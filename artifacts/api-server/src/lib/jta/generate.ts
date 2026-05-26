import { createHash } from "node:crypto";
import { getStrictJsonWithRetry } from "../llm/json-retry.js";
import type { LLMProvider } from "../llm/types.js";
import type { JtaProofConstraints, JtaResearchContext } from "./compact-research-context.js";

export const JTA_CANONICAL_SECTION_KEYS = [
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

export type JtaCanonicalSectionKey = (typeof JTA_CANONICAL_SECTION_KEYS)[number];

export type JtaWebsiteSignals = {
  title?: string;
  metaDescription?: string;
  heroExcerpt?: string;
  messagingPatterns?: string[];
  trustElements?: string[];
  conversionElements?: string[];
};

export type JtaPlatformSignals = {
  instagram?: {
    followerCount?: string;
    engagementNotes?: string[];
    contentPatterns?: string[];
    ctaPatterns?: string[];
  };
};

export type JtaGeneratorInput = {
  client: {
    brandName: string;
    clientName: string;
    websiteUrl: string;
    instagramHandle: string;
    oneLineDescription: string;
  };
  businessType: {
    primary: string;
    confidence: string;
  };
  sow: {
    industry: string;
    targetAudience: string;
    understandingOfRequirements: string;
    strategyLaunchPlanning: string;
    contentCreation: string;
    scopeOfWork: string;
    platforms: string[];
    monthlyPosts: Record<string, number>;
    contentMix: Record<string, number>;
    deliverables: string[];
    toneByPlatform: Record<string, string>;
  };
  instagram: {
    handle: string;
    bio: string;
    offerSummary: string;
    recentCaptionSnippets: string[];
    recurringTopics: string[];
    additionalInstagramNotes?: string;
    ctaPatterns?: string[];
    proofSignals?: string[];
    followerCount?: string;
    category?: string;
    visualStyleNotes?: string;
    instagramSummaryNotes?: string;
  } | null;
  approvedBusinessDna: {
    purpose: string;
    mission: string;
    vision: string;
    brandArchetype: string;
    coreValues: string[];
    personalityTraits: string[];
    audienceSegments: string[];
    pains: string[];
    desires: string[];
    objections: string[];
    category: string;
    valueProposition: string;
    differentiators: string[];
    reasonToBelieve: string[];
    primaryOffers: string[];
    transformationPromise: string;
    contentPillars: string[];
    themes: string[];
    hooksThatFitBrand: string[];
    trustSignalsToRepeat: string[];
    voiceTone: string[];
  };
  approvedResearchContext?: JtaResearchContext | null;
  websiteSignals?: JtaWebsiteSignals | null;
  platformSignals?: JtaPlatformSignals | null;
  proofConstraints?: JtaProofConstraints | null;
  templateType: string;
};

type GeneratedJtaDraft = {
  canonicalSections?: Partial<Record<JtaCanonicalSectionKey, string>>;
};

export type JtaGenerationResult = {
  canonicalSections: Record<string, string>;
  provider?: string;
  model?: string;
};

function hashPreview(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

const JTA_SYSTEM = `You are a senior strategist creating a strict JSON Jump-to-Action draft.

Return ONE valid JSON object only. No markdown. No commentary.

Rules:
- Use the approved Business DNA as the authority for category, audience, differentiation, tone, and trust framing.
- Use approvedResearchContext, websiteSignals, and platformSignals as the authority for specific taglines, products, rituals, CTAs, claim safety, and proof limitations.
- Respect the approved SOW as the authority for platforms, post volume, content mix, tone-by-platform, and execution scope.
- Ground problemGapSolution, brandFoundation, and contentStrategy in approvedResearchContext.researchHighlights and websiteSignals when present.
- Avoid category-level filler such as generic "wellness-conscious consumers" unless the approved inputs explicitly support that framing.
- Ground strategy choices in approved recurring Instagram topics/content buckets whenever those inputs are available.
- Do not paste raw Instagram captions, raw SOW text, or raw source dumps.
- Do not use ecommerce/product framing unless the inputs clearly support it.
- Do not imply certainty about analytics tools, dashboards, pixels, or instrumentation unless the approved inputs explicitly support them.
- When tooling or instrumentation is unconfirmed, use conditional phrasing such as "if available" or stay tool-agnostic.
- Do not assume blogs, webinars, founder-led inbound, client calls, or similar long-form engines for a platform unless the approved inputs explicitly support them.
- Do not mention paid ads, paid advertising, paid social, CAC, customer acquisition cost, campaign setup, targeting, pixels, retargeting, or ad spend unless the approved inputs explicitly put them in scope. If paid support is plausible but unconfirmed, omit it rather than labeling it as fact.
- PROOF & CLAIM GUARDRAILS: Do not claim testimonials, reviews, UGC, user-generated content, influencer proof, influencer partnerships, press coverage, press, certifications, or clinical proof as existing assets unless approved inputs or proofConstraints confirm them.
- When proofConstraints, proofGaps, or claimSafety.proofLimitations indicate weak or unconfirmed proof, use explicit proof-BUILDING language: build proof, collect, gather, source, request, develop, create a pipeline for, or plan to gather. Do NOT use showcase, share, utilize, leverage, display, highlight, feature, promote, present, or use when referring to testimonials, UGC, reviews, influencers, press, certifications, or clinical proof.
- contentStrategy, executionPhases, and assetRequirements must not treat unconfirmed proof as already available. Prefer founder-led education, ingredient explainers, ritual demos, and first-party capture plans until proof is confirmed.
- Respect claimSafety.claimsToAvoid and sensitiveCategoryNotes in problemGapSolution and contentStrategy.
- Avoid internal/meta planning phrases such as "translating our brand DNA into execution logic" when audience-facing strategy language would be clearer.
- For wellness, beauty, fragrance, skincare, fitness, or health-adjacent brands, frame benefits as positioning, ritual, sensory experience, self-care context, or perceived audience experience unless the approved inputs provide claim-level proof. Do not imply medical guarantees, treatment, cures, clinical proof, expert endorsement, or therapeutic certainty.
- With thin inputs, degrade safely: unknown factual fields should use "Not available from current inputs" when explicit absence is useful; strategic guesses must be labeled "Likely but needs client confirmation"; avoid invented demographics, geographies, values, certifications, proof assets, platforms, claims, or paid/performance tactics.
- Each canonical section must be distinct and commercially useful.
- Write polished section text, not bullet fragments or formulas.
- Use client.brandName in all client-facing copy. Never use internal CRM labels such as "(client)" suffixes.`;

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimExistingDraftForRepair(draft: Record<string, string> | null | undefined): Record<string, string> {
  if (!draft) return {};
  const out: Record<string, string> = {};
  for (const key of JTA_CANONICAL_SECTION_KEYS) {
    const value = normalizeText(draft[key]);
    if (!value) continue;
    out[key] = value.length > 900 ? `${value.slice(0, 900)}…` : value;
  }
  return out;
}

function buildServiceVocabularyGuard(input: JtaGeneratorInput): string {
  if (input.businessType.primary !== "service_agency" && input.businessType.primary !== "saas") {
    return "";
  }
  return `SERVICE-TYPE VOCABULARY GUARD:
- This business reads as service-, agency-, coaching-, or SaaS-led.
- Do not describe the offer using ecommerce or retail language such as "product page", "cart", "checkout", "SKU", "inventory", "storefront", or "shopping".
- Use service-appropriate language instead: offer, service, engagement, advisory work, subscription, software, consultation, pipeline, or client journey, whichever best fits the evidence.`;
}

function buildProofGuardrailBlock(input: JtaGeneratorInput): string {
  if (!input.proofConstraints && !input.approvedResearchContext?.proofGaps?.length) {
    return "";
  }
  const gaps = input.approvedResearchContext?.proofGaps ?? [];
  const types = input.proofConstraints?.unconfirmedProofTypes ?? [];
  const limitations = input.proofConstraints?.limitations ?? input.approvedResearchContext?.claimSafety?.proofLimitations ?? "";
  return `PROOF CONSTRAINTS FOR THIS RUN:
- proofLimitations: ${limitations || "not specified"}
- unconfirmedProofTypes: ${types.length > 0 ? types.join(", ") : "none listed"}
- proofGaps: ${gaps.length > 0 ? gaps.join(" | ") : "none listed"}
- Proof is weak or unconfirmed for this run. Use proof-BUILDING framing only.
- BANNED phrasing: showcase/share/utilize/leverage/display/highlight/feature/promote/present/use customer testimonials, UGC, user-generated content, reviews, influencer partnerships, influencer proof, press, certifications, or clinical proof as existing assets.
- REQUIRED phrasing: build proof, collect, gather, source, request, develop, create a pipeline for, plan to gather, or proof-building content systems (education, founder demos, explainers, first-party capture).`;
}

function buildPrompt(input: JtaGeneratorInput, repairIssues?: string[], existingDraft?: Record<string, string> | null): string {
  const repairBlock =
    repairIssues && repairIssues.length > 0
      ? `\nREPAIR MODE:\n- Preserve valid sections unchanged.\n- Rewrite only the flagged sections.\n- Keep the exact canonicalSections keys and strict JSON shape.\n- Use approved Business DNA, approved research context, and approved SOW inputs only.\n- Do not copy raw source text or weaken already-strong sections.\nTARGETED REPAIR INSTRUCTIONS:\n- ${repairIssues.join("\n- ")}\n\nPREVIOUS DRAFT JSON:\n${JSON.stringify(trimExistingDraftForRepair(existingDraft))}\n`
      : "";
  return `APPROVED JUMP-TO-ACTION INPUT:
${JSON.stringify(input)}
${repairBlock}
${buildServiceVocabularyGuard(input)}
${buildProofGuardrailBlock(input)}
APPROVED ACTIVE PLATFORMS FOR THIS RUN: ${input.sow.platforms.join(", ") || "none"}
CLIENT-FACING BRAND NAME: ${input.client.brandName}

Return a JSON object with one top-level key:
- canonicalSections

Inside canonicalSections, include these exact keys:
- marketNarrative
- problemGapSolution
- brandFoundation
- brandPhilosophy
- audience
- emotionalDrivers
- platformStrategy
- contentStrategy
- kpis
- trackingPlan
- executionPhases
- assetRequirements

Quality rules:
- Good market/foundation/audience sections each do a distinct job and should not restate one another.
- Good platformStrategy explains the role of each approved platform, not just the platform names.
- Good contentStrategy turns approved DNA and research highlights into audience-facing content moves, not repeated pillars/themes/hooks as lists.
- Good kpis and trackingPlan are measurable, operational, and tied to real signals and review cadence.
- Good executionPhases reflect real scope, sequencing, and deliverables rather than generic project boilerplate.
- Good contentStrategy clearly reflects approved DNA themes, recurring topics/content buckets, research highlights, and the approved platform mix.
- marketNarrative must frame the market opportunity and whitespace
- problemGapSolution must separate pain, gap, and solve using specific approved research signals when available
- brandFoundation must define mission/promise/differentiator/non-negotiables in client-ready language using client.brandName
- audience must describe who matters now, what moves them, and what blocks them
- platformStrategy must only cover approved active platforms
- contentStrategy must synthesize pillars/themes/hooks and research highlights, not dump raw lists
- kpis and trackingPlan must be operational, not generic
- executionPhases and assetRequirements must reflect the approved strategy scope

Specificity and distinctness rules:
- no two sections should restate each other
- platformStrategy must explain the role of each approved platform, not just list them
- do not mention or imply any platform outside the approved active platform mix for this run
- contentStrategy must translate DNA and approvedResearchContext into audience-facing content moves, not repeat DNA pillars/themes/hooks as lists
- contentStrategy should clearly derive from approved DNA, approved SOW, approvedResearchContext, recurring Instagram topics/content buckets, and the approved platform mix
- contentStrategy should describe audience-facing content moves, platform jobs, and recurring series ideas, not internal planning language
- include sharper, usable hook angles tied to recurring topics and the actual brand stance when the content strategy references hooks
- marketNarrative should explain how the brand becomes more distinct, memorable, or category-relevant, not just more visible
- contentStrategy should turn approved content buckets, research highlights, or recurring topics into concrete series, education angles, ritual content, or conversion moves when those inputs exist
- when proof is weak or unconfirmed, contentStrategy, executionPhases, and assetRequirements must use build/collect/source proof framing—not showcase, share, utilize, or leverage testimonials, UGC, reviews, influencers, press, certifications, or clinical proof
- kpis must be measurable and tied to real signals such as saves, shares, DMs, reach, replies, profile actions, clicks, leads, enquiries, retention, or CTR
- trackingPlan must include cadence and breakdown such as weekly/monthly and by content type, platform, or funnel stage
- do not name analytics tools or instrumentation with certainty unless the approved inputs confirm them
- where tooling or setup is unknown, use conditional phrasing such as "if available" or keep the language tool-agnostic
- do not include CAC, customer acquisition cost, campaign setup, targeting setup, pixels, retargeting, or paid optimization unless the approved SOW explicitly includes paid media scope
- health, wellness, beauty, skincare, and fragrance claims must stay in positioning, ritual, sensory, self-care, or perceived-experience language unless verified claim support is present
- executionPhases must reflect real scope and sequencing, not generic project boilerplate

Tiny negatives:
- bad KPI: "increase engagement and awareness"
- bad duplication: market and audience both restating generic growth ambition
- bad platform strategy: "Instagram and LinkedIn" with no role distinction
- bad content strategy with weak proof: "showcase customer testimonials and UGC" when proofConstraints say proof is unconfirmed

Tiny positives:
- good platform strategy: "Instagram for discovery and proof; Pinterest for saveable education and checklist-led discovery"
- good KPI/tracking: "track saves, shares, DMs, and profile clicks weekly; review monthly by platform and funnel stage"
- good execution phases: "Phase 1: foundation + first 4 weeks of programming; Phase 2: launch + iteration; Phase 3: scale + systematize"
- good weak-proof content strategy: "Build credibility through ingredient education, ritual demos, and founder-led explainers while collecting first-party proof assets"`;
}

function normalizeSections(value: unknown): Record<string, string> {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    JTA_CANONICAL_SECTION_KEYS.map((key) => [key, normalizeText(record[key])]),
  );
}

export async function generateJtaWithLlm(params: {
  provider: LLMProvider;
  input: JtaGeneratorInput;
  repairIssues?: string[];
  existingDraft?: Record<string, string> | null;
}): Promise<JtaGenerationResult> {
  const prompt = buildPrompt(params.input, params.repairIssues, params.existingDraft ?? null);
  let rawResponse = "";
  console.info(
    `[llm-observe] jta.prompt hash=${hashPreview(prompt)} preview=${prompt.replace(/\s+/g, " ").trim().slice(0, 500)}`,
  );
  const parsed = await getStrictJsonWithRetry<GeneratedJtaDraft>(params.provider, {
    contextLabel: params.repairIssues?.length ? "jump to action repair" : "jump to action",
    maxOutputTokens: 2200,
    onRawResponse: (raw, attempt) => {
      rawResponse = raw;
      console.info(
        `[llm-observe] jta.raw attempt=${attempt} hash=${hashPreview(raw)} preview=${raw.replace(/\s+/g, " ").trim().slice(0, 1000)}`,
      );
    },
    messages: [
      { role: "system", content: JTA_SYSTEM },
      { role: "user", content: prompt },
    ],
  });
  const info = params.provider.describe?.() ?? { provider: params.provider.id, model: "default" };
  const canonicalSections = normalizeSections(parsed.canonicalSections);
  console.info(
    `[llm-observe] jta.final hash=${hashPreview(JSON.stringify(canonicalSections))} raw_hash=${hashPreview(rawResponse || JSON.stringify(parsed))} helper_modified_content_fields=no`,
  );
  return {
    canonicalSections,
    provider: info.provider,
    model: info.model,
  };
}
