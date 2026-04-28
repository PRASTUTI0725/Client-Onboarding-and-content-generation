import { Router, type IRouter } from "express";
import { db, clientsTable, onboardingProfilesTable, strategiesTable, plannersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateClientBody,
  GenerateStrategyBody,
  UpdateStrategyBody,
} from "@workspace/api-zod";
import { enrich } from "../lib/strategy/enrich.js";
import {
  generateStructuredStrategy,
  generateStrategyDocument,
  buildStrategySummary,
  type StrategyDetailLevel,
} from "../lib/strategy/generate.js";
import { selectTemplate, type TemplateType } from "../lib/strategy/templates.js";
import { createHash, randomUUID } from "node:crypto";
import { markAIFallbackUsed, markFallbackUsed } from "../lib/runtime-mode.js";
import { isDbUnavailableError } from "../lib/db-unavailable.js";
import multer from "multer";
import {
  getRequestLLMProvider,
  getNoUsableAiProviderUserMessage,
  isNoUsableAiProviderError,
  shouldUseRealAI,
} from "../lib/llm/request-provider.js";
import type { LLMProvider } from "../lib/llm/types.js";
import {
  fetchInstagramSummary,
  fetchWebsiteSummary,
} from "../lib/extraction/summaries.js";
import { getClientContextWithCache } from "../lib/extraction/client-context-cache.js";
import { mergeInstagramForStrategy } from "../lib/extraction/instagram-for-strategy.js";
import { isSowComplete } from "../lib/sow-completion.js";
import { effectiveScopeOfWork } from "../lib/sow-canonical.js";
import {
  extractSowTextWithMetadata,
  inferOperationalDefaultsFromSowText,
} from "../lib/sow-pdf-extract.js";
import { type BusinessDna, buildBusinessDnaFromPublicSignals } from "../lib/business-dna.js";
import { assessSowPdfMismatch } from "../lib/sow-pdf-mismatch.js";
import { extractPdfText } from "../lib/pdf-text.js";
import { buildOptimizedSowContext } from "../lib/sow-context.js";
import { buildPromptBudgetStats, estimateTokens } from "../lib/llm/prompt-budget.js";
import {
  toPublicAiFailure,
  realAiDisabledFailure,
  type PublicAiFailure,
} from "../lib/ai-failure.js";
import {
  getMcpConfigFromEnv,
  isMcpAvailable,
  orchestrateStrategyEnrichment,
  type StrategyMcpResult,
} from "../lib/mcp/orchestrate.js";
import {
  injectPromptVariables,
  loadPromptTemplate,
  mapStrategyV1PromptVariables,
  STRATEGY_V1_OPTIONAL_PLACEHOLDERS,
  STRATEGY_V1_REQUIRED_PLACEHOLDERS,
} from "../lib/prompts/template.js";

const router: IRouter = Router();
type MemoryClient = {
  id: string;
  name: string;
  website: string | null;
  instagramHandle: string | null;
  oneLineDescription: string | null;
  sow: unknown;
  createdAt: string;
};

type MemoryOnboarding = {
  id: string;
  clientId: string;
  rawInput: {
    name: string;
    websiteUrl: string;
    instagramHandle: string;
    oneLineDescription: string;
  };
  enrichedData: unknown;
};

type MemoryStrategy = {
  id: string;
  clientId: string;
  structuredStrategy: Record<string, unknown>;
  strategyDocument: string;
  templateType: string;
  version: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const memoryClients = new Map<string, MemoryClient>();
const memoryOnboarding = new Map<string, MemoryOnboarding>();
const memoryStrategies = new Map<string, MemoryStrategy>();
const sowPdfDrafts = new Map<
  string,
  {
    fileName: string;
    extractedText: string;
    suggestions: Partial<{
      understandingOfRequirements: string;
      scopeOfWork: string;
      industry: string;
      targetAudience: string;
      parseWarnings: string[];
      structuredSections: Record<string, string>;
      pricingOptions: string;
      timeline: string;
      paymentTerms: string;
      nextSteps: string;
      platforms: string[];
      monthlyPosts: Record<string, number>;
      contentMix: Record<string, number>;
      deliverables: string[];
      toneByPlatform: Record<string, string>;
    }>;
    updatedAt: string;
  }
>();
const ONBOARD_PARSE_CACHE_TTL_MS = 10 * 60 * 1000;
const onboardParseCache = new Map<
  string,
  {
    extractedText: string;
    suggestions: SowInferred;
    createdAt: number;
  }
>();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
let demoSeeded = false;
function estimateRequestBytes(value: unknown): number {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function mergeEnrichedProvenance(
  enrichedData: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = enrichedData ?? {};
  return {
    ...current,
    __provenance: {
      ...(typeof current.__provenance === "object" && current.__provenance !== null
        ? (current.__provenance as Record<string, unknown>)
        : {}),
      ...patch,
    },
  };
}

function isValidBusinessDna(value: unknown): value is BusinessDna {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function hashPdfBuffer(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}

function readOnboardParseCache(key: string):
  | {
      extractedText: string;
      suggestions: SowInferred;
    }
  | null {
  const hit = onboardParseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.createdAt > ONBOARD_PARSE_CACHE_TTL_MS) {
    onboardParseCache.delete(key);
    return null;
  }
  return { extractedText: hit.extractedText, suggestions: hit.suggestions };
}

function writeOnboardParseCache(key: string, value: { extractedText: string; suggestions: SowInferred }): void {
  onboardParseCache.set(key, { ...value, createdAt: Date.now() });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms (${label})`)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const CANONICAL_SECTION_KEYS = [
  "marketNarrative",
  "problemGapSolution",
  "brandFoundation",
  "brandPhilosophy",
  "audience",
  "emotionalDrivers",
  "platformStrategy",
  "contentStrategy",
  "kpis",
  "trackingPlan",
  "executionPhases",
  "assetRequirements",
] as const;

function buildMcpProvenance(meta: {
  toolName?: string | null;
  status: string;
  timestamp: string;
  toolResultSummary?: Record<string, unknown> | null;
}) {
  return {
    toolName: meta.toolName ?? null,
    status: meta.status,
    timestamp: meta.timestamp,
    toolResultSummary: meta.toolResultSummary ?? null,
  };
}

type StrategySections = {
  positioning: string;
  idealAudience: string[];
  channelPlan: string[];
  messagingPillars: string[];
  cta: string;
  next30Days: string[];
};

const DEMO_CLIENTS: Array<{
  name: string;
  website: string;
  instagramHandle: string;
  oneLineDescription: string;
  templateType: string;
  sections: StrategySections;
  sow: {
    understandingOfRequirements: string;
    scopeOfWork: string;
    pricingOptions?: string;
    timeline?: string;
    paymentTerms?: string;
    nextSteps?: string;
    approval?: { approved: boolean };
    platforms: string[];
    monthlyPosts: Record<string, number>;
    contentMix: Record<string, number>;
    deliverables: string[];
    toneByPlatform: Record<string, string>;
  };
}> = [
  {
    name: "Niyati Jain · The Social Idiots",
    website: "https://thesocialidiots.com",
    instagramHandle: "@niyatijain",
    oneLineDescription:
      "Demo template client: Boutique social growth consultancy for D2C and personal brands.",
    templateType: "personal_brand",
    sections: {
      positioning:
        "The Social Idiots is positioned as a high-accountability growth partner that blends operator-level execution with creator-native storytelling.",
      idealAudience: [
        "D2C founders with early product-market fit and inconsistent content systems.",
        "Service-business founders wanting personal-brand-led inbound demand.",
        "Teams that value fast iteration over agency bureaucracy.",
      ],
      channelPlan: [
        "Instagram Reels for founder POV + proof.",
        "LinkedIn text posts for authority and conversion intent.",
        "Weekly email recap to convert high-intent lurkers.",
      ],
      messagingPillars: [
        "No-fluff playbooks from live client execution.",
        "Results transparency (wins, misses, and learnings).",
        "Founder identity as the trust engine.",
      ],
      cta: "DM 'SYSTEM' to get the 30-day founder content operating system.",
      next30Days: [
        "Publish 12 founder POV reels.",
        "Launch weekly case-study carousel format.",
        "Ship lead magnet + DM keyword funnel.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: social growth program requirements captured for template client.",
      scopeOfWork: "Demo: strategy, content creation, and platform management per SOW.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["Instagram", "LinkedIn"],
      monthlyPosts: { Instagram: 16, LinkedIn: 8 },
      contentMix: { education: 8, thought_leadership: 6, social_proof: 5, promotion: 5 },
      deliverables: ["Weekly case-study carousel", "2 founder thought pieces per week"],
      toneByPlatform: {
        Instagram: "Punchy, founder-energy, tactical and direct.",
        LinkedIn: "Operator-to-operator clarity with concrete insights.",
      },
    },
  },
  {
    name: "Lumen Skin Lab",
    website: "https://lumenskinlab.com",
    instagramHandle: "@lumenskinlab",
    oneLineDescription:
      "Demo template client: Clinical D2C skincare brand focused on sensitive-skin routines.",
    templateType: "d2c_growth",
    sections: {
      positioning:
        "Lumen Skin Lab is a science-forward skincare brand translating dermatology-grade routines into simple, trustable daily habits.",
      idealAudience: [
        "Women 24-38 navigating sensitivity, acne marks, or barrier repair.",
        "Shoppers who need proof before purchasing premium skincare.",
      ],
      channelPlan: [
        "Instagram educational reels + routine explainers.",
        "UGC testimonial stories for conversion confidence.",
        "Landing-page traffic push from offer-led posts.",
      ],
      messagingPillars: [
        "Ingredient education without jargon.",
        "Before/after realism and routine consistency.",
        "Barrier-first skin philosophy.",
      ],
      cta: "Take the 2-minute skin routine quiz to get your starter protocol.",
      next30Days: [
        "Run 3-week barrier-repair challenge content arc.",
        "Add 8 UGC proof assets with dermatologist commentary.",
        "Launch first-purchase routine bundle offer.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: D2C skincare launch and education requirements.",
      scopeOfWork: "Demo: content, community, and conversion program scope.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["Instagram", "YouTube"],
      monthlyPosts: { Instagram: 18, YouTube: 4 },
      contentMix: { education: 8, social_proof: 5, thought_leadership: 5, promotion: 4 },
      deliverables: ["Weekly routine walkthrough reel", "Monthly dermatologist FAQ video"],
      toneByPlatform: {
        Instagram: "Warm, credible, reassuring and practical.",
        YouTube: "Detailed and educational with clear sequencing.",
      },
    },
  },
  {
    name: "Peak Dental Studio",
    website: "https://peakdentalstudio.com",
    instagramHandle: "@peakdentalstudio",
    oneLineDescription:
      "Demo template client: Premium family dental clinic growing cosmetic and implant consults.",
    templateType: "healthcare",
    sections: {
      positioning:
        "Peak Dental Studio combines advanced treatment quality with anxiety-free patient experience, positioned as the trusted modern clinic in its city.",
      idealAudience: [
        "Families seeking a long-term primary dentist.",
        "Adults considering smile makeover or implant procedures.",
      ],
      channelPlan: [
        "Instagram myth-busting reels + patient journey stories.",
        "Google-first educational snippets repurposed to social.",
        "Monthly consultation campaign with urgency windows.",
      ],
      messagingPillars: [
        "Clarity over fear in treatment decisions.",
        "Proof through patient transformations.",
        "Trust through doctor-led education.",
      ],
      cta: "Book a smile assessment this week for a personalized treatment plan.",
      next30Days: [
        "Publish 4 treatment myth-buster videos.",
        "Launch implant FAQ conversion funnel.",
        "Feature 6 patient success stories with doctor commentary.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: dental growth and patient education needs.",
      scopeOfWork: "Demo: clinical content and consult conversion scope.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["Instagram"],
      monthlyPosts: { Instagram: 16 },
      contentMix: { education: 5, social_proof: 4, promotion: 4, thought_leadership: 3 },
      deliverables: ["Weekly doctor explainers", "Weekly patient testimonial post"],
      toneByPlatform: {
        Instagram: "Reassuring, trustworthy, and medically clear without jargon.",
      },
    },
  },
  {
    name: "UrbanKey Realty",
    website: "https://urbankeyrealty.in",
    instagramHandle: "@urbankeyrealty",
    oneLineDescription:
      "Demo template client: Real-estate advisory helping first-time buyers and investors.",
    templateType: "real_estate",
    sections: {
      positioning:
        "UrbanKey Realty is the no-hype advisory partner for urban buyers who want clear numbers, cleaner decisions, and faster confidence.",
      idealAudience: [
        "First-time home buyers worried about bad decisions.",
        "Working professionals comparing rent vs buy options.",
        "Investors looking for practical yield and resale potential.",
      ],
      channelPlan: [
        "Instagram neighborhood breakdown reels.",
        "LinkedIn market commentary for investor trust.",
        "Lead capture via checklist and discovery calls.",
      ],
      messagingPillars: [
        "Location intelligence and buying filters.",
        "Deal risk flags most buyers miss.",
        "Transparent advisory process.",
      ],
      cta: "DM 'CHECKLIST' to get our first-home buying due-diligence sheet.",
      next30Days: [
        "Drop 8 area intelligence reels.",
        "Publish rent-vs-buy calculator walkthrough.",
        "Launch Sunday Q&A live for buyers.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: buyer advisory and market education requirements.",
      scopeOfWork: "Demo: reels, threads, and lead capture scope.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["Instagram", "LinkedIn"],
      monthlyPosts: { Instagram: 14, LinkedIn: 6 },
      contentMix: { education: 6, thought_leadership: 5, social_proof: 5, promotion: 4 },
      deliverables: ["Weekly area report post", "Monthly investor insights thread"],
      toneByPlatform: {
        Instagram: "Simple, confidence-building, numbers-light explanations.",
        LinkedIn: "Data-backed, operator-level market interpretation.",
      },
    },
  },
  {
    name: "Aarav Mehta (Founder Brand)",
    website: "https://aaravmehta.com",
    instagramHandle: "@aaravbuilds",
    oneLineDescription:
      "Demo template client: B2B SaaS founder building authority to drive warm inbound pipeline.",
    templateType: "personal_brand",
    sections: {
      positioning:
        "Aarav is positioned as a transparent founder-operator documenting real GTM decisions, trade-offs, and outcomes in public.",
      idealAudience: [
        "Early-stage SaaS founders and GTM leads.",
        "Operators seeking practical execution frameworks.",
      ],
      channelPlan: [
        "LinkedIn for long-form operator takes.",
        "Instagram for short punchy founder snippets.",
        "Newsletter for deep tactical debriefs.",
      ],
      messagingPillars: [
        "Build-in-public learnings.",
        "GTM experiments and postmortems.",
        "Founder leadership and culture signals.",
      ],
      cta: "Subscribe for weekly operator notes and templates.",
      next30Days: [
        "Ship weekly GTM teardown post.",
        "Publish 3 founder story reels.",
        "Create a lead magnet from best-performing frameworks.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: founder brand and pipeline growth requirements.",
      scopeOfWork: "Demo: LinkedIn + Instagram authority content scope.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["LinkedIn", "Instagram"],
      monthlyPosts: { LinkedIn: 12, Instagram: 10 },
      contentMix: { thought_leadership: 6, education: 6, social_proof: 5, promotion: 5 },
      deliverables: ["Weekly build-in-public update", "Bi-weekly framework carousel"],
      toneByPlatform: {
        LinkedIn: "Operator-smart, specific, and candid.",
        Instagram: "Fast, direct, energetic founder POV.",
      },
    },
  },
  {
    name: "Marigold House Café",
    website: "https://marigoldhousecafe.com",
    instagramHandle: "@marigoldhousecafe",
    oneLineDescription:
      "Demo template client: Boutique café and bakery driving weekday footfall and brunch reservations.",
    templateType: "hospitality",
    sections: {
      positioning:
        "Marigold House Café is positioned as a neighborhood ritual space where handcrafted menu moments and warm hospitality create repeat visits.",
      idealAudience: [
        "Young professionals looking for cozy weekday work spots.",
        "Weekend brunch seekers and celebration groups.",
      ],
      channelPlan: [
        "Instagram reels for menu and ambience storytelling.",
        "Stories for daily specials and booking prompts.",
        "UGC repost loop for community proof.",
      ],
      messagingPillars: [
        "Signature menu craftsmanship.",
        "Space, mood, and community.",
        "Occasion-led experiences (brunch, celebrations).",
      ],
      cta: "Reserve your brunch slot this weekend via DM.",
      next30Days: [
        "Launch weekday coffee + croissant campaign.",
        "Publish chef-feature mini-series.",
        "Run UGC contest for local community growth.",
      ],
    },
    sow: {
      understandingOfRequirements: "Demo: footfall and reservation growth requirements.",
      scopeOfWork: "Demo: menu, ambience, and community content scope.",
      pricingOptions: "",
      timeline: "",
      paymentTerms: "",
      nextSteps: "",
      approval: { approved: true },
      platforms: ["Instagram"],
      monthlyPosts: { Instagram: 20 },
      contentMix: { education: 5, social_proof: 5, thought_leadership: 5, promotion: 5 },
      deliverables: ["Daily stories (Mon-Sat)", "Weekly menu spotlight reel"],
      toneByPlatform: {
        Instagram: "Warm, sensory, inviting, and community-first.",
      },
    },
  },
];

function serializeList(items: string[]): string {
  return items.map((x) => `- ${x}`).join("\n");
}

function buildStrategyDocument(name: string, s: StrategySections): string {
  return `# ${name} Strategy

## Positioning
${s.positioning}

## Ideal Audience
${serializeList(s.idealAudience)}

## Channel Plan
${serializeList(s.channelPlan)}

## Messaging Pillars
${serializeList(s.messagingPillars)}

## CTA
${s.cta}

## Next 30 Days
${serializeList(s.next30Days)}
`;
}

function buildStructuredFromSections(templateType: string, s: StrategySections) {
  const canonicalSections = buildCanonicalFromLegacySections(s, {
    name: "Demo Client",
    website: "",
    instagramHandle: "",
    oneLineDescription: "",
  });
  return {
    template: templateType,
    positioning: s.positioning,
    idealAudience: s.idealAudience,
    channels: s.channelPlan,
    messagingPillars: s.messagingPillars,
    cta: s.cta,
    next30Days: s.next30Days,
    canonicalSections,
    __meta: {
      sectionApprovals: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])),
      regenerateCounters: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
    },
  };
}

function fallbackVariantSections(
  client: MemoryClient,
  templateType: string,
  version: number,
): StrategySections {
  const baseName = client.name;
  const descriptor = client.oneLineDescription ?? "growth";
  const variants = {
    performance_marketing: [
      {
        positioning: `${baseName} wins by turning every content asset into measurable pipeline momentum with weekly experiment loops.`,
        idealAudience: [
          "Growth-focused teams measured on qualified leads.",
          "Founders who need performance clarity, not vanity metrics.",
        ],
        channelPlan: ["High-velocity Instagram reels", "LinkedIn offer-led posts", "Weekly retargeting hooks"],
        messagingPillars: ["Experiment transparency", "Data-backed content decisions", "Conversion-first creative"],
        cta: "Book a growth sprint call to map your next 30 days.",
        next30Days: ["Run 4 conversion experiments", "Ship 2 lead magnets", "Set weekly KPI review cadence"],
      },
      {
        positioning: `${baseName} is positioned as the practical growth engine for teams that need reliable inbound from content, not random spikes.`,
        idealAudience: [
          "Small marketing teams with big monthly targets.",
          "Operators replacing ad dependency with content systems.",
        ],
        channelPlan: ["LinkedIn authority sequences", "Instagram proof snippets", "Email follow-up assets"],
        messagingPillars: ["Pipeline math made simple", "Creative-to-revenue linkage", "Proof over promises"],
        cta: "DM 'PIPELINE' for the conversion content blueprint.",
        next30Days: ["Publish 3 case-study narratives", "Create 1 pillar landing page", "Launch weekly optimization cycle"],
      },
    ],
    personal_brand: [
      {
        positioning: `${baseName} is the operator voice in ${descriptor}, translating day-to-day execution into practical signals others can implement quickly.`,
        idealAudience: [
          "Founders and leaders building authority in public.",
          "Practitioners seeking real-world execution context.",
        ],
        channelPlan: ["LinkedIn thought pieces", "Instagram founder POV reels", "Weekly newsletter reflections"],
        messagingPillars: ["Build in public", "Operator notes", "Leadership narrative"],
        cta: "Subscribe for weekly operator notes.",
        next30Days: ["Ship 8 founder posts", "Record 4 short POV videos", "Launch monthly Q&A thread"],
      },
      {
        positioning: `${baseName} stands for clarity-first founder storytelling that turns expertise into trust and trust into demand.`,
        idealAudience: ["Peers and aspiring founders", "Decision-makers evaluating expert partners"],
        channelPlan: ["Instagram story-led narrative", "LinkedIn postmortems", "Email recap loop"],
        messagingPillars: ["Honest lessons", "Frameworks from live work", "Strong point of view"],
        cta: "Reply 'INSIGHTS' to get the founder content framework.",
        next30Days: ["Publish 6 tactical stories", "Post 4 teardown threads", "Package top learnings into lead asset"],
      },
    ],
    d2c_growth: [
      {
        positioning: `${baseName} grows by combining brand storytelling with conversion architecture so awareness reliably compounds into sales.`,
        idealAudience: ["Considered-purchase shoppers", "Value-conscious repeat buyers"],
        channelPlan: ["Instagram reels", "Creator collab slots", "Offer reinforcement stories"],
        messagingPillars: ["Problem-solution clarity", "Social proof", "Offer trust"],
        cta: "Tap through to claim the starter bundle.",
        next30Days: ["Launch 2 hero offers", "Publish 10 product education assets", "Add testimonial flywheel"],
      },
      {
        positioning: `${baseName} positions itself as the practical choice for customers who want dependable outcomes without complexity.`,
        idealAudience: ["First-time category buyers", "Shoppers evaluating alternatives"],
        channelPlan: ["Product explainer carousel", "UGC reels", "Weekly FAQ stories"],
        messagingPillars: ["Benefits in plain language", "Routine integration", "Proof from real users"],
        cta: "Start with the best-fit routine today.",
        next30Days: ["Add 6 FAQ videos", "Build comparison content series", "Ship retention-focused follow-ups"],
      },
    ],
    healthcare: [
      {
        positioning: `${baseName} is the trusted clinic voice that replaces confusion with confidence and helps patients take the next right step.`,
        idealAudience: ["Patients postponing treatment due to uncertainty", "Families seeking long-term care partners"],
        channelPlan: ["Doctor-led explainers", "Patient stories", "Consultation prompt posts"],
        messagingPillars: ["Education without fear", "Safety and outcomes", "Trust through expertise"],
        cta: "Book a consultation to get your personalized treatment roadmap.",
        next30Days: ["Run weekly myth-buster series", "Publish 5 patient transformations", "Create treatment-cost explainer content"],
      },
      {
        positioning: `${baseName} combines clinical precision with compassionate care, positioned as the modern standard for confident patient decisions.`,
        idealAudience: ["Working adults evaluating elective treatment", "Families prioritizing preventive care"],
        channelPlan: ["Instagram educational reels", "Stories for appointment nudges", "Website FAQ refreshes"],
        messagingPillars: ["Clarity", "Proof", "Care quality"],
        cta: "Reserve your assessment slot this week.",
        next30Days: ["Launch treatment journey mini-series", "Add trust-building staff stories", "Promote limited consult slots"],
      },
    ],
    hospitality: [
      {
        positioning: `${baseName} is where local rituals are made — a hospitality brand built on memorable details and repeat-worthy experiences.`,
        idealAudience: ["Local professionals and weekend social groups", "Experience-seeking café/restaurant lovers"],
        channelPlan: ["Instagram atmosphere reels", "Story-driven menu drops", "UGC community features"],
        messagingPillars: ["Signature moments", "Taste + craft", "Community vibe"],
        cta: "Reserve your table for this weekend.",
        next30Days: ["Publish 12 menu highlight assets", "Launch weekly event prompt", "Run guest-feature UGC series"],
      },
      {
        positioning: `${baseName} is positioned as the neighborhood favorite that turns everyday visits into delightful repeat habits.`,
        idealAudience: ["Nearby residents", "Brunch and celebration seekers"],
        channelPlan: ["Reels for menu and mood", "Stories for daily urgency", "Collab posts with local creators"],
        messagingPillars: ["Craft", "Ambience", "Belonging"],
        cta: "DM to secure your preferred slot.",
        next30Days: ["Create daily story cadence", "Promote seasonal menu drop", "Launch loyalty-led content series"],
      },
    ],
    real_estate: [
      {
        positioning: `${baseName} is the straight-talking advisor helping buyers and investors avoid expensive mistakes and move with confidence.`,
        idealAudience: ["First-time buyers", "Yield-focused investors"],
        channelPlan: ["Area breakdown reels", "LinkedIn market insight posts", "Checklist-led lead capture"],
        messagingPillars: ["Decision clarity", "Risk avoidance", "Opportunity timing"],
        cta: "DM 'CHECKLIST' to get the buyer due diligence sheet.",
        next30Days: ["Publish 8 market explainers", "Launch rent-vs-buy content arc", "Host weekly buyer Q&A"],
      },
      {
        positioning: `${baseName} makes real estate decisions simpler by translating local market complexity into actionable next steps.`,
        idealAudience: ["Upgraders and relocating families", "Professionals planning first purchase"],
        channelPlan: ["Instagram education + proof", "LinkedIn investment commentary", "Consultation funnel posts"],
        messagingPillars: ["Local expertise", "Transparent process", "Outcome-focused guidance"],
        cta: "Book a 20-minute property clarity call.",
        next30Days: ["Ship neighborhood ranking series", "Post 5 client journey stories", "Deploy lead qualification checklist"],
      },
    ],
    brand_building: [
      {
        positioning: `${baseName} is building a differentiated category position anchored in practical value and memorable brand language.`,
        idealAudience: ["Primary audience aligned to current offer", "Adjacent audience with high expansion potential"],
        channelPlan: ["Brand narrative content", "Education assets", "Proof + conversion cadence"],
        messagingPillars: ["Category story", "Unique mechanism", "Trust-building proof"],
        cta: "Start with our flagship offer.",
        next30Days: ["Sharpen brand narrative assets", "Publish audience education sequence", "Launch conversion-focused campaign"],
      },
      {
        positioning: `${baseName} stands out by pairing clear positioning with consistent execution so the brand is recognized and remembered.`,
        idealAudience: ["People actively looking for a better solution", "People currently using alternatives with pain points"],
        channelPlan: ["Instagram", "Website storytelling", "Email nurture"],
        messagingPillars: ["Relevance", "Distinctiveness", "Consistency"],
        cta: "Explore the brand playbook and next steps.",
        next30Days: ["Define monthly narrative spine", "Ship core proof assets", "Activate offer-led CTA cadence"],
      },
    ],
  } as const;

  const inferredTemplate =
    templateType in variants
      ? (templateType as keyof typeof variants)
      : client.oneLineDescription?.toLowerCase().includes("clinic")
        ? "healthcare"
        : client.oneLineDescription?.toLowerCase().includes("real estate")
          ? "real_estate"
          : client.oneLineDescription?.toLowerCase().includes("cafe")
            ? "hospitality"
            : "brand_building";
  const options = variants[inferredTemplate];
  const selected = options[(version - 1) % options.length];
  return {
    positioning: selected.positioning,
    idealAudience: [...selected.idealAudience],
    channelPlan: [...selected.channelPlan],
    messagingPillars: [...selected.messagingPillars],
    cta: selected.cta,
    next30Days: [...selected.next30Days],
  };
}

function seedDemoClients() {
  let added = 0;
  for (const demo of DEMO_CLIENTS) {
    const existing = Array.from(memoryClients.values()).find((c) => c.name === demo.name);
    if (existing) continue;
    const id = randomUUID();
    const now = new Date().toISOString();
    memoryClients.set(id, {
      id,
      name: demo.name,
      website: demo.website,
      instagramHandle: demo.instagramHandle,
      oneLineDescription: demo.oneLineDescription,
      sow: demo.sow,
      createdAt: now,
    });
    memoryOnboarding.set(id, {
      id: randomUUID(),
      clientId: id,
      rawInput: {
        name: demo.name,
        websiteUrl: demo.website,
        instagramHandle: demo.instagramHandle,
        oneLineDescription: demo.oneLineDescription,
      },
      enrichedData: {
        brand_name: demo.name,
        positioning: demo.sections.positioning,
        platform: demo.sow.platforms[0] ?? "Instagram",
      },
    });
    memoryStrategies.set(id, {
      id: randomUUID(),
      clientId: id,
      structuredStrategy: buildStructuredFromSections(demo.templateType, demo.sections),
      strategyDocument: buildStrategyDocument(demo.name, demo.sections),
      templateType: demo.templateType,
      version: 1,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    added += 1;
  }
  demoSeeded = true;
  return added;
}

type SowInferred = {
  understandingOfRequirements?: string;
  scopeOfWork?: string;
  industry?: string;
  targetAudience?: string;
  normalizedSections?: Record<string, string>;
  parseWarnings: string[];
  /** Roman I–VIII or classic keys; same shape for onboard and pdf-parse. */
  structuredSections?: Record<string, string>;
  platforms: string[];
  monthlyPosts: Record<string, number>;
  contentMix: Record<string, number>;
  deliverables: string[];
  toneByPlatform: Record<string, string>;
  sowVersion?: number;
  strategyLaunchPlanning?: string;
  contentCreation?: string;
  excludedCommercial?: string;
  parseMeta?: import("../lib/sow-canonical.js").SowParseMeta;
};

const DELIVERABLE_KEYWORD_MAP: Array<{ label: string; pattern: RegExp }> = [
  { label: "Reels", pattern: /\breels?\b|short[-\s]?form\s+video/i },
  { label: "Stories", pattern: /\bstor(y|ies)\b/i },
  { label: "Carousels", pattern: /\bcarousels?\b/i },
  { label: "Static posts", pattern: /\bstatic\b|\bimage\s+post/i },
  { label: "Monthly report", pattern: /\breport(ing)?\b/i },
  { label: "Ad creatives", pattern: /\bad(s)?\b|\bcreative(s)?\b/i },
  { label: "Content calendar", pattern: /\bcalendar\b|\bcontent\s+plan/i },
];

function normalizeDeliverables(input: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const cleaned = raw
      .replace(/^[-•*]\s*|\d+[.)]\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    const mapped = DELIVERABLE_KEYWORD_MAP.find((item) => item.pattern.test(cleaned))?.label;
    const candidate = mapped ?? cleaned;
    if (candidate.length > 70 || /\b(payment|pricing|gst|inr|terms?)\b/i.test(candidate)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * SOW PDF autofill: classic headings or Roman I–VIII; operational defaults from merged blobs.
 */
function inferSowFromExtractedText(text: string): SowInferred {
  const meta = extractSowTextWithMetadata(text);
  const {
    understandingOfRequirements,
    scopeOfWork,
    industry,
    targetAudience,
    sectionDeliverablesBlob,
    operationalBlob,
    parseWarnings,
    structuredSections,
    strategyLaunchPlanning,
    contentCreation,
    excludedCommercial,
    normalizedSections,
    parseMeta,
    sowVersion,
  } = meta;
  const opBlob = [operationalBlob, sectionDeliverablesBlob].filter(Boolean).join("\n\n");
  const v2Base = {
    ...(strategyLaunchPlanning ? { strategyLaunchPlanning } : {}),
    ...(contentCreation ? { contentCreation } : {}),
    ...(excludedCommercial ? { excludedCommercial } : {}),
    ...(parseMeta ? { parseMeta } : {}),
    ...(sowVersion != null ? { sowVersion } : {}),
  };
  if (!opBlob.trim()) {
    return {
      ...v2Base,
      ...(understandingOfRequirements ? { understandingOfRequirements } : {}),
      ...(scopeOfWork ? { scopeOfWork } : {}),
      ...(industry ? { industry } : {}),
      ...(targetAudience ? { targetAudience } : {}),
      ...(normalizedSections && Object.keys(normalizedSections).length > 0 ? { normalizedSections } : {}),
      parseWarnings: [...parseWarnings],
      ...(Object.keys(structuredSections).length > 0 ? { structuredSections } : {}),
      platforms: [],
      monthlyPosts: {},
      contentMix: {},
      deliverables: [],
      toneByPlatform: {},
    };
  }
  const op = inferOperationalDefaultsFromSowText(opBlob);
  const extraFromDeliverables: string[] = [];
  for (const line of sectionDeliverablesBlob.split("\n")) {
    const t = line.replace(/^[-•*]\s*|\d+[.)]\s*/, "").trim();
    if (t.length < 6 || t.length > 400) continue;
    if (!/[a-zA-Z]/.test(t)) continue;
    if (op.deliverables.some((d) => t.includes(d) || d.includes(t))) continue;
    extraFromDeliverables.push(t);
  }
  const deliverables = normalizeDeliverables([...op.deliverables, ...extraFromDeliverables]);
  return {
    ...v2Base,
    ...(understandingOfRequirements ? { understandingOfRequirements } : {}),
    ...(scopeOfWork ? { scopeOfWork } : {}),
    ...(industry ? { industry } : {}),
    ...(targetAudience ? { targetAudience } : {}),
    ...(normalizedSections && Object.keys(normalizedSections).length > 0 ? { normalizedSections } : {}),
    parseWarnings: [...parseWarnings],
    ...(Object.keys(structuredSections).length > 0 ? { structuredSections } : {}),
    ...op,
    deliverables,
  };
}

router.get("/clients", async (_req, res) => {
  try {
    const rows = await db.execute<{
      id: string;
      name: string;
      website: string | null;
      instagram_handle: string | null;
      one_line_description: string | null;
      created_at: Date;
      template_type: string | null;
      status: string | null;
    }>(sql`
      select c.id, c.name, c.website, c.instagram_handle, c.one_line_description, c.created_at,
        s.template_type, s.status
      from clients c
      left join lateral (
        select template_type, status
        from strategies
        where client_id = c.id
        order by version desc
        limit 1
      ) s on true
      order by c.created_at desc
    `);

    const items = rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      website: r.website,
      instagramHandle: r.instagram_handle,
      oneLineDescription: r.one_line_description,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      hasStrategy: r.template_type !== null,
      templateType: r.template_type,
      status: r.status,
    }));
    res.json(items);
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    if (!demoSeeded) seedDemoClients();
    _req.log.warn({ err }, "DB unavailable, serving clients from in-memory fallback");
    res.json(
      Array.from(memoryClients.values())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) => ({
          id: c.id,
          name: c.name,
          website: c.website,
          instagramHandle: c.instagramHandle,
          oneLineDescription: c.oneLineDescription,
          createdAt: c.createdAt,
          hasStrategy: memoryStrategies.has(c.id),
          templateType: memoryStrategies.get(c.id)?.templateType ?? null,
          status: memoryStrategies.get(c.id)?.status ?? null,
        })),
    );
  }
});

router.post("/clients/demo/seed", (_req, res) => {
  const added = seedDemoClients();
  res.json({
    added,
    totalDemoClients: DEMO_CLIENTS.length,
    message:
      added === 0
        ? "Demo clients already present"
        : `Added ${added} demo clients to fallback memory`,
  });
});

router.post("/clients", async (req, res) => {
  const startedAt = Date.now();
  const body = CreateClientBody.parse(req.body);
  const requestSizeBytes = estimateRequestBytes(body);
  const backgroundDnaQueuedAt = new Date().toISOString();
  const hasAutoDnaContext = Boolean(
    body.websiteUrl.trim() || body.instagramHandle.trim() || body.oneLineDescription.trim(),
  );
  const createRaw = {
    name: body.name,
    websiteUrl: body.websiteUrl,
    instagramHandle: body.instagramHandle,
    oneLineDescription: body.oneLineDescription,
  };
  const pendingEnrichedData = mergeEnrichedProvenance(null, {
    dnaBackgroundStatus: hasAutoDnaContext ? "pending" : "idle",
    ...(hasAutoDnaContext ? { dnaBackgroundQueuedAt: backgroundDnaQueuedAt } : {}),
    dnaBackgroundMode: "lightweight",
  });
  const useLightweightProvider = hasAutoDnaContext && shouldUseRealAI(req);
  let lightweightProvider: LLMProvider | null = null;
  if (useLightweightProvider) {
    try {
      lightweightProvider = getRequestLLMProvider(req);
    } catch (err) {
      req.log.warn({ err }, "Lightweight Business DNA provider unavailable; falling back to public-signal enrichment");
    }
  }
  try {
    const [client] = await db
      .insert(clientsTable)
      .values({
        name: body.name,
        website: body.websiteUrl,
        instagramHandle: body.instagramHandle,
        oneLineDescription: body.oneLineDescription,
      })
      .returning();

    if (!client) {
      res.status(500).json({ error: "Failed to create client" });
      return;
    }

    const [onboardingProfile] = await db.insert(onboardingProfilesTable).values({
      clientId: client.id,
      rawInput: createRaw,
      enrichedData: pendingEnrichedData,
    }).returning();

    req.log.info(
      { requestSizeBytes, responseTimeMs: elapsedMs(startedAt) },
      "Client creation telemetry",
    );
    res.status(201).json(serializeClient(client));
    if (onboardingProfile && hasAutoDnaContext) {
      void (async () => {
        const enrichStart = Date.now();
        let finalBackgroundStatus = "pending";
        try {
          console.log("=== BUSINESS DNA TASK START ===");
          console.log("Raw inputs:", {
            website: body.websiteUrl,
            instagram: body.instagramHandle,
            rawInput: createRaw,
          });
          console.log("Background provider env availability:", {
            groq: Boolean(process.env.GROQ_API_KEY?.trim()),
            openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
            gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
            openaiBaseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || null,
          });
          req.log.info(
            {
              clientId: client.id,
              clientName: body.name,
              websiteUrl: body.websiteUrl,
              instagramHandle: body.instagramHandle,
              queuedAt: backgroundDnaQueuedAt,
            },
            "Background Business DNA job started",
          );
          const { businessDna, lightweightProviderLabel } = await withTimeout(
            (async () => {
              let enrichedProfile: Record<string, unknown> | null = null;
              let providerLabel: string | null = null;
              if (lightweightProvider) {
                console.log("Step 3: Calling enrich() with provider...");
                req.log.info({ clientId: client.id }, "Background Business DNA: lightweight provider step started");
                try {
                  const providerInfo = lightweightProvider.describe?.() ?? {
                    provider: lightweightProvider.id,
                    model: "default",
                  };
                  providerLabel = `${providerInfo.provider}:${providerInfo.model}`;
                  console.log("Provider used:", providerLabel);
                  const enriched = await enrich(
                    {
                      name: body.name,
                      websiteUrl: body.websiteUrl,
                      instagramHandle: body.instagramHandle,
                      oneLineDescription: body.oneLineDescription,
                    },
                    lightweightProvider,
                  );
                  enrichedProfile = enriched as Record<string, unknown>;
                  console.log("Enrich result:", enriched);
                  req.log.info(
                    { clientId: client.id, provider: providerLabel },
                    "Background Business DNA: lightweight provider step completed",
                  );
                } catch (providerErr) {
                  console.log("Provider used:", providerLabel ?? lightweightProvider.id);
                  console.log(
                    "Enrich result:",
                    providerErr instanceof Error ? `${providerErr.name}: ${providerErr.message}` : providerErr,
                  );
                  req.log.warn(
                    { clientId: client.id, providerErr },
                    "Background Business DNA: lightweight provider step failed; using public signals only",
                  );
                }
              } else {
                console.log("Step 3: Calling enrich() with provider...");
                console.log("Provider used:", null);
                console.log("Enrich result:", "SKIPPED_NO_PROVIDER");
                req.log.info({ clientId: client.id }, "Background Business DNA: no lightweight provider, using public signals only");
              }
              console.log("Step 4: Calling buildBusinessDnaFromPublicSignals...");
              console.log("Public signals input:", {
                name: body.name,
                websiteUrl: body.websiteUrl,
                instagramHandle: body.instagramHandle,
                oneLineDescription: body.oneLineDescription || null,
                instagramSummaryNotes: null,
                enrichedProfile,
              });
              req.log.info({ clientId: client.id }, "Background Business DNA: public-signal build started");
              const builtBusinessDna = await buildBusinessDnaFromPublicSignals({
                name: body.name,
                websiteUrl: body.websiteUrl,
                instagramHandle: body.instagramHandle,
                oneLineDescription: body.oneLineDescription || null,
                instagramSummaryNotes: null,
                enrichedProfile,
                skipInstagramFetch: true,
              });
              if (!isValidBusinessDna(builtBusinessDna)) {
                throw new Error("Business DNA builder returned an empty payload");
              }
              console.log("Final businessDna shape:", Object.keys(builtBusinessDna));
              req.log.info(
                { clientId: client.id, keys: Object.keys(builtBusinessDna) },
                "Background Business DNA: public-signal build completed",
              );
              return { businessDna: builtBusinessDna, lightweightProviderLabel: providerLabel };
            })(),
            90_000,
            `background business dna client=${client.id}`,
          );
          console.log("Step 5: Saving to onboarding...");
          req.log.info({ clientId: client.id }, "Background Business DNA: saving final payload");
          await db
            .update(onboardingProfilesTable)
            .set({
              enrichedData: mergeEnrichedProvenance(
                {
                  ...((onboardingProfile.enrichedData as Record<string, unknown> | null | undefined) ?? {}),
                  businessDna,
                },
                {
                  dnaBackgroundStatus: "ready",
                  dnaBackgroundCompletedAt: new Date().toISOString(),
                  dnaBackgroundProvider: lightweightProviderLabel ?? "public-signals",
                },
              ),
              updatedAt: new Date(),
            })
            .where(eq(onboardingProfilesTable.id, onboardingProfile.id));
          finalBackgroundStatus = "ready";
          console.log("=== TASK COMPLETE: " + finalBackgroundStatus + " ===");
          req.log.info(
            {
              clientId: client.id,
              durationMs: Date.now() - enrichStart,
              provider: lightweightProviderLabel ?? "public-signals",
            },
            "Deferred founder onboarding DNA enrichment completed",
          );
        } catch (enrichErr) {
          finalBackgroundStatus = "failed";
          console.log("=== TASK COMPLETE: " + finalBackgroundStatus + " ===");
          console.log(
            "Business DNA task error:",
            enrichErr instanceof Error ? `${enrichErr.name}: ${enrichErr.message}` : enrichErr,
          );
          req.log.error({ clientId: client.id, enrichErr }, "Background Business DNA job failed");
          await db
            .update(onboardingProfilesTable)
            .set({
              enrichedData: mergeEnrichedProvenance(
                (onboardingProfile.enrichedData as Record<string, unknown> | null | undefined) ?? {},
                {
                  dnaBackgroundStatus: "failed",
                  dnaBackgroundFailedAt: new Date().toISOString(),
                },
              ),
              updatedAt: new Date(),
            })
            .where(eq(onboardingProfilesTable.id, onboardingProfile.id))
            .catch(() => undefined);
          req.log.warn({ clientId: client.id, enrichErr }, "Deferred founder onboarding DNA enrichment failed");
        }
      })();
    }
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    req.log.warn({ err }, "DB unavailable, creating client in-memory");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const memoryClient: MemoryClient = {
      id,
      name: body.name,
      website: body.websiteUrl,
      instagramHandle: body.instagramHandle,
      oneLineDescription: body.oneLineDescription,
      sow: null,
      createdAt,
    };
    memoryClients.set(id, memoryClient);
    memoryOnboarding.set(id, {
      id: randomUUID(),
      clientId: id,
      rawInput: createRaw,
      enrichedData: pendingEnrichedData,
    });
    req.log.info(
      { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "db_unavailable" },
      "Client creation telemetry",
    );
    res.status(201).json(memoryClient);
    if (hasAutoDnaContext) {
      void (async () => {
      const enrichStart = Date.now();
      let finalBackgroundStatus = "pending";
      try {
        console.log("=== BUSINESS DNA TASK START ===");
        console.log("Raw inputs:", {
          website: body.websiteUrl,
          instagram: body.instagramHandle,
          rawInput: createRaw,
        });
        console.log("Background provider env availability:", {
          groq: Boolean(process.env.GROQ_API_KEY?.trim()),
          openrouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
          gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
          openaiBaseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || null,
        });
        req.log.info(
          {
            clientId: id,
            clientName: body.name,
            websiteUrl: body.websiteUrl,
            instagramHandle: body.instagramHandle,
            queuedAt: backgroundDnaQueuedAt,
          },
          "Background Business DNA job started (memory fallback)",
        );
        const { businessDna, lightweightProviderLabel } = await withTimeout(
          (async () => {
            let enrichedProfile: Record<string, unknown> | null = null;
            let providerLabel: string | null = null;
            if (lightweightProvider) {
              console.log("Step 3: Calling enrich() with provider...");
              req.log.info({ clientId: id }, "Background Business DNA: lightweight provider step started (memory fallback)");
              try {
                const providerInfo = lightweightProvider.describe?.() ?? {
                  provider: lightweightProvider.id,
                  model: "default",
                };
                providerLabel = `${providerInfo.provider}:${providerInfo.model}`;
                console.log("Provider used:", providerLabel);
                const enriched = await enrich(
                  {
                    name: body.name,
                    websiteUrl: body.websiteUrl,
                    instagramHandle: body.instagramHandle,
                    oneLineDescription: body.oneLineDescription,
                  },
                  lightweightProvider,
                );
                enrichedProfile = enriched as Record<string, unknown>;
                console.log("Enrich result:", enriched);
                req.log.info(
                  { clientId: id, provider: providerLabel },
                  "Background Business DNA: lightweight provider step completed (memory fallback)",
                );
              } catch (providerErr) {
                console.log("Provider used:", providerLabel ?? lightweightProvider.id);
                console.log(
                  "Enrich result:",
                  providerErr instanceof Error ? `${providerErr.name}: ${providerErr.message}` : providerErr,
                );
                req.log.warn(
                  { clientId: id, providerErr },
                  "Background Business DNA: lightweight provider step failed; using public signals only (memory fallback)",
                );
              }
            } else {
              console.log("Step 3: Calling enrich() with provider...");
              console.log("Provider used:", null);
              console.log("Enrich result:", "SKIPPED_NO_PROVIDER");
              req.log.info({ clientId: id }, "Background Business DNA: no lightweight provider, using public signals only (memory fallback)");
            }
            console.log("Step 4: Calling buildBusinessDnaFromPublicSignals...");
            console.log("Public signals input:", {
              name: body.name,
              websiteUrl: body.websiteUrl,
              instagramHandle: body.instagramHandle,
              oneLineDescription: body.oneLineDescription || null,
              instagramSummaryNotes: null,
              enrichedProfile,
            });
            req.log.info({ clientId: id }, "Background Business DNA: public-signal build started (memory fallback)");
            const builtBusinessDna = await buildBusinessDnaFromPublicSignals({
              name: body.name,
              websiteUrl: body.websiteUrl,
              instagramHandle: body.instagramHandle,
              oneLineDescription: body.oneLineDescription || null,
              instagramSummaryNotes: null,
              enrichedProfile,
              skipInstagramFetch: true,
            });
            if (!isValidBusinessDna(builtBusinessDna)) {
              throw new Error("Business DNA builder returned an empty payload");
            }
            console.log("Final businessDna shape:", Object.keys(builtBusinessDna));
            req.log.info(
              { clientId: id, keys: Object.keys(builtBusinessDna) },
              "Background Business DNA: public-signal build completed (memory fallback)",
            );
            return { businessDna: builtBusinessDna, lightweightProviderLabel: providerLabel };
          })(),
          90_000,
          `background business dna memory client=${id}`,
        );
        console.log("Step 5: Saving to onboarding...");
        req.log.info({ clientId: id }, "Background Business DNA: saving final payload (memory fallback)");
        const existing = memoryOnboarding.get(id);
        if (!existing) return;
        memoryOnboarding.set(id, {
          ...existing,
          enrichedData: mergeEnrichedProvenance(
            {
              ...((existing.enrichedData as Record<string, unknown> | null | undefined) ?? {}),
              businessDna,
            },
            {
              dnaBackgroundStatus: "ready",
              dnaBackgroundCompletedAt: new Date().toISOString(),
              dnaBackgroundProvider: lightweightProviderLabel ?? "public-signals",
            },
          ),
        });
        finalBackgroundStatus = "ready";
        console.log("=== TASK COMPLETE: " + finalBackgroundStatus + " ===");
        req.log.info(
          {
            clientId: id,
            durationMs: Date.now() - enrichStart,
            provider: lightweightProviderLabel ?? "public-signals",
          },
          "Deferred in-memory founder onboarding DNA enrichment completed",
        );
      } catch (enrichErr) {
        finalBackgroundStatus = "failed";
        console.log("=== TASK COMPLETE: " + finalBackgroundStatus + " ===");
        console.log(
          "Business DNA task error:",
          enrichErr instanceof Error ? `${enrichErr.name}: ${enrichErr.message}` : enrichErr,
        );
        req.log.error({ clientId: id, enrichErr }, "Background Business DNA job failed (memory fallback)");
        const existing = memoryOnboarding.get(id);
        if (existing) {
          memoryOnboarding.set(id, {
            ...existing,
            enrichedData: mergeEnrichedProvenance(
              (existing.enrichedData as Record<string, unknown> | null | undefined) ?? {},
              {
                dnaBackgroundStatus: "failed",
                dnaBackgroundFailedAt: new Date().toISOString(),
              },
            ),
          });
        }
        req.log.warn({ clientId: id, enrichErr }, "Deferred in-memory founder onboarding DNA enrichment failed");
      }
      })();
    }
  }
});

router.post("/clients/onboard", (req, _res, next) => {
  req.log.info(
    {
      contentType: req.headers["content-type"] ?? null,
      contentLength: req.headers["content-length"] ?? null,
    },
    "onboard: request received",
  );
  next();
}, upload.single("sowPdf"), async (req, res) => {
  const startedAt = Date.now();
  let failureStage:
    | "validate_request"
    | "extract_pdf_text"
    | "infer_sow_sections"
    | "validate_extracted_sow"
    | "prepare_sow_payload"
    | "write_client" = "validate_request";
  const name = String(req.body?.name ?? "").trim();
  const websiteUrl = String(req.body?.websiteUrl ?? "").trim();
  const instagramHandle = String(req.body?.instagramHandle ?? "").trim();
  const oneLineDescription = String(req.body?.oneLineDescription ?? "").trim();
  const requestSizeBytes =
    estimateRequestBytes({
      name,
      websiteUrl,
      instagramHandle,
      oneLineDescription,
    }) + (req.file?.size ?? 0);
  req.log.info(
    {
      requestSizeBytes,
      fileName: req.file?.originalname ?? null,
      fileMimeType: req.file?.mimetype ?? null,
      fileSizeBytes: req.file?.size ?? null,
    },
    "onboard: multipart parsed",
  );
  if (!name) {
    res.status(400).json({ error: "Client name is required" });
    return;
  }
  if (!req.file || req.file.mimetype !== "application/pdf") {
    res.status(400).json({ error: "SOW PDF upload is required (multipart field: sowPdf)" });
    return;
  }

  const parseStartedAt = Date.now();
  const pdfHash = hashPdfBuffer(req.file.buffer);
  const cachedParse = readOnboardParseCache(pdfHash);
  const parseCacheHit = Boolean(cachedParse);
  let extractedText = cachedParse?.extractedText ?? "";
  let suggestions = cachedParse?.suggestions;
  if (!suggestions) {
    failureStage = "extract_pdf_text";
    try {
      extractedText = await extractPdfText(req.file.buffer);
    } catch (err) {
      req.log.warn(
        { err, requestSizeBytes, responseTimeMs: elapsedMs(startedAt), failureStage },
        "onboard: PDF text extraction failed",
      );
      res.status(422).json({ error: "Could not read the SOW PDF. Try another export or re-save as PDF from Word/Google Docs." });
      return;
    }
    failureStage = "infer_sow_sections";
    try {
      suggestions = inferSowFromExtractedText(extractedText);
    } catch (err) {
      req.log.warn(
        { err, requestSizeBytes, responseTimeMs: elapsedMs(startedAt), failureStage },
        "onboard: SOW section inference failed",
      );
      res.status(422).json({
        error: "Could not parse SOW sections from this PDF. Try another export or simplify section headings.",
      });
      return;
    }
    writeOnboardParseCache(pdfHash, { extractedText, suggestions });
  }
  const parseDurationMs = elapsedMs(parseStartedAt);

  try {

  if (!suggestions) {
    res.status(500).json({ error: "Failed to parse SOW PDF" });
    return;
  }
  failureStage = "validate_extracted_sow";
  const uor = String(suggestions.understandingOfRequirements ?? "").trim();
  const sowScope = String(suggestions.scopeOfWork ?? "").trim();
  if (!uor && !sowScope) {
    res.status(422).json({
      error:
        "Could not extract SOW narrative (no Understanding block or strategy/scope found). For Roman I–VIII layouts, ensure section headings (I. … II. …) are present in the PDF text.",
      extractedPreview: extractedText.slice(0, 3500),
      parseWarnings: suggestions.parseWarnings,
    });
    return;
  }

  const pdfCheck = assessSowPdfMismatch({
    name,
    websiteUrl,
    instagramHandle,
    extractedText,
    understandingOfRequirements: uor,
    scopeOfWork: sowScope,
  });
  if (pdfCheck.detected) {
    req.log.warn(
      { name, usedFiltered: pdfCheck.usedFilteredSections },
      "SOW PDF may not match client identity; using brand-filtered copy where applicable",
    );
  }
  const uorFinal = pdfCheck.alignedUnderstanding || uor;
  const sowFinal = pdfCheck.alignedScope || sowScope;

  const op = {
    platforms: suggestions.platforms,
    monthlyPosts: { ...suggestions.monthlyPosts },
    contentMix: { ...suggestions.contentMix },
    deliverables: suggestions.deliverables,
    toneByPlatform: { ...suggestions.toneByPlatform },
  };
  const totalPosts = Object.values(op.monthlyPosts).reduce((a, b) => a + b, 0);
  const totalMix = Object.values(op.contentMix).reduce((a, b) => a + b, 0);
  if (totalPosts > 0 && totalMix !== totalPosts) {
    const scale = totalPosts / Math.max(totalMix, 1);
    for (const k of Object.keys(op.contentMix)) {
      op.contentMix[k] = Math.max(0, Math.round(op.contentMix[k] * scale));
    }
    let fix = totalPosts - Object.values(op.contentMix).reduce((a, b) => a + b, 0);
    const keys = Object.keys(op.contentMix);
    let i = 0;
    while (fix !== 0 && keys.length > 0) {
      const kk = keys[i % keys.length]!;
      op.contentMix[kk] = Math.max(0, op.contentMix[kk] + (fix > 0 ? 1 : -1));
      fix += fix > 0 ? -1 : 1;
      i++;
    }
  }

  failureStage = "prepare_sow_payload";
  const optimizeStartedAt = Date.now();
  const sowOptimization = buildOptimizedSowContext({
    clientName: name,
    clientNotes: oneLineDescription,
    sourceText: extractedText,
    structuredSections: suggestions.structuredSections ?? null,
    understandingOfRequirements: uorFinal,
    strategyLaunchPlanning: suggestions.strategyLaunchPlanning ?? sowFinal,
    contentCreation: suggestions.contentCreation ?? "",
    scopeOfWork: sowFinal,
    targetAudience: suggestions.targetAudience ?? "",
    industry: suggestions.industry ?? "",
    maxChunkTokens: 500,
    maxContextTokens: 2000,
    topSectionCount: 3,
  });
  const optimizationDurationMs = elapsedMs(optimizeStartedAt);

  const initialSow = {
    sowVersion: suggestions.sowVersion ?? 2,
    industry: String(suggestions.industry ?? "").trim(),
    targetAudience: String(suggestions.targetAudience ?? "").trim(),
    understandingOfRequirements: uorFinal,
    scopeOfWork: sowFinal,
    ...(suggestions.normalizedSections && Object.keys(suggestions.normalizedSections).length > 0
      ? { normalizedSections: suggestions.normalizedSections }
      : {}),
    ...(suggestions.strategyLaunchPlanning
      ? { strategyLaunchPlanning: String(suggestions.strategyLaunchPlanning).trim() }
      : {}),
    ...(suggestions.contentCreation
      ? { contentCreation: String(suggestions.contentCreation).trim() }
      : {}),
    ...(suggestions.parseMeta ? { parseMeta: suggestions.parseMeta } : {}),
    platforms: op.platforms,
    monthlyPosts: op.monthlyPosts,
    contentMix: op.contentMix,
    deliverables: op.deliverables,
    toneByPlatform: op.toneByPlatform,
    approval: { approved: false, approvedAt: null as string | null },
    pdfExtraction: slimPdfExtraction({
      fileName: req.file.originalname,
      sectionsExtracted: ["Understanding of Requirements", "Strategy & Launch Planning (or Scope of Work (SOW))"],
      parseWarnings: suggestions.parseWarnings,
      compactContextTokens: sowOptimization.mergedContextTokens,
      sourceTokens: sowOptimization.sourceTokens,
      tokenReductionPct: sowOptimization.tokenReductionPct,
      sourceTextAvailable: extractedText.length > 0,
      sourceTextCharCount: extractedText.length,
      embeddingModel: "sentence-transformers/all-MiniLM-L6-v2",
    }),
    pdfMismatch: {
      detected: pdfCheck.detected,
      message: pdfCheck.message,
      details: pdfCheck.details,
      checks: pdfCheck.checks,
      usedFilteredSections: pdfCheck.usedFilteredSections,
      acknowledged: !pdfCheck.detected,
    },
  };

  const enrichedPayload: Record<string, unknown> = {};
  const dbWriteStartedAt = Date.now();

  try {
    failureStage = "write_client";
    const [client] = await db
      .insert(clientsTable)
      .values({
        name,
        website: websiteUrl,
        instagramHandle,
        oneLineDescription: oneLineDescription || null,
        sow: initialSow,
      })
      .returning();
    if (!client) {
      res.status(500).json({ error: "Failed to create client" });
      return;
    }
    await db.insert(onboardingProfilesTable).values({
      clientId: client.id,
      rawInput: {
        name,
        websiteUrl,
        instagramHandle,
        oneLineDescription,
      },
      enrichedData: enrichedPayload,
    });
    req.log.info(
      {
        clientId: client.id,
        durationMs: Date.now() - dbWriteStartedAt,
        totalResponseMs: elapsedMs(startedAt),
        requestSizeBytes,
        parseDurationMs,
        optimizationDurationMs,
        parseCacheHit,
        sourceTokens: sowOptimization.sourceTokens,
        compactTokens: sowOptimization.mergedContextTokens,
        tokenReductionPct: sowOptimization.tokenReductionPct,
      },
      "Client onboarded with SOW PDF (DNA enrichment deferred)",
    );
    res.status(201).json({
      client: serializeClient(client),
      onboarding: { enrichedData: enrichedPayload },
      pdf: {
        sectionsExtracted: ["Understanding of Requirements", "Scope of Work (SOW)"],
        charCount: extractedText.length,
        sourceTokens: sowOptimization.sourceTokens,
        compactTokens: sowOptimization.mergedContextTokens,
        tokenReductionPct: sowOptimization.tokenReductionPct,
      },
      pdfMismatch: pdfCheck,
    });
    void (async () => {
      const enrichStart = Date.now();
      try {
        const businessDna = await buildBusinessDnaFromPublicSignals({
          name,
          websiteUrl,
          instagramHandle,
          oneLineDescription: oneLineDescription || null,
          instagramSummaryNotes: null,
          sowSections: { understandingOfRequirements: uorFinal, scopeOfWork: sowFinal },
        });
        await db
          .update(onboardingProfilesTable)
          .set({ enrichedData: { businessDna }, updatedAt: new Date() })
          .where(eq(onboardingProfilesTable.clientId, client.id));
        req.log.info(
          { clientId: client.id, durationMs: Date.now() - enrichStart },
          "Deferred onboarding DNA enrichment completed",
        );
      } catch (enrichErr) {
        req.log.warn({ clientId: client.id, enrichErr }, "Deferred onboarding DNA enrichment failed");
      }
    })();
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    req.log.warn({ err }, "DB unavailable, onboard in memory");
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const memoryClient: MemoryClient = {
      id,
      name,
      website: websiteUrl,
      instagramHandle,
      oneLineDescription: oneLineDescription || null,
      sow: initialSow,
      createdAt,
    };
    memoryClients.set(id, memoryClient);
    memoryOnboarding.set(id, {
      id: randomUUID(),
      clientId: id,
      rawInput: {
        name,
        websiteUrl,
        instagramHandle,
        oneLineDescription,
      },
      enrichedData: enrichedPayload,
    });
    req.log.info(
      {
        clientId: id,
        durationMs: Date.now() - dbWriteStartedAt,
        totalResponseMs: elapsedMs(startedAt),
        requestSizeBytes,
        parseDurationMs,
        optimizationDurationMs,
        parseCacheHit,
        sourceTokens: sowOptimization.sourceTokens,
        compactTokens: sowOptimization.mergedContextTokens,
        tokenReductionPct: sowOptimization.tokenReductionPct,
      },
      "Client onboarded in memory with deferred DNA enrichment",
    );
    res.status(201).json({
      client: memoryClient,
      onboarding: { enrichedData: enrichedPayload },
      pdf: {
        sectionsExtracted: ["Understanding of Requirements", "Scope of Work (SOW)"],
        charCount: extractedText.length,
        sourceTokens: sowOptimization.sourceTokens,
        compactTokens: sowOptimization.mergedContextTokens,
        tokenReductionPct: sowOptimization.tokenReductionPct,
      },
      pdfMismatch: pdfCheck,
    });
    void (async () => {
      const enrichStart = Date.now();
      try {
        const businessDna = await buildBusinessDnaFromPublicSignals({
          name,
          websiteUrl,
          instagramHandle,
          oneLineDescription: oneLineDescription || null,
          instagramSummaryNotes: null,
          sowSections: { understandingOfRequirements: uorFinal, scopeOfWork: sowFinal },
        });
        const existing = memoryOnboarding.get(id);
        if (!existing) return;
        memoryOnboarding.set(id, {
          ...existing,
          enrichedData: { ...(existing.enrichedData as Record<string, unknown> | null | undefined), businessDna },
        });
        req.log.info(
          { clientId: id, durationMs: Date.now() - enrichStart },
          "Deferred in-memory onboarding DNA enrichment completed",
        );
      } catch (enrichErr) {
        req.log.warn({ clientId: id, enrichErr }, "Deferred in-memory onboarding DNA enrichment failed");
      }
    })();
  }
  } catch (onboardErr) {
    if (res.headersSent) return;
    req.log.error(
      { err: onboardErr, responseTimeMs: elapsedMs(startedAt), failureStage },
      "POST /clients/onboard failed",
    );
    const detail = onboardErr instanceof Error ? onboardErr.message : String(onboardErr);
    res.status(500).json({ error: "Client onboarding failed", detail });
  }
});

router.get("/clients/:clientId", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  res.set("Cache-Control", "no-store");

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [onboarding] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);

    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    const [planner] = await db
      .select({ id: plannersTable.id })
      .from(plannersTable)
      .where(eq(plannersTable.clientId, clientId))
      .limit(1);

    res.json({
      client: serializeClient(client),
      onboarding: onboarding
        ? {
            id: onboarding.id,
            clientId: onboarding.clientId,
            rawInput: onboarding.rawInput,
            enrichedData: onboarding.enrichedData,
          }
        : null,
      strategy: strategy ? serializeStrategy(strategy) : null,
      hasCalendar: !!planner,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    if (!demoSeeded) seedDemoClients();
    const client = memoryClients.get(clientId);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const onboarding = memoryOnboarding.get(clientId) ?? null;
    const strategy = memoryStrategies.get(clientId) ?? null;
    res.json({
      client,
      onboarding,
      strategy,
      hasCalendar: false,
    });
  }
});

router.post("/clients/:clientId/onboarding/business-dna/rebuild", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    if (!profile) {
      res.status(400).json({ error: "No onboarding profile for this client" });
      return;
    }

    const raw = (profile.rawInput as Record<string, unknown> | null | undefined) ?? {};
    const existingEnriched = (profile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const existingBusinessDna =
      (existingEnriched.businessDna as Partial<BusinessDna> | null | undefined) ?? null;
    const sow = (client.sow as Record<string, unknown> | null | undefined) ?? null;
    const normalizedSections = getStrategyRelevantNormalizedSowSections(sow);
    const sowSections = buildStrategyDnaSowSections(sow, normalizedSections);
    const businessDna = await buildBusinessDnaFromPublicSignals({
      name: String(raw.name ?? client.name ?? ""),
      websiteUrl: String(raw.websiteUrl ?? client.website ?? ""),
      instagramHandle: String(raw.instagramHandle ?? client.instagramHandle ?? ""),
      oneLineDescription: String(raw.oneLineDescription ?? client.oneLineDescription ?? ""),
      instagramSummaryNotes:
        typeof raw.instagramSummaryNotes === "string" ? raw.instagramSummaryNotes : null,
      existing: existingBusinessDna,
      enrichedProfile: existingEnriched,
      sowSections,
    });

    const nextEnriched = {
      ...existingEnriched,
      businessDna,
      __provenance: {
        ...(typeof existingEnriched.__provenance === "object" && existingEnriched.__provenance !== null
          ? (existingEnriched.__provenance as Record<string, unknown>)
          : {}),
        dnaRebuiltFromUiAt: new Date().toISOString(),
      },
    };

    const [updated] = await db
      .update(onboardingProfilesTable)
      .set({ enrichedData: nextEnriched, updatedAt: new Date() })
      .where(eq(onboardingProfilesTable.id, profile.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to rebuild business DNA" });
      return;
    }

    req.log.info({ clientId }, "Business DNA rebuilt from workspace");
    res.json({
      id: updated.id,
      clientId: updated.clientId,
      rawInput: updated.rawInput,
      enrichedData: nextEnriched,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const client = memoryClients.get(clientId);
    const existing = memoryOnboarding.get(clientId);
    if (!client || !existing) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const raw = (existing.rawInput as Record<string, unknown> | null | undefined) ?? {};
    const existingEnriched = (existing.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const existingBusinessDna =
      (existingEnriched.businessDna as Partial<BusinessDna> | null | undefined) ?? null;
    const sow = (client.sow as Record<string, unknown> | null | undefined) ?? null;
    const normalizedSections = getStrategyRelevantNormalizedSowSections(sow);
    const sowSections = buildStrategyDnaSowSections(sow, normalizedSections);
    const businessDna = await buildBusinessDnaFromPublicSignals({
      name: String(raw.name ?? client.name ?? ""),
      websiteUrl: String(raw.websiteUrl ?? client.website ?? ""),
      instagramHandle: String(raw.instagramHandle ?? client.instagramHandle ?? ""),
      oneLineDescription: String(raw.oneLineDescription ?? client.oneLineDescription ?? ""),
      instagramSummaryNotes:
        typeof raw.instagramSummaryNotes === "string" ? raw.instagramSummaryNotes : null,
      existing: existingBusinessDna,
      enrichedProfile: existingEnriched,
      sowSections,
    });
    const nextEnriched = {
      ...existingEnriched,
      businessDna,
      __provenance: {
        ...(typeof existingEnriched.__provenance === "object" && existingEnriched.__provenance !== null
          ? (existingEnriched.__provenance as Record<string, unknown>)
          : {}),
        dnaRebuiltFromUiAt: new Date().toISOString(),
      },
    };
    memoryOnboarding.set(clientId, { ...existing, enrichedData: nextEnriched });
    req.log.info({ clientId }, "Business DNA rebuilt from workspace (memory fallback)");
    res.json({
      id: existing.id,
      clientId: existing.clientId,
      rawInput: existing.rawInput,
      enrichedData: nextEnriched,
    });
  }
});

/**
 * Update onboarding `enrichedData` (primarily `businessDna`) from the workspace UI.
 * Merges with existing `enrichedData` so other keys (__provenance, offer, etc.) are preserved.
 */
router.patch("/clients/:clientId/onboarding", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = req.body as {
    businessDna?: Record<string, unknown>;
    /** Ops: manual Instagram context when public fetch / MCP is empty */
    instagramSummaryNotes?: string;
    rebuildBusinessDna?: boolean;
  };
  if (
    !body ||
    (body.businessDna == null && body.instagramSummaryNotes == null && body.rebuildBusinessDna !== true) ||
    (body.businessDna != null && typeof body.businessDna !== "object") ||
    (body.instagramSummaryNotes != null && typeof body.instagramSummaryNotes !== "string") ||
    (body.rebuildBusinessDna != null && body.rebuildBusinessDna !== true)
  ) {
    res.status(400).json({
      error:
        "Send businessDna (object), instagramSummaryNotes (string), and/or rebuildBusinessDna: true.",
    });
    return;
  }

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    if (!profile) {
      res.status(400).json({ error: "No onboarding profile for this client" });
      return;
    }

    const current = (profile.enrichedData as Record<string, unknown> | null) ?? {};
    const currentRaw = (profile.rawInput as Record<string, unknown> | null) ?? {};
    const normalizedSections = getStrategyRelevantNormalizedSowSections(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    const rebuiltBusinessDna =
      body.rebuildBusinessDna === true
        ? await buildBusinessDnaFromPublicSignals({
            name: String(currentRaw.name ?? client.name ?? ""),
            websiteUrl: String(currentRaw.websiteUrl ?? client.website ?? ""),
            instagramHandle: String(currentRaw.instagramHandle ?? client.instagramHandle ?? ""),
            oneLineDescription: String(
              currentRaw.oneLineDescription ?? client.oneLineDescription ?? "",
            ),
            instagramSummaryNotes:
              typeof body.instagramSummaryNotes === "string"
                ? body.instagramSummaryNotes.trim()
                : typeof currentRaw.instagramSummaryNotes === "string"
                  ? currentRaw.instagramSummaryNotes
                  : null,
            existing:
              ((current.businessDna as Partial<BusinessDna> | null | undefined) ?? null),
            enrichedProfile: current,
            sowSections: buildStrategyDnaSowSections(
              (client.sow as Record<string, unknown> | null | undefined) ?? null,
              normalizedSections,
            ),
          })
        : null;
    const nextRaw: MemoryOnboarding["rawInput"] & { instagramSummaryNotes?: string } = {
      name: String(currentRaw.name ?? ""),
      websiteUrl: String(currentRaw.websiteUrl ?? ""),
      instagramHandle: String(currentRaw.instagramHandle ?? ""),
      oneLineDescription: String(currentRaw.oneLineDescription ?? ""),
      ...(body.instagramSummaryNotes != null
        ? { instagramSummaryNotes: body.instagramSummaryNotes.trim() }
        : {}),
    };
    const nextEnriched: Record<string, unknown> = {
      ...current,
      ...(body.businessDna != null
        ? {
            businessDna: body.businessDna,
            __provenance: {
              ...(typeof current.__provenance === "object" && current.__provenance !== null
                ? (current.__provenance as Record<string, unknown>)
                : {}),
              dnaEditedFromUiAt: new Date().toISOString(),
            },
          }
        : {}),
      ...(rebuiltBusinessDna != null
        ? {
            businessDna: rebuiltBusinessDna,
            __provenance: {
              ...(typeof current.__provenance === "object" && current.__provenance !== null
                ? (current.__provenance as Record<string, unknown>)
                : {}),
              dnaRebuiltFromUiAt: new Date().toISOString(),
            },
          }
        : {}),
    };

    const [updated] = await db
      .update(onboardingProfilesTable)
      .set({
        enrichedData: nextEnriched,
        rawInput: nextRaw,
        updatedAt: new Date(),
      })
      .where(eq(onboardingProfilesTable.id, profile.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to update onboarding profile" });
      return;
    }

    res.json({
      id: updated.id,
      clientId: updated.clientId,
      rawInput: updated.rawInput,
      enrichedData: nextEnriched,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const memoryClient = memoryClients.get(clientId);
    const existing = memoryOnboarding.get(clientId);
    if (!memoryClient || !existing) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const current = (existing.enrichedData as Record<string, unknown> | null) ?? {};
    const currentRaw = (existing.rawInput as Record<string, unknown> | null) ?? {};
    const normalizedSections = getStrategyRelevantNormalizedSowSections(
      (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    const rebuiltBusinessDna =
      body.rebuildBusinessDna === true
        ? await buildBusinessDnaFromPublicSignals({
            name: String(currentRaw.name ?? existing.rawInput.name ?? ""),
            websiteUrl: String(currentRaw.websiteUrl ?? existing.rawInput.websiteUrl ?? ""),
            instagramHandle: String(
              currentRaw.instagramHandle ?? existing.rawInput.instagramHandle ?? "",
            ),
            oneLineDescription: String(
              currentRaw.oneLineDescription ?? existing.rawInput.oneLineDescription ?? "",
            ),
            instagramSummaryNotes:
              typeof body.instagramSummaryNotes === "string"
                ? body.instagramSummaryNotes.trim()
                : typeof currentRaw.instagramSummaryNotes === "string"
                  ? currentRaw.instagramSummaryNotes
                  : null,
            existing:
              ((current.businessDna as Partial<BusinessDna> | null | undefined) ?? null),
            enrichedProfile: current,
            sowSections: buildStrategyDnaSowSections(
              (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
              normalizedSections,
            ),
          })
        : null;
    const nextEnriched: Record<string, unknown> = {
      ...current,
      ...(body.businessDna != null
        ? {
            businessDna: body.businessDna,
            __provenance: {
              ...(typeof current.__provenance === "object" && current.__provenance !== null
                ? (current.__provenance as Record<string, unknown>)
                : {}),
              dnaEditedFromUiAt: new Date().toISOString(),
            },
          }
        : {}),
      ...(rebuiltBusinessDna != null
        ? {
            businessDna: rebuiltBusinessDna,
            __provenance: {
              ...(typeof current.__provenance === "object" && current.__provenance !== null
                ? (current.__provenance as Record<string, unknown>)
                : {}),
              dnaRebuiltFromUiAt: new Date().toISOString(),
            },
          }
        : {}),
    };
    const nextRaw: MemoryOnboarding["rawInput"] & { instagramSummaryNotes?: string } = {
      name: String(currentRaw.name ?? existing.rawInput.name),
      websiteUrl: String(currentRaw.websiteUrl ?? existing.rawInput.websiteUrl),
      instagramHandle: String(currentRaw.instagramHandle ?? existing.rawInput.instagramHandle),
      oneLineDescription: String(
        currentRaw.oneLineDescription ?? existing.rawInput.oneLineDescription,
      ),
      ...(body.instagramSummaryNotes != null
        ? { instagramSummaryNotes: body.instagramSummaryNotes.trim() }
        : {}),
    };
    memoryOnboarding.set(clientId, { ...existing, enrichedData: nextEnriched, rawInput: nextRaw });
    res.json({
      id: existing.id,
      clientId: existing.clientId,
      rawInput: nextRaw,
      enrichedData: nextEnriched,
    });
  }
});

router.post(
  "/clients/:clientId/sow/pdf-parse",
  upload.single("file"),
  async (req, res) => {
    const rawClientId = req.params.clientId;
    const clientId = Array.isArray(rawClientId) ? rawClientId[0] : rawClientId;
    if (!clientId) {
      res.status(400).json({ error: "clientId required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "PDF file is required (multipart field name: file)" });
      return;
    }
    if (req.file.mimetype !== "application/pdf") {
      res.status(400).json({ error: "Only PDF files are supported for now." });
      return;
    }
    try {
      const extractedText = await extractPdfText(req.file.buffer);
      const suggestions = inferSowFromExtractedText(extractedText);
      const baseWarning =
        extractedText.length === 0
          ? "No readable text was extracted from this PDF. You can still fill fields manually."
          : "Auto-filled what could be identified. Review carefully before saving SOW.";
      const warning =
        suggestions.parseWarnings.length > 0
          ? `${baseWarning} Notes: ${suggestions.parseWarnings.join(" ")}`
          : baseWarning;
      const payload = {
        fileName: req.file.originalname,
        extractedText,
        suggestions,
        updatedAt: new Date().toISOString(),
      };
      sowPdfDrafts.set(clientId, payload);
      const detectedFields = [
        ...Object.keys(suggestions).filter((k) => k !== "parseWarnings" && k !== "structuredSections"),
        ...Object.keys(suggestions.structuredSections ?? {}).map((k) => `section:${k}`),
      ];
      res.json({
        ...payload,
        detectedFields,
        parseWarnings: suggestions.parseWarnings,
        warning,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to parse SOW PDF");
      res.status(422).json({
        error: "Could not parse PDF reliably. You can still review extracted text manually.",
      });
    }
  },
);

router.get("/clients/:clientId/sow/pdf-parse/latest", (req, res) => {
  const rawClientId = req.params.clientId;
  const clientId = Array.isArray(rawClientId) ? rawClientId[0] : rawClientId;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const latest = sowPdfDrafts.get(clientId) ?? null;
  res.json({ latest });
});

/** Optional LLM merge over extracted PDF text; requires SOW_LLM_NORMALIZE=1. */
router.post("/clients/:clientId/sow/llm-normalize", async (req, res) => {
  const { isSowLlmNormalizeEnabled, runOptionalSowLlmNormalize } = await import("../lib/sow-llm-normalize.js");
  if (!isSowLlmNormalizeEnabled()) {
    res.status(403).json({ error: "SOW_LLM_NORMALIZE is not enabled (set to 1 in the API environment)." });
    return;
  }
  const { clientId } = req.params;
  const text = String((req.body as { extractedText?: string } | null)?.extractedText ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "extractedText (string) is required" });
    return;
  }
  const ruleBased = inferSowFromExtractedText(text) as unknown as Record<string, unknown>;
  const merged = await runOptionalSowLlmNormalize(text, ruleBased);
  if (!merged) {
    res.status(500).json({ error: "LLM normalize did not return output" });
    return;
  }
  res.json({ merged, ruleBased, sowVersion: 2 });
});

router.put("/clients/:clientId/sow", async (req, res) => {
  const startedAt = Date.now();
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const requestSizeBytes = estimateRequestBytes(body);
  if (!isSowPayloadValid(body)) {
    res.status(400).json({ error: "Invalid SOW payload" });
    return;
  }
  const sanitizedBody = sanitizeSowPayload(body);

  try {
    const [updated] = await db
      .update(clientsTable)
      .set({ sow: sanitizedBody })
      .where(eq(clientsTable.id, clientId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    req.log.info(
      { requestSizeBytes, responseTimeMs: elapsedMs(startedAt) },
      "SOW save telemetry",
    );
    res.json(serializeClient(updated));
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const existing = memoryClients.get(clientId);
    if (!existing) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const updated: MemoryClient = {
      ...existing,
      sow: sanitizedBody,
    };
    memoryClients.set(clientId, updated);
    req.log.info(
      { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "db_unavailable" },
      "SOW save telemetry",
    );
    res.json(updated);
  }
});

router.delete("/clients/:clientId", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  try {
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
    res.status(204).send();
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    memoryClients.delete(clientId);
    memoryOnboarding.delete(clientId);
    res.status(204).send();
  }
});

router.post("/clients/:clientId/strategy/import-chatgpt", async (req, res) => {
  const startedAt = Date.now();
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const requestSizeBytes = estimateRequestBytes(req.body ?? null);
  const parsedImport = parseImportedStrategyPayload(req.body);
  if (!parsedImport.ok) {
    res.status(400).json({ error: parsedImport.error });
    return;
  }

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    const canonicalSections = parsedImport.canonicalSections;
    const strategyDocument = buildCanonicalDocument(client.name, canonicalSections);
    const structured = {
      canonicalSections,
      __summary: {
        strategy:
          parsedImport.summary.strategy ||
          buildStrategySummary(client.name, { canonicalSections } as Record<string, unknown>),
        pillarPriorities: parsedImport.summary.pillarPriorities,
        monthlyGoals: parsedImport.summary.monthlyGoals,
      },
      __meta: {
        strategySource: "chatgpt_import",
        importedAt: new Date().toISOString(),
        sectionApprovals: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, true])),
        regenerateCounters: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
      },
    } as Record<string, unknown>;

    let saved: typeof strategiesTable.$inferSelect | null = null;
    if (existing) {
      const [updated] = await db
        .update(strategiesTable)
        .set({
          structuredStrategy: structured,
          strategyDocument,
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(strategiesTable.id, existing.id))
        .returning();
      saved = updated ?? null;
    } else {
      const [created] = await db
        .insert(strategiesTable)
        .values({
          clientId,
          structuredStrategy: structured,
          strategyDocument,
          templateType: "brand_building",
          version: 1,
          status: "approved",
        })
        .returning();
      saved = created ?? null;
    }
    if (!saved) {
      res.status(500).json({ error: "Failed to save imported strategy" });
      return;
    }
    req.log.info(
      {
        requestSizeBytes,
        responseTimeMs: elapsedMs(startedAt),
        source: "chatgpt_import",
      },
      "Strategy import telemetry",
    );
    res.json({
      ...serializeStrategy(saved),
      strategySource: "chatgpt_import",
      imported: true,
      importSummary: {
        sectionCount: CANONICAL_SECTION_KEYS.length,
        pillarPriorities: parsedImport.summary.pillarPriorities.length,
        monthlyGoals: parsedImport.summary.monthlyGoals.length,
      },
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      req.log.error({ err }, "Strategy import failed");
      res.status(500).json({ error: "Could not import strategy" });
      return;
    }
    markFallbackUsed();
    const client = memoryClients.get(clientId);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const previous = memoryStrategies.get(clientId);
    const now = new Date().toISOString();
    const structured = {
      canonicalSections: parsedImport.canonicalSections,
      __summary: {
        strategy:
          parsedImport.summary.strategy ||
          buildStrategySummary(client.name, { canonicalSections: parsedImport.canonicalSections } as Record<string, unknown>),
        pillarPriorities: parsedImport.summary.pillarPriorities,
        monthlyGoals: parsedImport.summary.monthlyGoals,
      },
      __meta: {
        strategySource: "chatgpt_import",
        importedAt: now,
        sectionApprovals: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, true])),
        regenerateCounters: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
      },
    } as Record<string, unknown>;
    const next: MemoryStrategy = {
      id: previous?.id ?? randomUUID(),
      clientId,
      structuredStrategy: structured,
      strategyDocument: buildCanonicalDocument(client.name, parsedImport.canonicalSections),
      templateType: previous?.templateType ?? "brand_building",
      version: previous?.version ?? 1,
      status: "approved",
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    memoryStrategies.set(clientId, next);
    req.log.info(
      {
        requestSizeBytes,
        responseTimeMs: elapsedMs(startedAt),
        source: "chatgpt_import",
        fallbackReason: "db_unavailable",
      },
      "Strategy import telemetry",
    );
    res.json({
      ...next,
      strategySource: "chatgpt_import",
      imported: true,
      importSummary: {
        sectionCount: CANONICAL_SECTION_KEYS.length,
        pillarPriorities: parsedImport.summary.pillarPriorities.length,
        monthlyGoals: parsedImport.summary.monthlyGoals.length,
      },
    });
  }
});

router.post("/clients/:clientId/strategy/copy-prompt", async (req, res) => {
  const startedAt = Date.now();
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const requestSizeBytes = estimateRequestBytes(req.body ?? null);

  try {
    const [client] = await db
      .select({
        id: clientsTable.id,
        name: clientsTable.name,
        website: clientsTable.website,
        instagramHandle: clientsTable.instagramHandle,
        oneLineDescription: clientsTable.oneLineDescription,
        sow: clientsTable.sow,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const [onboarding] = await db
      .select({
        rawInput: onboardingProfilesTable.rawInput,
        enrichedData: onboardingProfilesTable.enrichedData,
      })
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    if (!onboarding) {
      req.log.warn(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "missing_onboarding" },
        "Copy prompt telemetry",
      );
      res.status(400).json({ error: "No onboarding profile found" });
      return;
    }

    const [strategy] = await db
      .select({ structuredStrategy: strategiesTable.structuredStrategy })
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    const assemblyStartedAt = Date.now();
    const variables = mapStrategyV1PromptVariables({
      client: {
        name: client.name,
        website: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
        sow: (client.sow as Record<string, unknown> | null | undefined) ?? null,
      },
      onboarding: {
        rawInput: (onboarding.rawInput as Record<string, unknown> | null | undefined) ?? null,
        enrichedData: (onboarding.enrichedData as Record<string, unknown> | null | undefined) ?? null,
      },
      strategy: strategy
        ? {
            structuredStrategy: strategy.structuredStrategy as Record<string, unknown>,
          }
        : null,
    });

    const missingRequired = findMissingPromptKeys(variables, STRATEGY_V1_REQUIRED_PLACEHOLDERS);
    const missingOptional = findMissingPromptKeys(variables, STRATEGY_V1_OPTIONAL_PLACEHOLDERS);
    if (missingRequired.length > 0) {
      req.log.warn(
        {
          requestSizeBytes,
          responseTimeMs: elapsedMs(startedAt),
          fallbackReason: "missing_required_inputs",
          missingRequired,
        },
        "Copy prompt telemetry",
      );
      res.status(422).json({
        error: "Missing required prompt inputs",
        missingRequired,
      });
      return;
    }

    const templateName = "strategy/v1-full" as const;
    const template = await loadPromptTemplate(templateName);
    const prompt = injectPromptVariables(template, variables, {
      requiredKeys: [...STRATEGY_V1_REQUIRED_PLACEHOLDERS],
      optionalKeys: [...STRATEGY_V1_OPTIONAL_PLACEHOLDERS],
    });
    const diagnostics = {
      estimatedPromptTokens: estimateTokens(prompt),
      promptChars: prompt.length,
      missingRequired,
      missingOptional,
    };
    const promptAssemblyMs = elapsedMs(assemblyStartedAt);
    req.log.info(
      {
        requestSizeBytes,
        responseTimeMs: elapsedMs(startedAt),
        promptAssemblyMs,
        promptChars: diagnostics.promptChars,
        estimatedPromptTokens: diagnostics.estimatedPromptTokens,
      },
      "Copy prompt telemetry",
    );
    res.json({
      templateName,
      prompt,
      diagnostics,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      req.log.error({ err }, "Copy prompt failed");
      res.status(500).json({ error: "Could not prepare prompt" });
      return;
    }

    markFallbackUsed();
    const client = memoryClients.get(clientId);
    if (!client) {
      req.log.warn(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "db_unavailable_client_not_in_memory" },
        "Copy prompt fallback could not find DB-backed client in memory",
      );
      res.status(503).json({
        error: "Prompt preparation is temporarily unavailable because the backend database connection was interrupted. Please retry.",
      });
      return;
    }
    const onboarding = memoryOnboarding.get(clientId);
    if (!onboarding) {
      req.log.warn(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "missing_onboarding" },
        "Copy prompt telemetry",
      );
      res.status(400).json({ error: "No onboarding profile found" });
      return;
    }
    const strategy = memoryStrategies.get(clientId);

    try {
      const assemblyStartedAt = Date.now();
      const variables = mapStrategyV1PromptVariables({
        client: {
          name: client.name,
          website: client.website,
          instagramHandle: client.instagramHandle,
          oneLineDescription: client.oneLineDescription,
          sow: (client.sow as Record<string, unknown> | null | undefined) ?? null,
        },
        onboarding: {
          rawInput: (onboarding.rawInput as Record<string, unknown> | null | undefined) ?? null,
          enrichedData: (onboarding.enrichedData as Record<string, unknown> | null | undefined) ?? null,
        },
        strategy: strategy
          ? {
              structuredStrategy: strategy.structuredStrategy,
            }
          : null,
      });
      const missingRequired = findMissingPromptKeys(variables, STRATEGY_V1_REQUIRED_PLACEHOLDERS);
      const missingOptional = findMissingPromptKeys(variables, STRATEGY_V1_OPTIONAL_PLACEHOLDERS);
      if (missingRequired.length > 0) {
        req.log.warn(
          {
            requestSizeBytes,
            responseTimeMs: elapsedMs(startedAt),
            fallbackReason: "missing_required_inputs",
            missingRequired,
          },
          "Copy prompt telemetry",
        );
        res.status(422).json({
          error: "Missing required prompt inputs",
          missingRequired,
        });
        return;
      }
      const templateName = "strategy/v1-full" as const;
      const template = await loadPromptTemplate(templateName);
      const prompt = injectPromptVariables(template, variables, {
        requiredKeys: [...STRATEGY_V1_REQUIRED_PLACEHOLDERS],
        optionalKeys: [...STRATEGY_V1_OPTIONAL_PLACEHOLDERS],
      });
      const diagnostics = {
        estimatedPromptTokens: estimateTokens(prompt),
        promptChars: prompt.length,
        missingRequired,
        missingOptional,
      };
      const promptAssemblyMs = elapsedMs(assemblyStartedAt);
      req.log.info(
        {
          requestSizeBytes,
          responseTimeMs: elapsedMs(startedAt),
          promptAssemblyMs,
          promptChars: diagnostics.promptChars,
          estimatedPromptTokens: diagnostics.estimatedPromptTokens,
          fallbackReason: "db_unavailable",
        },
        "Copy prompt telemetry",
      );
      res.json({
        templateName,
        prompt,
        diagnostics,
      });
    } catch (fallbackErr) {
      req.log.error({ err: fallbackErr }, "Copy prompt failed in memory mode");
      res.status(500).json({ error: "Could not prepare prompt" });
    }
  }
});

router.post("/clients/:clientId/strategy/generate", async (req, res) => {
  const startedAt = Date.now();
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const strategyBodyParsed = GenerateStrategyBody.safeParse(req.body ?? {});
  if (!strategyBodyParsed.success) {
    res.status(400).json({ error: "Invalid request body", details: strategyBodyParsed.error.flatten() });
    return;
  }
  const body = strategyBodyParsed.data;
  const requestSizeBytes = estimateRequestBytes(body);
  req.setTimeout(600_000);
  res.setTimeout(600_000);

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (!isSowComplete(client.sow as Record<string, unknown> | null | undefined)) {
      res.status(400).json({
        error:
          "SOW must be complete and approved (including monthly totals and content mix) before strategy generation.",
      });
      return;
    }

    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);

    if (!profile) {
      res.status(400).json({ error: "No onboarding profile found" });
      return;
    }

    const useRealAI = shouldUseRealAI(req);
    let resolvedStrategyLlm: LLMProvider | null = null;
    if (useRealAI) {
      try {
        resolvedStrategyLlm = getRequestLLMProvider(req);
        const d = resolvedStrategyLlm.describe?.() ?? { provider: resolvedStrategyLlm.id, model: "default" };
        req.log.info(
          { provider: d.provider, model: d.model },
          "Strategy generate: LLM provider resolved (fail-fast before heavy work)",
        );
      } catch (e) {
        if (isNoUsableAiProviderError(e)) {
          res.status(503).json({ error: getNoUsableAiProviderUserMessage(), code: "NO_USABLE_AI_PROVIDER" });
          return;
        }
        throw e;
      }
    }

    const raw = profile.rawInput as {
      name: string;
      websiteUrl: string;
      instagramHandle: string;
      oneLineDescription: string;
      instagramSummaryNotes?: string;
    };

    const businessDna =
      (profile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
    const mcpConfig = getMcpConfigFromEnv();
    const mcpAvailable = isMcpAvailable(mcpConfig);
    const strategyMcpInput = {
      clientId,
      templateType: body.templateType ?? null,
      raw: raw as Record<string, unknown>,
      enriched: (profile.enrichedData ?? {}) as Record<string, unknown>,
      businessDna: (businessDna as Record<string, unknown> | null | undefined) ?? null,
    };
    let mcpStrategy: StrategyMcpResult = {
      used: false,
      status: "disabled",
      toolName: null,
      timestamp: new Date().toISOString(),
      toolResultSummary: null,
      enriched: strategyMcpInput,
    };
    if (mcpAvailable) {
      mcpStrategy = await orchestrateStrategyEnrichment(strategyMcpInput, mcpConfig);
    }
    const sowRec = (client.sow as Record<string, unknown> | null | undefined) ?? null;
    const normalizedStrategySections = getStrategyRelevantNormalizedSowSections(sowRec);
    const strategyDnaSections = buildStrategyDnaSowSections(sowRec, normalizedStrategySections);
    const currentBusinessDna = await buildBusinessDnaFromPublicSignals({
      name: raw.name,
      websiteUrl: raw.websiteUrl,
      instagramHandle: raw.instagramHandle,
      oneLineDescription: raw.oneLineDescription || null,
      instagramSummaryNotes: typeof raw.instagramSummaryNotes === "string" ? raw.instagramSummaryNotes : null,
      existing: businessDna,
      enrichedProfile: {
        ...((profile.enrichedData as Record<string, unknown> | null | undefined) ?? {}),
        ...(mcpStrategy.enriched.enriched as Record<string, unknown>),
      },
      mcpData:
        ((mcpStrategy.enriched.enriched as Record<string, unknown>).mcp as Record<string, unknown> | null | undefined) ??
        null,
      sowSections: {
        understandingOfRequirements: strategyDnaSections.understandingOfRequirements,
        scopeOfWork: strategyDnaSections.scopeOfWork,
      },
    });
    req.log.info(
      {
        available: mcpAvailable,
        enabled: mcpConfig.enabled,
        status: mcpStrategy.status,
        used: mcpStrategy.used,
      },
      "MCP strategy orchestration status",
    );

    const mcpProv = buildMcpProvenance({
      toolName: "toolName" in mcpStrategy ? (mcpStrategy as { toolName?: string | null }).toolName ?? null : null,
      status: String((mcpStrategy as { status?: string }).status ?? "disabled"),
      timestamp:
        "timestamp" in mcpStrategy && typeof (mcpStrategy as { timestamp?: string }).timestamp === "string"
          ? (mcpStrategy as { timestamp: string }).timestamp
          : new Date().toISOString(),
      toolResultSummary:
        "toolResultSummary" in mcpStrategy
          ? (mcpStrategy as { toolResultSummary?: Record<string, unknown> | null }).toolResultSummary ?? null
          : null,
    });
    const preLlmEnriched: Record<string, unknown> = {
      ...((profile.enrichedData as Record<string, unknown> | null) ?? {}),
      businessDna: currentBusinessDna as unknown as Record<string, unknown>,
      __provenance: {
        mcp: mcpProv,
        phase: "pre-llm",
        savedAt: new Date().toISOString(),
        websiteMcp: currentBusinessDna.mcp?.website ?? null,
      },
    };
    const sowOptimization = buildOptimizedSowContext({
      clientName: raw.name,
      clientNotes: raw.oneLineDescription,
      normalizedSections: normalizedStrategySections,
      understandingOfRequirements: normalizedStrategySections ? "" : String(sowRec?.understandingOfRequirements ?? ""),
      strategyLaunchPlanning: normalizedStrategySections ? "" : String(sowRec?.strategyLaunchPlanning ?? ""),
      contentCreation: normalizedStrategySections ? "" : String(sowRec?.contentCreation ?? ""),
      scopeOfWork: normalizedStrategySections ? "" : effectiveScopeOfWork(sowRec),
      targetAudience: normalizedStrategySections ? "" : String(sowRec?.targetAudience ?? ""),
      industry: normalizedStrategySections ? "" : String(sowRec?.industry ?? ""),
      maxChunkTokens: 500,
      maxContextTokens: 2000,
      topSectionCount: 3,
    });
    try {
      await db
        .update(onboardingProfilesTable)
        .set({ enrichedData: preLlmEnriched, updatedAt: new Date() })
        .where(eq(onboardingProfilesTable.id, profile.id));
      req.log.info({ clientId }, "Persisted businessDna + MCP provenance before LLM (partial checkpoint)");
    } catch (persistErr) {
      req.log.warn({ persistErr, clientId }, "Pre-LLM partial persist failed; continuing with strategy generation");
    }

    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    const selectedTemplate = (body.templateType ?? "brand_building") as string;
    const requestedDetail = req.header("x-strategy-detail")?.trim().toLowerCase();
    const detailLevel: StrategyDetailLevel = requestedDetail === "full" ? "full" : "core";
    const nextVersion = (existing?.version ?? 0) + 1;
    const provisionalCanonical = ensureCanonicalStrategyPayload(
      client,
      selectedTemplate,
      {},
      "",
      0,
      currentBusinessDna,
    );
    const [provisionalStrategy] = await db
      .insert(strategiesTable)
      .values({
        clientId,
        structuredStrategy: {
          ...(provisionalCanonical.structured as Record<string, unknown>),
          __meta: {
            ...(((provisionalCanonical.structured as Record<string, unknown>).__meta as Record<
              string,
              unknown
            > | undefined) ?? {}),
            generationProgress: {
              stage: "starting",
              updatedAt: new Date().toISOString(),
            },
          },
        },
        strategyDocument: provisionalCanonical.document,
        templateType: selectedTemplate as TemplateType,
        version: nextVersion,
        status: "draft",
      })
      .returning();
    if (!provisionalStrategy) {
      res.status(500).json({ error: "Failed to create provisional strategy" });
      return;
    }
    let enriched: ReturnType<typeof enrich> extends Promise<infer T> ? T : never;
    let tpl: TemplateType;
    let structured: Record<string, unknown>;
    let document: string;
    let strategySource: "real" | "fallback" = "real";
    let strategyAiFailure: PublicAiFailure | undefined;

    if (useRealAI) {
      try {
        const provider = resolvedStrategyLlm!;
        const providerInfo = provider.describe?.() ?? { provider: provider.id, model: "default" };
        req.log.info(
          { provider: providerInfo.provider, model: providerInfo.model },
          "Strategy generation: using real LLM provider",
        );
        const instagramUrl = raw.instagramHandle?.startsWith("http")
          ? raw.instagramHandle
          : raw.instagramHandle
            ? `https://instagram.com/${raw.instagramHandle.replace(/^@/, "")}`
            : "";
        const contextStartedAt = Date.now();
        const context = await getClientContextWithCache({
          clientId,
          websiteUrl: raw.websiteUrl,
          instagramUrlOrHandle: instagramUrl,
          forceRefresh: req.query.refreshContext === "1",
          timeoutMs: 6000,
        });
        const websiteSummary = context.websiteSummary;
        const instagramFromFetch = context.instagramSummary;
        req.log.info(
          {
            cacheHit: context.cacheHit,
            websiteFetchMs: context.websiteMs,
            instagramFetchMs: context.instagramMs,
            contextTotalMs: Date.now() - contextStartedAt,
          },
          "Strategy context enrichment stage timings",
        );
        const igPlatform = (
          currentBusinessDna.platformSignals?.instagram as
            | {
                handle?: string;
                bioSignals?: string[];
                contentPatterns?: string[];
                engagementSignals?: string[];
              }
            | undefined
        ) ?? undefined;
        const instagramSummary = mergeInstagramForStrategy(instagramFromFetch, igPlatform);
        req.log.info(
          {
            instagramFromPublic: instagramFromFetch
              ? {
                  bio: instagramFromFetch.bio ? instagramFromFetch.bio.slice(0, 180) : "",
                  followers: instagramFromFetch.followers ?? "",
                  snippets: instagramFromFetch.last_n_caption_snippets?.length ?? 0,
                  blocked: !!instagramFromFetch.blocked,
                }
              : null,
            instagramMergedForStrategy: instagramSummary
              ? {
                  bio: instagramSummary.bio ? instagramSummary.bio.slice(0, 180) : "",
                  followers: instagramSummary.followers ?? "",
                  snippets: instagramSummary.last_n_caption_snippets?.length ?? 0,
                }
              : null,
            mcpToolKeys: Object.keys(
              ((mcpStrategy.enriched.enriched as Record<string, unknown>).mcp as Record<string, unknown> | null | undefined) ??
                {},
            ),
          },
          "Instagram summary: public fetch + DNA/MCP platform merge for strategy extraction",
        );
        const forceAiEnrich = req.header("x-force-enrich-ai")?.trim() === "1";
        const existingEnriched = (profile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
        if (forceAiEnrich) {
          enriched = await enrich(raw, provider);
        } else {
          enriched = buildFastEnrichedProfile({
            raw,
            existingEnriched,
          }) as Awaited<ReturnType<typeof enrich>>;
        }
        enriched = {
          ...enriched,
          ...mcpStrategy.enriched.enriched,
          businessDna: currentBusinessDna,
          sowSummary: sowOptimization.mergedContext,
        } as typeof enriched & { sowSummary: string };
        req.log.info(
          buildPromptBudgetStats(
            "strategy generation",
            [
              raw,
              enriched,
              sowOptimization.mergedContext,
              sowOptimization.topSections.map((section) => section.summary),
            ],
            3000,
            1500,
          ),
          "Strategy prompt budget",
        );
        req.log.info(
          { requestSizeBytes },
          "Strategy request payload telemetry",
        );
        req.log.info(
          {
            hasMcp: !!(enriched.mcp && typeof enriched.mcp === "object"),
            hasBusinessDna: !!enriched.businessDna,
            instagramHandle: raw.instagramHandle,
          },
          "Instagram context merged into strategy input",
        );
        tpl = selectTemplate(
          enriched as unknown as Record<string, unknown>,
          body.templateType ?? null,
        );
        const structuredStartedAt = Date.now();
        const structuredOutput = await withTimeout(
          generateStructuredStrategy(
          raw,
          enriched,
          tpl,
          provider,
          {
            websiteSummary,
            instagramSummary,
            sowContext: {
              compactContext: sowOptimization.mergedContext,
              topSections: sowOptimization.topSections,
            },
          },
          { detailLevel },
          ),
          Number(process.env.STRATEGY_STRUCTURED_TIMEOUT_MS ?? "25000"),
          "strategy_structured_generation",
        );
        const structuredMs = Date.now() - structuredStartedAt;
        req.log.info({ detailLevel, structuredMs }, "Strategy structured generation timing");
        structured = structuredOutput as unknown as Record<string, unknown>;
        if (detailLevel === "full") {
          const documentStartedAt = Date.now();
          document = await generateStrategyDocument(raw, enriched, structuredOutput, tpl, provider, {
            websiteSummary,
            instagramSummary,
            sowContext: {
              compactContext: sowOptimization.mergedContext,
              topSections: sowOptimization.topSections,
            },
          });
          const documentMs = Date.now() - documentStartedAt;
          req.log.info({ detailLevel, documentMs }, "Strategy narrative generation timing");
        } else {
          document = "";
          req.log.info(
            { detailLevel, reason: "fast_first_persist" },
            "Skipping long strategy document generation for initial fast pass",
          );
        }
        req.log.info(
          {
            extractionHasInstagram:
              Boolean(instagramSummary?.bio?.trim()) ||
              (instagramSummary?.last_n_caption_snippets?.length ?? 0) > 0,
          },
          "Strategy LLM prompts include instagram_summary when merge produced data",
        );
        req.log.info(
          {
            provider: providerInfo.provider,
            model: providerInfo.model,
            responseTimeMs: elapsedMs(startedAt),
          },
          "Strategy generation completed from real LLM output",
        );
      } catch (err) {
        req.log.warn(
          { err },
          "Real AI strategy generation failed (provider/JSON parse/extraction), using demo strategy",
        );
        markAIFallbackUsed();
        strategySource = "fallback";
        req.log.warn(
          { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "provider_or_output_failure" },
          "Strategy fallback telemetry",
        );
        {
          const d = resolvedStrategyLlm?.describe?.() ?? { provider: "unknown", model: "default" };
          strategyAiFailure = toPublicAiFailure(err, { providerId: d.provider, model: d.model });
          strategyAiFailure.message = humanizePromptFailure(strategyAiFailure.message);
        }
        const sections = fallbackVariantSections(
          {
            id: client.id,
            name: client.name,
            website: client.website,
            instagramHandle: client.instagramHandle,
            oneLineDescription: client.oneLineDescription,
            sow: client.sow,
            createdAt:
              client.createdAt instanceof Date
                ? client.createdAt.toISOString()
                : String(client.createdAt),
          },
          selectedTemplate,
          1,
        );
        enriched = {
          brand_name: raw.name,
          offer: raw.oneLineDescription,
          price_range: "",
          business_model: "B2B services",
          target_audience: { who: "", age_range: "", stage: "growth-stage" },
          brand_tone: "",
          positioning: sections.positioning,
          platform: "Instagram",
          content_preference: "",
          competitors: [],
        };
        enriched = {
          ...enriched,
          ...mcpStrategy.enriched.enriched,
          businessDna: currentBusinessDna,
        };
        tpl = selectedTemplate as TemplateType;
        structured = buildStructuredFromSections(selectedTemplate, sections);
        document = buildStrategyDocument(raw.name, sections);
      }
    } else {
      req.log.info("Strategy generation using deterministic demo fallback (real AI disabled)");
      markAIFallbackUsed();
      strategySource = "fallback";
      req.log.info(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "real_ai_disabled" },
        "Strategy fallback telemetry",
      );
      {
        strategyAiFailure = realAiDisabledFailure({ providerId: "demo", model: "deterministic" });
      }
      const sections = fallbackVariantSections(
        {
          id: client.id,
          name: client.name,
          website: client.website,
          instagramHandle: client.instagramHandle,
          oneLineDescription: client.oneLineDescription,
          sow: client.sow,
          createdAt:
            client.createdAt instanceof Date ? client.createdAt.toISOString() : String(client.createdAt),
        },
        selectedTemplate,
        1,
      );
      enriched = {
        brand_name: raw.name,
        offer: raw.oneLineDescription,
        price_range: "",
        business_model: "B2B services",
        target_audience: { who: "", age_range: "", stage: "growth-stage" },
        brand_tone: "",
        positioning: sections.positioning,
        platform: "Instagram",
        content_preference: "",
        competitors: [],
      };
      enriched = {
        ...enriched,
        ...mcpStrategy.enriched.enriched,
        businessDna: currentBusinessDna,
      };
      tpl = selectedTemplate as TemplateType;
      structured = buildStructuredFromSections(selectedTemplate, sections);
      document = buildStrategyDocument(raw.name, sections);
    }
    const canonicalReady = ensureCanonicalStrategyPayload(
      client,
      selectedTemplate,
      structured,
      document,
      0,
      currentBusinessDna,
    );
    structured = canonicalReady.structured;
    const strategySummary = buildStrategySummary(client.name, structured);
    structured = {
      ...structured,
      __summary: {
        strategy: strategySummary,
        pillarPriorities: extractPillarPriorities(structured),
        monthlyGoals: extractMonthlyGoals(structured),
      },
      __meta: {
        ...(((structured.__meta as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>),
        mcp: mcpProv,
        strategySource,
        tokenUsage: {
          sowSourceTokens: sowOptimization.sourceTokens,
          sowContextTokens: sowOptimization.mergedContextTokens,
          sowTokenReductionPct: sowOptimization.tokenReductionPct,
        },
        ...(strategySource === "fallback" && strategyAiFailure ? { aiFailure: strategyAiFailure } : {}),
      },
    };
    document = canonicalReady.document;

    await db
      .update(onboardingProfilesTable)
      .set({ enrichedData: enriched, updatedAt: new Date() })
      .where(eq(onboardingProfilesTable.id, profile.id));

    const [strategy] = await db
      .update(strategiesTable)
      .set({
        structuredStrategy: structured as Record<string, unknown>,
        strategyDocument: document,
        templateType: tpl,
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(strategiesTable.id, provisionalStrategy.id))
      .returning();

    if (!strategy) {
      res.status(500).json({ error: "Failed to save strategy" });
      return;
    }

    req.log.info({ source: strategySource }, "Strategy generation source selected");
    res.setHeader("x-strategy-source", strategySource);
    res.json({
      ...serializeStrategy(strategy),
      strategySource,
      ...(strategySource === "fallback" && strategyAiFailure
        ? { aiFailure: strategyAiFailure }
        : {}),
    });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      markFallbackUsed();
      const memoryClient = memoryClients.get(clientId);
      const memoryProfile = memoryOnboarding.get(clientId);
      if (!memoryClient || !memoryProfile) {
        res.status(404).json({ error: "Client not found" });
        return;
      }
      if (!isSowComplete(memoryClient.sow as Record<string, unknown> | null | undefined)) {
        res.status(400).json({
          error:
            "Complete and approve SOW before generating strategy. SOW is required for downstream content creation.",
        });
        return;
      }

      const selectedTemplate = (body.templateType ?? "brand_building") as string;
      const now = new Date().toISOString();
      const previous = memoryStrategies.get(clientId);
      const nextVersion = (previous?.version ?? 0) + 1;
      const sections = fallbackVariantSections(memoryClient, selectedTemplate, nextVersion);
      const memoryDna =
        (memoryProfile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
      const canonicalReady = ensureCanonicalStrategyPayload(
        memoryClient,
        selectedTemplate,
        buildStructuredFromSections(selectedTemplate, sections),
        buildStrategyDocument(memoryClient.name, sections),
        nextVersion - 1,
        memoryDna,
      );
      const strategy: MemoryStrategy = {
        id: randomUUID(),
        clientId,
        structuredStrategy: canonicalReady.structured,
        strategyDocument: canonicalReady.document,
        templateType: selectedTemplate,
        version: nextVersion,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      };
      memoryStrategies.set(clientId, strategy);
      markAIFallbackUsed();
      let memD = { provider: "demo", model: "deterministic" };
      if (shouldUseRealAI(req)) {
        try {
          const memProvider = getRequestLLMProvider(req);
          memD = memProvider.describe?.() ?? { provider: memProvider.id, model: "default" };
        } catch {
          memD = { provider: "unconfigured", model: "n/a" };
        }
      }
      const strategyAiFailureMem: PublicAiFailure = shouldUseRealAI(req)
        ? toPublicAiFailure(new Error("Database unavailable; strategy used a safe template."), {
            providerId: memD.provider,
            model: memD.model,
          })
        : realAiDisabledFailure({ providerId: "demo", model: "deterministic" });
      res.setHeader("x-strategy-source", "fallback");
      res.json({
        ...strategy,
        strategySource: "fallback" as const,
        aiFailure: strategyAiFailureMem,
      });
      return;
    }
    req.log.error({ err }, "Strategy generation failed");
    res.status(500).json({ error: "Strategy generation failed", detail: String(err) });
  }
});

router.post("/clients/:clientId/strategy/bootstrap", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    if (existing) {
      res.json(serializeStrategy(existing));
      return;
    }

    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    if (!profile) {
      res.status(400).json({ error: "No onboarding profile found" });
      return;
    }

    const businessDna =
      (profile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
    if (!isValidBusinessDna(businessDna)) {
      res.status(400).json({ error: "Business DNA is not ready yet" });
      return;
    }

    const requestedTemplate =
      typeof (req.body as { templateType?: unknown } | null | undefined)?.templateType === "string"
        ? String((req.body as { templateType?: string }).templateType).trim()
        : "";
    const templateType = (requestedTemplate || "brand_building") as TemplateType;
    const canonicalSections = buildBootstrapCanonicalSections({
      client: {
        name: client.name,
        website: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
      },
      businessDna,
      sow: (client.sow as Record<string, unknown> | null | undefined) ?? null,
      templateType,
    });
    const structuredStrategy: Record<string, unknown> = {
      canonicalSections,
      __meta: {
        sectionApprovals: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])),
        regenerateCounters: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
        strategySource: "bootstrap",
      },
    };

    const [created] = await db
      .insert(strategiesTable)
      .values({
        clientId,
        structuredStrategy,
        strategyDocument: buildCanonicalDocument(client.name, canonicalSections),
        templateType,
        version: 1,
        status: "draft",
      })
      .returning();

    if (!created) {
      res.status(500).json({ error: "Failed to create bootstrap strategy" });
      return;
    }

    res.status(201).json(serializeStrategy(created));
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    res.status(503).json({ error: "Strategy bootstrap is temporarily unavailable." });
  }
});

router.patch("/clients/:clientId/strategy", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = UpdateStrategyBody.parse(req.body);

  try {
    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No strategy found" });
      return;
    }

    const updates: Partial<typeof strategiesTable.$inferInsert> = { updatedAt: new Date() };
    if (body.strategyDocument !== undefined) updates.strategyDocument = body.strategyDocument;
    if (body.structuredStrategy !== undefined)
      updates.structuredStrategy = body.structuredStrategy as Record<string, unknown>;
    if (body.status !== undefined) updates.status = body.status;

    const [updated] = await db
      .update(strategiesTable)
      .set(updates)
      .where(eq(strategiesTable.id, existing.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to update strategy" });
      return;
    }

    res.json(serializeStrategy(updated));
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const existing = memoryStrategies.get(clientId);
    if (!existing) {
      res.status(404).json({ error: "No strategy found" });
      return;
    }
    const updated: MemoryStrategy = {
      ...existing,
      strategyDocument: body.strategyDocument ?? existing.strategyDocument,
      structuredStrategy:
        (body.structuredStrategy as Record<string, unknown> | undefined) ??
        existing.structuredStrategy,
      status: body.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    memoryStrategies.set(clientId, updated);
    res.json(updated);
  }
});

router.post("/clients/:clientId/strategy/sections/:sectionKey/regenerate", async (req, res) => {
  const { clientId, sectionKey } = req.params;
  if (!clientId || !sectionKey) {
    res.status(400).json({ error: "clientId and sectionKey required" });
    return;
  }
  if (!CANONICAL_SECTION_KEYS.includes(sectionKey as (typeof CANONICAL_SECTION_KEYS)[number])) {
    res.status(400).json({ error: "Unsupported section key" });
    return;
  }
  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    if (!client || !strategy) {
      res.status(404).json({ error: "Client/strategy not found" });
      return;
    }
    const structured = strategy.structuredStrategy as Record<string, unknown>;
    const canonical = ((structured.canonicalSections ?? {}) as Record<string, string>) ?? {};
    const regenerateCounters =
      (((structured.__meta ?? {}) as { regenerateCounters?: Record<string, number> }).regenerateCounters ??
        {}) as Record<string, number>;
    const nextCounter = (regenerateCounters[sectionKey] ?? 0) + 1;
    const refreshed = buildSectionVariantText(
      sectionKey,
      {
        name: client.name,
        website: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
      },
      nextCounter,
    );
    const sectionApprovals = {
      ...(((structured.__meta ?? {}) as { sectionApprovals?: Record<string, boolean> }).sectionApprovals ??
        {}),
      [sectionKey]: false,
    };
    const nextStructured = {
      ...structured,
      canonicalSections: { ...canonical, [sectionKey]: refreshed },
      __meta: {
        ...((structured.__meta as Record<string, unknown> | undefined) ?? {}),
        sectionApprovals,
        regenerateCounters: {
          ...regenerateCounters,
          [sectionKey]: nextCounter,
        },
      },
    };
    const nextDocument = buildCanonicalDocument(client.name, nextStructured.canonicalSections);
    const [updated] = await db
      .update(strategiesTable)
      .set({
        structuredStrategy: nextStructured,
        strategyDocument: nextDocument,
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(strategiesTable.id, strategy.id))
      .returning();
    res.json(serializeStrategy(updated ?? strategy));
  } catch (err) {
    if (isDbUnavailableError(err)) {
      markFallbackUsed();
      const memoryClient = memoryClients.get(clientId);
      const memoryStrategy = memoryStrategies.get(clientId);
      if (!memoryClient || !memoryStrategy) {
        res.status(404).json({ error: "Client/strategy not found" });
        return;
      }
      const structured = memoryStrategy.structuredStrategy as Record<string, unknown>;
      const canonical = ((structured.canonicalSections ?? {}) as Record<string, string>) ?? {};
      const regenerateCounters =
        (((structured.__meta ?? {}) as { regenerateCounters?: Record<string, number> })
          .regenerateCounters ?? {}) as Record<string, number>;
      const nextCounter = (regenerateCounters[sectionKey] ?? 0) + 1;
      const refreshed = buildSectionVariantText(
        sectionKey,
        {
          name: memoryClient.name,
          website: memoryClient.website,
          instagramHandle: memoryClient.instagramHandle,
          oneLineDescription: memoryClient.oneLineDescription,
        },
        nextCounter,
      );
      const sectionApprovals = {
        ...(((structured.__meta ?? {}) as { sectionApprovals?: Record<string, boolean> })
          .sectionApprovals ?? {}),
        [sectionKey]: false,
      };
      const nextStructured = {
        ...structured,
        canonicalSections: { ...canonical, [sectionKey]: refreshed },
        __meta: {
          ...((structured.__meta as Record<string, unknown> | undefined) ?? {}),
          sectionApprovals,
          regenerateCounters: {
            ...regenerateCounters,
            [sectionKey]: nextCounter,
          },
        },
      };
      const updated: MemoryStrategy = {
        ...memoryStrategy,
        structuredStrategy: nextStructured,
        strategyDocument: buildCanonicalDocument(memoryClient.name, nextStructured.canonicalSections),
        status: "draft",
        updatedAt: new Date().toISOString(),
      };
      memoryStrategies.set(clientId, updated);
      res.json(updated);
      return;
    }
    req.log.error({ err }, "Section regenerate failed");
    res.status(500).json({ error: "Section regenerate failed", detail: String(err) });
  }
});

function isSowPayloadValid(body: Record<string, unknown>): boolean {
  const platforms = Array.isArray(body.platforms) ? body.platforms : [];
  const monthlyPosts = (body.monthlyPosts ?? {}) as Record<string, unknown>;
  const contentMix = (body.contentMix ?? {}) as Record<string, unknown>;
  const deliverables = Array.isArray(body.deliverables) ? body.deliverables : [];
  const toneByPlatform = (body.toneByPlatform ?? {}) as Record<string, unknown>;
  if (body.industry != null && typeof body.industry !== "string") return false;
  if (body.targetAudience != null && typeof body.targetAudience !== "string") return false;
  if (body.understandingOfRequirements != null && typeof body.understandingOfRequirements !== "string") return false;
  if (body.scopeOfWork != null && typeof body.scopeOfWork !== "string") return false;
  if (body.strategyLaunchPlanning != null && typeof body.strategyLaunchPlanning !== "string") return false;
  if (body.contentCreation != null && typeof body.contentCreation !== "string") return false;
  if (body.normalizedSections != null && (typeof body.normalizedSections !== "object" || body.normalizedSections === null)) {
    return false;
  }
  if (body.sowVersion != null && typeof body.sowVersion !== "number") return false;
  if (body.parseMeta != null && (typeof body.parseMeta !== "object" || body.parseMeta === null)) return false;
  return (
    platforms.every((p) => typeof p === "string") &&
    Object.values(monthlyPosts).every((v) => typeof v === "number") &&
    Object.values(contentMix).every((v) => typeof v === "number") &&
    deliverables.every((d) => typeof d === "string") &&
    Object.values(toneByPlatform).every((v) => typeof v === "string")
  );
}

function sanitizeSowPayload(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  delete next.excludedCommercial;

  const pdfExtraction = (body.pdfExtraction as Record<string, unknown> | undefined) ?? undefined;
  if (pdfExtraction) {
    next.pdfExtraction = slimPdfExtraction(pdfExtraction);
  }

  const normalizedSections = (body.normalizedSections as Record<string, unknown> | undefined) ?? undefined;
  if (normalizedSections) {
    next.normalizedSections = Object.fromEntries(
      Object.entries(normalizedSections)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .filter(([key, value]) => !isExcludedSowSection(key, value as string)),
    );
  }

  return next;
}

function isExcludedSowSection(key: string, value: string): boolean {
  const blockedKey = /pricing|payment|retainer|costing|quotation|commercial|approval/i.test(key);
  const blockedValue = /(pricing|payment|retainer|costing|quotation|commercial|prepared by|founder, social idiots|approval)/i.test(
    value,
  );
  return blockedKey || blockedValue;
}

function findMissingPromptKeys(
  variables: Record<string, string>,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => {
    const value = variables[key];
    return value == null || value.trim().length === 0;
  });
}

function slimPdfExtraction(pdfExtraction: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(pdfExtraction).filter(([key]) =>
      [
        "fileName",
        "sectionsExtracted",
        "parseWarnings",
        "compactContextTokens",
        "sourceTokens",
        "tokenReductionPct",
        "sourceTextAvailable",
        "sourceTextCharCount",
        "embeddingModel",
      ].includes(key),
    ),
  );
}

function buildFastEnrichedProfile(input: {
  raw: { name: string; websiteUrl: string; instagramHandle: string; oneLineDescription: string };
  existingEnriched: Record<string, unknown>;
}) {
  const existingAudience =
    input.existingEnriched.target_audience && typeof input.existingEnriched.target_audience === "object"
      ? (input.existingEnriched.target_audience as Record<string, unknown>)
      : {};
  const websiteHost = safeHostFromUrl(input.raw.websiteUrl);
  const fallbackOffer = input.raw.oneLineDescription || `Offer for ${input.raw.name}`;
  return {
    brand_name: asNonEmptyString(input.existingEnriched.brand_name) ?? input.raw.name,
    offer: asNonEmptyString(input.existingEnriched.offer) ?? fallbackOffer,
    price_range: asNonEmptyString(input.existingEnriched.price_range) ?? "",
    business_model: asNonEmptyString(input.existingEnriched.business_model) ?? "",
    target_audience: {
      who: asNonEmptyString(existingAudience.who) ?? "",
      age_range: asNonEmptyString(existingAudience.age_range) ?? "",
      stage: asNonEmptyString(existingAudience.stage) ?? "growth-stage",
    },
    brand_tone: asNonEmptyString(input.existingEnriched.brand_tone) ?? "",
    positioning:
      asNonEmptyString(input.existingEnriched.positioning) ??
      `${input.raw.name} focused on ${input.raw.oneLineDescription || "clear customer outcomes"}`,
    platform: asNonEmptyString(input.existingEnriched.platform) ?? "Instagram",
    content_preference: asNonEmptyString(input.existingEnriched.content_preference) ?? "Educational + proof content",
    competitors: Array.isArray(input.existingEnriched.competitors)
      ? input.existingEnriched.competitors.map((item) => String(item)).filter(Boolean).slice(0, 5)
      : websiteHost
        ? [`${websiteHost} alternatives`]
        : [],
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeHostFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function getStrategyRelevantNormalizedSowSections(
  sow: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  const normalizedSections = (sow?.normalizedSections as Record<string, unknown> | undefined) ?? undefined;
  if (!normalizedSections) return null;
  const entries = Object.entries(normalizedSections)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .filter(([key, value]) => !isExcludedSowSection(key, String(value)));
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value).trim()]));
}

function buildStrategyDnaSowSections(
  sow: Record<string, unknown> | null | undefined,
  normalizedSections: Record<string, string> | null,
): { understandingOfRequirements: string; scopeOfWork: string } {
  if (!normalizedSections) {
    return {
      understandingOfRequirements: String(sow?.understandingOfRequirements ?? ""),
      scopeOfWork: effectiveScopeOfWork(sow) || String(sow?.scopeOfWork ?? ""),
    };
  }

  const understandingKeys = ["industry", "brandPositioning", "objectivesAndGoals", "targetAudience", "expectedOutcomes"];
  const scopeKeys = [
    "scopeOfWork",
    "strategyLaunchPlanning",
    "contentCreationScope",
    "paidMediaAdsScope",
    "reportingOptimizationScope",
    "monthlyDeliverables",
    "clientResponsibilities",
    "timelineMilestones",
  ];
  const join = (keys: string[]) =>
    keys
      .map((key) => normalizedSections[key])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n\n")
      .trim();

  return {
    understandingOfRequirements: join(understandingKeys),
    scopeOfWork: join(scopeKeys),
  };
}

function buildCanonicalDocument(name: string, sections: Record<string, string>): string {
  return `# ${name} Strategy\n\n${CANONICAL_SECTION_KEYS.map(
    (key) => `## ${canonicalLabel(key)}\n${sections[key] ?? "-"}`,
  ).join("\n\n")}\n`;
}

function parseImportedStrategyPayload(input: unknown):
  | {
      ok: true;
      canonicalSections: Record<string, string>;
      summary: { strategy: string; pillarPriorities: string[]; monthlyGoals: string[] };
    }
  | { ok: false; error: string } {
  const record = (input as Record<string, unknown> | null | undefined) ?? null;
  if (!record || typeof record !== "object") {
    return { ok: false, error: "Invalid payload. Send ChatGPT JSON object or string." };
  }
  const rawPayload = record.chatgptJson ?? record.payload ?? record.strategyJson ?? record;
  let payloadObj: Record<string, unknown>;
  if (typeof rawPayload === "string") {
    try {
      payloadObj = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Invalid JSON string. Paste valid ChatGPT JSON." };
    }
  } else if (rawPayload && typeof rawPayload === "object") {
    payloadObj = rawPayload as Record<string, unknown>;
  } else {
    return { ok: false, error: "Invalid payload. Missing ChatGPT JSON." };
  }

  const rootStrategy = ((payloadObj.strategy as Record<string, unknown> | undefined) ??
    payloadObj) as Record<string, unknown>;
  const canonicalCandidate = ((rootStrategy.canonicalSections as Record<string, unknown> | undefined) ??
    rootStrategy) as Record<string, unknown>;
  const canonicalSections = normalizeImportedCanonicalSections(canonicalCandidate);
  if (!canonicalSections) {
    return {
      ok: false,
      error:
        "Missing canonical sections. Expected strategy.canonicalSections with all 12 required section keys.",
    };
  }

  const summaryObj =
    ((rootStrategy.summary as Record<string, unknown> | undefined) ??
      (payloadObj.summary as Record<string, unknown> | undefined) ??
      {}) as Record<string, unknown>;
  const strategySummary = String(summaryObj.strategy ?? "").trim();
  const pillarPriorities = normalizeStringList(summaryObj.pillarPriorities);
  const monthlyGoals = normalizeStringList(summaryObj.monthlyGoals);

  return {
    ok: true,
    canonicalSections,
    summary: {
      strategy: strategySummary,
      pillarPriorities: pillarPriorities.length > 0 ? pillarPriorities : extractPillarPriorities({ canonicalSections }),
      monthlyGoals: monthlyGoals.length > 0 ? monthlyGoals : extractMonthlyGoals({ canonicalSections }),
    },
  };
}

function normalizeImportedCanonicalSections(
  sections: Record<string, unknown> | null | undefined,
): Record<string, string> | null {
  if (!sections || typeof sections !== "object") return null;
  const out = Object.fromEntries(
    CANONICAL_SECTION_KEYS.map((key) => [key, String(sections[key] ?? "").trim()]),
  ) as Record<string, string>;
  const missing = CANONICAL_SECTION_KEYS.filter((key) => !out[key]);
  if (missing.length > 0) return null;
  return out;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)
    .slice(0, 12);
}

function mergeBusinessDnaIntoCanonical(
  dna: BusinessDna | null | undefined,
  sections: Record<string, string>,
): Record<string, string> {
  if (!dna) return sections;
  const block = [
    "### Business DNA",
    `Purpose: ${dna.purpose || "n/a"}`,
    `Mission: ${dna.mission || "n/a"}`,
    `Audience: ${dna.targetAudience.segments.join(", ") || "n/a"}`,
    `Positioning: ${dna.positioning.valueProposition || "n/a"}`,
    `Content pillars: ${dna.contentStrategy.contentPillars.join(", ") || "n/a"}`,
    `Voice: ${dna.toneOfVoice.style.join(", ") || dna.voice_tone || "n/a"}`,
    `Visual style: ${dna.visualIdentity.layoutStyle || dna.visual_identity.style || "n/a"}`,
    `Palette signals: ${dna.visualIdentity.colors.map((color) => color.hex).join(", ") || dna.visual_identity.colors.join(", ") || "n/a"}`,
    `Website discovery: ${dna.mcp.website.ok ? "ok" : dna.mcp.website.error ?? "unavailable"}`,
    `Instagram data: ${dna.mcp.instagram.ok ? "attached" : dna.mcp.instagram.note ?? dna.mcp.instagram.error ?? "MCP not configured"}`,
  ].join("\n");
  return {
    ...sections,
    marketNarrative: [block, sections.marketNarrative].filter(Boolean).join("\n\n"),
  };
}

function joinStrategyLines(lines: Array<string | null | undefined>): string {
  return lines.map((line) => String(line ?? "").trim()).filter(Boolean).join("\n");
}

function bulletLines(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function buildBootstrapCanonicalSections(input: {
  client: Pick<MemoryClient, "name" | "website" | "instagramHandle" | "oneLineDescription">;
  businessDna: BusinessDna;
  sow: Record<string, unknown> | null | undefined;
  templateType: string;
}): Record<string, string> {
  const base = ensureCanonicalStrategyPayload(
    input.client,
    input.templateType,
    {},
    "",
    0,
    input.businessDna,
  ).structured.canonicalSections as Record<string, string>;
  const dna = input.businessDna;
  const sow = input.sow ?? {};
  const monthlyPosts = (sow.monthlyPosts as Record<string, unknown> | undefined) ?? {};
  const toneByPlatform = (sow.toneByPlatform as Record<string, unknown> | undefined) ?? {};
  const contentMix = (sow.contentMix as Record<string, unknown> | undefined) ?? {};
  const platforms = Array.isArray(sow.platforms) ? sow.platforms.map((item) => String(item).trim()).filter(Boolean) : [];

  const platformPlan = platforms
    .map((platform) => {
      const monthly = Number(monthlyPosts[platform]) || 0;
      const tone = String(toneByPlatform[platform] ?? "").trim();
      return [platform, monthly > 0 ? `${monthly} posts/month` : "", tone ? `Tone: ${tone}` : ""]
        .filter(Boolean)
        .join(" - ");
    })
    .filter(Boolean);

  const contentMixLines = Object.entries(contentMix)
    .map(([key, value]) => {
      const count = Number(value) || 0;
      if (count <= 0) return "";
      return `- ${canonicalLabelForMix(key)}: ${count} posts`;
    })
    .filter(Boolean)
    .join("\n");

  return {
    ...base,
    marketNarrative: joinStrategyLines([
      dna.purpose || input.client.oneLineDescription,
      dna.positioning.marketAngle,
      dna.positioning.valueProposition,
    ]) || base.marketNarrative,
    problemGapSolution: joinStrategyLines([
      `Problem: ${String(sow.understandingOfRequirements ?? "").trim() || "The category needs clearer proof-backed positioning."}`,
      `Gap: ${dna.positioning.marketAngle || "Current messaging does not fully connect need, trust, and differentiation."}`,
      `Solution: ${dna.positioning.valueProposition || dna.purpose || input.client.oneLineDescription || base.problemGapSolution}`,
    ]),
    brandFoundation: joinStrategyLines([
      dna.mission ? `Mission: ${dna.mission}` : "",
      dna.vision ? `Vision: ${dna.vision}` : "",
      dna.coreValues.length > 0 ? `Values:\n${bulletLines(dna.coreValues)}` : "",
      dna.positioning.differentiators.length > 0 ? `Differentiators:\n${bulletLines(dna.positioning.differentiators)}` : "",
    ]) || base.brandFoundation,
    brandPhilosophy: joinStrategyLines([
      dna.brandArchetype ? `Archetype: ${dna.brandArchetype}` : "",
      dna.purpose,
      dna.voice_tone,
      dna.personalityTraits.length > 0 ? `Traits: ${dna.personalityTraits.join(", ")}` : "",
    ]) || base.brandPhilosophy,
    audience: joinStrategyLines([
      dna.targetAudience.segments.length > 0 ? `Primary segments:\n${bulletLines(dna.targetAudience.segments)}` : "",
      dna.targetAudience.demographics.length > 0 ? `Demographics: ${dna.targetAudience.demographics.join(", ")}` : "",
      dna.targetAudience.psychographics.length > 0 ? `Psychographics: ${dna.targetAudience.psychographics.join(", ")}` : "",
      dna.targetAudience.pains.length > 0 ? `Pain points:\n${bulletLines(dna.targetAudience.pains)}` : "",
      dna.targetAudience.desires.length > 0 ? `Desired outcomes:\n${bulletLines(dna.targetAudience.desires)}` : "",
    ]) || base.audience,
    emotionalDrivers: joinStrategyLines([
      dna.targetAudience.desires.length > 0 ? bulletLines(dna.targetAudience.desires) : "",
      dna.targetAudience.objections.length > 0 ? `Common objections:\n${bulletLines(dna.targetAudience.objections)}` : "",
    ]) || base.emotionalDrivers,
    platformStrategy: joinStrategyLines([
      platformPlan.length > 0 ? bulletLines(platformPlan) : "",
      dna.platformSignals.website.messagingPatterns.length > 0
        ? `Website signals:\n${bulletLines(dna.platformSignals.website.messagingPatterns)}`
        : "",
      dna.platformSignals.instagram.contentPatterns.length > 0
        ? `Instagram signals:\n${bulletLines(dna.platformSignals.instagram.contentPatterns)}`
        : "",
    ]) || base.platformStrategy,
    contentStrategy: joinStrategyLines([
      dna.contentStrategy.contentPillars.length > 0 ? `Pillars:\n${bulletLines(dna.contentStrategy.contentPillars)}` : "",
      dna.contentStrategy.themes.length > 0 ? `Themes:\n${bulletLines(dna.contentStrategy.themes)}` : "",
      contentMixLines ? `Content mix:\n${contentMixLines}` : "",
      String(sow.contentCreation ?? "").trim(),
    ]) || base.contentStrategy,
    kpis: joinStrategyLines([
      dna.platformSignals.website.conversionElements.length > 0
        ? `Conversion signals:\n${bulletLines(dna.platformSignals.website.conversionElements)}`
        : "",
      dna.contentStrategy.trustSignalsToRepeat.length > 0
        ? `Trust signals to repeat:\n${bulletLines(dna.contentStrategy.trustSignalsToRepeat)}`
        : "",
      "Track reach, saves, profile actions, clicks, and conversion intent weekly.",
    ]) || base.kpis,
    trackingPlan: joinStrategyLines([
      "Weekly: review performance by section, platform, and format.",
      "Bi-weekly: compare content mix vs platform response.",
      "Monthly: refine priorities using the strongest proof, hooks, and conversion patterns.",
    ]),
    executionPhases: joinStrategyLines([
      String(sow.strategyLaunchPlanning ?? "").trim(),
      String(sow.timeline ?? "").trim(),
      String(sow.nextSteps ?? "").trim(),
    ]) || base.executionPhases,
    assetRequirements: joinStrategyLines([
      Array.isArray(sow.deliverables) && sow.deliverables.length > 0
        ? `Deliverables:\n${bulletLines(sow.deliverables)}`
        : "",
      String(sow.scopeOfWork ?? "").trim(),
      dna.offers.primaryOffers.length > 0 ? `Primary offers:\n${bulletLines(dna.offers.primaryOffers)}` : "",
    ]) || base.assetRequirements,
  };
}

function canonicalLabelForMix(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function canonicalLabel(key: string): string {
  const labels: Record<string, string> = {
    marketNarrative: "Market Narrative",
    problemGapSolution: "Problem • Gap • Solution",
    brandFoundation: "Brand Foundation",
    brandPhilosophy: "Brand Philosophy",
    audience: "Audience",
    emotionalDrivers: "Emotional Drivers",
    platformStrategy: "Platform Strategy",
    contentStrategy: "Content Strategy",
    kpis: "KPIs",
    trackingPlan: "Tracking Plan",
    executionPhases: "Execution Phases",
    assetRequirements: "Asset Requirements",
  };
  return labels[key] ?? key;
}

function ensureCanonicalStrategyPayload(
  client: Pick<MemoryClient, "name" | "website" | "instagramHandle" | "oneLineDescription">,
  templateType: string,
  structured: Record<string, unknown>,
  document: string,
  seed: number,
  businessDna?: BusinessDna | null,
): { structured: Record<string, unknown>; document: string } {
  const fallbackCanonical = buildInitialCanonicalSections(client, templateType, seed);
  let canonicalSections = Object.fromEntries(
    CANONICAL_SECTION_KEYS.map((key) => {
      const current = String(fallbackCanonical[key] ?? "").trim();
      return [key, current || buildSectionVariantText(key, client, 0)];
    }),
  ) as Record<string, string>;
  canonicalSections = mergeBusinessDnaIntoCanonical(businessDna, canonicalSections);
  return {
    structured: {
      ...structured,
      canonicalSections,
      __meta: {
        ...((structured.__meta as Record<string, unknown> | undefined) ?? {}),
        sectionApprovals: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])),
        regenerateCounters: Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
      },
    },
    document: buildCanonicalDocument(client.name, canonicalSections),
  };
}

function buildInitialCanonicalSections(
  client: Pick<MemoryClient, "name" | "website" | "instagramHandle" | "oneLineDescription">,
  _templateType: string,
  seed: number,
): Record<string, string> {
  return Object.fromEntries(
    CANONICAL_SECTION_KEYS.map((key) => [key, buildSectionVariantText(key, client, seed % 3)]),
  );
}

function buildCanonicalFromLegacySections(
  legacy: StrategySections,
  client: Pick<MemoryClient, "name" | "website" | "instagramHandle" | "oneLineDescription">,
): Record<string, string> {
  return {
    marketNarrative: legacy.positioning,
    problemGapSolution: `${legacy.positioning}\n\nCore solution focus: ${legacy.cta}`,
    brandFoundation: legacy.messagingPillars.join("\n"),
    brandPhilosophy: `Brand philosophy for ${client.name}: practical clarity, consistency, and trust-building.`,
    audience: legacy.idealAudience.join("\n"),
    emotionalDrivers: "Confidence in daily use\nTrust in skin-safe quality\nPride in premium routines",
    platformStrategy: legacy.channelPlan.join("\n"),
    contentStrategy: legacy.messagingPillars.join("\n"),
    kpis: "Awareness growth\nQualified engagement\nWebsite intent",
    trackingPlan: "Track saves, shares, profile actions, and website clicks weekly.",
    executionPhases: legacy.next30Days.join("\n"),
    assetRequirements: "Reel scripts\nCarousel designs\nStatic creatives\nStory templates",
  };
}

function humanizePromptFailure(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("402") || m.includes("credits") || m.includes("can only afford")) {
    return "Prompt too large for free tier - upgrade credits or shorten inputs.";
  }
  if (m.includes("413") || m.includes("request too large") || m.includes("tpm")) {
    return "Prompt too large for free tier - upgrade credits or shorten inputs.";
  }
  return message;
}

function extractPillarPriorities(structured: Record<string, unknown>): string[] {
  const contentStrategy = structured["content_strategy"] as
    | { pillars?: Array<{ name?: string; description?: string } | string> }
    | undefined;
  const pillars = Array.isArray(contentStrategy?.pillars) ? contentStrategy.pillars : [];
  return pillars
    .map((pillar) =>
      typeof pillar === "string"
        ? pillar
        : [pillar.name, pillar.description].filter(Boolean).join(": "),
    )
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
}

function extractMonthlyGoals(structured: Record<string, unknown>): string[] {
  const phases = Array.isArray(structured["phases"]) ? (structured["phases"] as Array<Record<string, unknown>>) : [];
  const kpis = structured["kpis"];
  const phaseGoals = phases
    .map((phase) => String(phase.objective ?? phase.success_signal ?? phase.name ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
  const kpiGoal = typeof kpis === "object" && kpis
    ? [JSON.stringify(kpis).slice(0, 180)]
    : [];
  return [...phaseGoals, ...kpiGoal].slice(0, 4);
}

function buildSectionVariantText(
  sectionKey: string,
  client: Pick<MemoryClient, "name" | "website" | "instagramHandle" | "oneLineDescription">,
  variant: number,
): string {
  const productLine = client.oneLineDescription ?? "premium category offering";
  const website = client.website ?? "-";
  const instagram = client.instagramHandle ?? "-";
  const variants: Record<string, string[]> = {
    marketNarrative: [
      `${client.name} competes in a crowded fragrance market where harsh alcohol-based products dominate. The whitespace is skin-safe, alcohol-free daily fragrance rituals that combine wellness and premium scent identity.`,
      `${client.name} operates at the intersection of personal care and fragrance. Category demand is shifting toward clean, non-irritating formulations, creating a strong narrative space for alcohol-free perfume routines.`,
      `${client.name} is positioned inside an emerging clean-fragrance narrative: consumers want scent longevity without skin compromise. This market shift favors oil-based, gentle formulations with clear ingredient credibility.`,
    ],
    problemGapSolution: [
      `Problem: mainstream perfumes can irritate sensitive skin.\nGap: limited premium options communicate both performance and skin comfort.\nSolution: ${client.name} delivers alcohol-free, oil-based fragrance positioned as safe for daily pulse-point use.`,
      `Problem: consumers choose between longevity and skin safety.\nGap: category messaging rarely addresses reactive skin concerns.\nSolution: ${client.name} reframes fragrance as a wellness-aligned ritual with alcohol-free reliability.`,
      `Problem: sensitive users avoid frequent fragrance use.\nGap: existing premium brands under-serve gentle-use needs.\nSolution: ${client.name} owns the "daily wear without harsh chemicals" promise and converts concern into confidence.`,
    ],
    brandFoundation: [
      `Mission: make fragrance wearable every day for sensitive skin audiences.\nVision: become India’s most trusted alcohol-free wellness perfume brand.\nValues: safety, consistency, transparency, premium simplicity.`,
      `Mission: remove skin anxiety from fragrance choices.\nVision: lead the clean personal-fragrance movement in India.\nValues: gentleness, credibility, craftsmanship, audience empathy.`,
      `Mission: build skin-kind fragrance routines people can repeat daily.\nVision: define premium alcohol-free perfume standards.\nValues: efficacy, trust, clean formulation, ritual-first design.`,
    ],
    brandPhilosophy: [
      `${client.name} believes fragrance should feel as safe as skincare. The brand rejects harsh formulation shortcuts and champions repeatable daily comfort.`,
      `${client.name} treats fragrance as personal care. It rejects irritation trade-offs and champions clean confidence, emotional comfort, and long-term trust.`,
      `${client.name} frames scent as a wellness ritual, not a one-time spray. It rejects aggressive alcohol-heavy formulas and champions gentle consistency.`,
    ],
    audience: [
      `Primary: men and women 18-40 in tier 1/2 cities seeking premium fragrance without irritation.\nSecondary: gifting buyers looking for safe daily-use products.\nSignals: checks ingredients, values comfort, prefers trusted digital education.`,
      `Primary: consumers with dry/reactive skin avoiding harsh perfumes.\nSecondary: premium lifestyle audiences wanting clean-brand positioning.\nMotivations: confidence in social settings, skin safety, product credibility.`,
      `Primary: personal care conscious users upgrading from mainstream sprays.\nSecondary: online-first audiences influenced by wellness-led beauty narratives.\nNeeds: non-irritating formula, long-wear confidence, proof-backed messaging.`,
    ],
    emotionalDrivers: [
      `Confidence without irritation\nPride in clean premium choices\nRelief from skin anxiety`,
      `Comfort in daily wear\nTrust in gentle formulation\nIdentity through premium rituals`,
      `Safety in every application\nBelonging to mindful self-care culture\nAssurance through transparency`,
    ],
    platformStrategy: [
      `Instagram (primary): discovery + product education reels.\nPinterest (secondary): save-led visual education boards.\nSupport: weekly website-focused conversion posts.\nReferences: ${website}, ${instagram}`,
      `Instagram: high-frequency short-form for routine storytelling.\nPinterest: evergreen guides and ingredient-led content.\nDistribution: product-use demos, lifestyle positioning, and trust proof.`,
      `Instagram: conversion-intent creative with social proof.\nPinterest: intent-capture content for grooming routines.\nExecution: weekly rhythm balancing awareness, education, and conversion nudges.`,
    ],
    contentStrategy: [
      `Pillars: product education, skin-safe proof, lifestyle ritual, brand trust.\nFormats: reels, carousels, static visuals, stories.\nVoice: premium yet relatable; science-lite and practical.`,
      `Pillars: why alcohol-free matters, daily use cues, ingredient confidence, emotional identity.\nFormats: short reels, infographics, before/after narratives.\nTone: warm, assured, benefit-led.`,
      `Pillars: gentle formula differentiation, use-case storytelling, testimonials, guided routines.\nFormats: reels + carousel education + story prompts.\nTone: clear, credible, aspirational.`,
    ],
    kpis: [
      `Reach growth on Instagram\nSave/share ratio on education content\nWebsite traffic from social landing pages\nDM inquiries for product recommendations`,
      `Profile visit-to-click conversion\nCommunity engagement rate\nRepeat viewers on routine content\nLead quality from campaign CTAs`,
      `Awareness lift across weekly content\nContent-assisted product page visits\nStory interactions and replies\nMonthly qualified intent actions`,
    ],
    trackingPlan: [
      `Weekly: reach, saves, shares, profile actions, outbound clicks.\nBi-weekly: top hooks, top formats, top audience segments.\nMonthly: platform split performance + content-to-conversion insights.`,
      `Track event set: post saves, link clicks, DM keywords, product page sessions.\nTooling: platform analytics + web analytics dashboard.\nCadence: weekly sprint review, monthly optimization pass.`,
      `Capture: awareness, engagement depth, conversion intent.\nReport by pillar and format every week.\nUse monthly synthesis to rebalance content mix and CTA strategy.`,
    ],
    executionPhases: [
      `Phase 1 (Week 1-2): launch narrative + product education baseline.\nPhase 2 (Week 3-4): trust proof + routine integration.\nPhase 3 (Week 5-8): conversion-focused campaigns and optimization.`,
      `Phase 1: rapid setup and consistency system.\nPhase 2: audience trust and differentiated messaging.\nPhase 3: growth acceleration via high-performing formats.`,
      `Phase 1: awareness and positioning clarity.\nPhase 2: engagement depth and social proof build.\nPhase 3: conversion intent and scale cadence.`,
    ],
    assetRequirements: [
      `Monthly reel shot-list templates\nCarousel design system (6-slide structure)\nIngredient explainer visuals\nStory interaction templates\nUTM-ready landing links`,
      `Foundational brand copy bank\nProduct-use demo scripts\nPlatform-specific caption bank\nCommunity response macros\nWeekly reporting dashboard`,
      `Creative brief pack per pillar\nVisual mood board + typography guidance\nProof/content library workflow\nCTA keyword framework\nCampaign measurement sheet`,
    ],
  };
  const choices = variants[sectionKey] ?? [`${sectionKey} strategy section for ${client.name}.`];
  return choices[variant % choices.length] ?? choices[0]!;
}

function serializeClient(c: typeof clientsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    instagramHandle: c.instagramHandle,
    oneLineDescription: c.oneLineDescription,
    sow: c.sow ?? null,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  };
}

function serializeStrategy(s: typeof strategiesTable.$inferSelect) {
  return {
    id: s.id,
    clientId: s.clientId,
    structuredStrategy: s.structuredStrategy,
    strategyDocument: s.strategyDocument,
    templateType: s.templateType,
    version: s.version,
    status: s.status,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
  };
}

export default router;

export function getMemoryClientForWorkflow(clientId: string): MemoryClient | null {
  return memoryClients.get(clientId) ?? null;
}

export function getMemoryStrategyForWorkflow(clientId: string): MemoryStrategy | null {
  return memoryStrategies.get(clientId) ?? null;
}
