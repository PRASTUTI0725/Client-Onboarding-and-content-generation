import { Router, type IRouter } from "express";
import { compactImportedResearchForDna } from "@workspace/research-brief";
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
import { getStrictJsonWithRetry } from "../lib/llm/json-retry.js";
import { selectTemplate, type TemplateType } from "../lib/strategy/templates.js";
import { createHash, randomUUID } from "node:crypto";
import { clearAIFallbackUsed, getLastFailureStage, markAIFallbackUsed, markFallbackUsed, setLastFailureStage } from "../lib/runtime-mode.js";
import { isDbUnavailableError } from "../lib/db-unavailable.js";
import multer from "multer";
import {
  getRequestLLMProvider,
  getNoUsableAiProviderUserMessage,
  isNoUsableAiProviderError,
  shouldUseRealAI,
} from "../lib/llm/request-provider.js";
import type { LLMProvider } from "../lib/llm/types.js";
import { FallbackProvider } from "../lib/llm/fallback-provider.js";
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
import {
  type BusinessDna,
  type BusinessDnaDiagnosticEvent,
  buildBusinessDnaFromPublicSignals,
  createEmptyBusinessDna,
} from "../lib/business-dna.js";
import {
  BusinessDnaPromptBudgetError,
  generateBusinessDnaWithLlm,
  toBusinessDnaPromptBudgetDiagnostics,
  type BusinessDnaGeneratorInput,
} from "../lib/business-dna/generate.js";
import { BUSINESS_DNA_REBUILD_TIMEOUT_MS } from "../lib/business-dna/constants.js";
import {
  buildBusinessDnaRepairInstructionLines,
  buildBusinessDnaRepairPromptInput,
  validateBusinessDnaSemantics,
  validateBusinessDnaStructure,
} from "../lib/business-dna/validate.js";
import { generateJtaWithLlm, type JtaGeneratorInput } from "../lib/jta/generate.js";
import {
  buildProofConstraintsFromResearchContext,
  compactImportedResearchForJta,
  countJtaResearchContextFields,
  type JtaProofConstraints,
} from "../lib/jta/compact-research-context.js";
import {
  buildJtaRepairInstructionLines,
  buildJtaRepairPromptInput,
  validateJtaSemantics,
  validateJtaStructure,
} from "../lib/jta/validate.js";
import { resolveClientFacingBrandName, sanitizeClientFacingText } from "../lib/client-display-name.js";
import { classifyBusinessType } from "../lib/business-type/classify.js";
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
import {
  getBusinessDnaRequirementError,
  getCurrentJtaDraftRequirementError,
  getBusinessDnaWorkflowState,
  getJtaRequirementError,
  getJtaWorkflowState,
  readApprovedSnapshotRecord,
} from "../lib/workflow-approval.js";
import { z } from "zod";

const router: IRouter = Router();

function resolveConcreteTemplateType(
  enriched: Record<string, unknown> | null | undefined,
  requestedTemplateType?: string | null,
): TemplateType {
  const normalizedRequestedTemplate =
    typeof requestedTemplateType === "string" && requestedTemplateType.trim().length > 0
      ? requestedTemplateType.trim()
      : null;
  return selectTemplate(enriched ?? {}, normalizedRequestedTemplate);
}

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
    instagram?: StructuredInstagramInput;
    instagramSummaryNotes?: string;
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

type StrategyPatchResponse = {
  patch?: {
    sectionKey?: string;
    sectionValue?: string;
    meta?: Record<string, unknown>;
  };
};

type StructuredInstagramInput = {
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
};

type ApprovedContextSnapshot = {
  id: string;
  createdAt: string;
  sourceContext: "approved_snapshot";
  templateType: string;
  client: {
    id: string;
    name: string;
    websiteUrl: string | null;
    instagramHandle: string | null;
    oneLineDescription: string | null;
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
    instagram?: StructuredInstagramInput;
    normalizedSections?: Record<string, string>;
    approval?: { approved?: boolean; approvedAt?: string | null };
  };
  provenance: {
    website: "extracted" | "missing";
    instagram: "extracted" | "missing";
    oneLineDescription: "extracted" | "missing";
    sow: "extracted";
    template: "extracted";
    generatedAt: string;
  };
};

type RunMetaInput = {
  clientId: string;
  snapshotId: string | null;
  taskType: "business_dna" | "strategy_bootstrap" | "strategy_generate" | "calendar_generate";
  provider: string;
  model: string;
  fallbackUsed: boolean;
  sourceContext: "draft" | "approved_snapshot";
  timestamp?: string;
  generationMode?: "heuristic" | "llm" | "fallback" | "deterministic";
  validation?: {
    status: "not_run" | "passed" | "warning" | "failed";
    note?: string;
    issues?: string[];
  };
  inputSources?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

type ArtifactApprovalMeta = {
  approved: boolean;
  approvedAt?: string | null;
  approvedSnapshotId?: string | null;
  approvalVersion?: string;
};

type BusinessDnaArtifactMeta = {
  businessDnaVersion?: string;
  businessDnaInputVersion?: string;
  generationMode?: "llm" | "heuristic_fallback" | "heuristic" | "fallback";
  validationStatus?: "passed" | "warning" | "failed" | "not_run";
  validationIssues?: string[];
  provider?: string;
  model?: string;
  fallbackReason?: string;
  fallbackSource?: "business_dna_heuristic";
  generatedAt?: string;
  snapshotId?: string | null;
  currentSnapshotId?: string | null;
  stale?: boolean;
  latestRun?: ReturnType<typeof buildRunMeta>;
  approval?: ArtifactApprovalMeta;
  manualEdits?: Record<string, { editedAt: string; source: string }>;
  businessType?: {
    primary?: string;
    confidence?: string;
  };
};

type StrategyArtifactMeta = {
  latestRun?: ReturnType<typeof buildRunMeta>;
  snapshotId?: string | null;
  snapshotState?: "fresh" | "stale";
  currentSnapshotId?: string | null;
  staleAt?: string;
  jtaVersion?: string;
  jtaInputVersion?: string;
  generationMode?: "llm" | "deterministic_fallback" | "deterministic" | "fallback";
  validationStatus?: "passed" | "warning" | "failed" | "not_run";
  validationIssues?: string[];
  provider?: string;
  model?: string;
  fallbackReason?: string;
  fallbackSource?: "bootstrap_deterministic";
  generatedAt?: string;
  approval?: ArtifactApprovalMeta;
  businessType?: {
    primary?: string;
    confidence?: string;
  };
};

const EDITABLE_BUSINESS_DNA_FIELDS = {
  purpose: "text",
  mission: "text",
  vision: "text",
  "personalityTraits": "list",
  "toneOfVoice.style": "list",
  "toneOfVoice.dos": "list",
  "toneOfVoice.donts": "list",
  "toneOfVoice.samplePhrases": "list",
  "targetAudience.segments": "list",
  "targetAudience.demographics": "list",
  "targetAudience.psychographics": "list",
  "targetAudience.geographies": "list",
  "targetAudience.pains": "list",
  "targetAudience.desires": "list",
  "targetAudience.objections": "list",
  "positioning.category": "text",
  "positioning.valueProposition": "text",
  "positioning.differentiators": "list",
  "positioning.competitorReferences": "list",
  "positioning.marketAngle": "text",
  "positioning.reasonToBelieve": "list",
  "offers.primaryOffers": "list",
  "offers.pricingSignals": "list",
  "offers.transformationPromise": "text",
  "offers.urgencyStyle": "text",
  "contentStrategy.contentPillars": "list",
  "contentStrategy.themes": "list",
  "contentStrategy.hooksThatFitBrand": "list",
  "contentStrategy.topicsToAvoid": "list",
  "contentStrategy.trustSignalsToRepeat": "list",
} as const satisfies Record<string, "text" | "list">;

type EditableBusinessDnaFieldPath = keyof typeof EDITABLE_BUSINESS_DNA_FIELDS;

function isEditableBusinessDnaFieldPath(path: string): path is EditableBusinessDnaFieldPath {
  return path in EDITABLE_BUSINESS_DNA_FIELDS;
}

function normalizeBusinessDnaPatchValue(path: string, value: unknown): string | string[] {
  const mode = EDITABLE_BUSINESS_DNA_FIELDS[path as EditableBusinessDnaFieldPath];
  if (mode === "list") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
    return String(value ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(value ?? "").trim();
}

function clonePlainRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function applyNestedPatch(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) return target;
  const next = clonePlainRecord(target);
  let cursor: Record<string, unknown> = next;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const existing = cursor[segment];
    cursor[segment] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
  return next;
}

function extractApprovedBusinessDnaValidationContext(
  approvedSnapshot: ApprovedContextSnapshot,
  snapshotInput: ReturnType<typeof buildGenerationInputsFromSnapshot>,
  brandName: string,
  clientName: string,
  businessTypePrimary: string,
) {
  const approvedSowRecord = approvedSnapshot.sow as Record<string, unknown>;
  return {
    approvedSowRecord,
    snapshotInput,
    brandName,
    clientName,
    businessTypePrimary,
  };
}

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\s*e\.g\./i,
  /^\s*for example\b/i,
  /^\s*paste the\b/i,
  /^\s*short list of recurring outputs/i,
  /^\s*how should instagram sound\??/i,
  /^\s*e\.g\.\s*1[×x]\s*monthly\b/i,
];

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

const BUSINESS_DNA_REBUILD_TIMEOUT_REASON = "business_dna_rebuild_timeout";
const BUSINESS_DNA_REBUILD_REQ_ABORTED_REASON = "business_dna_rebuild_req_aborted";
const BUSINESS_DNA_REBUILD_REQ_CLOSED_REASON = "business_dna_rebuild_req_closed";
const BUSINESS_DNA_REBUILD_RES_CLOSED_REASON = "business_dna_rebuild_res_closed";

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" && reason ? reason : "Operation aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isTimeoutAbortReason(reason: unknown): boolean {
  return reason === BUSINESS_DNA_REBUILD_TIMEOUT_REASON;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw createAbortError(signal.reason);
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
  return validateBusinessDnaStructure(value).ok;
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
    dnaBackgroundStatus: hasAutoDnaContext ? "locked_pending_sow_approval" : "idle",
    dnaBackgroundMode: "approval_gated",
    dnaBackgroundNote: hasAutoDnaContext
      ? "Approve SOW to generate final Business DNA and Jump-to-Action."
      : "Add website, Instagram, or a business summary to enable Business DNA after SOW approval.",
  });
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
      req.log.info(
        { clientId: client.id, sourceContext: "draft" },
        "Business DNA generation deferred until SOW approval",
      );
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
      req.log.info(
        { clientId: id, sourceContext: "draft", fallbackReason: "db_unavailable" },
        "Business DNA generation deferred until SOW approval (memory fallback)",
      );
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

  const enrichedPayload: Record<string, unknown> = mergeEnrichedProvenance(null, {
    dnaBackgroundStatus: "locked_pending_sow_approval",
    dnaBackgroundMode: "approval_gated",
    dnaBackgroundNote: "Approve SOW to generate final Business DNA and Jump-to-Action.",
  });
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
    req.log.info({ clientId: client.id, sourceContext: "draft" }, "Business DNA generation deferred until SOW approval");
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
    req.log.info(
      { clientId: id, sourceContext: "draft", fallbackReason: "db_unavailable" },
      "Business DNA generation deferred until SOW approval (memory fallback)",
    );
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
  const rebuildRequestId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const rebuildAbortController = new AbortController();
  let rebuildFinished = false;
  const logDiagnostic = (
    step: string,
    detail: Record<string, unknown> = {},
    level: "info" | "warn" | "error" = "info",
  ) => {
    req.log[level](
      {
        clientId: clientId ?? null,
        rebuildRequestId,
        step,
        elapsedMs: elapsedMs(startedAt),
        ...detail,
      },
      "Business DNA rebuild diagnostic",
    );
  };
  const emitBuildDiagnostic = (event: BusinessDnaDiagnosticEvent) => {
    logDiagnostic(`${event.step}_${event.phase}`, event.detail ?? {});
  };
  const abortRebuild = (reason: string, level: "warn" | "error" = "warn") => {
    if (rebuildFinished || rebuildAbortController.signal.aborted) return;
    rebuildAbortController.abort(reason);
    logDiagnostic("request_cancelled", { reason }, level);
  };
  const rebuildTimeout = setTimeout(() => {
    abortRebuild(BUSINESS_DNA_REBUILD_TIMEOUT_REASON, "error");
  }, BUSINESS_DNA_REBUILD_TIMEOUT_MS);
  req.once("aborted", () => abortRebuild(BUSINESS_DNA_REBUILD_REQ_ABORTED_REASON));
  res.once("close", () => {
    if (!rebuildFinished) abortRebuild(BUSINESS_DNA_REBUILD_RES_CLOSED_REASON);
  });
  res.once("finish", () => {
    rebuildFinished = true;
    clearTimeout(rebuildTimeout);
    logDiagnostic("response_sent", { statusCode: res.statusCode });
  });
  logDiagnostic("request_start");
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
    const approvedSnapshot = readApprovedSnapshot(sow);
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
      return;
    }
    logDiagnostic("snapshot_load", {
      snapshotId: approvedSnapshot.id,
      sourceContext: approvedSnapshot.sourceContext,
    });
    const snapshotInput = buildGenerationInputsFromSnapshot(approvedSnapshot, raw);
    const approvedSowRecord = approvedSnapshot.sow as Record<string, unknown>;
    const businessType = classifyBusinessType({
      brandName: snapshotInput.name,
      clientName: client.name,
      oneLineDescription: snapshotInput.oneLineDescription,
      industry: approvedSowRecord.industry,
      targetAudience: approvedSowRecord.targetAudience,
      websiteText: [snapshotInput.websiteUrl, snapshotInput.oneLineDescription].filter(Boolean).join(" "),
      instagramBio: snapshotInput.instagram?.bio,
      offerSummary: snapshotInput.instagram?.offerSummary,
    });
    const useRealAI = shouldUseRealAI(req);
    const aiHeaderDiagnostics = buildAiHeaderDiagnostics(req);
    let resolvedProvider: LLMProvider | null = null;
    let providerInfo = { provider: "public-signals", model: "n/a" };
    if (useRealAI) {
      try {
        resolvedProvider = getRequestLLMProvider(req);
        providerInfo = resolvedProvider.describe?.() ?? { provider: resolvedProvider.id, model: "default" };
      } catch (error) {
        providerInfo = { provider: "fallback", model: "business_dna_heuristic" };
        req.log.warn({ clientId, err: error }, "Business DNA rebuild falling back because no AI provider was available");
      }
    }
    let fallbackBusinessDna: BusinessDna;
    try {
      fallbackBusinessDna = await buildBusinessDnaFromPublicSignals({
        name: snapshotInput.name,
        websiteUrl: snapshotInput.websiteUrl,
        instagramHandle: snapshotInput.instagramHandle,
        structuredInstagram: snapshotInput.instagram,
        oneLineDescription: snapshotInput.oneLineDescription || null,
        instagramSummaryNotes: snapshotInput.instagramSummaryNotes || null,
        existing: existingBusinessDna,
        enrichedProfile: existingEnriched,
        sowSections: snapshotInput.sowSections,
        skipInstagramFetch: true,
        diagnostic: emitBuildDiagnostic,
        abortSignal: rebuildAbortController.signal,
      });
    } catch (error) {
      if (rebuildAbortController.signal.aborted && isTimeoutAbortReason(rebuildAbortController.signal.reason)) {
        logDiagnostic("request_timeout", { reason: rebuildAbortController.signal.reason }, "error");
        res.status(504).json({ error: "Business DNA rebuild timed out while fetching public signals" });
        return;
      }
      if (isAbortError(error) || rebuildAbortController.signal.aborted) {
        logDiagnostic("request_aborted", { reason: rebuildAbortController.signal.reason ?? String(error) });
        return;
      }
      throw error;
    }
    throwIfAborted(rebuildAbortController.signal);
    logDiagnostic("instagram_skip_applied", {
      source: fallbackBusinessDna.mcp.instagram.source ?? null,
      classification: fallbackBusinessDna.platformSignals.instagram.status?.classification ?? null,
    });
    const generatorInput = buildApprovedBusinessDnaGeneratorInput({
      approvedSnapshot,
      snapshotInput,
      clientName: client.name,
      businessType: {
        primary: businessType.primary,
        confidence: businessType.confidence,
      },
      websiteSummary: summarizeWebsiteForBusinessDnaInput(fallbackBusinessDna),
      importedResearchBrief:
        (raw.importedResearchBrief as Record<string, unknown> | undefined) ?? null,
    });
    if (shouldLogProvenance()) {
      req.log.info(
        {
          clientId,
          clientName: client.name,
          businessType: businessType.primary,
          artifactStage: "business_dna",
          approvedSnapshotId: approvedSnapshot.id,
          sourceSnippet: {
            sow: previewText(generatorInput.sow, 300),
            website: previewText(generatorInput.website, 220),
            instagram: previewText(generatorInput.instagram, 220),
          },
          promptInput: previewJson(generatorInput),
        },
        "Business DNA provenance source",
      );
    }
    let businessDna = fallbackBusinessDna;
    let fallbackUsed = true;
    let fallbackReason = "AI generation unavailable; heuristic Business DNA fallback was used.";
    let repairAttempted = false;
    let repairSucceeded = false;
    let promptBudgetDiagnostics: Record<string, unknown> = {};
    if (resolvedProvider) {
      try {
        const generated = await generateBusinessDnaWithLlm({
          provider: resolvedProvider,
          input: generatorInput,
          baseBusinessDna: fallbackBusinessDna,
        });
        throwIfAborted(rebuildAbortController.signal);
        promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(generated.promptBudget);
        const generatedAssessment = evaluateBusinessDnaCandidate(generated.businessDna, {
          approvedSowRecord,
          snapshotInput,
          brandName: snapshotInput.name,
          clientName: client.name,
          businessTypePrimary: businessType.primary,
        });
        if (generatedAssessment.validationStatus === "failed") {
          repairAttempted = true;
          const repaired = await generateBusinessDnaWithLlm({
            provider: resolvedProvider,
            input: generatorInput,
            baseBusinessDna: fallbackBusinessDna,
            repairIssues: buildBusinessDnaRepairInstructionLines({
              ok: generatedAssessment.validationStatus !== "failed",
              status: generatedAssessment.validationStatus,
              issues: generatedAssessment.validationIssues,
              issueDetails: generatedAssessment.validationIssueDetails,
            }),
            existingDraft: generated.businessDna,
          });
          throwIfAborted(rebuildAbortController.signal);
          promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(repaired.promptBudget);
          const repairedAssessment = evaluateBusinessDnaCandidate(repaired.businessDna, {
            approvedSowRecord,
            snapshotInput,
            brandName: snapshotInput.name,
            clientName: client.name,
            businessTypePrimary: businessType.primary,
          });
          if (repairedAssessment.validationStatus !== "failed") {
            businessDna = repaired.businessDna;
            fallbackUsed = false;
            fallbackReason = "";
            repairSucceeded = true;
            providerInfo = {
              provider: repaired.provider ?? providerInfo.provider,
              model: repaired.model ?? providerInfo.model,
            };
          } else {
            setLastFailureStage("validation_failed_after_response");
            fallbackReason = `LLM Business DNA failed validation after repair: ${repairedAssessment.validationIssues.join("; ")}`;
          }
        } else {
          businessDna = generated.businessDna;
          fallbackUsed = false;
          fallbackReason = "";
          providerInfo = {
            provider: generated.provider ?? providerInfo.provider,
            model: generated.model ?? providerInfo.model,
          };
        }
      } catch (error) {
        if (error instanceof BusinessDnaPromptBudgetError) {
          promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(error.promptBudget);
          setLastFailureStage("prompt_budget_exceeded");
        } else {
          setLastFailureStage("fallback_used");
        }
        fallbackReason = error instanceof Error ? error.message : String(error);
        req.log.warn({ clientId, err: error }, "Business DNA rebuild fell back to heuristic output");
      }
    }
    if (fallbackUsed && useRealAI) markAIFallbackUsed();
    if (!fallbackUsed) clearAIFallbackUsed();
    const { validationIssues, validationIssueDetails, validationStatus } = evaluateBusinessDnaCandidate(businessDna, {
      approvedSowRecord,
      snapshotInput,
      brandName: snapshotInput.name,
      clientName: client.name,
      businessTypePrimary: businessType.primary,
    });
    const validationNote =
      validationIssues.length > 0
        ? buildBusinessDnaRepairPromptInput({
            ok: validationStatus !== "failed",
            status: validationStatus,
            issues: validationIssues,
            issueDetails: validationIssueDetails,
          })
        : fallbackUsed
          ? fallbackReason
          : "Business DNA validation passed.";
    const runMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "business_dna",
      provider: providerInfo.provider,
      model: providerInfo.model,
      fallbackUsed,
      sourceContext: "approved_snapshot",
      generationMode: fallbackUsed ? "heuristic" : "llm",
      validation: {
        status: validationStatus,
        note: validationNote,
        issues: validationIssues,
      },
      inputSources: buildBusinessDnaInputSourceSummary({
        sourceContext: "approved_snapshot",
        websiteUrl: snapshotInput.websiteUrl,
        instagramHandle: snapshotInput.instagramHandle,
        structuredInstagram: snapshotInput.instagram,
        instagramSummaryNotes: snapshotInput.instagramSummaryNotes,
        sowSections: snapshotInput.sowSections,
        skipInstagramFetch: true,
        strategyType: approvedSnapshot.templateType ?? null,
      }),
      diagnostics: {
        ...aiHeaderDiagnostics,
        ...promptBudgetDiagnostics,
        ...buildProviderDiagnostics(resolvedProvider, {
          repairAttempted,
          repairSucceeded,
          fallbackReason: fallbackUsed ? fallbackReason : null,
        }),
      },
    });
    req.log.info({ clientId, trace: runMeta }, "Business DNA rebuild trace prepared");
    if (shouldLogProvenance()) {
      req.log.info(
        {
          clientId,
          clientName: client.name,
          businessType: businessType.primary,
          artifactStage: "business_dna",
          contentSource: fallbackUsed ? "heuristic_fallback" : "llm",
          helper_modified_content_fields: fallbackUsed ? "yes" : "no",
          helperNames: fallbackUsed ? ["buildBusinessDnaFromPublicSignals"] : [],
          finalArtifact: previewJson(businessDna),
        },
        "Business DNA provenance final",
      );
    }

    const rebuiltArtifact = annotateBusinessDnaArtifact(
      {
        ...existingEnriched,
        businessDna: businessDna as unknown as Record<string, unknown>,
      },
      runMeta,
      approvedSnapshot.id,
      false,
      businessType,
    );
    const nextEnriched = {
      ...rebuiltArtifact,
      __provenance: {
        ...((rebuiltArtifact.__provenance as Record<string, unknown> | undefined) ?? {}),
        dnaRebuiltFromUiAt: new Date().toISOString(),
        sourceContext: "approved_snapshot",
      },
    };

    logDiagnostic("save_start", { profileId: profile.id });
    const [updated] = await db
      .update(onboardingProfilesTable)
      .set({ enrichedData: nextEnriched, updatedAt: new Date() })
      .where(eq(onboardingProfilesTable.id, profile.id))
      .returning();
    throwIfAborted(rebuildAbortController.signal);

    if (!updated) {
      res.status(500).json({ error: "Failed to rebuild business DNA" });
      return;
    }
    logDiagnostic("save_end", { profileId: updated.id });

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
    const approvedSnapshot = readApprovedSnapshot(sow);
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
      return;
    }
    logDiagnostic("snapshot_load", {
      snapshotId: approvedSnapshot.id,
      sourceContext: approvedSnapshot.sourceContext,
      persistence: "memory_fallback",
    });
    const snapshotInput = buildGenerationInputsFromSnapshot(approvedSnapshot, raw);
    const approvedSowRecord = approvedSnapshot.sow as Record<string, unknown>;
    const businessType = classifyBusinessType({
      brandName: snapshotInput.name,
      clientName: client.name,
      oneLineDescription: snapshotInput.oneLineDescription,
      industry: approvedSowRecord.industry,
      targetAudience: approvedSowRecord.targetAudience,
      websiteText: [snapshotInput.websiteUrl, snapshotInput.oneLineDescription].filter(Boolean).join(" "),
      instagramBio: snapshotInput.instagram?.bio,
      offerSummary: snapshotInput.instagram?.offerSummary,
    });
    const aiHeaderDiagnostics = buildAiHeaderDiagnostics(req);
    let resolvedProvider: LLMProvider | null = null;
    let providerInfo = { provider: "public-signals", model: "n/a" };
    if (shouldUseRealAI(req)) {
      try {
        resolvedProvider = getRequestLLMProvider(req);
        providerInfo = resolvedProvider.describe?.() ?? { provider: resolvedProvider.id, model: "default" };
      } catch (error) {
        providerInfo = { provider: "fallback", model: "business_dna_heuristic" };
        req.log.warn({ clientId, err: error, persistence: "memory_fallback" }, "Business DNA rebuild falling back because no AI provider was available");
      }
    }
    let fallbackBusinessDna: BusinessDna;
    try {
      fallbackBusinessDna = await buildBusinessDnaFromPublicSignals({
        name: snapshotInput.name,
        websiteUrl: snapshotInput.websiteUrl,
        instagramHandle: snapshotInput.instagramHandle,
        structuredInstagram: snapshotInput.instagram,
        oneLineDescription: snapshotInput.oneLineDescription || null,
        instagramSummaryNotes: snapshotInput.instagramSummaryNotes || null,
        existing: existingBusinessDna,
        enrichedProfile: existingEnriched,
        sowSections: snapshotInput.sowSections,
        skipInstagramFetch: true,
        diagnostic: emitBuildDiagnostic,
        abortSignal: rebuildAbortController.signal,
      });
    } catch (error) {
      if (rebuildAbortController.signal.aborted && isTimeoutAbortReason(rebuildAbortController.signal.reason)) {
        logDiagnostic("request_timeout", { reason: rebuildAbortController.signal.reason }, "error");
        res.status(504).json({ error: "Business DNA rebuild timed out while fetching public signals" });
        return;
      }
      if (isAbortError(error) || rebuildAbortController.signal.aborted) {
        logDiagnostic("request_aborted", { reason: rebuildAbortController.signal.reason ?? String(error) });
        return;
      }
      throw error;
    }
    throwIfAborted(rebuildAbortController.signal);
    logDiagnostic("instagram_skip_applied", {
      source: fallbackBusinessDna.mcp.instagram.source ?? null,
      classification: fallbackBusinessDna.platformSignals.instagram.status?.classification ?? null,
      persistence: "memory_fallback",
    });
    const generatorInput = buildApprovedBusinessDnaGeneratorInput({
      approvedSnapshot,
      snapshotInput,
      clientName: client.name,
      businessType: {
        primary: businessType.primary,
        confidence: businessType.confidence,
      },
      websiteSummary: summarizeWebsiteForBusinessDnaInput(fallbackBusinessDna),
      importedResearchBrief:
        (raw.importedResearchBrief as Record<string, unknown> | undefined) ?? null,
    });
    let businessDna = fallbackBusinessDna;
    let fallbackUsed = true;
    let fallbackReason = "AI generation unavailable; heuristic Business DNA fallback was used.";
    let repairAttempted = false;
    let repairSucceeded = false;
    let promptBudgetDiagnostics: Record<string, unknown> = {};
    if (resolvedProvider) {
      try {
        const generated = await generateBusinessDnaWithLlm({
          provider: resolvedProvider,
          input: generatorInput,
          baseBusinessDna: fallbackBusinessDna,
        });
        throwIfAborted(rebuildAbortController.signal);
        promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(generated.promptBudget);
        const generatedAssessment = evaluateBusinessDnaCandidate(generated.businessDna, {
          approvedSowRecord,
          snapshotInput,
          brandName: snapshotInput.name,
          clientName: client.name,
          businessTypePrimary: businessType.primary,
        });
        if (generatedAssessment.validationStatus === "failed") {
          repairAttempted = true;
          const repaired = await generateBusinessDnaWithLlm({
            provider: resolvedProvider,
            input: generatorInput,
            baseBusinessDna: fallbackBusinessDna,
            repairIssues: buildBusinessDnaRepairInstructionLines({
              ok: generatedAssessment.validationStatus !== "failed",
              status: generatedAssessment.validationStatus,
              issues: generatedAssessment.validationIssues,
              issueDetails: generatedAssessment.validationIssueDetails,
            }),
            existingDraft: generated.businessDna,
          });
          throwIfAborted(rebuildAbortController.signal);
          promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(repaired.promptBudget);
          const repairedAssessment = evaluateBusinessDnaCandidate(repaired.businessDna, {
            approvedSowRecord,
            snapshotInput,
            brandName: snapshotInput.name,
            clientName: client.name,
            businessTypePrimary: businessType.primary,
          });
          if (repairedAssessment.validationStatus !== "failed") {
            businessDna = repaired.businessDna;
            fallbackUsed = false;
            fallbackReason = "";
            repairSucceeded = true;
            providerInfo = {
              provider: repaired.provider ?? providerInfo.provider,
              model: repaired.model ?? providerInfo.model,
            };
          } else {
            setLastFailureStage("validation_failed_after_response");
            fallbackReason = `LLM Business DNA failed validation after repair: ${repairedAssessment.validationIssues.join("; ")}`;
          }
        } else {
          businessDna = generated.businessDna;
          fallbackUsed = false;
          fallbackReason = "";
          providerInfo = {
            provider: generated.provider ?? providerInfo.provider,
            model: generated.model ?? providerInfo.model,
          };
        }
      } catch (error) {
        if (error instanceof BusinessDnaPromptBudgetError) {
          promptBudgetDiagnostics = toBusinessDnaPromptBudgetDiagnostics(error.promptBudget);
          setLastFailureStage("prompt_budget_exceeded");
        } else {
          setLastFailureStage("fallback_used");
        }
        fallbackReason = error instanceof Error ? error.message : String(error);
        req.log.warn({ clientId, err: error, persistence: "memory_fallback" }, "Business DNA rebuild fell back to heuristic output");
      }
    }
    if (fallbackUsed && shouldUseRealAI(req)) markAIFallbackUsed();
    if (!fallbackUsed) clearAIFallbackUsed();
    const { validationIssues, validationIssueDetails, validationStatus } = evaluateBusinessDnaCandidate(businessDna, {
      approvedSowRecord,
      snapshotInput,
      brandName: snapshotInput.name,
      clientName: client.name,
      businessTypePrimary: businessType.primary,
    });
    const validationNote =
      validationIssues.length > 0
        ? buildBusinessDnaRepairPromptInput({
            ok: validationStatus !== "failed",
            status: validationStatus,
            issues: validationIssues,
            issueDetails: validationIssueDetails,
          })
        : fallbackUsed
          ? fallbackReason
          : "Business DNA validation passed.";
    const runMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "business_dna",
      provider: providerInfo.provider,
      model: providerInfo.model,
      fallbackUsed,
      sourceContext: "approved_snapshot",
      generationMode: fallbackUsed ? "heuristic" : "llm",
      validation: {
        status: validationStatus,
        note: validationNote,
        issues: validationIssues,
      },
      inputSources: buildBusinessDnaInputSourceSummary({
        sourceContext: "approved_snapshot",
        websiteUrl: snapshotInput.websiteUrl,
        instagramHandle: snapshotInput.instagramHandle,
        structuredInstagram: snapshotInput.instagram,
        instagramSummaryNotes: snapshotInput.instagramSummaryNotes,
        sowSections: snapshotInput.sowSections,
        skipInstagramFetch: true,
        strategyType: approvedSnapshot.templateType ?? null,
      }),
      diagnostics: {
        ...aiHeaderDiagnostics,
        ...promptBudgetDiagnostics,
        ...buildProviderDiagnostics(resolvedProvider, {
          repairAttempted,
          repairSucceeded,
          fallbackReason: fallbackUsed ? fallbackReason : null,
        }),
      },
    });
    req.log.info({ clientId, trace: runMeta, persistence: "memory_fallback" }, "Business DNA rebuild trace prepared");
    const rebuiltArtifact = annotateBusinessDnaArtifact(
      {
        ...existingEnriched,
        businessDna: businessDna as unknown as Record<string, unknown>,
      },
      runMeta,
      approvedSnapshot.id,
      false,
      businessType,
    );
    const nextEnriched = {
      ...rebuiltArtifact,
      __provenance: {
        ...((rebuiltArtifact.__provenance as Record<string, unknown> | undefined) ?? {}),
        dnaRebuiltFromUiAt: new Date().toISOString(),
        sourceContext: "approved_snapshot",
      },
    };
    logDiagnostic("save_start", { profileId: existing.id, persistence: "memory_fallback" });
    memoryOnboarding.set(clientId, { ...existing, enrichedData: nextEnriched });
    throwIfAborted(rebuildAbortController.signal);
    logDiagnostic("save_end", { profileId: existing.id, persistence: "memory_fallback" });
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
    businessDnaPatch?: { path?: string; value?: unknown };
    /** Ops: manual Instagram context when public fetch / MCP is empty */
    instagramSummaryNotes?: string;
    instagram?: StructuredInstagramInput;
    rebuildBusinessDna?: boolean;
    importedResearchBrief?: Record<string, unknown>;
  };
  const businessDnaPatchPath =
    typeof body?.businessDnaPatch?.path === "string" ? body.businessDnaPatch.path.trim() : "";
  const hasBusinessDnaPatch = businessDnaPatchPath.length > 0;
  if (
    !body ||
    (body.businessDna == null &&
      body.businessDnaPatch == null &&
      body.instagramSummaryNotes == null &&
      body.instagram == null &&
      body.importedResearchBrief == null &&
      body.rebuildBusinessDna !== true) ||
    (body.businessDna != null && body.businessDnaPatch != null) ||
    (body.businessDna != null && typeof body.businessDna !== "object") ||
    (body.businessDnaPatch != null &&
      (typeof body.businessDnaPatch !== "object" || body.businessDnaPatch === null || Array.isArray(body.businessDnaPatch))) ||
    (body.instagramSummaryNotes != null && typeof body.instagramSummaryNotes !== "string") ||
    (body.instagram != null &&
      (typeof body.instagram !== "object" || body.instagram === null || Array.isArray(body.instagram))) ||
    (body.importedResearchBrief != null &&
      (typeof body.importedResearchBrief !== "object" ||
        body.importedResearchBrief === null ||
        Array.isArray(body.importedResearchBrief))) ||
    (body.rebuildBusinessDna != null && body.rebuildBusinessDna !== true)
  ) {
    res.status(400).json({
      error:
        "Send businessDna (object), businessDnaPatch ({ path, value }), instagram (object), instagramSummaryNotes (string), importedResearchBrief (object), and/or rebuildBusinessDna: true.",
    });
    return;
  }
  if (hasBusinessDnaPatch && !isEditableBusinessDnaFieldPath(businessDnaPatchPath)) {
    res.status(400).json({ error: "Unsupported Business DNA field path" });
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
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (body.rebuildBusinessDna === true && !approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
      return;
    }
    const snapshotInput = approvedSnapshot
      ? buildGenerationInputsFromSnapshot(approvedSnapshot, currentRaw)
      : null;
    const bodyInstagram = cleanStructuredInstagram(body.instagram);
    const preferredInstagram = pickPreferredInstagramInput(
      snapshotInput?.instagram,
      readStructuredInstagramFromUnknown(currentRaw.instagram),
      bodyInstagram,
    );
    const nextRawInstagram = bodyInstagram ?? readStructuredInstagramFromUnknown(currentRaw.instagram);
    const preferredInstagramNotes =
      deriveInstagramSummaryNotesFromStructuredInstagram(preferredInstagram) ||
      snapshotInput?.instagramSummaryNotes ||
      (typeof body.instagramSummaryNotes === "string"
        ? body.instagramSummaryNotes.trim()
        : typeof currentRaw.instagramSummaryNotes === "string"
          ? currentRaw.instagramSummaryNotes
          : null);
    if (hasBusinessDnaPatch && !approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before editing Business DNA fields." });
      return;
    }
    const rebuiltBusinessDna =
      body.rebuildBusinessDna === true
        ? await buildBusinessDnaFromPublicSignals({
            name: snapshotInput?.name ?? String(currentRaw.name ?? client.name ?? ""),
            websiteUrl: snapshotInput?.websiteUrl ?? String(currentRaw.websiteUrl ?? client.website ?? ""),
            instagramHandle:
              snapshotInput?.instagramHandle ??
              preferredInstagram?.handle ??
              String(currentRaw.instagramHandle ?? client.instagramHandle ?? ""),
            oneLineDescription:
              snapshotInput?.oneLineDescription ??
              String(currentRaw.oneLineDescription ?? client.oneLineDescription ?? ""),
            structuredInstagram: preferredInstagram,
            instagramSummaryNotes: preferredInstagramNotes,
            existing:
              ((current.businessDna as Partial<BusinessDna> | null | undefined) ?? null),
            enrichedProfile: current,
            sowSections:
              snapshotInput?.sowSections ??
              buildStrategyDnaSowSections(
                (client.sow as Record<string, unknown> | null | undefined) ?? null,
                getStrategyRelevantNormalizedSowSections(
                  (client.sow as Record<string, unknown> | null | undefined) ?? null,
                ),
              ),
          })
        : null;
    const approvedSowRecord = (approvedSnapshot?.sow as Record<string, unknown> | undefined) ?? undefined;
    const businessType =
      approvedSnapshot != null
        ? classifyBusinessType({
            brandName: snapshotInput?.name ?? String(currentRaw.name ?? client.name ?? ""),
            clientName: client.name,
            oneLineDescription:
              snapshotInput?.oneLineDescription ??
              String(currentRaw.oneLineDescription ?? client.oneLineDescription ?? ""),
            industry: approvedSowRecord?.industry,
            targetAudience: approvedSowRecord?.targetAudience,
            websiteText:
              snapshotInput?.websiteUrl ??
              String(currentRaw.websiteUrl ?? client.website ?? ""),
            instagramBio: preferredInstagram?.bio,
            offerSummary: preferredInstagram?.offerSummary,
          })
        : null;
    const dnaValidation =
      approvedSnapshot && rebuiltBusinessDna
        ? (() => {
            const structural = validateBusinessDnaStructure(rebuiltBusinessDna);
            const semantic = validateBusinessDnaSemantics(rebuiltBusinessDna, {
              strategyLaunchPlanning:
                typeof approvedSowRecord?.strategyLaunchPlanning === "string"
                  ? approvedSowRecord.strategyLaunchPlanning
                  : null,
              scopeOfWork: typeof approvedSowRecord?.scopeOfWork === "string" ? approvedSowRecord.scopeOfWork : null,
              recentCaptionSnippets: preferredInstagram?.recentCaptionSnippets ?? [],
              proofSignals: preferredInstagram?.proofSignals ?? [],
              brandName: snapshotInput?.name ?? String(currentRaw.name ?? client.name ?? ""),
              clientName: client.name,
              businessTypePrimary: businessType?.primary ?? null,
            });
            const issues = mergeValidationIssues(structural.issues, semantic.issues);
            const status: NonNullable<RunMetaInput["validation"]>["status"] =
              structural.status === "failed"
                ? "failed"
                : semantic.status === "warning"
                  ? "warning"
                  : "passed";
            return { status, issues, issueDetails: [...structural.issueDetails, ...semantic.issueDetails] };
          })()
        : null;
    const patchedBusinessDnaCandidate =
      hasBusinessDnaPatch
        ? (() => {
            const currentBusinessDna =
              ((current.businessDna as Record<string, unknown> | null | undefined) ?? null);
            if (!isValidBusinessDna(currentBusinessDna)) {
              return null;
            }
            return applyNestedPatch(
              currentBusinessDna,
              businessDnaPatchPath,
              normalizeBusinessDnaPatchValue(businessDnaPatchPath, body.businessDnaPatch?.value),
            ) as BusinessDna;
          })()
        : null;
    if (hasBusinessDnaPatch && !patchedBusinessDnaCandidate) {
      res.status(400).json({ error: "Business DNA is not ready yet" });
      return;
    }
    const patchedBusinessDnaValidation =
      approvedSnapshot && patchedBusinessDnaCandidate
        ? evaluateBusinessDnaCandidate(
            patchedBusinessDnaCandidate,
            extractApprovedBusinessDnaValidationContext(
              approvedSnapshot,
              snapshotInput ?? buildGenerationInputsFromSnapshot(approvedSnapshot, currentRaw),
              snapshotInput?.name ?? String(currentRaw.name ?? client.name ?? ""),
              client.name,
              businessType?.primary ?? "unknown",
            ),
          )
        : null;
    const runMeta = approvedSnapshot
      ? buildRunMeta({
          clientId,
          snapshotId: approvedSnapshot.id,
          taskType: "business_dna",
          provider: shouldUseRealAI(req)
            ? (() => {
                try {
                  const provider = getRequestLLMProvider(req);
                  return provider.describe?.().provider ?? provider.id;
                } catch {
                  return "public-signals";
                }
              })()
            : "public-signals",
          model: shouldUseRealAI(req)
            ? (() => {
                try {
                  const provider = getRequestLLMProvider(req);
                  return provider.describe?.().model ?? "default";
                } catch {
                  return "n/a";
                }
              })()
            : "n/a",
          fallbackUsed: false,
          sourceContext: "approved_snapshot",
          generationMode: "heuristic",
          validation: dnaValidation
            ? {
                status: dnaValidation.status,
                note:
                  dnaValidation.issues.length > 0
                    ? buildBusinessDnaRepairPromptInput({
                        ok: dnaValidation.status !== "failed",
                        status: dnaValidation.status,
                        issues: dnaValidation.issues,
                        issueDetails: dnaValidation.issueDetails,
                      })
                    : "Business DNA validation scaffolding passed.",
                issues: dnaValidation.issues,
              }
            : {
                status: "not_run",
                note: "Business DNA rebuild was not requested in this onboarding update.",
              },
          inputSources: buildBusinessDnaInputSourceSummary({
            sourceContext: "approved_snapshot",
            websiteUrl: snapshotInput?.websiteUrl ?? String(currentRaw.websiteUrl ?? client.website ?? ""),
            instagramHandle:
              snapshotInput?.instagramHandle ??
              preferredInstagram?.handle ??
              String(currentRaw.instagramHandle ?? client.instagramHandle ?? ""),
            structuredInstagram: preferredInstagram,
            instagramSummaryNotes: preferredInstagramNotes,
            sowSections: snapshotInput?.sowSections,
            strategyType: approvedSnapshot.templateType ?? null,
          }),
        })
      : null;
    if (runMeta) {
      req.log.info({ clientId, trace: runMeta }, "Business DNA onboarding patch trace prepared");
    }
    const nextRaw: MemoryOnboarding["rawInput"] & { instagramSummaryNotes?: string; importedResearchBrief?: Record<string, unknown> } = {
      name: String(currentRaw.name ?? ""),
      websiteUrl: String(currentRaw.websiteUrl ?? ""),
      instagramHandle: nextRawInstagram?.handle ?? String(currentRaw.instagramHandle ?? ""),
      oneLineDescription: String(currentRaw.oneLineDescription ?? ""),
      ...(nextRawInstagram ? { instagram: nextRawInstagram } : {}),
      ...(bodyInstagram
        ? { instagramSummaryNotes: deriveInstagramSummaryNotesFromStructuredInstagram(bodyInstagram) || preferredInstagramNotes || "" }
        : preferredInstagramNotes
        ? { instagramSummaryNotes: preferredInstagramNotes }
        : {}),
      ...(body.importedResearchBrief != null ? { importedResearchBrief: body.importedResearchBrief } : {}),
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
      ...(patchedBusinessDnaCandidate != null
        ? (() => {
            const currentBusinessDna =
              ((current.businessDna as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
            const currentMeta =
              (((currentBusinessDna.__meta as BusinessDnaArtifactMeta | undefined) ?? undefined) as BusinessDnaArtifactMeta | undefined);
            const editedAt = new Date().toISOString();
            const approvalMeta =
              patchedBusinessDnaValidation?.validationStatus === "failed"
                ? defaultApprovalMeta(approvedSnapshot?.id ?? null)
                : (currentMeta?.approval ?? defaultApprovalMeta(approvedSnapshot?.id ?? null));
            return {
              businessDna: {
                ...patchedBusinessDnaCandidate,
                __meta: {
                  ...(currentMeta ?? {}),
                  snapshotId: approvedSnapshot?.id ?? currentMeta?.snapshotId ?? null,
                  currentSnapshotId: approvedSnapshot?.id ?? currentMeta?.currentSnapshotId ?? null,
                  stale: false,
                  approval: approvalMeta,
                  validationStatus: patchedBusinessDnaValidation?.validationStatus ?? currentMeta?.validationStatus ?? "not_run",
                  validationIssues: patchedBusinessDnaValidation?.validationIssues ?? currentMeta?.validationIssues ?? [],
                  manualEdits: {
                    ...((currentMeta?.manualEdits ?? {}) as Record<string, { editedAt: string; source: string }>),
                    [businessDnaPatchPath]: {
                      editedAt,
                      source: "workspace_field_edit",
                    },
                  },
                } satisfies BusinessDnaArtifactMeta,
              },
              __provenance: {
                ...(typeof current.__provenance === "object" && current.__provenance !== null
                  ? (current.__provenance as Record<string, unknown>)
                  : {}),
                dnaEditedFromUiAt: editedAt,
              },
            };
          })()
        : {}),
      ...(rebuiltBusinessDna != null
        ? (() => {
            const rebuiltArtifact = runMeta
              ? annotateBusinessDnaArtifact(
                  {
                    ...current,
                    businessDna: rebuiltBusinessDna as unknown as Record<string, unknown>,
                  },
                  runMeta,
                  approvedSnapshot?.id ?? null,
                  false,
                  businessType,
                )
              : {
                  ...current,
                  businessDna: rebuiltBusinessDna as unknown as Record<string, unknown>,
                };
            return {
              businessDna: rebuiltArtifact.businessDna,
              __provenance: {
                ...((rebuiltArtifact.__provenance as Record<string, unknown> | undefined) ?? {}),
                dnaRebuiltFromUiAt: new Date().toISOString(),
                ...(runMeta ? { sourceContext: "approved_snapshot" } : {}),
              },
            };
          })()
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
    let jtaMarkedStale = false;
    if (patchedBusinessDnaCandidate && approvedSnapshot) {
      const [latestStrategy] = await db
        .select()
        .from(strategiesTable)
        .where(eq(strategiesTable.clientId, clientId))
        .orderBy(desc(strategiesTable.version))
        .limit(1);
      if (latestStrategy) {
        await db
          .update(strategiesTable)
          .set({
            structuredStrategy: markStructuredArtifactStale(
              (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
              approvedSnapshot.id,
            ),
            status: "draft",
            updatedAt: new Date(),
          })
          .where(eq(strategiesTable.id, latestStrategy.id));
        jtaMarkedStale = true;
      }
    }

    res.json({
      id: updated.id,
      clientId: updated.clientId,
      rawInput: updated.rawInput,
      enrichedData: nextEnriched,
      jtaMarkedStale,
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
    const approvedSnapshot = readApprovedSnapshot(
      (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (body.rebuildBusinessDna === true && !approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
      return;
    }
    const snapshotInput = approvedSnapshot
      ? buildGenerationInputsFromSnapshot(approvedSnapshot, currentRaw)
      : null;
    const bodyInstagram = cleanStructuredInstagram(body.instagram);
    const preferredInstagram = pickPreferredInstagramInput(
      snapshotInput?.instagram,
      readStructuredInstagramFromUnknown(currentRaw.instagram),
      bodyInstagram,
    );
    const nextRawInstagram = bodyInstagram ?? readStructuredInstagramFromUnknown(currentRaw.instagram);
    const preferredInstagramNotes =
      deriveInstagramSummaryNotesFromStructuredInstagram(preferredInstagram) ||
      snapshotInput?.instagramSummaryNotes ||
      (typeof body.instagramSummaryNotes === "string"
        ? body.instagramSummaryNotes.trim()
        : typeof currentRaw.instagramSummaryNotes === "string"
          ? currentRaw.instagramSummaryNotes
          : null);
    if (hasBusinessDnaPatch && !approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before editing Business DNA fields." });
      return;
    }
    const rebuiltBusinessDna =
      body.rebuildBusinessDna === true
        ? await buildBusinessDnaFromPublicSignals({
            name: snapshotInput?.name ?? String(currentRaw.name ?? existing.rawInput.name ?? ""),
            websiteUrl:
              snapshotInput?.websiteUrl ?? String(currentRaw.websiteUrl ?? existing.rawInput.websiteUrl ?? ""),
            instagramHandle:
              snapshotInput?.instagramHandle ??
              preferredInstagram?.handle ??
              String(currentRaw.instagramHandle ?? existing.rawInput.instagramHandle ?? ""),
            oneLineDescription:
              snapshotInput?.oneLineDescription ??
              String(currentRaw.oneLineDescription ?? existing.rawInput.oneLineDescription ?? ""),
            structuredInstagram: preferredInstagram,
            instagramSummaryNotes: preferredInstagramNotes,
            existing:
              ((current.businessDna as Partial<BusinessDna> | null | undefined) ?? null),
            enrichedProfile: current,
            sowSections:
              snapshotInput?.sowSections ??
              buildStrategyDnaSowSections(
                (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
                getStrategyRelevantNormalizedSowSections(
                  (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
                ),
              ),
          })
        : null;
    const approvedSowRecord = (approvedSnapshot?.sow as Record<string, unknown> | undefined) ?? undefined;
    const businessType =
      approvedSnapshot != null
        ? classifyBusinessType({
            brandName: snapshotInput?.name ?? String(currentRaw.name ?? memoryClient.name ?? ""),
            clientName: memoryClient.name,
            oneLineDescription:
              snapshotInput?.oneLineDescription ??
              String(currentRaw.oneLineDescription ?? memoryClient.oneLineDescription ?? ""),
            industry: approvedSowRecord?.industry,
            targetAudience: approvedSowRecord?.targetAudience,
            websiteText:
              snapshotInput?.websiteUrl ??
              String(currentRaw.websiteUrl ?? memoryClient.website ?? ""),
            instagramBio: preferredInstagram?.bio,
            offerSummary: preferredInstagram?.offerSummary,
          })
        : null;
    const dnaValidation =
      approvedSnapshot && rebuiltBusinessDna
        ? (() => {
            const structural = validateBusinessDnaStructure(rebuiltBusinessDna);
            const semantic = validateBusinessDnaSemantics(rebuiltBusinessDna, {
              strategyLaunchPlanning:
                typeof approvedSowRecord?.strategyLaunchPlanning === "string"
                  ? approvedSowRecord.strategyLaunchPlanning
                  : null,
              scopeOfWork: typeof approvedSowRecord?.scopeOfWork === "string" ? approvedSowRecord.scopeOfWork : null,
              recentCaptionSnippets: preferredInstagram?.recentCaptionSnippets ?? [],
              proofSignals: preferredInstagram?.proofSignals ?? [],
              brandName: snapshotInput?.name ?? String(currentRaw.name ?? memoryClient.name ?? ""),
              clientName: memoryClient.name,
              businessTypePrimary: businessType?.primary ?? null,
            });
            const issues = mergeValidationIssues(structural.issues, semantic.issues);
            const status: NonNullable<RunMetaInput["validation"]>["status"] =
              structural.status === "failed"
                ? "failed"
                : semantic.status === "warning"
                  ? "warning"
                  : "passed";
            return { status, issues, issueDetails: [...structural.issueDetails, ...semantic.issueDetails] };
          })()
        : null;
    const patchedBusinessDnaCandidate =
      hasBusinessDnaPatch
        ? (() => {
            const currentBusinessDna =
              ((current.businessDna as Record<string, unknown> | null | undefined) ?? null);
            if (!isValidBusinessDna(currentBusinessDna)) {
              return null;
            }
            return applyNestedPatch(
              currentBusinessDna,
              businessDnaPatchPath,
              normalizeBusinessDnaPatchValue(businessDnaPatchPath, body.businessDnaPatch?.value),
            ) as BusinessDna;
          })()
        : null;
    if (hasBusinessDnaPatch && !patchedBusinessDnaCandidate) {
      res.status(400).json({ error: "Business DNA is not ready yet" });
      return;
    }
    const patchedBusinessDnaValidation =
      approvedSnapshot && patchedBusinessDnaCandidate
        ? evaluateBusinessDnaCandidate(
            patchedBusinessDnaCandidate,
            extractApprovedBusinessDnaValidationContext(
              approvedSnapshot,
              snapshotInput ?? buildGenerationInputsFromSnapshot(approvedSnapshot, currentRaw),
              snapshotInput?.name ?? String(currentRaw.name ?? memoryClient.name ?? ""),
              memoryClient.name,
              businessType?.primary ?? "unknown",
            ),
          )
        : null;
    const runMeta = approvedSnapshot
      ? buildRunMeta({
          clientId,
          snapshotId: approvedSnapshot.id,
          taskType: "business_dna",
          provider: "public-signals",
          model: "n/a",
          fallbackUsed: false,
          sourceContext: "approved_snapshot",
          generationMode: "heuristic",
          validation: dnaValidation
            ? {
                status: dnaValidation.status,
                note:
                  dnaValidation.issues.length > 0
                    ? buildBusinessDnaRepairPromptInput({
                        ok: dnaValidation.status !== "failed",
                        status: dnaValidation.status,
                        issues: dnaValidation.issues,
                        issueDetails: dnaValidation.issueDetails,
                      })
                    : "Business DNA validation scaffolding passed.",
                issues: dnaValidation.issues,
              }
            : {
                status: "not_run",
                note: "Business DNA rebuild was not requested in this onboarding update.",
              },
          inputSources: buildBusinessDnaInputSourceSummary({
            sourceContext: "approved_snapshot",
            websiteUrl: snapshotInput?.websiteUrl ?? String(currentRaw.websiteUrl ?? existing.rawInput.websiteUrl ?? ""),
            instagramHandle:
              snapshotInput?.instagramHandle ??
              preferredInstagram?.handle ??
              String(currentRaw.instagramHandle ?? existing.rawInput.instagramHandle ?? ""),
            structuredInstagram: preferredInstagram,
            instagramSummaryNotes: preferredInstagramNotes,
            sowSections: snapshotInput?.sowSections,
            strategyType: approvedSnapshot.templateType ?? null,
          }),
        })
      : null;
    if (runMeta) {
      req.log.info(
        { clientId, trace: runMeta, persistence: "memory_fallback" },
        "Business DNA onboarding patch trace prepared",
      );
    }
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
      ...(patchedBusinessDnaCandidate != null
        ? (() => {
            const currentBusinessDna =
              ((current.businessDna as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
            const currentMeta =
              (((currentBusinessDna.__meta as BusinessDnaArtifactMeta | undefined) ?? undefined) as BusinessDnaArtifactMeta | undefined);
            const editedAt = new Date().toISOString();
            const approvalMeta =
              patchedBusinessDnaValidation?.validationStatus === "failed"
                ? defaultApprovalMeta(approvedSnapshot?.id ?? null)
                : (currentMeta?.approval ?? defaultApprovalMeta(approvedSnapshot?.id ?? null));
            return {
              businessDna: {
                ...patchedBusinessDnaCandidate,
                __meta: {
                  ...(currentMeta ?? {}),
                  snapshotId: approvedSnapshot?.id ?? currentMeta?.snapshotId ?? null,
                  currentSnapshotId: approvedSnapshot?.id ?? currentMeta?.currentSnapshotId ?? null,
                  stale: false,
                  approval: approvalMeta,
                  validationStatus: patchedBusinessDnaValidation?.validationStatus ?? currentMeta?.validationStatus ?? "not_run",
                  validationIssues: patchedBusinessDnaValidation?.validationIssues ?? currentMeta?.validationIssues ?? [],
                  manualEdits: {
                    ...((currentMeta?.manualEdits ?? {}) as Record<string, { editedAt: string; source: string }>),
                    [businessDnaPatchPath]: {
                      editedAt,
                      source: "workspace_field_edit",
                    },
                  },
                } satisfies BusinessDnaArtifactMeta,
              },
              __provenance: {
                ...(typeof current.__provenance === "object" && current.__provenance !== null
                  ? (current.__provenance as Record<string, unknown>)
                  : {}),
                dnaEditedFromUiAt: editedAt,
              },
            };
          })()
        : {}),
      ...(rebuiltBusinessDna != null
        ? (() => {
            const rebuiltArtifact = runMeta
              ? annotateBusinessDnaArtifact(
                  {
                    ...current,
                    businessDna: rebuiltBusinessDna as unknown as Record<string, unknown>,
                  },
                  runMeta,
                  approvedSnapshot?.id ?? null,
                  false,
                  businessType,
                )
              : {
                  ...current,
                  businessDna: rebuiltBusinessDna as unknown as Record<string, unknown>,
                };
            return {
              businessDna: rebuiltArtifact.businessDna,
              __provenance: {
                ...((rebuiltArtifact.__provenance as Record<string, unknown> | undefined) ?? {}),
                dnaRebuiltFromUiAt: new Date().toISOString(),
                ...(runMeta ? { sourceContext: "approved_snapshot" } : {}),
              },
            };
          })()
        : {}),
    };
    const nextRaw: MemoryOnboarding["rawInput"] & { instagramSummaryNotes?: string; importedResearchBrief?: Record<string, unknown> } = {
      name: String(currentRaw.name ?? existing.rawInput.name),
      websiteUrl: String(currentRaw.websiteUrl ?? existing.rawInput.websiteUrl),
      instagramHandle:
        nextRawInstagram?.handle ??
        String(currentRaw.instagramHandle ?? existing.rawInput.instagramHandle),
      oneLineDescription: String(
        currentRaw.oneLineDescription ?? existing.rawInput.oneLineDescription,
      ),
      ...(nextRawInstagram ? { instagram: nextRawInstagram } : {}),
      ...(bodyInstagram
        ? { instagramSummaryNotes: deriveInstagramSummaryNotesFromStructuredInstagram(bodyInstagram) || preferredInstagramNotes || "" }
        : preferredInstagramNotes
        ? { instagramSummaryNotes: preferredInstagramNotes }
        : {}),
      ...(body.importedResearchBrief != null ? { importedResearchBrief: body.importedResearchBrief } : {}),
    };
    let jtaMarkedStale = false;
    if (patchedBusinessDnaCandidate && approvedSnapshot) {
      const latestStrategy = memoryStrategies.get(clientId);
      if (latestStrategy) {
        memoryStrategies.set(clientId, {
          ...latestStrategy,
          structuredStrategy: markStructuredArtifactStale(
            (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
            approvedSnapshot.id,
          ),
          status: "draft",
          updatedAt: new Date().toISOString(),
        });
        jtaMarkedStale = true;
      }
    }
    memoryOnboarding.set(clientId, { ...existing, enrichedData: nextEnriched, rawInput: nextRaw });
    res.json({
      id: existing.id,
      clientId: existing.clientId,
      rawInput: nextRaw,
      enrichedData: nextEnriched,
      jtaMarkedStale,
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
    const [existingClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!existingClient) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const [latestStrategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    const [latestPlanner] = await db
      .select()
      .from(plannersTable)
      .where(eq(plannersTable.clientId, clientId))
      .orderBy(desc(plannersTable.createdAt))
      .limit(1);
    const [latestProfile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    const nextInstagram = cleanStructuredInstagram(sanitizedBody.instagram);
    const clientBasics = (body.clientBasics as Record<string, unknown> | undefined) ?? undefined;
    const syncedClientName =
      (typeof clientBasics?.name === "string" && clientBasics.name.trim()) || existingClient.name;
    const syncedWebsite =
      (typeof clientBasics?.website === "string" && clientBasics.website.trim()) ||
      stripPlaceholderText(existingClient.website) ||
      null;
    const currentRaw = (latestProfile?.rawInput as Record<string, unknown> | null | undefined) ?? null;
    const syncedInstagramHandle =
      nextInstagram?.handle ||
      (typeof clientBasics?.instagramHandle === "string" ? clientBasics.instagramHandle.trim() : "") ||
      stripPlaceholderText(existingClient.instagramHandle) ||
      null;
    const syncedOneLineDescription =
      (typeof clientBasics?.oneLineDescription === "string" && clientBasics.oneLineDescription.trim()) ||
      stripPlaceholderText(existingClient.oneLineDescription) ||
      stripPlaceholderText(currentRaw?.oneLineDescription) ||
      null;
    const previousSnapshot = readApprovedSnapshot(
      (existingClient.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    const templateForSnapshot =
      latestStrategy?.templateType ?? previousSnapshot?.templateType ?? "brand_building";
    const nextSnapshot =
      ((sanitizedBody.approval as { approved?: boolean } | undefined)?.approved ?? false)
        ? buildApprovedContextSnapshot({
            clientId,
            clientName: syncedClientName,
            websiteUrl: syncedWebsite,
            instagramHandle: syncedInstagramHandle,
            oneLineDescription: syncedOneLineDescription,
            sow: sanitizedBody,
            templateType: templateForSnapshot,
            previousSnapshot,
          })
        : null;
    const snapshotChanged = nextSnapshot?.id !== previousSnapshot?.id;
    const staleAfterSave = Boolean(nextSnapshot && previousSnapshot && snapshotChanged);
    const nextSow = stampArtifactState(
      sanitizedBody,
      nextSnapshot,
      staleAfterSave,
      staleAfterSave ? "approved_context_changed" : undefined,
    );
    const [updated] = await db
      .update(clientsTable)
      .set({
        name: syncedClientName,
        website: syncedWebsite,
        sow: nextSow,
        instagramHandle: syncedInstagramHandle,
        oneLineDescription: syncedOneLineDescription,
      })
      .where(eq(clientsTable.id, clientId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (latestProfile) {
      const currentDerivedInstagramNotes =
        typeof currentRaw?.instagramSummaryNotes === "string" ? currentRaw.instagramSummaryNotes : "";
      const nextRawInput = {
        ...currentRaw,
        ...(syncedWebsite ? { websiteUrl: syncedWebsite } : {}),
        ...(syncedClientName ? { name: syncedClientName } : {}),
        ...(nextInstagram ? { instagram: nextInstagram } : {}),
        ...(nextInstagram
          ? { instagramSummaryNotes: deriveInstagramSummaryNotesFromStructuredInstagram(nextInstagram) }
          : currentDerivedInstagramNotes
            ? { instagramSummaryNotes: currentDerivedInstagramNotes }
            : {}),
      };
      await db
        .update(onboardingProfilesTable)
        .set({
          rawInput: nextRawInput,
          ...(snapshotChanged && nextSnapshot
            ? {
                enrichedData: markBusinessDnaStale(
                  (latestProfile.enrichedData as Record<string, unknown> | null | undefined) ?? null,
                  nextSnapshot.id,
                ),
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(onboardingProfilesTable.id, latestProfile.id));
    }
    if (snapshotChanged && nextSnapshot) {
      if (latestStrategy) {
        await db
          .update(strategiesTable)
          .set({
            structuredStrategy: markStructuredArtifactStale(
              (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
              nextSnapshot.id,
            ),
            updatedAt: new Date(),
          })
          .where(eq(strategiesTable.id, latestStrategy.id));
      }
      if (latestPlanner) {
        await db
          .update(plannersTable)
          .set({
            metadata: markPlannerArtifactStale(
              (latestPlanner.metadata as Record<string, unknown> | null | undefined) ?? null,
              nextSnapshot.id,
            ),
          })
          .where(eq(plannersTable.id, latestPlanner.id));
      }
    }
    req.log.info(
      {
        requestSizeBytes,
        responseTimeMs: elapsedMs(startedAt),
        snapshotId: nextSnapshot?.id ?? null,
        snapshotChanged,
      },
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
    const latestProfile = memoryOnboarding.get(clientId);
    const nextInstagram = cleanStructuredInstagram(sanitizedBody.instagram);
    const currentRaw = (latestProfile?.rawInput as Record<string, unknown> | null | undefined) ?? null;
    const syncedInstagramHandle =
      nextInstagram?.handle || stripPlaceholderText(existing.instagramHandle) || null;
    const syncedOneLineDescription =
      stripPlaceholderText(existing.oneLineDescription) ||
      stripPlaceholderText(currentRaw?.oneLineDescription) ||
      null;
    const updated: MemoryClient = {
      ...existing,
      instagramHandle: syncedInstagramHandle,
      oneLineDescription: syncedOneLineDescription,
      sow: stampArtifactState(
        sanitizedBody,
        ((sanitizedBody.approval as { approved?: boolean } | undefined)?.approved ?? false)
          ? buildApprovedContextSnapshot({
              clientId,
              clientName: existing.name,
              websiteUrl: existing.website,
              instagramHandle: syncedInstagramHandle,
              oneLineDescription: syncedOneLineDescription,
              sow: sanitizedBody,
              templateType:
                memoryStrategies.get(clientId)?.templateType ??
                readApprovedSnapshot((existing.sow as Record<string, unknown> | null | undefined) ?? null)?.templateType ??
                "brand_building",
              previousSnapshot: readApprovedSnapshot(
                (existing.sow as Record<string, unknown> | null | undefined) ?? null,
              ),
            })
          : null,
        Boolean(
          ((sanitizedBody.approval as { approved?: boolean } | undefined)?.approved ?? false) &&
            readApprovedSnapshot((existing.sow as Record<string, unknown> | null | undefined) ?? null),
        ),
        ((sanitizedBody.approval as { approved?: boolean } | undefined)?.approved ?? false) &&
        readApprovedSnapshot((existing.sow as Record<string, unknown> | null | undefined) ?? null)
          ? "approved_context_changed"
          : undefined,
      ),
    };
    memoryClients.set(clientId, updated);
    const nextSnapshot = readApprovedSnapshot((updated.sow as Record<string, unknown> | null | undefined) ?? null);
    const previousSnapshot = readApprovedSnapshot((existing.sow as Record<string, unknown> | null | undefined) ?? null);
    if (latestProfile) {
      memoryOnboarding.set(clientId, {
        ...latestProfile,
        rawInput: {
          ...latestProfile.rawInput,
          ...(nextInstagram ? { instagram: nextInstagram } : {}),
          ...(nextInstagram
            ? { instagramSummaryNotes: deriveInstagramSummaryNotesFromStructuredInstagram(nextInstagram) }
            : {}),
        },
      });
    }
    if (nextSnapshot?.id !== previousSnapshot?.id && nextSnapshot) {
      const staleProfile = memoryOnboarding.get(clientId);
      if (staleProfile) {
        memoryOnboarding.set(clientId, {
          ...staleProfile,
          enrichedData: markBusinessDnaStale(
            (staleProfile.enrichedData as Record<string, unknown> | null | undefined) ?? null,
            nextSnapshot.id,
          ),
        });
      }
      const latestStrategy = memoryStrategies.get(clientId);
      if (latestStrategy) {
        memoryStrategies.set(clientId, {
          ...latestStrategy,
          structuredStrategy: markStructuredArtifactStale(
            (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
            nextSnapshot.id,
          ),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    req.log.info(
      {
        requestSizeBytes,
        responseTimeMs: elapsedMs(startedAt),
        fallbackReason: "db_unavailable",
        snapshotId: nextSnapshot?.id ?? null,
      },
      "SOW save telemetry",
    );
    res.json(updated);
  }
});

router.post("/clients/:clientId/onboarding/business-dna/approve", async (req, res) => {
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
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before approving Business DNA." });
      return;
    }

    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "Onboarding profile not found" });
      return;
    }

    const enrichedData = (profile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const businessDna = (enrichedData.businessDna as Record<string, unknown> | null | undefined) ?? null;
    if (!isValidBusinessDna(businessDna)) {
      res.status(400).json({ error: "Business DNA is not ready yet" });
      return;
    }
    const currentMeta =
      ((((businessDna as unknown as Record<string, unknown>).__meta as BusinessDnaArtifactMeta | undefined) ?? undefined));
    if (currentMeta?.validationStatus === "failed") {
      res.status(400).json({ error: "Business DNA failed validation and cannot be approved yet" });
      return;
    }

    const approval = {
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedSnapshotId: approvedSnapshot.id,
      approvalVersion: "v1" as const,
    };
    const nextBusinessDna = {
      ...businessDna,
      __meta: {
        ...((currentMeta ?? {}) as BusinessDnaArtifactMeta),
        approval,
      } satisfies BusinessDnaArtifactMeta,
    };
    const nextEnriched = {
      ...enrichedData,
      businessDna: nextBusinessDna,
    };

    const [updated] = await db
      .update(onboardingProfilesTable)
      .set({ enrichedData: nextEnriched, updatedAt: new Date() })
      .where(eq(onboardingProfilesTable.id, profile.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to approve Business DNA" });
      return;
    }

    res.json({
      ok: true,
      businessDna: nextBusinessDna,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const client = memoryClients.get(clientId);
    const profile = memoryOnboarding.get(clientId);
    if (!client || !profile) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before approving Business DNA." });
      return;
    }
    const enrichedData = (profile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const businessDna = (enrichedData.businessDna as Record<string, unknown> | null | undefined) ?? null;
    if (!isValidBusinessDna(businessDna)) {
      res.status(400).json({ error: "Business DNA is not ready yet" });
      return;
    }
    const currentMeta =
      ((((businessDna as unknown as Record<string, unknown>).__meta as BusinessDnaArtifactMeta | undefined) ?? undefined));
    if (currentMeta?.validationStatus === "failed") {
      res.status(400).json({ error: "Business DNA failed validation and cannot be approved yet" });
      return;
    }
    const approval = {
      approved: true,
      approvedAt: new Date().toISOString(),
      approvedSnapshotId: approvedSnapshot.id,
      approvalVersion: "v1" as const,
    };
    const nextBusinessDna = {
      ...businessDna,
      __meta: {
        ...((currentMeta ?? {}) as BusinessDnaArtifactMeta),
        approval,
      } satisfies BusinessDnaArtifactMeta,
    };
    memoryOnboarding.set(clientId, {
      ...profile,
      enrichedData: {
        ...enrichedData,
        businessDna: nextBusinessDna,
      },
    });
    res.json({
      ok: true,
      businessDna: nextBusinessDna,
    });
  }
});

router.patch("/clients/:clientId/template", async (req, res) => {
  const { clientId } = req.params;
  const templateType =
    typeof (req.body as { templateType?: unknown } | null | undefined)?.templateType === "string"
      ? String((req.body as { templateType: string }).templateType).trim()
      : "";
  if (!clientId || !templateType) {
    res.status(400).json({ error: "clientId and templateType required" });
    return;
  }

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const sow = ((client.sow as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
    const currentSnapshot = readApprovedSnapshot(sow);
    const nextSow = {
      ...sow,
      __templatePreference: templateType,
    } as Record<string, unknown>;
    let snapshotChanged = false;
    let nextSnapshot = currentSnapshot;
    if (currentSnapshot) {
      nextSnapshot = buildApprovedContextSnapshot({
        clientId,
        clientName: client.name,
        websiteUrl: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
        sow: nextSow,
        templateType,
        previousSnapshot: currentSnapshot,
      });
      snapshotChanged = nextSnapshot.id !== currentSnapshot.id;
      nextSow.__approvedContextSnapshot = nextSnapshot;
      nextSow.__artifactState = {
        snapshotId: nextSnapshot.id,
        stale: snapshotChanged,
        reason: snapshotChanged ? "template_changed_after_approval" : null,
        updatedAt: new Date().toISOString(),
      };
    }
    const [updated] = await db
      .update(clientsTable)
      .set({ sow: nextSow })
      .where(eq(clientsTable.id, clientId))
      .returning();
    if (!updated) {
      res.status(500).json({ error: "Failed to save template preference" });
      return;
    }
    if (snapshotChanged && nextSnapshot) {
      const [latestStrategy] = await db
        .select()
        .from(strategiesTable)
        .where(eq(strategiesTable.clientId, clientId))
        .orderBy(desc(strategiesTable.version))
        .limit(1);
      const [latestPlanner] = await db
        .select()
        .from(plannersTable)
        .where(eq(plannersTable.clientId, clientId))
        .orderBy(desc(plannersTable.createdAt))
        .limit(1);
      if (latestStrategy) {
        await db
          .update(strategiesTable)
          .set({
            structuredStrategy: markStructuredArtifactStale(
              (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
              nextSnapshot.id,
            ),
            updatedAt: new Date(),
          })
          .where(eq(strategiesTable.id, latestStrategy.id));
      }
      if (latestPlanner) {
        await db
          .update(plannersTable)
          .set({
            metadata: markPlannerArtifactStale(
              (latestPlanner.metadata as Record<string, unknown> | null | undefined) ?? null,
              nextSnapshot.id,
            ),
          })
          .where(eq(plannersTable.id, latestPlanner.id));
      }
    }
    res.json(serializeClient(updated));
  } catch (err) {
    if (!isDbUnavailableError(err)) throw err;
    markFallbackUsed();
    const client = memoryClients.get(clientId);
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const sow = ((client.sow as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
    const currentSnapshot = readApprovedSnapshot(sow);
    const nextSow = {
      ...sow,
      __templatePreference: templateType,
    } as Record<string, unknown>;
    let nextSnapshot = currentSnapshot;
    let snapshotChanged = false;
    if (currentSnapshot) {
      nextSnapshot = buildApprovedContextSnapshot({
        clientId,
        clientName: client.name,
        websiteUrl: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
        sow: nextSow,
        templateType,
        previousSnapshot: currentSnapshot,
      });
      snapshotChanged = nextSnapshot.id !== currentSnapshot.id;
      nextSow.__approvedContextSnapshot = nextSnapshot;
      nextSow.__artifactState = {
        snapshotId: nextSnapshot.id,
        stale: snapshotChanged,
        reason: snapshotChanged ? "template_changed_after_approval" : null,
        updatedAt: new Date().toISOString(),
      };
    }
    const updated = { ...client, sow: nextSow };
    memoryClients.set(clientId, updated);
    if (snapshotChanged && nextSnapshot) {
      const latestStrategy = memoryStrategies.get(clientId);
      if (latestStrategy) {
        memoryStrategies.set(clientId, {
          ...latestStrategy,
          structuredStrategy: markStructuredArtifactStale(
            (latestStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? {},
            nextSnapshot.id,
          ),
          updatedAt: new Date().toISOString(),
        });
      }
    }
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
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
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

    const [currentStrategyForApproval] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    const enrichedProfileData =
      ((profile.enrichedData as Record<string, unknown> | null | undefined) ?? {});
    const businessDnaApprovalError = getBusinessDnaApprovalRequirementError(
      enrichedProfileData,
      approvedSnapshot.id,
      "generating the full strategy",
    );
    if (businessDnaApprovalError) {
      res.status(400).json({ error: businessDnaApprovalError });
      return;
    }
    const jtaApprovalError = getJtaApprovalRequirementError(
      (currentStrategyForApproval?.structuredStrategy as Record<string, unknown> | null | undefined) ?? null,
      approvedSnapshot.id,
      "generating the full strategy",
    );
    if (jtaApprovalError) {
      res.status(400).json({ error: jtaApprovalError });
      return;
    }
    const approvedJtaStructured = readApprovedJtaFromStructured(
      (currentStrategyForApproval?.structuredStrategy as Record<string, unknown> | null | undefined) ?? null,
      approvedSnapshot.id,
    );

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

    const rawInput = (profile.rawInput as Record<string, unknown> | null | undefined) ?? {};
    const snapshotInput = buildGenerationInputsFromSnapshot(approvedSnapshot, rawInput);
    const raw = {
      name: snapshotInput.name,
      websiteUrl: snapshotInput.websiteUrl,
      instagramHandle: snapshotInput.instagramHandle,
      oneLineDescription: snapshotInput.oneLineDescription,
      ...(snapshotInput.instagram ? { instagram: snapshotInput.instagram } : {}),
      ...(snapshotInput.instagramSummaryNotes
        ? { instagramSummaryNotes: snapshotInput.instagramSummaryNotes }
        : {}),
    };

    const businessDna =
      (profile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
    const mcpConfig = getMcpConfigFromEnv();
    const mcpAvailable = isMcpAvailable(mcpConfig);
    const strategyMcpInput = {
      clientId,
      templateType: approvedSnapshot.templateType ?? null,
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
    const strategyDnaSections = snapshotInput.sowSections;
    const approvedBusinessDnaForStrategy = readApprovedBusinessDnaFromEnriched(
      ((profile.enrichedData as Record<string, unknown> | null | undefined) ?? {}),
      approvedSnapshot.id,
    );
    const currentBusinessDna =
      approvedBusinessDnaForStrategy ??
      (await buildBusinessDnaFromPublicSignals({
        name: raw.name,
        websiteUrl: raw.websiteUrl,
        instagramHandle: raw.instagramHandle,
        structuredInstagram: readStructuredInstagramFromUnknown(raw.instagram),
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
      }));
    const currentProviderInfo = resolvedStrategyLlm?.describe?.() ?? {
      provider: useRealAI ? "provider_pending" : "demo",
      model: useRealAI ? "provider_pending" : "deterministic",
    };
    const approvedBusinessDnaMeta = approvedBusinessDnaForStrategy
      ? (((approvedBusinessDnaForStrategy as unknown as Record<string, unknown>).__meta as BusinessDnaArtifactMeta | undefined) ??
        undefined)
      : undefined;
    const businessDnaRunMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "business_dna",
      provider: approvedBusinessDnaMeta?.provider ?? currentProviderInfo.provider,
      model: approvedBusinessDnaMeta?.model ?? currentProviderInfo.model,
      fallbackUsed: approvedBusinessDnaForStrategy ? approvedBusinessDnaMeta?.generationMode !== "llm" : false,
      sourceContext: "approved_snapshot",
      generationMode:
        approvedBusinessDnaForStrategy && approvedBusinessDnaMeta?.generationMode === "llm"
          ? "llm"
          : "heuristic",
      validation: {
        status: approvedBusinessDnaMeta?.validationStatus ?? "not_run",
        note:
          approvedBusinessDnaForStrategy
            ? approvedBusinessDnaMeta?.fallbackReason ?? "Using approved Business DNA artifact for strategy generation."
            : "Phase 1 placeholder - Business DNA semantic validation not wired yet.",
        issues: approvedBusinessDnaMeta?.validationIssues ?? [],
      },
      inputSources: buildBusinessDnaInputSourceSummary({
        sourceContext: "approved_snapshot",
        websiteUrl: raw.websiteUrl,
        instagramHandle: raw.instagramHandle,
        structuredInstagram: readStructuredInstagramFromUnknown(raw.instagram),
        instagramSummaryNotes: typeof raw.instagramSummaryNotes === "string" ? raw.instagramSummaryNotes : null,
        sowSections: strategyDnaSections,
        mcpDataPresent:
          Boolean(
            ((mcpStrategy.enriched.enriched as Record<string, unknown>).mcp as Record<string, unknown> | null | undefined) ??
              null,
          ),
        strategyType: approvedSnapshot.templateType ?? null,
      }),
    });
    req.log.info({ clientId, trace: businessDnaRunMeta }, "Business DNA pre-strategy trace prepared");
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
    const refreshedBusinessDnaArtifact = approvedBusinessDnaForStrategy
      ? {
          ...((profile.enrichedData as Record<string, unknown> | null) ?? {}),
          businessDna: currentBusinessDna as unknown as Record<string, unknown>,
        }
      : annotateBusinessDnaArtifact(
          {
            ...((profile.enrichedData as Record<string, unknown> | null) ?? {}),
            businessDna: currentBusinessDna as unknown as Record<string, unknown>,
          },
          businessDnaRunMeta,
          approvedSnapshot.id,
          false,
        );
    const preLlmEnriched: Record<string, unknown> = {
      ...refreshedBusinessDnaArtifact,
      __provenance: {
        ...((refreshedBusinessDnaArtifact.__provenance as Record<string, unknown> | undefined) ?? {}),
        mcp: mcpProv,
        phase: "pre-llm",
        savedAt: new Date().toISOString(),
        websiteMcp: currentBusinessDna.mcp?.website ?? null,
        sourceContext: "approved_snapshot",
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
    const selectedTemplate = resolveConcreteTemplateType(
      preLlmEnriched as Record<string, unknown>,
      body.templateType ?? approvedSnapshot.templateType ?? null,
    );
    const requestedDetail = req.header("x-strategy-detail")?.trim().toLowerCase();
    const detailLevel: StrategyDetailLevel = requestedDetail === "core" ? "core" : "full";
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
        structuredStrategy: annotateStrategyStructured({
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
        }, buildRunMeta({
          clientId,
          snapshotId: approvedSnapshot.id,
          taskType: "strategy_generate",
          provider: currentProviderInfo.provider,
          model: currentProviderInfo.model,
          fallbackUsed: false,
          sourceContext: "approved_snapshot",
        }), approvedSnapshot.id, false),
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
            sow: sowRec,
          }) as Awaited<ReturnType<typeof enrich>>;
        }
        enriched = {
          ...enriched,
          ...mcpStrategy.enriched.enriched,
          businessDna: currentBusinessDna,
          approvedJumpToAction: approvedJtaStructured,
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
          body.templateType ?? approvedSnapshot.templateType ?? null,
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
          {
            detailLevel,
            strategyContext: {
              activePlatforms: readSelectedPlatforms(sowRec),
              monthlyPostCounts: readMonthlyPosts(sowRec),
              contentMixBreakdown: readContentMix(sowRec),
              toneByPlatform: readToneByPlatform(sowRec),
              targetAudienceDefinition: String(sowRec?.targetAudience ?? ""),
              businessObjectives:
                firstUseful([
                  String((normalizedStrategySections ?? {}).objectivesAndGoals ?? ""),
                  String((sowRec?.businessObjectives as string | undefined) ?? ""),
                  String((sowRec?.goals as string | undefined) ?? ""),
                ]) || raw.oneLineDescription,
            },
          },
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
    const strategyRunMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "strategy_generate",
      provider:
        strategySource === "fallback" && strategyAiFailure
          ? strategyAiFailure.providerId
          : (resolvedStrategyLlm?.describe?.().provider ?? currentProviderInfo.provider),
      model:
        strategySource === "fallback" && strategyAiFailure
          ? strategyAiFailure.model
          : (resolvedStrategyLlm?.describe?.().model ?? currentProviderInfo.model),
      fallbackUsed: strategySource === "fallback",
      sourceContext: "approved_snapshot",
    });
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
        latestRun: strategyRunMeta,
        snapshotId: approvedSnapshot.id,
        sourceContext: "approved_snapshot",
        snapshotState: "fresh",
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
      .set({
        enrichedData: approvedBusinessDnaForStrategy
          ? (enriched as unknown as Record<string, unknown>)
          : annotateBusinessDnaArtifact(
              enriched as unknown as Record<string, unknown>,
              businessDnaRunMeta,
              approvedSnapshot.id,
              false,
            ),
        updatedAt: new Date(),
      })
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
    const responseProvider =
      strategySource === "fallback" && strategyAiFailure
        ? { provider: strategyAiFailure.providerId, model: strategyAiFailure.model }
        : resolvedStrategyLlm?.describe?.() ?? null;
    if (responseProvider) {
      const info = responseProvider;
      res.setHeader("x-ai-provider", info.provider);
      res.setHeader("x-ai-model", info.model);
    }
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
      const approvedSnapshot = readApprovedSnapshot(
        (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
      );
      if (!approvedSnapshot) {
        res.status(400).json({ error: "Approve SOW to generate final Business DNA and Jump-to-Action." });
        return;
      }

      const selectedTemplate = resolveConcreteTemplateType(
        (memoryProfile.enrichedData as Record<string, unknown> | null | undefined) ?? null,
        body.templateType ?? approvedSnapshot.templateType ?? null,
      );
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
      const strategyRunMetaMem = buildRunMeta({
        clientId,
        snapshotId: approvedSnapshot.id,
        taskType: "strategy_generate",
        provider: shouldUseRealAI(req) ? "fallback" : "demo",
        model: shouldUseRealAI(req) ? "safe_template" : "deterministic",
        fallbackUsed: true,
        sourceContext: "approved_snapshot",
      });
      const strategy: MemoryStrategy = {
        id: randomUUID(),
        clientId,
        structuredStrategy: annotateStrategyStructured(
          canonicalReady.structured,
          strategyRunMetaMem,
          approvedSnapshot.id,
          false,
        ),
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
      res.setHeader("x-ai-provider", strategyAiFailureMem.providerId);
      res.setHeader("x-ai-model", strategyAiFailureMem.model);
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

    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate Business DNA and Jump-to-Action." });
      return;
    }

    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

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

    const requestedTemplateType =
      typeof (req.body as { templateType?: unknown } | null | undefined)?.templateType === "string"
        ? String((req.body as { templateType: string }).templateType).trim()
        : null;

    const enrichedData = (profile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const approvedBusinessDna = readApprovedBusinessDnaFromEnriched(enrichedData, approvedSnapshot.id);
    if (!approvedBusinessDna) {
      res.status(400).json({ error: "Approved Business DNA is required before generating Jump-to-Action." });
      return;
    }

    const templateType = resolveConcreteTemplateType(
      enrichedData,
      requestedTemplateType ?? approvedSnapshot.templateType ?? null,
    );
    const aiHeaderDiagnostics = buildAiHeaderDiagnostics(req);
    let resolvedProvider: LLMProvider | null = null;
    let providerInfo = { provider: "fallback", model: "bootstrap_deterministic" };
    if (shouldUseRealAI(req)) {
      try {
        resolvedProvider = getRequestLLMProvider(req);
        providerInfo = resolvedProvider.describe?.() ?? { provider: resolvedProvider.id, model: "default" };
      } catch (error) {
        providerInfo = { provider: "fallback", model: "bootstrap_deterministic" };
        req.log.warn({ clientId, err: error }, "JTA/bootstrap falling back because no AI provider was available");
      }
    }
    const approvedSowRecord = approvedSnapshot.sow as Record<string, unknown>;
    const businessType = classifyBusinessType({
      brandName: client.name,
      clientName: client.name,
      oneLineDescription: client.oneLineDescription,
      industry: approvedSowRecord.industry,
      targetAudience: approvedSowRecord.targetAudience,
      websiteText: client.website,
      instagramBio: approvedBusinessDna.platformSignals?.instagram?.bioSignals?.join(" "),
      offerSummary: approvedBusinessDna.offers?.primaryOffers?.[0] ?? approvedBusinessDna.offers?.transformationPromise,
    });
    const snapshotInput = buildGenerationInputsFromSnapshot(
      approvedSnapshot,
      (profile.rawInput as Record<string, unknown> | null | undefined) ?? null,
    );
    const importedResearchBrief =
      (profile.rawInput as Record<string, unknown> | null | undefined)?.importedResearchBrief ?? null;
    const websiteSummary = summarizeWebsiteForBusinessDnaInput(approvedBusinessDna);
    const resolvedBrandName = resolveClientFacingBrandName(client.name, {
      oneLineDescription: client.oneLineDescription,
      websiteTitle: websiteSummary?.title ?? null,
    });
    const fallbackCanonicalSections = buildBootstrapCanonicalSections({
      client: {
        name: resolvedBrandName,
        website: client.website,
        instagramHandle: client.instagramHandle,
        oneLineDescription: client.oneLineDescription,
      },
      businessDna: approvedBusinessDna,
      sow: (client.sow as Record<string, unknown> | null | undefined) ?? null,
      templateType,
    });
    const jtaInput = buildApprovedJtaGeneratorInput({
      approvedSnapshot,
      snapshotInput,
      clientName: client.name,
      businessType: { primary: businessType.primary, confidence: businessType.confidence },
      approvedBusinessDna,
      templateType,
      importedResearchBrief:
        importedResearchBrief && typeof importedResearchBrief === "object" && !Array.isArray(importedResearchBrief)
          ? (importedResearchBrief as Record<string, unknown>)
          : null,
      websiteSummary,
    });
    if (shouldLogProvenance()) {
      req.log.info(
        {
          clientId,
          clientName: client.name,
          businessType: businessType.primary,
          artifactStage: "jump_to_action",
          approvedSnapshotId: approvedSnapshot.id,
          sourceSnippet: {
            sow: previewText(jtaInput.sow, 300),
            approvedBusinessDna: previewText(jtaInput.approvedBusinessDna, 300),
            instagram: previewText(jtaInput.instagram, 220),
          },
          promptInput: previewJson(jtaInput),
        },
        "Jump-to-Action provenance source",
      );
    }
    let canonicalSections = fallbackCanonicalSections;
    let fallbackUsed = true;
    let fallbackReason = "AI generation unavailable; deterministic Jump-to-Action fallback was used.";
    let repairAttempted = false;
    let repairSucceeded = false;
    if (resolvedProvider) {
      try {
        const generated = await generateJtaWithLlm({
          provider: resolvedProvider,
          input: jtaInput,
        });
        const generatedSections = sanitizeJtaCanonicalSections(
          generated.canonicalSections,
          client.name,
          jtaInput.client.brandName,
        );
        const generatedAssessment = evaluateJtaCandidate({
          canonicalSections: generatedSections,
          businessTypePrimary: businessType.primary,
          platforms: Array.isArray(approvedSowRecord.platforms)
            ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [],
          approvedBusinessDnaCategory: approvedBusinessDna.positioning?.category ?? null,
          approvedBusinessDnaAudience: approvedBusinessDna.targetAudience?.segments ?? [],
          approvedBusinessDnaPains: approvedBusinessDna.targetAudience?.pains ?? [],
          approvedBusinessDnaThemes: approvedBusinessDna.contentStrategy?.themes ?? [],
          approvedBusinessDnaDifferentiators: approvedBusinessDna.positioning?.differentiators ?? [],
          proofConstraints: jtaInput.proofConstraints ?? null,
          proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
        });
        if (generatedAssessment.validationStatus === "failed") {
          repairAttempted = true;
          const repaired = await generateJtaWithLlm({
            provider: resolvedProvider,
            input: jtaInput,
            repairIssues: buildJtaRepairInstructionLines({
              ok: generatedAssessment.validationStatus !== "failed",
              status: generatedAssessment.validationStatus,
              issues: generatedAssessment.validationIssues,
              issueDetails: generatedAssessment.validationIssueDetails,
            }),
            existingDraft: generatedSections,
          });
          const repairedSections = sanitizeJtaCanonicalSections(
            repaired.canonicalSections,
            client.name,
            jtaInput.client.brandName,
          );
          const repairedAssessment = evaluateJtaCandidate({
            canonicalSections: repairedSections,
            businessTypePrimary: businessType.primary,
            platforms: Array.isArray(approvedSowRecord.platforms)
              ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
              : [],
            approvedBusinessDnaCategory: approvedBusinessDna.positioning?.category ?? null,
            approvedBusinessDnaAudience: approvedBusinessDna.targetAudience?.segments ?? [],
            approvedBusinessDnaPains: approvedBusinessDna.targetAudience?.pains ?? [],
            approvedBusinessDnaThemes: approvedBusinessDna.contentStrategy?.themes ?? [],
            approvedBusinessDnaDifferentiators: approvedBusinessDna.positioning?.differentiators ?? [],
            proofConstraints: jtaInput.proofConstraints ?? null,
          proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
          });
          if (repairedAssessment.validationStatus !== "failed") {
            canonicalSections = repairedSections;
            fallbackUsed = false;
            fallbackReason = "";
            repairSucceeded = true;
            providerInfo = { provider: repaired.provider ?? providerInfo.provider, model: repaired.model ?? providerInfo.model };
          } else {
            setLastFailureStage("validation_failed_after_response");
            fallbackReason = `LLM Jump-to-Action failed validation after repair: ${repairedAssessment.validationIssues.join("; ")}`;
          }
        } else {
          canonicalSections = generatedSections;
          fallbackUsed = false;
          fallbackReason = "";
          providerInfo = { provider: generated.provider ?? providerInfo.provider, model: generated.model ?? providerInfo.model };
        }
      } catch (error) {
        fallbackReason = error instanceof Error ? error.message : String(error);
        req.log.warn({ clientId, err: error }, "JTA/bootstrap fell back to deterministic output");
      }
    }
    const jtaValidation = evaluateJtaCandidate({
      canonicalSections,
      businessTypePrimary: businessType.primary,
      platforms: Array.isArray(approvedSowRecord.platforms)
        ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      approvedBusinessDnaCategory: approvedBusinessDna.positioning?.category ?? null,
      approvedBusinessDnaAudience: approvedBusinessDna.targetAudience?.segments ?? [],
      approvedBusinessDnaPains: approvedBusinessDna.targetAudience?.pains ?? [],
      approvedBusinessDnaThemes: approvedBusinessDna.contentStrategy?.themes ?? [],
      approvedBusinessDnaDifferentiators: approvedBusinessDna.positioning?.differentiators ?? [],
      proofConstraints: jtaInput.proofConstraints ?? null,
      proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
    });
    const runMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "strategy_bootstrap",
      provider: providerInfo.provider,
      model: providerInfo.model,
      fallbackUsed,
      sourceContext: "approved_snapshot",
      generationMode: fallbackUsed ? "deterministic" : "llm",
      validation: {
        status: jtaValidation.validationStatus,
        note:
          jtaValidation.validationIssues.length > 0
            ? buildJtaRepairPromptInput({
                ok: jtaValidation.validationStatus !== "failed",
                status: jtaValidation.validationStatus,
                issues: jtaValidation.validationIssues,
                issueDetails: jtaValidation.validationIssueDetails,
              })
            : fallbackUsed
              ? fallbackReason
              : "Jump-to-Action validation passed.",
        issues: jtaValidation.validationIssues,
      },
      inputSources: buildJtaBootstrapInputSourceSummary({
        sourceContext: "approved_snapshot",
        templateType,
        businessDna: approvedBusinessDna,
        sow: (client.sow as Record<string, unknown> | null | undefined) ?? null,
        client: {
          website: client.website,
          instagramHandle: client.instagramHandle,
          oneLineDescription: client.oneLineDescription,
        },
      }),
      diagnostics: {
        ...aiHeaderDiagnostics,
        hasImportedResearchContext: Boolean(jtaInput.approvedResearchContext),
        proofConstraintsPresent: Boolean(jtaInput.proofConstraints),
        compactionFieldCount: countJtaResearchContextFields(jtaInput.approvedResearchContext),
        resolvedBrandName: jtaInput.client.brandName,
        ...buildProviderDiagnostics(resolvedProvider, {
          repairAttempted,
          repairSucceeded,
          fallbackReason: fallbackUsed ? fallbackReason : null,
        }),
      },
    });
    if (shouldLogProvenance()) {
      req.log.info(
        {
          clientId,
          clientName: client.name,
          businessType: businessType.primary,
          artifactStage: "jump_to_action",
          contentSource: fallbackUsed ? "deterministic_fallback" : "llm",
          helper_modified_content_fields: fallbackUsed ? "yes" : "no",
          helperNames: fallbackUsed ? ["buildBootstrapCanonicalSections"] : [],
          finalArtifact: previewJson(canonicalSections),
        },
        "Jump-to-Action provenance final",
      );
    }
    const structuredStrategyBase: Record<string, unknown> = {
      canonicalSections,
      __meta: {
        sectionApprovals: existing
          ? (((existing.structuredStrategy as Record<string, unknown> | undefined)?.__meta as { sectionApprovals?: Record<string, boolean> } | undefined)
              ?.sectionApprovals ??
            Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])))
          : Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])),
        regenerateCounters: existing
          ? (((existing.structuredStrategy as Record<string, unknown> | undefined)?.__meta as { regenerateCounters?: Record<string, number> } | undefined)
              ?.regenerateCounters ??
            Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])))
          : Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
        strategySource: fallbackUsed ? "fallback" : "bootstrap",
        snapshotId: approvedSnapshot.id,
        sourceContext: "approved_snapshot",
        ...(fallbackUsed ? { aiFailure: { message: fallbackReason } } : {}),
      },
    };
    const structuredStrategy = annotateStrategyStructured(
      structuredStrategyBase,
      runMeta,
      approvedSnapshot.id,
      false,
      businessType,
    );
    req.log.info(
      {
        clientId,
        trace: ((structuredStrategy.__meta as Record<string, unknown> | undefined)?.latestRun ?? null),
      },
      "JTA/bootstrap trace prepared",
    );

    if (existing) {
      const [updated] = await db
        .update(strategiesTable)
        .set({
          structuredStrategy,
          strategyDocument: buildCanonicalDocument(client.name, canonicalSections),
          templateType,
          status: "draft",
          updatedAt: new Date(),
        })
        .where(eq(strategiesTable.id, existing.id))
        .returning();
      if (!updated) {
        res.status(500).json({ error: "Failed to regenerate bootstrap strategy" });
        return;
      }
      res.json(serializeStrategy(updated));
      return;
    }

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
    markFallbackUsed();
    const memoryClient = memoryClients.get(clientId);
    const memoryProfile = memoryOnboarding.get(clientId);
    if (!memoryClient || !memoryProfile) {
      res.status(503).json({
        error:
          "Strategy bootstrap is temporarily unavailable. The database is unreachable and this client is not in the offline session. Retry when the database is available, or create the client again while the API is running in offline fallback mode.",
      });
      return;
    }
    const approvedSnapshot = readApprovedSnapshot(
      (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate Business DNA and Jump-to-Action." });
      return;
    }
    const existingMem = memoryStrategies.get(clientId);
    const enrichedDataMem = (memoryProfile.enrichedData as Record<string, unknown> | null | undefined) ?? {};
    const approvedBusinessDnaMem = readApprovedBusinessDnaFromEnriched(enrichedDataMem, approvedSnapshot.id);
    if (!approvedBusinessDnaMem) {
      res.status(400).json({ error: "Approved Business DNA is required before generating Jump-to-Action." });
      return;
    }
    const templateTypeMem = resolveConcreteTemplateType(
      enrichedDataMem,
      approvedSnapshot.templateType ?? null,
    );
    const approvedSowRecord = approvedSnapshot.sow as Record<string, unknown>;
    const businessType = classifyBusinessType({
      brandName: memoryClient.name,
      clientName: memoryClient.name,
      oneLineDescription: memoryClient.oneLineDescription,
      industry: approvedSowRecord.industry,
      targetAudience: approvedSowRecord.targetAudience,
      websiteText: memoryClient.website,
      instagramBio: approvedBusinessDnaMem.platformSignals?.instagram?.bioSignals?.join(" "),
      offerSummary: approvedBusinessDnaMem.offers?.primaryOffers?.[0] ?? approvedBusinessDnaMem.offers?.transformationPromise,
    });
    const aiHeaderDiagnostics = buildAiHeaderDiagnostics(req);
    let resolvedMemProvider: LLMProvider | null = null;
    let memProviderInfo = { provider: "fallback", model: "bootstrap_deterministic" };
    if (shouldUseRealAI(req)) {
      try {
        resolvedMemProvider = getRequestLLMProvider(req);
        memProviderInfo = resolvedMemProvider.describe?.() ?? { provider: resolvedMemProvider.id, model: "default" };
      } catch (error) {
        memProviderInfo = { provider: "fallback", model: "bootstrap_deterministic" };
        req.log.warn({ clientId, err: error, persistence: "memory_fallback" }, "JTA/bootstrap falling back because no AI provider was available");
      }
    }
    const snapshotInput = buildGenerationInputsFromSnapshot(
      approvedSnapshot,
      (memoryProfile.rawInput as Record<string, unknown> | null | undefined) ?? null,
    );
    const importedResearchBriefMem =
      (memoryProfile.rawInput as Record<string, unknown> | null | undefined)?.importedResearchBrief ?? null;
    const websiteSummaryMem = summarizeWebsiteForBusinessDnaInput(approvedBusinessDnaMem);
    const resolvedBrandNameMem = resolveClientFacingBrandName(memoryClient.name, {
      oneLineDescription: memoryClient.oneLineDescription,
      websiteTitle: websiteSummaryMem?.title ?? null,
    });
    const fallbackCanonicalSectionsMem = buildBootstrapCanonicalSections({
      client: {
        name: resolvedBrandNameMem,
        website: memoryClient.website,
        instagramHandle: memoryClient.instagramHandle,
        oneLineDescription: memoryClient.oneLineDescription,
      },
      businessDna: approvedBusinessDnaMem,
      sow: (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
      templateType: templateTypeMem,
    });
    const jtaInput = buildApprovedJtaGeneratorInput({
      approvedSnapshot,
      snapshotInput,
      clientName: memoryClient.name,
      businessType: { primary: businessType.primary, confidence: businessType.confidence },
      approvedBusinessDna: approvedBusinessDnaMem,
      templateType: templateTypeMem,
      importedResearchBrief:
        importedResearchBriefMem && typeof importedResearchBriefMem === "object" && !Array.isArray(importedResearchBriefMem)
          ? (importedResearchBriefMem as Record<string, unknown>)
          : null,
      websiteSummary: websiteSummaryMem,
    });
    let canonicalSectionsMem = fallbackCanonicalSectionsMem;
    let fallbackUsed = true;
    let fallbackReason = "AI generation unavailable; deterministic Jump-to-Action fallback was used.";
    let repairAttempted = false;
    let repairSucceeded = false;
    if (resolvedMemProvider) {
      try {
        const generated = await generateJtaWithLlm({
          provider: resolvedMemProvider,
          input: jtaInput,
        });
        const generatedSectionsMem = sanitizeJtaCanonicalSections(
          generated.canonicalSections,
          memoryClient.name,
          jtaInput.client.brandName,
        );
        const generatedAssessment = evaluateJtaCandidate({
          canonicalSections: generatedSectionsMem,
          businessTypePrimary: businessType.primary,
          platforms: Array.isArray(approvedSowRecord.platforms)
            ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
            : [],
          approvedBusinessDnaCategory: approvedBusinessDnaMem.positioning?.category ?? null,
          approvedBusinessDnaAudience: approvedBusinessDnaMem.targetAudience?.segments ?? [],
          approvedBusinessDnaPains: approvedBusinessDnaMem.targetAudience?.pains ?? [],
          approvedBusinessDnaThemes: approvedBusinessDnaMem.contentStrategy?.themes ?? [],
          approvedBusinessDnaDifferentiators: approvedBusinessDnaMem.positioning?.differentiators ?? [],
          proofConstraints: jtaInput.proofConstraints ?? null,
          proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
        });
        if (generatedAssessment.validationStatus === "failed") {
          repairAttempted = true;
          const repaired = await generateJtaWithLlm({
            provider: resolvedMemProvider,
            input: jtaInput,
            repairIssues: buildJtaRepairInstructionLines({
              ok: generatedAssessment.validationStatus !== "failed",
              status: generatedAssessment.validationStatus,
              issues: generatedAssessment.validationIssues,
              issueDetails: generatedAssessment.validationIssueDetails,
            }),
            existingDraft: generatedSectionsMem,
          });
          const repairedSectionsMem = sanitizeJtaCanonicalSections(
            repaired.canonicalSections,
            memoryClient.name,
            jtaInput.client.brandName,
          );
          const repairedAssessment = evaluateJtaCandidate({
            canonicalSections: repairedSectionsMem,
            businessTypePrimary: businessType.primary,
            platforms: Array.isArray(approvedSowRecord.platforms)
              ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
              : [],
            approvedBusinessDnaCategory: approvedBusinessDnaMem.positioning?.category ?? null,
            approvedBusinessDnaAudience: approvedBusinessDnaMem.targetAudience?.segments ?? [],
            approvedBusinessDnaPains: approvedBusinessDnaMem.targetAudience?.pains ?? [],
            approvedBusinessDnaThemes: approvedBusinessDnaMem.contentStrategy?.themes ?? [],
            approvedBusinessDnaDifferentiators: approvedBusinessDnaMem.positioning?.differentiators ?? [],
            proofConstraints: jtaInput.proofConstraints ?? null,
          proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
          });
          if (repairedAssessment.validationStatus !== "failed") {
            canonicalSectionsMem = repairedSectionsMem;
            fallbackUsed = false;
            fallbackReason = "";
            repairSucceeded = true;
            memProviderInfo = { provider: repaired.provider ?? memProviderInfo.provider, model: repaired.model ?? memProviderInfo.model };
          } else {
            fallbackReason = `LLM Jump-to-Action failed validation after repair: ${repairedAssessment.validationIssues.join("; ")}`;
          }
        } else {
          canonicalSectionsMem = generatedSectionsMem;
          fallbackUsed = false;
          fallbackReason = "";
          memProviderInfo = { provider: generated.provider ?? memProviderInfo.provider, model: generated.model ?? memProviderInfo.model };
        }
      } catch (error) {
        if (!fallbackReason) setLastFailureStage("fallback_used");
        fallbackReason = error instanceof Error ? error.message : String(error);
        req.log.warn({ clientId, err: error, persistence: "memory_fallback" }, "JTA/bootstrap fell back to deterministic output");
      }
    }
    if (fallbackUsed && shouldUseRealAI(req)) markAIFallbackUsed();
    if (!fallbackUsed) clearAIFallbackUsed();
    const jtaValidation = evaluateJtaCandidate({
      canonicalSections: canonicalSectionsMem,
      businessTypePrimary: businessType.primary,
      platforms: Array.isArray(approvedSowRecord.platforms)
        ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      approvedBusinessDnaCategory: approvedBusinessDnaMem.positioning?.category ?? null,
      approvedBusinessDnaAudience: approvedBusinessDnaMem.targetAudience?.segments ?? [],
      approvedBusinessDnaPains: approvedBusinessDnaMem.targetAudience?.pains ?? [],
      approvedBusinessDnaThemes: approvedBusinessDnaMem.contentStrategy?.themes ?? [],
      approvedBusinessDnaDifferentiators: approvedBusinessDnaMem.positioning?.differentiators ?? [],
      proofConstraints: jtaInput.proofConstraints ?? null,
      proofGaps: jtaInput.approvedResearchContext?.proofGaps ?? null,
    });
    const runMeta = buildRunMeta({
      clientId,
      snapshotId: approvedSnapshot.id,
      taskType: "strategy_bootstrap",
      provider: memProviderInfo.provider,
      model: memProviderInfo.model,
      fallbackUsed,
      sourceContext: "approved_snapshot",
      generationMode: fallbackUsed ? "deterministic" : "llm",
      validation: {
        status: jtaValidation.validationStatus,
        note:
          jtaValidation.validationIssues.length > 0
            ? buildJtaRepairPromptInput({
                ok: jtaValidation.validationStatus !== "failed",
                status: jtaValidation.validationStatus,
                issues: jtaValidation.validationIssues,
                issueDetails: jtaValidation.validationIssueDetails,
              })
            : fallbackUsed
              ? fallbackReason
              : "Jump-to-Action validation passed.",
        issues: jtaValidation.validationIssues,
      },
      inputSources: buildJtaBootstrapInputSourceSummary({
        sourceContext: "approved_snapshot",
        templateType: templateTypeMem,
        businessDna: approvedBusinessDnaMem,
        sow: (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
        client: {
          website: memoryClient.website,
          instagramHandle: memoryClient.instagramHandle,
          oneLineDescription: memoryClient.oneLineDescription,
        },
      }),
      diagnostics: {
        ...aiHeaderDiagnostics,
        hasImportedResearchContext: Boolean(jtaInput.approvedResearchContext),
        proofConstraintsPresent: Boolean(jtaInput.proofConstraints),
        compactionFieldCount: countJtaResearchContextFields(jtaInput.approvedResearchContext),
        resolvedBrandName: jtaInput.client.brandName,
        ...buildProviderDiagnostics(resolvedMemProvider, {
          repairAttempted,
          repairSucceeded,
          fallbackReason: fallbackUsed ? fallbackReason : null,
        }),
      },
    });
    const structuredStrategyMemBase: Record<string, unknown> = {
      canonicalSections: canonicalSectionsMem,
      __meta: {
        sectionApprovals: existingMem
          ? (((existingMem.structuredStrategy as Record<string, unknown> | undefined)?.__meta as { sectionApprovals?: Record<string, boolean> } | undefined)
              ?.sectionApprovals ??
            Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])))
          : Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, false])),
        regenerateCounters: existingMem
          ? (((existingMem.structuredStrategy as Record<string, unknown> | undefined)?.__meta as { regenerateCounters?: Record<string, number> } | undefined)
              ?.regenerateCounters ??
            Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])))
          : Object.fromEntries(CANONICAL_SECTION_KEYS.map((key) => [key, 0])),
        strategySource: fallbackUsed ? "fallback" : "bootstrap",
        snapshotId: approvedSnapshot.id,
        sourceContext: "approved_snapshot",
        ...(fallbackUsed ? { aiFailure: { message: fallbackReason } } : {}),
      },
    };
    const structuredStrategyMem = annotateStrategyStructured(
      structuredStrategyMemBase,
      runMeta,
      approvedSnapshot.id,
      false,
      businessType,
    );
    req.log.info(
      {
        clientId,
        trace: ((structuredStrategyMem.__meta as Record<string, unknown> | undefined)?.latestRun ?? null),
        persistence: "memory_fallback",
      },
      "JTA/bootstrap trace prepared",
    );
    const nowIso = new Date().toISOString();
    const nextStrategyMem: MemoryStrategy = existingMem
      ? {
          ...existingMem,
          structuredStrategy: structuredStrategyMem,
          strategyDocument: buildCanonicalDocument(memoryClient.name, canonicalSectionsMem),
          templateType: templateTypeMem,
          status: "draft",
          updatedAt: nowIso,
        }
      : {
          id: randomUUID(),
          clientId,
          structuredStrategy: structuredStrategyMem,
          strategyDocument: buildCanonicalDocument(memoryClient.name, canonicalSectionsMem),
          templateType: templateTypeMem,
          version: 1,
          status: "draft",
          createdAt: nowIso,
          updatedAt: nowIso,
        };
    memoryStrategies.set(clientId, nextStrategyMem);
    res.status(existingMem ? 200 : 201).json(serializeStrategy(nextStrategyMem as any));
  }
});

router.post("/clients/:clientId/strategy/bootstrap/approve", async (req, res) => {
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
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before approving Jump-to-Action." });
      return;
    }

    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    if (!strategy) {
      res.status(404).json({ error: "Jump-to-Action is not ready yet" });
      return;
    }

    const structured =
      ((strategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? null);
    const currentMeta =
      (((structured?.__meta as StrategyArtifactMeta | undefined) ?? undefined));
    if (currentMeta?.validationStatus === "failed") {
      res.status(400).json({ error: "Jump-to-Action failed validation and cannot be approved yet" });
      return;
    }

    const nextStructured = {
      ...(structured ?? {}),
      __meta: {
        ...((currentMeta ?? {}) as StrategyArtifactMeta),
        approval: {
          approved: true,
          approvedAt: new Date().toISOString(),
          approvedSnapshotId: approvedSnapshot.id,
          approvalVersion: "v1" as const,
        },
      } satisfies StrategyArtifactMeta,
    };

    const [updated] = await db
      .update(strategiesTable)
      .set({
        structuredStrategy: nextStructured,
        updatedAt: new Date(),
      })
      .where(eq(strategiesTable.id, strategy.id))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to approve Jump-to-Action" });
      return;
    }

    res.json({
      ok: true,
      strategy: serializeStrategy(updated),
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const client = memoryClients.get(clientId);
    const strategy = memoryStrategies.get(clientId);
    if (!client || !strategy) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW before approving Jump-to-Action." });
      return;
    }
    const structured =
      ((strategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? null);
    const currentMeta =
      (((structured?.__meta as StrategyArtifactMeta | undefined) ?? undefined));
    if (currentMeta?.validationStatus === "failed") {
      res.status(400).json({ error: "Jump-to-Action failed validation and cannot be approved yet" });
      return;
    }
    const nextStrategy = {
      ...strategy,
      updatedAt: new Date().toISOString(),
      structuredStrategy: {
        ...(structured ?? {}),
        __meta: {
          ...((currentMeta ?? {}) as StrategyArtifactMeta),
          approval: {
            approved: true,
            approvedAt: new Date().toISOString(),
            approvedSnapshotId: approvedSnapshot.id,
            approvalVersion: "v1" as const,
          },
        } satisfies StrategyArtifactMeta,
      },
    } satisfies MemoryStrategy;
    memoryStrategies.set(clientId, nextStrategy);
    res.json({
      ok: true,
      strategy: serializeStrategy(nextStrategy as any),
    });
  }
});

router.patch("/clients/:clientId/strategy", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = UpdateStrategyBody.parse(req.body) as z.infer<typeof UpdateStrategyBody> & {
    templateType?: string;
  };
  const requestedTemplateType =
    typeof body.templateType === "string" && body.templateType.trim().length > 0
      ? body.templateType.trim()
      : undefined;

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

    const baseStructured = (existing.structuredStrategy as Record<string, unknown> | null | undefined) ?? {};
    const nextStructured =
      body.structuredStrategy !== undefined
        ? { ...(body.structuredStrategy as Record<string, unknown>) }
        : { ...baseStructured };
    if (requestedTemplateType !== undefined) {
      nextStructured.template = requestedTemplateType;
    }
    const currentMeta =
      (((baseStructured.__meta as StrategyArtifactMeta | undefined) ?? undefined) as StrategyArtifactMeta | undefined);
    if (body.structuredStrategy !== undefined || body.status === "draft") {
      nextStructured.__meta = {
        ...((nextStructured.__meta as Record<string, unknown> | undefined) ?? {}),
        approval:
          body.status === "approved"
            ? (currentMeta?.approval ?? defaultApprovalMeta(currentMeta?.snapshotId ?? null))
            : defaultApprovalMeta(currentMeta?.snapshotId ?? null),
      };
    }

    const updates: Partial<typeof strategiesTable.$inferInsert> = { updatedAt: new Date() };
    if (body.strategyDocument !== undefined) updates.strategyDocument = body.strategyDocument;
    if (body.structuredStrategy !== undefined || requestedTemplateType !== undefined) {
      updates.structuredStrategy = nextStructured;
    }
    if (requestedTemplateType !== undefined) updates.templateType = requestedTemplateType as TemplateType;
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
    if (requestedTemplateType !== undefined) {
      const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
      if (client) {
        const sow = ((client.sow as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
        const currentSnapshot = readApprovedSnapshot(sow);
        const nextSow: Record<string, unknown> = {
          ...sow,
          __templatePreference: requestedTemplateType,
        };
        if (currentSnapshot) {
          const nextSnapshot = buildApprovedContextSnapshot({
            clientId,
            clientName: client.name,
            websiteUrl: client.website,
            instagramHandle: client.instagramHandle,
            oneLineDescription: client.oneLineDescription,
            sow: nextSow,
            templateType: requestedTemplateType,
            previousSnapshot: currentSnapshot,
          });
          nextSow.__approvedContextSnapshot = nextSnapshot;
          nextSow.__artifactState = {
            snapshotId: nextSnapshot.id,
            stale: nextSnapshot.id !== currentSnapshot.id,
            reason: nextSnapshot.id !== currentSnapshot.id ? "template_changed_after_approval" : null,
            updatedAt: new Date().toISOString(),
          };
        }
        await db.update(clientsTable).set({ sow: nextSow }).where(eq(clientsTable.id, clientId));
      }
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
    const memoryStructured = {
      ...(((body.structuredStrategy as Record<string, unknown> | undefined) ?? existing.structuredStrategy) as Record<
        string,
        unknown
      >),
    };
    if (requestedTemplateType !== undefined) {
      memoryStructured.template = requestedTemplateType;
    }
    const currentMeta =
      (((existing.structuredStrategy as Record<string, unknown> | undefined)?.__meta as StrategyArtifactMeta | undefined) ??
        undefined);
    if (body.structuredStrategy !== undefined || body.status === "draft") {
      memoryStructured.__meta = {
        ...((memoryStructured.__meta as Record<string, unknown> | undefined) ?? {}),
        approval:
          body.status === "approved"
            ? (currentMeta?.approval ?? defaultApprovalMeta(currentMeta?.snapshotId ?? null))
            : defaultApprovalMeta(currentMeta?.snapshotId ?? null),
      };
    }
    const updated: MemoryStrategy = {
      ...existing,
      strategyDocument: body.strategyDocument ?? existing.strategyDocument,
      structuredStrategy:
        body.structuredStrategy !== undefined || requestedTemplateType !== undefined
          ? memoryStructured
          : existing.structuredStrategy,
      templateType: requestedTemplateType ?? existing.templateType,
      status: body.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };
    memoryStrategies.set(clientId, updated);
    if (requestedTemplateType !== undefined) {
      const client = memoryClients.get(clientId);
      if (client) {
        const sow = ((client.sow as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
        const currentSnapshot = readApprovedSnapshot(sow);
        const nextSow: Record<string, unknown> = {
          ...sow,
          __templatePreference: requestedTemplateType,
        };
        if (currentSnapshot) {
          const nextSnapshot = buildApprovedContextSnapshot({
            clientId,
            clientName: client.name,
            websiteUrl: client.website,
            instagramHandle: client.instagramHandle,
            oneLineDescription: client.oneLineDescription,
            sow: nextSow,
            templateType: requestedTemplateType,
            previousSnapshot: currentSnapshot,
          });
          nextSow.__approvedContextSnapshot = nextSnapshot;
          nextSow.__artifactState = {
            snapshotId: nextSnapshot.id,
            stale: nextSnapshot.id !== currentSnapshot.id,
            reason: nextSnapshot.id !== currentSnapshot.id ? "template_changed_after_approval" : null,
            updatedAt: new Date().toISOString(),
          };
        }
        memoryClients.set(clientId, { ...client, sow: nextSow });
      }
    }
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
    const [profile] = await db
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
    if (!client || !strategy || !profile) {
      res.status(404).json({ error: "Client/strategy not found" });
      return;
    }
    const approvedSnapshot = readApprovedSnapshot(
      (client.sow as Record<string, unknown> | null | undefined) ?? null,
    );
    if (!approvedSnapshot) {
      res.status(400).json({ error: "Approve SOW to generate Business DNA and Jump-to-Action." });
      return;
    }
    const enrichedData =
      ((profile.enrichedData as Record<string, unknown> | null | undefined) ?? {});
    const businessDnaApprovalError = getBusinessDnaApprovalRequirementError(
      enrichedData,
      approvedSnapshot.id,
      "regenerating strategy sections",
    );
    if (businessDnaApprovalError) {
      res.status(400).json({ error: businessDnaApprovalError });
      return;
    }
    const jtaApprovalError = getCurrentJtaDraftRequirementError(
      getJtaWorkflowState(
        (strategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? null,
        approvedSnapshot.id,
      ),
      "regenerating strategy sections",
    );
    if (jtaApprovalError) {
      res.status(400).json({ error: jtaApprovalError });
      return;
    }
    const structured = strategy.structuredStrategy as Record<string, unknown>;
    const canonical = ((structured.canonicalSections ?? {}) as Record<string, string>) ?? {};
    const regenerateCounters =
      (((structured.__meta ?? {}) as { regenerateCounters?: Record<string, number> }).regenerateCounters ??
        {}) as Record<string, number>;
    const nextCounter = (regenerateCounters[sectionKey] ?? 0) + 1;
    const useRealAI = shouldUseRealAI(req);
    const businessDna =
      (profile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
    let refreshed = "";
    if (useRealAI) {
      try {
        const provider = getRequestLLMProvider(req);
        refreshed = validateCanonicalSection(
          sectionKey,
          await generateStrategySectionPatch({
            provider,
            client: {
              id: approvedSnapshot.client.id,
              name: approvedSnapshot.client.name,
              website: approvedSnapshot.client.websiteUrl,
              instagramHandle: approvedSnapshot.client.instagramHandle,
              oneLineDescription: approvedSnapshot.client.oneLineDescription,
            },
            sectionKey,
            structured,
            businessDna,
            sow: approvedSnapshot.sow as unknown as Record<string, unknown>,
            importedResearchBrief:
              (profile.rawInput as Record<string, unknown> | null | undefined)?.importedResearchBrief as
                | Record<string, unknown>
                | undefined,
            reason: typeof (req.body as { reason?: unknown } | null | undefined)?.reason === "string"
              ? String((req.body as { reason: string }).reason)
              : null,
          }),
            {
              website: approvedSnapshot.client.websiteUrl,
              instagramHandle: approvedSnapshot.client.instagramHandle,
              oneLineDescription: approvedSnapshot.client.oneLineDescription,
            },
          );
      } catch (err) {
        req.log.warn({ err, clientId, sectionKey }, "Context-aware section regenerate failed; falling back");
      }
    }
if (!refreshed) {
      const dnaValid = businessDna && isValidBusinessDna(businessDna);
      const platforms = readSelectedPlatforms(client.sow as Record<string, unknown> | null | undefined);
      refreshed = dnaValid
        ? buildBootstrapCanonicalSections({
            client: {
              name: approvedSnapshot.client.name,
              website: approvedSnapshot.client.websiteUrl,
              instagramHandle: approvedSnapshot.client.instagramHandle,
              oneLineDescription: approvedSnapshot.client.oneLineDescription,
            },
            businessDna,
            sow: approvedSnapshot.sow as unknown as Record<string, unknown>,
            templateType: strategy.templateType,
          })[sectionKey]
        : buildSectionVariantText(
            sectionKey,
            {
          name: approvedSnapshot.client.name,
          website: approvedSnapshot.client.websiteUrl,
          instagramHandle: approvedSnapshot.client.instagramHandle,
          oneLineDescription: approvedSnapshot.client.oneLineDescription,
        },
        nextCounter,
      );
    }
    const sectionApprovals = {
      ...(((structured.__meta ?? {}) as { sectionApprovals?: Record<string, boolean> }).sectionApprovals ??
        {}),
      [sectionKey]: false,
    };
    const nextStructured: Record<string, unknown> = {
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
    const sectionPatchSucceeded = Boolean(useRealAI && refreshed);
    nextStructured.__meta = {
      ...((nextStructured.__meta as Record<string, unknown> | undefined) ?? {}),
      latestRun: buildRunMeta({
        clientId,
        snapshotId: approvedSnapshot.id,
        taskType: "strategy_generate",
        provider: sectionPatchSucceeded ? "section_patch" : "deterministic",
        model: sectionPatchSucceeded ? "context_patch" : "bootstrap",
        fallbackUsed: !sectionPatchSucceeded,
        sourceContext: "approved_snapshot",
        generationMode: sectionPatchSucceeded ? "llm" : "deterministic",
      }),
      snapshotId: approvedSnapshot.id,
      snapshotState: "fresh",
      approval: defaultApprovalMeta(approvedSnapshot.id),
      sourceContext: "approved_snapshot",
    };
    const nextDocument = buildCanonicalDocument(
      client.name,
      (nextStructured.canonicalSections as Record<string, string> | undefined) ?? {},
    );
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
      const memoryProfile = memoryOnboarding.get(clientId);
      if (!memoryClient || !memoryStrategy || !memoryProfile) {
        res.status(404).json({ error: "Client/strategy not found" });
        return;
      }
      const approvedSnapshot = readApprovedSnapshot(
        (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
      );
      if (!approvedSnapshot) {
        res.status(400).json({ error: "Approve SOW to generate Business DNA and Jump-to-Action." });
        return;
      }
      const memoryEnrichedData =
        ((memoryProfile.enrichedData as Record<string, unknown> | null | undefined) ?? {});
      const memoryBusinessDnaApprovalError = getBusinessDnaApprovalRequirementError(
        memoryEnrichedData,
        approvedSnapshot.id,
        "regenerating strategy sections",
      );
      if (memoryBusinessDnaApprovalError) {
        res.status(400).json({ error: memoryBusinessDnaApprovalError });
        return;
      }
      const memoryJtaApprovalError = getCurrentJtaDraftRequirementError(
        getJtaWorkflowState(
          (memoryStrategy.structuredStrategy as Record<string, unknown> | null | undefined) ?? null,
          approvedSnapshot.id,
        ),
        "regenerating strategy sections",
      );
      if (memoryJtaApprovalError) {
        res.status(400).json({ error: memoryJtaApprovalError });
        return;
      }
      const structured = memoryStrategy.structuredStrategy as Record<string, unknown>;
      const canonical = ((structured.canonicalSections ?? {}) as Record<string, string>) ?? {};
      const regenerateCounters =
        (((structured.__meta ?? {}) as { regenerateCounters?: Record<string, number> })
          .regenerateCounters ?? {}) as Record<string, number>;
      const nextCounter = (regenerateCounters[sectionKey] ?? 0) + 1;
      let refreshed = "";
      if (shouldUseRealAI(req)) {
        try {
          const provider = getRequestLLMProvider(req);
          refreshed = validateCanonicalSection(
            sectionKey,
            await generateStrategySectionPatch({
              provider,
              client: {
                id: memoryClient.id,
                name: memoryClient.name,
                website: memoryClient.website,
                instagramHandle: memoryClient.instagramHandle,
                oneLineDescription: memoryClient.oneLineDescription,
              },
              sectionKey,
              structured,
              businessDna:
                (memoryProfile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null,
              sow: (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
              importedResearchBrief:
                (memoryProfile.rawInput as Record<string, unknown> | null | undefined)?.importedResearchBrief as
                  | Record<string, unknown>
                  | undefined,
              reason: typeof (req.body as { reason?: unknown } | null | undefined)?.reason === "string"
                ? String((req.body as { reason: string }).reason)
                : null,
            }),
            {
              website: memoryClient.website,
              instagramHandle: memoryClient.instagramHandle,
              oneLineDescription: memoryClient.oneLineDescription,
            },
          );
        } catch (err) {
          req.log.warn({ err, clientId, sectionKey }, "Memory section regenerate AI patch failed; falling back");
        }
      }
      if (!refreshed) {
        const memoryBusinessDna =
          (memoryProfile.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna ?? null;
        refreshed = memoryBusinessDna && isValidBusinessDna(memoryBusinessDna)
          ? buildBootstrapCanonicalSections({
              client: {
                name: memoryClient.name,
                website: memoryClient.website,
                instagramHandle: memoryClient.instagramHandle,
                oneLineDescription: memoryClient.oneLineDescription,
              },
              businessDna: memoryBusinessDna,
              sow: (memoryClient.sow as Record<string, unknown> | null | undefined) ?? null,
              templateType: memoryStrategy.templateType,
            })[sectionKey]
          : buildSectionVariantText(
              sectionKey,
              {
                name: memoryClient.name,
                website: memoryClient.website,
                instagramHandle: memoryClient.instagramHandle,
                oneLineDescription: memoryClient.oneLineDescription,
              },
              nextCounter,
            );
      }
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
          approval: defaultApprovalMeta(approvedSnapshot.id),
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
  const instagram = (body.instagram ?? null) as Record<string, unknown> | null;
  if (body.industry != null && typeof body.industry !== "string") return false;
  if (body.targetAudience != null && typeof body.targetAudience !== "string") return false;
  if (body.understandingOfRequirements != null && typeof body.understandingOfRequirements !== "string") return false;
  if (body.scopeOfWork != null && typeof body.scopeOfWork !== "string") return false;
  if (body.strategyLaunchPlanning != null && typeof body.strategyLaunchPlanning !== "string") return false;
  if (body.contentCreation != null && typeof body.contentCreation !== "string") return false;
  if (body.instagram != null && (typeof body.instagram !== "object" || body.instagram === null || Array.isArray(body.instagram))) {
    return false;
  }
  if (body.normalizedSections != null && (typeof body.normalizedSections !== "object" || body.normalizedSections === null)) {
    return false;
  }
  if (body.sowVersion != null && typeof body.sowVersion !== "number") return false;
  if (body.parseMeta != null && (typeof body.parseMeta !== "object" || body.parseMeta === null)) return false;
  if (body.researchBriefImport != null && (typeof body.researchBriefImport !== "object" || body.researchBriefImport === null)) {
    return false;
  }
  if (body.clientBasics != null && (typeof body.clientBasics !== "object" || body.clientBasics === null)) return false;
  if (instagram) {
    if (instagram.handle != null && typeof instagram.handle !== "string") return false;
    if (instagram.bio != null && typeof instagram.bio !== "string") return false;
    if (instagram.offerSummary != null && typeof instagram.offerSummary !== "string") return false;
    if (instagram.additionalInstagramNotes != null && typeof instagram.additionalInstagramNotes !== "string") return false;
    if (instagram.followerCount != null && typeof instagram.followerCount !== "string") return false;
    if (instagram.category != null && typeof instagram.category !== "string") return false;
    if (instagram.visualStyleNotes != null && typeof instagram.visualStyleNotes !== "string") return false;
    if (instagram.recentCaptionSnippets != null && !Array.isArray(instagram.recentCaptionSnippets)) return false;
    if (instagram.recurringTopics != null && !Array.isArray(instagram.recurringTopics)) return false;
    if (instagram.ctaPatterns != null && !Array.isArray(instagram.ctaPatterns)) return false;
    if (instagram.proofSignals != null && !Array.isArray(instagram.proofSignals)) return false;
  }
  return (
    platforms.every((p) => typeof p === "string") &&
    Object.values(monthlyPosts).every((v) => typeof v === "number") &&
    Object.values(contentMix).every((v) => typeof v === "number") &&
    deliverables.every((d) => typeof d === "string") &&
    Object.values(toneByPlatform).every((v) => typeof v === "string") &&
    (!instagram ||
      [instagram.recentCaptionSnippets, instagram.recurringTopics, instagram.ctaPatterns, instagram.proofSignals]
        .filter(Array.isArray)
        .every((items) => items.every((item) => typeof item === "string")))
  );
}

function stripPlaceholderText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) return "";
  return trimmed;
}

function cleanStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => stripPlaceholderText(value))
    .filter(Boolean);
}

function cleanNumberMap(values: unknown): Record<string, number> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>)
      .map(([key, value]) => [String(key).trim(), Number(value) || 0] as const)
      .filter(([key, value]) => key.length > 0 && value > 0),
  );
}

function cleanStringMap(values: unknown): Record<string, string> {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values as Record<string, unknown>)
      .map(([key, value]) => [String(key).trim(), stripPlaceholderText(value)] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function cleanStructuredInstagram(values: unknown): StructuredInstagramInput | undefined {
  if (!values || typeof values !== "object" || Array.isArray(values)) return undefined;
  const record = values as Record<string, unknown>;
  const recentCaptionSnippets = cleanStringList(record.recentCaptionSnippets);
  const recurringTopics = cleanStringList(record.recurringTopics);
  const cleaned: StructuredInstagramInput = {
    handle: stripPlaceholderText(record.handle),
    bio: stripPlaceholderText(record.bio),
    offerSummary: stripPlaceholderText(record.offerSummary),
    recentCaptionSnippets,
    recurringTopics,
    ...(stripPlaceholderText(record.additionalInstagramNotes)
      ? { additionalInstagramNotes: stripPlaceholderText(record.additionalInstagramNotes) }
      : {}),
    ...(cleanStringList(record.ctaPatterns).length > 0
      ? { ctaPatterns: cleanStringList(record.ctaPatterns) }
      : {}),
    ...(cleanStringList(record.proofSignals).length > 0
      ? { proofSignals: cleanStringList(record.proofSignals) }
      : {}),
    ...(stripPlaceholderText(record.followerCount)
      ? { followerCount: stripPlaceholderText(record.followerCount) }
      : {}),
    ...(stripPlaceholderText(record.category) ? { category: stripPlaceholderText(record.category) } : {}),
    ...(stripPlaceholderText(record.visualStyleNotes)
      ? { visualStyleNotes: stripPlaceholderText(record.visualStyleNotes) }
      : {}),
  };
  const hasAnyValue = Boolean(
    cleaned.handle ||
      cleaned.bio ||
      cleaned.offerSummary ||
      cleaned.recentCaptionSnippets.length > 0 ||
      cleaned.recurringTopics.length > 0 ||
      cleaned.additionalInstagramNotes ||
      (cleaned.ctaPatterns?.length ?? 0) > 0 ||
      (cleaned.proofSignals?.length ?? 0) > 0 ||
      cleaned.followerCount ||
      cleaned.category ||
      cleaned.visualStyleNotes,
  );
  return hasAnyValue ? cleaned : undefined;
}

function deriveInstagramSummaryNotesFromStructuredInstagram(
  instagram: StructuredInstagramInput | null | undefined,
): string {
  if (!instagram) return "";
  const blocks = [
    instagram.bio ? `Bio: ${instagram.bio}` : "",
    instagram.offerSummary ? `Offer: ${instagram.offerSummary}` : "",
    instagram.additionalInstagramNotes ? `Additional Instagram notes: ${instagram.additionalInstagramNotes}` : "",
    instagram.category ? `Category: ${instagram.category}` : "",
    instagram.followerCount ? `Follower count: ${instagram.followerCount}` : "",
    instagram.recurringTopics.length > 0 ? `Recurring topics: ${instagram.recurringTopics.join(", ")}` : "",
    instagram.recentCaptionSnippets.length > 0
      ? `Recent captions or themes: ${instagram.recentCaptionSnippets.join(" | ")}`
      : "",
    (instagram.ctaPatterns?.length ?? 0) > 0 ? `CTA patterns: ${instagram.ctaPatterns!.join(", ")}` : "",
    (instagram.proofSignals?.length ?? 0) > 0 ? `Proof signals: ${instagram.proofSignals!.join(", ")}` : "",
    instagram.visualStyleNotes ? `Visual style: ${instagram.visualStyleNotes}` : "",
  ].filter(Boolean);
  return blocks.join("\n").trim();
}

function readStructuredInstagramFromUnknown(values: unknown): StructuredInstagramInput | undefined {
  return cleanStructuredInstagram(values);
}

function pickPreferredInstagramInput(
  ...candidates: Array<StructuredInstagramInput | null | undefined>
): StructuredInstagramInput | undefined {
  for (const candidate of candidates) {
    const cleaned = cleanStructuredInstagram(candidate);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function readApprovedSnapshot(sow: Record<string, unknown> | null | undefined): ApprovedContextSnapshot | null {
  return readApprovedSnapshotRecord<ApprovedContextSnapshot>(sow);
}

function buildRunMeta(input: RunMetaInput) {
  return {
    clientId: input.clientId,
    snapshotId: input.snapshotId,
    runId: randomUUID(),
    taskType: input.taskType,
    provider: input.provider,
    model: input.model,
    fallbackUsed: input.fallbackUsed,
    sourceContext: input.sourceContext,
    timestamp: input.timestamp ?? new Date().toISOString(),
    generationMode: input.generationMode ?? (input.fallbackUsed ? "fallback" : "deterministic"),
    validation:
      input.validation ?? {
        status: "not_run" as const,
        note: "Phase 1 trace placeholder - semantic validation not wired yet.",
      },
    inputSources: input.inputSources ?? {},
    diagnostics: input.diagnostics ?? {},
  };
}

function shouldLogProvenance(): boolean {
  return process.env.NODE_ENV !== "production";
}

function hashPreview(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function previewText(value: unknown, maxChars = 500): string {
  const text =
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);
  return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function previewJson(value: unknown, maxChars = 500): { hash: string; preview: string } {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return {
    hash: hashPreview(text),
    preview: previewText(text, maxChars),
  };
}

function buildAiHeaderDiagnostics(req: Parameters<typeof shouldUseRealAI>[0]) {
  const requestedProvider = req.header("x-ai-provider")?.trim() || null;
  const requestedModel = req.header("x-ai-model")?.trim() || null;
  const providedApiKey = req.header("x-ai-api-key");
  return {
    useRealAI: shouldUseRealAI(req),
    requestedProvider,
    requestedModel,
    clientApiKeyPresent: typeof providedApiKey === "string" && providedApiKey.trim().length > 0,
  };
}

function buildProviderDiagnostics(
  provider: LLMProvider | null,
  extras?: {
    repairAttempted?: boolean;
    repairSucceeded?: boolean;
    fallbackReason?: string | null;
  },
) {
  const configuredChain =
    provider instanceof FallbackProvider
      ? provider.getConfiguredProviders()
      : provider
        ? [provider.describe?.() ?? { provider: provider.id, model: "default" }]
        : [];
  const attempts =
    provider instanceof FallbackProvider
      ? provider.getLastAttemptDiagnostics()
      : [];

  return {
    configuredProviderChain: configuredChain,
    providerAttempts: attempts,
    repairAttempted: Boolean(extras?.repairAttempted),
    repairSucceeded: Boolean(extras?.repairSucceeded),
    fallbackReason: extras?.fallbackReason ?? null,
    failureStage: getLastFailureStage(),
  };
}

function defaultApprovalMeta(snapshotId: string | null): ArtifactApprovalMeta {
  return {
    approved: false,
    approvedAt: null,
    approvedSnapshotId: snapshotId,
    approvalVersion: "v1",
  };
}

function mergeValidationIssues(...groups: Array<string[] | null | undefined>): string[] {
  return Array.from(
    new Set(
      groups
        .flatMap((group) => group ?? [])
        .map((item) => String(item ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function summarizeWebsiteForBusinessDnaInput(businessDna: BusinessDna | null | undefined) {
  if (!businessDna) return null;
  return {
    title: typeof businessDna.raw?.siteTitle === "string" ? businessDna.raw.siteTitle : "",
    metaDescription: typeof businessDna.raw?.metaDescription === "string" ? businessDna.raw.metaDescription : "",
    heroExcerpt: typeof businessDna.raw?.heroExcerpt === "string" ? businessDna.raw.heroExcerpt : "",
    messagingPatterns: businessDna.platformSignals?.website?.messagingPatterns ?? [],
    trustElements: businessDna.platformSignals?.website?.trustElements ?? [],
    conversionElements: businessDna.platformSignals?.website?.conversionElements ?? [],
    colors: businessDna.visualIdentity?.colors?.map((entry) => entry.hex) ?? [],
  };
}

function buildApprovedBusinessDnaGeneratorInput(params: {
  approvedSnapshot: ApprovedContextSnapshot;
  snapshotInput: ReturnType<typeof buildGenerationInputsFromSnapshot>;
  clientName: string;
  businessType: { primary: string; confidence: string };
  websiteSummary?: ReturnType<typeof summarizeWebsiteForBusinessDnaInput> | null;
  importedResearchBrief?: Record<string, unknown> | null;
}): BusinessDnaGeneratorInput {
  const approvedSowRecord = params.approvedSnapshot.sow as Record<string, unknown>;
  const structuredInstagram = params.snapshotInput.instagram;
  return {
    client: {
      brandName: params.approvedSnapshot.client.name,
      clientName: params.clientName,
      websiteUrl: params.approvedSnapshot.client.websiteUrl ?? params.snapshotInput.websiteUrl ?? "",
      instagramHandle:
        params.approvedSnapshot.client.instagramHandle ?? params.snapshotInput.instagramHandle ?? "",
      oneLineDescription:
        params.approvedSnapshot.client.oneLineDescription ?? params.snapshotInput.oneLineDescription ?? "",
    },
    businessType: params.businessType,
    sow: {
      industry: typeof approvedSowRecord.industry === "string" ? approvedSowRecord.industry : "",
      targetAudience: typeof approvedSowRecord.targetAudience === "string" ? approvedSowRecord.targetAudience : "",
      understandingOfRequirements:
        typeof approvedSowRecord.understandingOfRequirements === "string"
          ? approvedSowRecord.understandingOfRequirements
          : "",
      strategyLaunchPlanning:
        typeof approvedSowRecord.strategyLaunchPlanning === "string"
          ? approvedSowRecord.strategyLaunchPlanning
          : "",
      contentCreation:
        typeof approvedSowRecord.contentCreation === "string" ? approvedSowRecord.contentCreation : "",
      scopeOfWork: typeof approvedSowRecord.scopeOfWork === "string" ? approvedSowRecord.scopeOfWork : "",
      platforms: Array.isArray(approvedSowRecord.platforms)
        ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      monthlyPosts:
        typeof approvedSowRecord.monthlyPosts === "object" && approvedSowRecord.monthlyPosts !== null
          ? (approvedSowRecord.monthlyPosts as Record<string, number>)
          : {},
      contentMix:
        typeof approvedSowRecord.contentMix === "object" && approvedSowRecord.contentMix !== null
          ? (approvedSowRecord.contentMix as Record<string, number>)
          : {},
      deliverables: Array.isArray(approvedSowRecord.deliverables)
        ? approvedSowRecord.deliverables.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      toneByPlatform:
        typeof approvedSowRecord.toneByPlatform === "object" && approvedSowRecord.toneByPlatform !== null
          ? Object.fromEntries(
              Object.entries(approvedSowRecord.toneByPlatform as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value ?? "").trim(),
              ]),
            )
          : {},
    },
    instagram: structuredInstagram
      ? {
          handle: structuredInstagram.handle,
          bio: structuredInstagram.bio,
          offerSummary: structuredInstagram.offerSummary,
          recentCaptionSnippets: structuredInstagram.recentCaptionSnippets,
          recurringTopics: structuredInstagram.recurringTopics,
          ...(structuredInstagram.additionalInstagramNotes
            ? { additionalInstagramNotes: structuredInstagram.additionalInstagramNotes }
            : {}),
          ...(structuredInstagram.ctaPatterns?.length ? { ctaPatterns: structuredInstagram.ctaPatterns } : {}),
          ...(structuredInstagram.proofSignals?.length ? { proofSignals: structuredInstagram.proofSignals } : {}),
          ...(structuredInstagram.followerCount ? { followerCount: structuredInstagram.followerCount } : {}),
          ...(structuredInstagram.category ? { category: structuredInstagram.category } : {}),
          ...(structuredInstagram.visualStyleNotes ? { visualStyleNotes: structuredInstagram.visualStyleNotes } : {}),
          ...(params.snapshotInput.instagramSummaryNotes
            ? { instagramSummaryNotes: params.snapshotInput.instagramSummaryNotes }
            : {}),
        }
      : params.snapshotInput.instagramSummaryNotes
        ? {
            handle: params.snapshotInput.instagramHandle ?? "",
            bio: params.snapshotInput.instagramSummaryNotes,
            offerSummary: "",
            recentCaptionSnippets: [],
            recurringTopics: [],
            instagramSummaryNotes: params.snapshotInput.instagramSummaryNotes,
          }
        : null,
    website: params.websiteSummary ?? null,
    importedResearch: compactImportedResearchForDna(
      (params.importedResearchBrief as import("@workspace/research-brief").ImportedResearchBrief | null | undefined) ??
        null,
    ),
  };
}

function evaluateBusinessDnaCandidate(
  businessDna: BusinessDna,
  params: {
    approvedSowRecord: Record<string, unknown>;
    snapshotInput: ReturnType<typeof buildGenerationInputsFromSnapshot>;
    brandName: string;
    clientName: string;
    businessTypePrimary: string;
  },
) {
  const structuralValidation = validateBusinessDnaStructure(businessDna);
  const semanticValidation = validateBusinessDnaSemantics(businessDna, {
    strategyLaunchPlanning:
      typeof params.approvedSowRecord.strategyLaunchPlanning === "string"
        ? params.approvedSowRecord.strategyLaunchPlanning
        : null,
    scopeOfWork:
      typeof params.approvedSowRecord.scopeOfWork === "string" ? params.approvedSowRecord.scopeOfWork : null,
    recentCaptionSnippets: params.snapshotInput.instagram?.recentCaptionSnippets ?? [],
    proofSignals: params.snapshotInput.instagram?.proofSignals ?? [],
    brandName: params.brandName,
    clientName: params.clientName,
    businessTypePrimary: params.businessTypePrimary,
  });
  const validationIssues = mergeValidationIssues(structuralValidation.issues, semanticValidation.issues);
  const validationStatus: NonNullable<RunMetaInput["validation"]>["status"] =
    structuralValidation.status === "failed"
      ? "failed"
      : semanticValidation.status === "warning"
        ? "warning"
        : "passed";
  return {
    structuralValidation,
    semanticValidation,
    validationIssues,
    validationIssueDetails: [...structuralValidation.issueDetails, ...semanticValidation.issueDetails],
    validationStatus,
  };
}

function readApprovedBusinessDnaFromEnriched(
  enrichedData: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
): BusinessDna | null {
  const state = getBusinessDnaWorkflowState<BusinessDna & Record<string, unknown>>(enrichedData, snapshotId);
  return state.status === "approved_current" && state.artifact && isValidBusinessDna(state.artifact)
    ? state.artifact
    : null;
}

function getBusinessDnaApprovalRequirementError(
  enrichedData: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
  actionLabel: string,
): string | null {
  return getBusinessDnaRequirementError(getBusinessDnaWorkflowState(enrichedData, snapshotId), actionLabel);
}

function readApprovedJtaFromStructured(
  structured: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
): Record<string, unknown> | null {
  const state = getJtaWorkflowState<Record<string, unknown>>(structured, snapshotId);
  return state.status === "approved_current" ? state.artifact : null;
}

function getJtaApprovalRequirementError(
  structured: Record<string, unknown> | null | undefined,
  snapshotId: string | null,
  actionLabel: string,
): string | null {
  return getJtaRequirementError(getJtaWorkflowState(structured, snapshotId), actionLabel);
}

function buildApprovedJtaGeneratorInput(params: {
  approvedSnapshot: ApprovedContextSnapshot;
  snapshotInput: ReturnType<typeof buildGenerationInputsFromSnapshot>;
  clientName: string;
  businessType: { primary: string; confidence: string };
  approvedBusinessDna: BusinessDna;
  templateType: string;
  importedResearchBrief?: Record<string, unknown> | null;
  websiteSummary?: ReturnType<typeof summarizeWebsiteForBusinessDnaInput> | null;
}): JtaGeneratorInput {
  const approvedSowRecord = params.approvedSnapshot.sow as Record<string, unknown>;
  const structuredInstagram = params.snapshotInput.instagram;
  const rawBrandName = params.approvedSnapshot.client.name;
  const websiteSummary = params.websiteSummary ?? null;
  const brandName = resolveClientFacingBrandName(rawBrandName, {
    oneLineDescription:
      params.approvedSnapshot.client.oneLineDescription ?? params.snapshotInput.oneLineDescription ?? "",
    websiteTitle: websiteSummary?.title ?? null,
  });
  const knownTextBlob = [
    params.snapshotInput.oneLineDescription,
    approvedSowRecord.industry,
    approvedSowRecord.targetAudience,
    structuredInstagram?.bio,
    structuredInstagram?.offerSummary,
    ...(structuredInstagram?.recentCaptionSnippets ?? []),
    ...(structuredInstagram?.recurringTopics ?? []),
    params.approvedBusinessDna.positioning.valueProposition,
    params.approvedBusinessDna.mission,
  ]
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const approvedResearchContext = compactImportedResearchForJta(params.importedResearchBrief, {
    knownTextBlob,
  });
  const proofConstraints = buildProofConstraintsFromResearchContext(approvedResearchContext);
  const hasStructuredInstagram = Boolean(
    structuredInstagram &&
      (structuredInstagram.bio ||
        structuredInstagram.offerSummary ||
        structuredInstagram.recentCaptionSnippets.length > 0 ||
        structuredInstagram.recurringTopics.length > 0 ||
        (structuredInstagram.ctaPatterns?.length ?? 0) > 0 ||
        (structuredInstagram.proofSignals?.length ?? 0) > 0 ||
        structuredInstagram.visualStyleNotes),
  );
  const instagram = structuredInstagram
    ? {
        handle: structuredInstagram.handle,
        bio: structuredInstagram.bio,
        offerSummary: structuredInstagram.offerSummary,
        recentCaptionSnippets: structuredInstagram.recentCaptionSnippets,
        recurringTopics: structuredInstagram.recurringTopics,
        ...(structuredInstagram.additionalInstagramNotes
          ? { additionalInstagramNotes: structuredInstagram.additionalInstagramNotes }
          : {}),
        ...(structuredInstagram.ctaPatterns?.length ? { ctaPatterns: structuredInstagram.ctaPatterns } : {}),
        ...(structuredInstagram.proofSignals?.length ? { proofSignals: structuredInstagram.proofSignals } : {}),
        ...(structuredInstagram.followerCount ? { followerCount: structuredInstagram.followerCount } : {}),
        ...(structuredInstagram.category ? { category: structuredInstagram.category } : {}),
        ...(structuredInstagram.visualStyleNotes ? { visualStyleNotes: structuredInstagram.visualStyleNotes } : {}),
        ...(!hasStructuredInstagram && params.snapshotInput.instagramSummaryNotes
          ? { instagramSummaryNotes: params.snapshotInput.instagramSummaryNotes }
          : {}),
      }
    : params.snapshotInput.instagramSummaryNotes
      ? {
          handle: params.snapshotInput.instagramHandle ?? "",
          bio: params.snapshotInput.instagramSummaryNotes,
          offerSummary: "",
          recentCaptionSnippets: [],
          recurringTopics: [],
          instagramSummaryNotes: params.snapshotInput.instagramSummaryNotes,
        }
      : null;

  return {
    client: {
      brandName,
      clientName: params.clientName,
      websiteUrl: params.approvedSnapshot.client.websiteUrl ?? params.snapshotInput.websiteUrl ?? "",
      instagramHandle:
        params.approvedSnapshot.client.instagramHandle ?? params.snapshotInput.instagramHandle ?? "",
      oneLineDescription:
        params.approvedSnapshot.client.oneLineDescription ?? params.snapshotInput.oneLineDescription ?? "",
    },
    businessType: params.businessType,
    sow: {
      industry: typeof approvedSowRecord.industry === "string" ? approvedSowRecord.industry : "",
      targetAudience: typeof approvedSowRecord.targetAudience === "string" ? approvedSowRecord.targetAudience : "",
      understandingOfRequirements:
        typeof approvedSowRecord.understandingOfRequirements === "string"
          ? approvedSowRecord.understandingOfRequirements
          : "",
      strategyLaunchPlanning:
        typeof approvedSowRecord.strategyLaunchPlanning === "string"
          ? approvedSowRecord.strategyLaunchPlanning
          : "",
      contentCreation:
        typeof approvedSowRecord.contentCreation === "string" ? approvedSowRecord.contentCreation : "",
      scopeOfWork: typeof approvedSowRecord.scopeOfWork === "string" ? approvedSowRecord.scopeOfWork : "",
      platforms: Array.isArray(approvedSowRecord.platforms)
        ? approvedSowRecord.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      monthlyPosts:
        typeof approvedSowRecord.monthlyPosts === "object" && approvedSowRecord.monthlyPosts !== null
          ? (approvedSowRecord.monthlyPosts as Record<string, number>)
          : {},
      contentMix:
        typeof approvedSowRecord.contentMix === "object" && approvedSowRecord.contentMix !== null
          ? (approvedSowRecord.contentMix as Record<string, number>)
          : {},
      deliverables: Array.isArray(approvedSowRecord.deliverables)
        ? approvedSowRecord.deliverables.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      toneByPlatform:
        typeof approvedSowRecord.toneByPlatform === "object" && approvedSowRecord.toneByPlatform !== null
          ? Object.fromEntries(
              Object.entries(approvedSowRecord.toneByPlatform as Record<string, unknown>).map(([key, value]) => [
                key,
                String(value ?? "").trim(),
              ]),
            )
          : {},
    },
    instagram,
    approvedBusinessDna: {
      purpose: params.approvedBusinessDna.purpose,
      mission: params.approvedBusinessDna.mission,
      vision: params.approvedBusinessDna.vision,
      brandArchetype: params.approvedBusinessDna.brandArchetype,
      coreValues: params.approvedBusinessDna.coreValues,
      personalityTraits: params.approvedBusinessDna.personalityTraits,
      audienceSegments: params.approvedBusinessDna.targetAudience.segments,
      pains: params.approvedBusinessDna.targetAudience.pains,
      desires: params.approvedBusinessDna.targetAudience.desires,
      objections: params.approvedBusinessDna.targetAudience.objections,
      category: params.approvedBusinessDna.positioning.category,
      valueProposition: params.approvedBusinessDna.positioning.valueProposition,
      differentiators: params.approvedBusinessDna.positioning.differentiators,
      reasonToBelieve: params.approvedBusinessDna.positioning.reasonToBelieve,
      primaryOffers: params.approvedBusinessDna.offers.primaryOffers,
      transformationPromise: params.approvedBusinessDna.offers.transformationPromise,
      contentPillars: params.approvedBusinessDna.contentStrategy.contentPillars,
      themes: params.approvedBusinessDna.contentStrategy.themes,
      hooksThatFitBrand: params.approvedBusinessDna.contentStrategy.hooksThatFitBrand,
      trustSignalsToRepeat: params.approvedBusinessDna.contentStrategy.trustSignalsToRepeat,
      voiceTone: params.approvedBusinessDna.toneOfVoice.style,
    },
    ...(approvedResearchContext ? { approvedResearchContext } : {}),
    ...(websiteSummary ? { websiteSignals: websiteSummary } : {}),
    platformSignals: {
      instagram: {
        ...(structuredInstagram?.followerCount ? { followerCount: structuredInstagram.followerCount } : {}),
        ...(structuredInstagram?.ctaPatterns?.length ? { ctaPatterns: structuredInstagram.ctaPatterns } : {}),
        ...(params.approvedBusinessDna.platformSignals?.instagram?.contentPatterns?.length
          ? { contentPatterns: params.approvedBusinessDna.platformSignals.instagram.contentPatterns.slice(0, 6) }
          : {}),
        ...(params.approvedBusinessDna.platformSignals?.instagram?.engagementSignals?.length
          ? { engagementNotes: params.approvedBusinessDna.platformSignals.instagram.engagementSignals.slice(0, 6) }
          : {}),
      },
    },
    ...(proofConstraints ? { proofConstraints } : {}),
    templateType: params.templateType,
  };
}

function sanitizeJtaCanonicalSections(
  sections: Record<string, string>,
  rawName: string,
  brandName: string,
): Record<string, string> {
  if (!rawName || rawName === brandName) return sections;
  return Object.fromEntries(
    Object.entries(sections).map(([key, value]) => [
      key,
      sanitizeClientFacingText(String(value ?? ""), rawName, brandName),
    ]),
  );
}

function evaluateJtaCandidate(params: {
  canonicalSections: Record<string, unknown>;
  businessTypePrimary: string;
  platforms: string[];
  approvedBusinessDnaCategory?: string | null;
  approvedBusinessDnaAudience?: string[] | null;
  approvedBusinessDnaPains?: string[] | null;
  approvedBusinessDnaThemes?: string[] | null;
  approvedBusinessDnaDifferentiators?: string[] | null;
  proofConstraints?: JtaProofConstraints | null;
  proofGaps?: string[] | null;
}) {
  const structural = validateJtaStructure({ canonicalSections: params.canonicalSections });
  const semantic = validateJtaSemantics({
    canonicalSections: params.canonicalSections,
    businessTypePrimary: params.businessTypePrimary,
    platforms: params.platforms,
    approvedBusinessDnaCategory: params.approvedBusinessDnaCategory,
    approvedBusinessDnaAudience: params.approvedBusinessDnaAudience,
    approvedBusinessDnaPains: params.approvedBusinessDnaPains,
    approvedBusinessDnaThemes: params.approvedBusinessDnaThemes,
    approvedBusinessDnaDifferentiators: params.approvedBusinessDnaDifferentiators,
    proofConstraints: params.proofConstraints ?? null,
    proofGaps: params.proofGaps ?? null,
  });
  const validationIssues = mergeValidationIssues(structural.issues, semantic.issues);
  const validationStatus: NonNullable<RunMetaInput["validation"]>["status"] =
    structural.status === "failed"
      ? "failed"
      : semantic.status === "warning"
        ? "warning"
        : "passed";
  return {
    structural,
    semantic,
    validationIssues,
    validationIssueDetails: [...structural.issueDetails, ...semantic.issueDetails],
    validationStatus,
  };
}

function buildBusinessDnaInputSourceSummary(input: {
  sourceContext: "draft" | "approved_snapshot";
  websiteUrl: string | null | undefined;
  instagramHandle: string | null | undefined;
  structuredInstagram: StructuredInstagramInput | null | undefined;
  instagramSummaryNotes: string | null | undefined;
  sowSections?: { understandingOfRequirements?: string; scopeOfWork?: string } | null | undefined;
  mcpDataPresent?: boolean;
  skipInstagramFetch?: boolean;
  strategyType?: string | null | undefined;
}): Record<string, unknown> {
  const structured = cleanStructuredInstagram(input.structuredInstagram);
  const notes = typeof input.instagramSummaryNotes === "string" ? input.instagramSummaryNotes.trim() : "";
  const understanding = String(input.sowSections?.understandingOfRequirements ?? "").trim();
  const scope = String(input.sowSections?.scopeOfWork ?? "").trim();
  return {
    sourceContext: input.sourceContext,
    strategyType: input.strategyType ?? null,
    hasWebsiteUrl: Boolean(input.websiteUrl?.trim()),
    hasInstagramHandle: Boolean(input.instagramHandle?.trim()),
    hasStructuredInstagram: Boolean(structured),
    structuredInstagramFields: structured
      ? {
          handle: Boolean(structured.handle),
          bio: Boolean(structured.bio),
          offerSummary: Boolean(structured.offerSummary),
          recentCaptionSnippets: structured.recentCaptionSnippets.length,
          recurringTopics: structured.recurringTopics.length,
          additionalInstagramNotes: Boolean(structured.additionalInstagramNotes),
          ctaPatterns: structured.ctaPatterns?.length ?? 0,
          proofSignals: structured.proofSignals?.length ?? 0,
          followerCount: Boolean(structured.followerCount),
          category: Boolean(structured.category),
          visualStyleNotes: Boolean(structured.visualStyleNotes),
        }
      : null,
    hasLegacyInstagramNotes: Boolean(notes),
    legacyInstagramNotesLength: notes.length,
    hasUnderstandingOfRequirements: Boolean(understanding),
    hasScopeOfWork: Boolean(scope),
    mcpDataPresent: Boolean(input.mcpDataPresent),
    skipInstagramFetch: Boolean(input.skipInstagramFetch),
  };
}

function buildJtaBootstrapInputSourceSummary(input: {
  sourceContext: "draft" | "approved_snapshot";
  templateType: string | null | undefined;
  businessDna: BusinessDna | null | undefined;
  sow: Record<string, unknown> | null | undefined;
  client: Pick<MemoryClient, "website" | "instagramHandle" | "oneLineDescription">;
}): Record<string, unknown> {
  const dna = input.businessDna;
  const sow = input.sow ?? {};
  const sectionCount = dna && typeof dna === "object" ? Object.keys(dna).length : 0;
  return {
    sourceContext: input.sourceContext,
    templateType: input.templateType ?? null,
    hasBusinessDna: Boolean(dna),
    businessDnaSectionCount: sectionCount,
    hasWebsiteUrl: Boolean(input.client.website?.trim()),
    hasInstagramHandle: Boolean(input.client.instagramHandle?.trim()),
    hasOneLineDescription: Boolean(input.client.oneLineDescription?.trim()),
    selectedPlatforms: readSelectedPlatforms(sow),
    monthlyPostCountTotal: Object.values(readMonthlyPosts(sow)).reduce((sum, value) => sum + (Number(value) || 0), 0),
    contentMixBucketCount: Object.keys(readContentMix(sow)).length,
    toneByPlatformCount: Object.keys(readToneByPlatform(sow)).length,
  };
}

function buildApprovedContextSnapshot(params: {
  clientId: string;
  clientName: string;
  websiteUrl: string | null | undefined;
  instagramHandle: string | null | undefined;
  oneLineDescription: string | null | undefined;
  sow: Record<string, unknown>;
  templateType: string;
  previousSnapshot?: ApprovedContextSnapshot | null;
}): ApprovedContextSnapshot {
  const cleanedInstagram = cleanStructuredInstagram(params.sow.instagram);
  const cleanedNormalizedSections = (() => {
    const raw = (params.sow.normalizedSections as Record<string, unknown> | undefined) ?? undefined;
    if (!raw) return undefined;
    const out = Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [String(key).trim(), stripPlaceholderText(value)] as const)
        .filter(([key, value]) => key.length > 0 && value.length > 0),
    );
    return Object.keys(out).length > 0 ? out : undefined;
  })();
  const base = {
    sourceContext: "approved_snapshot" as const,
    templateType: params.templateType,
    client: {
      id: params.clientId,
      name: params.clientName,
      websiteUrl: stripPlaceholderText(params.websiteUrl) || null,
      instagramHandle: stripPlaceholderText(params.instagramHandle) || cleanedInstagram?.handle || null,
      oneLineDescription: stripPlaceholderText(params.oneLineDescription) || null,
    },
    sow: {
      industry: stripPlaceholderText(params.sow.industry),
      targetAudience: stripPlaceholderText(params.sow.targetAudience),
      understandingOfRequirements: stripPlaceholderText(params.sow.understandingOfRequirements),
      strategyLaunchPlanning: stripPlaceholderText(params.sow.strategyLaunchPlanning),
      contentCreation: stripPlaceholderText(params.sow.contentCreation),
      scopeOfWork: stripPlaceholderText(params.sow.scopeOfWork),
      platforms: cleanStringList(params.sow.platforms),
      monthlyPosts: cleanNumberMap(params.sow.monthlyPosts),
      contentMix: cleanNumberMap(params.sow.contentMix),
      deliverables: cleanStringList(params.sow.deliverables),
      toneByPlatform: cleanStringMap(params.sow.toneByPlatform),
      ...(cleanedInstagram ? { instagram: cleanedInstagram } : {}),
      ...(cleanedNormalizedSections ? { normalizedSections: cleanedNormalizedSections } : {}),
      approval:
        params.sow.approval && typeof params.sow.approval === "object"
          ? (params.sow.approval as { approved?: boolean; approvedAt?: string | null })
          : undefined,
    },
    provenance: {
      website: stripPlaceholderText(params.websiteUrl) ? "extracted" as const : "missing" as const,
      instagram:
        stripPlaceholderText(params.instagramHandle) || cleanedInstagram
          ? "extracted" as const
          : "missing" as const,
      oneLineDescription: stripPlaceholderText(params.oneLineDescription)
        ? "extracted" as const
        : "missing" as const,
      sow: "extracted" as const,
      template: "extracted" as const,
      generatedAt: new Date().toISOString(),
    },
  };
  const stablePayload = JSON.stringify(base);
  const previousPayload = params.previousSnapshot
    ? JSON.stringify({
        sourceContext: params.previousSnapshot.sourceContext,
        templateType: params.previousSnapshot.templateType,
        client: params.previousSnapshot.client,
        sow: params.previousSnapshot.sow,
      })
    : null;
  const snapshotId =
    previousPayload === stablePayload && params.previousSnapshot?.id
      ? params.previousSnapshot.id
      : randomUUID();
  const createdAt =
    previousPayload === stablePayload && params.previousSnapshot?.createdAt
      ? params.previousSnapshot.createdAt
      : new Date().toISOString();
  return {
    id: snapshotId,
    createdAt,
    ...base,
  };
}

function stampArtifactState(
  sow: Record<string, unknown>,
  snapshot: ApprovedContextSnapshot | null,
  stale: boolean,
  reason?: string,
): Record<string, unknown> {
  return {
    ...sow,
    __approvedContextSnapshot: snapshot,
    __artifactState: {
      snapshotId: snapshot?.id ?? null,
      stale,
      ...(reason ? { reason } : {}),
      updatedAt: new Date().toISOString(),
    },
  };
}

function annotateBusinessDnaArtifact(
  enrichedData: Record<string, unknown> | null | undefined,
  runMeta: ReturnType<typeof buildRunMeta>,
  snapshotId: string | null,
  stale: boolean,
  businessType?: { primary?: string; confidence?: string } | null,
): Record<string, unknown> {
  const current = enrichedData ?? {};
  const currentBusinessDna =
    ((current.businessDna as Record<string, unknown> | null | undefined) ?? null);
  const existingMeta =
    ((currentBusinessDna?.__meta as BusinessDnaArtifactMeta | undefined) ?? undefined);
  const nextBusinessDna = currentBusinessDna
    ? {
        ...currentBusinessDna,
        __artifactMeta: {
          ...(((currentBusinessDna.__artifactMeta as Record<string, unknown> | undefined) ?? {}) as Record<
            string,
            unknown
          >),
          ...runMeta,
          snapshotId,
          stale,
        },
        __meta: {
          ...((existingMeta ?? {}) as BusinessDnaArtifactMeta),
          businessDnaVersion: existingMeta?.businessDnaVersion ?? "v1",
          businessDnaInputVersion: existingMeta?.businessDnaInputVersion ?? "v1",
          generationMode:
            (runMeta.generationMode === "llm" ? "llm" : "heuristic_fallback") as BusinessDnaArtifactMeta["generationMode"],
          validationStatus: runMeta.validation?.status ?? existingMeta?.validationStatus ?? "not_run",
          validationIssues: runMeta.validation?.issues ?? existingMeta?.validationIssues ?? [],
          provider: runMeta.provider,
          model: runMeta.model,
          fallbackReason:
            runMeta.generationMode === "llm"
              ? undefined
              : (typeof runMeta.diagnostics?.fallbackReason === "string"
                  ? runMeta.diagnostics.fallbackReason
                  : undefined) ??
                runMeta.validation?.note ??
                existingMeta?.fallbackReason,
          fallbackSource:
            runMeta.generationMode === "llm" ? existingMeta?.fallbackSource : "business_dna_heuristic",
          generatedAt: runMeta.timestamp,
          snapshotId,
          currentSnapshotId: snapshotId,
          stale,
          latestRun: runMeta,
          approval: defaultApprovalMeta(snapshotId),
          businessType: businessType ?? existingMeta?.businessType,
        } satisfies BusinessDnaArtifactMeta,
      }
    : currentBusinessDna;
  return {
    ...current,
    ...(nextBusinessDna ? { businessDna: nextBusinessDna } : {}),
    __provenance: {
      ...(typeof current.__provenance === "object" && current.__provenance !== null
        ? (current.__provenance as Record<string, unknown>)
        : {}),
      latestBusinessDnaRun: runMeta,
      artifactSnapshotId: snapshotId,
      artifactStale: stale,
    },
  };
}

function annotateStrategyStructured(
  structured: Record<string, unknown>,
  runMeta: ReturnType<typeof buildRunMeta>,
  snapshotId: string | null,
  stale: boolean,
  businessType?: { primary?: string; confidence?: string } | null,
): Record<string, unknown> {
  const existingMeta =
    (((structured.__meta as StrategyArtifactMeta | undefined) ?? undefined) as StrategyArtifactMeta | undefined);
  return {
    ...structured,
    __meta: {
      ...(((structured.__meta as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>),
      latestRun: runMeta,
      snapshotId,
      snapshotState: stale ? "stale" : "fresh",
      jtaVersion: existingMeta?.jtaVersion ?? "v1",
      generationMode:
        (runMeta.generationMode === "llm" ? "llm" : "deterministic_fallback") as StrategyArtifactMeta["generationMode"],
      validationStatus: runMeta.validation?.status ?? existingMeta?.validationStatus ?? "not_run",
      validationIssues: runMeta.validation?.issues ?? existingMeta?.validationIssues ?? [],
      provider: runMeta.provider,
      model: runMeta.model,
      fallbackReason:
        runMeta.generationMode === "llm"
          ? undefined
          : runMeta.validation?.note ?? existingMeta?.fallbackReason,
      fallbackSource:
        runMeta.generationMode === "llm" ? existingMeta?.fallbackSource : "bootstrap_deterministic",
      generatedAt: runMeta.timestamp,
      jtaInputVersion: existingMeta?.jtaInputVersion ?? "v1",
      approval: defaultApprovalMeta(snapshotId),
      businessType: businessType ?? existingMeta?.businessType,
    },
  };
}

function annotatePlannerMetadata(
  metadata: Record<string, unknown> | null | undefined,
  runMeta: ReturnType<typeof buildRunMeta>,
  snapshotId: string | null,
  stale: boolean,
): Record<string, unknown> {
  return {
    ...((metadata ?? {}) as Record<string, unknown>),
    latestRun: runMeta,
    snapshotId,
    snapshotState: stale ? "stale" : "fresh",
  };
}

function markBusinessDnaStale(
  enrichedData: Record<string, unknown> | null | undefined,
  currentSnapshotId: string | null,
): Record<string, unknown> {
  const current = enrichedData ?? {};
  const businessDna =
    ((current.businessDna as Record<string, unknown> | null | undefined) ?? null);
  const currentMeta =
    ((businessDna?.__meta as BusinessDnaArtifactMeta | undefined) ?? undefined);
  return {
    ...current,
    ...(businessDna
      ? {
          businessDna: {
            ...businessDna,
            __artifactMeta: {
              ...(((businessDna.__artifactMeta as Record<string, unknown> | undefined) ?? {}) as Record<
                string,
                unknown
              >),
              stale: true,
              currentSnapshotId,
              staleAt: new Date().toISOString(),
            },
            __meta: {
              ...((currentMeta ?? {}) as BusinessDnaArtifactMeta),
              stale: true,
              currentSnapshotId,
              approval: defaultApprovalMeta(currentSnapshotId),
            } satisfies BusinessDnaArtifactMeta,
          },
        }
      : {}),
    __provenance: {
      ...(typeof current.__provenance === "object" && current.__provenance !== null
        ? (current.__provenance as Record<string, unknown>)
        : {}),
      artifactStale: true,
      artifactSnapshotId: currentSnapshotId,
      artifactStaleAt: new Date().toISOString(),
    },
  };
}

function markStructuredArtifactStale(
  structured: Record<string, unknown>,
  currentSnapshotId: string | null,
): Record<string, unknown> {
  const currentMeta =
    (((structured.__meta as StrategyArtifactMeta | undefined) ?? undefined) as StrategyArtifactMeta | undefined);
  return {
    ...structured,
    __meta: {
      ...(((structured.__meta as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>),
      snapshotState: "stale",
      currentSnapshotId,
      staleAt: new Date().toISOString(),
      approval: defaultApprovalMeta(currentSnapshotId),
      generationMode: currentMeta?.generationMode,
      validationStatus: currentMeta?.validationStatus,
      validationIssues: currentMeta?.validationIssues,
    },
  };
}

function markPlannerArtifactStale(
  metadata: Record<string, unknown> | null | undefined,
  currentSnapshotId: string | null,
): Record<string, unknown> {
  return {
    ...((metadata ?? {}) as Record<string, unknown>),
    snapshotState: "stale",
    currentSnapshotId,
    staleAt: new Date().toISOString(),
  };
}

function sanitizeSowPayload(body: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body };
  delete next.excludedCommercial;
  delete next.clientBasics;

  const pdfExtraction = (body.pdfExtraction as Record<string, unknown> | undefined) ?? undefined;
  if (pdfExtraction) {
    next.pdfExtraction = slimPdfExtraction(pdfExtraction);
  }

  const researchBriefImport = (body.researchBriefImport as Record<string, unknown> | undefined) ?? undefined;
  if (researchBriefImport) {
    next.researchBriefImport = slimResearchBriefImport(researchBriefImport);
  }

  const normalizedSections = (body.normalizedSections as Record<string, unknown> | undefined) ?? undefined;
  if (normalizedSections) {
    next.normalizedSections = Object.fromEntries(
      Object.entries(normalizedSections)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .filter(([key, value]) => !isExcludedSowSection(key, value as string)),
    );
  }

  const instagram = cleanStructuredInstagram(body.instagram);
  if (instagram) {
    next.instagram = instagram;
  } else {
    delete next.instagram;
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

function slimResearchBriefImport(researchBriefImport: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(researchBriefImport).filter(([key]) =>
      ["lastImportedAt", "importFileName", "importHash", "fieldProvenance", "sectionMap"].includes(key),
    ),
  );
}

function buildFastEnrichedProfile(input: {
  raw: { name: string; websiteUrl: string; instagramHandle: string; oneLineDescription: string };
  existingEnriched: Record<string, unknown>;
  sow?: Record<string, unknown> | null;
}) {
  const existingAudience =
    input.existingEnriched.target_audience && typeof input.existingEnriched.target_audience === "object"
      ? (input.existingEnriched.target_audience as Record<string, unknown>)
      : {};
  const websiteHost = safeHostFromUrl(input.raw.websiteUrl);
  const fallbackOffer = input.raw.oneLineDescription || `Offer for ${input.raw.name}`;
  const selectedPlatforms = readSelectedPlatforms(input.sow);
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
    platform:
      asNonEmptyString(input.existingEnriched.platform) ??
      (selectedPlatforms.length > 0 ? selectedPlatforms.map(formatPlatformName).join(" + ") : "Instagram"),
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

function trimSentence(input: string, maxChars = 280): string {
  const clean = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= maxChars ? clean : `${clean.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatPlatformName(platform: string): string {
  return platform
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function readSelectedPlatforms(sow: Record<string, unknown> | null | undefined): string[] {
  return Array.isArray(sow?.platforms)
    ? sow.platforms.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function readMonthlyPosts(sow: Record<string, unknown> | null | undefined): Record<string, number> {
  const raw = (sow?.monthlyPosts as Record<string, unknown> | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key).trim(), Number(value) || 0] as const)
      .filter(([key, value]) => key.length > 0 && value > 0),
  );
}

function readContentMix(sow: Record<string, unknown> | null | undefined): Record<string, number> {
  const raw = (sow?.contentMix as Record<string, unknown> | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key).trim(), Number(value) || 0] as const)
      .filter(([key, value]) => key.length > 0 && value > 0),
  );
}

function readToneByPlatform(sow: Record<string, unknown> | null | undefined): Record<string, string> {
  const raw = (sow?.toneByPlatform as Record<string, unknown> | undefined) ?? {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
      .filter(([key, value]) => key && value),
  );
}

function buildGenerationInputsFromSnapshot(
  snapshot: ApprovedContextSnapshot,
  rawInput: Record<string, unknown> | null | undefined,
) {
  const rawInstagram = readStructuredInstagramFromUnknown(rawInput?.instagram);
  const snapshotInstagram = readStructuredInstagramFromUnknown(snapshot.sow.instagram);
  const preferredInstagram = pickPreferredInstagramInput(snapshotInstagram, rawInstagram);
  const structuredInstagramNotes = deriveInstagramSummaryNotesFromStructuredInstagram(preferredInstagram);
  const legacyInstagramNotes =
    typeof rawInput?.instagramSummaryNotes === "string"
      ? stripPlaceholderText(rawInput.instagramSummaryNotes)
      : "";
  return {
    name: snapshot.client.name,
    websiteUrl: snapshot.client.websiteUrl ?? "",
    instagramHandle: snapshot.client.instagramHandle ?? preferredInstagram?.handle ?? "",
    oneLineDescription: snapshot.client.oneLineDescription ?? "",
    instagram: preferredInstagram,
    instagramSummaryNotes: structuredInstagramNotes || legacyInstagramNotes,
    sowSections: buildStrategyDnaSowSections(snapshot.sow as unknown as Record<string, unknown>, snapshot.sow.normalizedSections ?? null),
  };
}

function describePlatforms(
  platforms: string[],
  monthlyPosts: Record<string, number>,
  toneByPlatform: Record<string, string>,
): string {
  const parts = platforms
    .map((platform) => {
      const monthly = monthlyPosts[platform] ?? 0;
      const tone = toneByPlatform[platform] ?? "";
      return [
        formatPlatformName(platform),
        monthly > 0 ? `${monthly} posts/month` : "",
        tone ? `${tone} tone` : "",
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean);
  return parts.join("; ");
}

function describeContentMix(contentMix: Record<string, number>): string {
  return Object.entries(contentMix)
    .map(([key, value]) => `${canonicalLabelForMix(key)} (${value})`)
    .join(", ");
}

function firstUseful(items: Array<string | null | undefined>): string {
  return items.map((item) => String(item ?? "").trim()).find(Boolean) ?? "";
}

function joinSentences(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => trimSentence(String(line ?? "")))
    .filter(Boolean)
    .join(" ");
}

function lowerFirst(text: string): string {
  const clean = String(text ?? "").trim();
  if (!clean) return "";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

function cleanStrategicPhrase(text: string, fallback = ""): string {
  const clean = replaceDetectorPhrases(trimSentence(text, 180))
    .replace(/\.\.\.+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/g, "");
  return clean || fallback;
}

function summarizeAudienceNeed(dna: BusinessDna): string {
  return cleanStrategicPhrase(
    firstUseful([
      dna.targetAudience.desires[0],
      dna.targetAudience.pains[0],
      dna.targetAudience.objections[0],
    ]),
    "clear proof, fit, and everyday relevance",
  );
}

function buildMetricBullet(label: string, metrics: string[]): string {
  const cleanMetrics = metrics.map((item) => cleanStrategicPhrase(item)).filter(Boolean);
  if (cleanMetrics.length === 0) return "";
  return `${label}: ${cleanMetrics.join(", ")}`;
}

function buildBootstrapSectionText(input: {
  client: Pick<MemoryClient, "name" | "oneLineDescription">;
  dna: BusinessDna;
  sow: Record<string, unknown>;
  platforms: string[];
  monthlyPosts: Record<string, number>;
  contentMix: Record<string, number>;
  toneByPlatform: Record<string, string>;
  fallback: Record<string, string>;
}): Record<string, string> {
  const { client, dna, sow, platforms, monthlyPosts, contentMix, toneByPlatform, fallback } = input;
  const platformSummary = describePlatforms(platforms, monthlyPosts, toneByPlatform);
  const contentMixSummary = describeContentMix(contentMix);
  const category = firstUseful([
    dna.positioning.category,
    String(sow.industry ?? ""),
    "the category",
  ]);
  const marketAngle = firstUseful([
    dna.positioning.marketAngle,
    dna.positioning.valueProposition,
    client.oneLineDescription ?? "",
  ]);
  const primarySegments = dna.targetAudience.segments.slice(0, 2).join(" and ");
  const audienceNeed = summarizeAudienceNeed(dna);
  const differentiator = firstUseful([
    dna.positioning.differentiators[0],
    dna.positioning.valueProposition,
    dna.mission,
  ]);
  const promiseFrame = cleanStrategicPhrase(
    firstUseful([
      dna.positioning.valueProposition,
      dna.mission,
      dna.offers.primaryOffers[0],
    ]),
    "a more credible and differentiated category choice",
  );
  const differentiatorFrame = cleanStrategicPhrase(
    firstUseful([
      dna.positioning.differentiators[0],
      dna.positioning.valueProposition,
      dna.mission,
    ]),
    "a clearer, more trustable alternative to generic category positioning",
  );
  const hooks = dna.contentStrategy.hooksThatFitBrand.slice(0, 2).join(", ");
  const trustSignals = dna.contentStrategy.trustSignalsToRepeat
    .slice(0, 2)
    .map((item) => cleanStrategicPhrase(item))
    .filter(Boolean)
    .join(", ");
  const activePlatformsLabel =
    platforms.length > 0 ? platforms.map(formatPlatformName).join(" and ") : "the active channels";
  const nonNegotiables = dna.coreValues.length > 0
    ? dna.coreValues.slice(0, 4).map((item) => cleanStrategicPhrase(item)).filter(Boolean)
    : ["Clarity", "Trust", "Consistency", "Premium restraint"];
  const audienceSegments = dna.targetAudience.segments.slice(0, 4).map((item) => cleanStrategicPhrase(item)).filter(Boolean);
  const audienceMotivations = [
    ...dna.targetAudience.desires.slice(0, 2),
    dna.targetAudience.psychographics[0],
  ].map((item) => cleanStrategicPhrase(item)).filter(Boolean);
  const painAndDesire = [
    dna.targetAudience.pains[0],
    dna.targetAudience.desires[0],
  ].map((item) => cleanStrategicPhrase(item)).filter(Boolean);
  const buyingTriggers = [
    dna.targetAudience.objections[0]
      ? `Clear proof that resolves ${lowerFirst(cleanStrategicPhrase(dna.targetAudience.objections[0]))}`
      : "",
    "Tangible differentiation they can understand quickly",
    "A low-friction next step that converts interest into action",
  ].map((item) => cleanStrategicPhrase(item)).filter(Boolean);
  const emotionalBullets = [
    buildMetricBullet("Confidence", [
      cleanStrategicPhrase(dna.targetAudience.desires[0], "buyers want confidence that the brand is the right fit"),
    ]),
    buildMetricBullet("Relief", [
      dna.targetAudience.objections[0]
        ? `reassurance that removes ${lowerFirst(cleanStrategicPhrase(dna.targetAudience.objections[0]))}`
        : "reassurance that reduces hesitation before action",
    ]),
    buildMetricBullet("Trust", [
      "credibility needs to feel earned before buyers convert",
    ]),
    buildMetricBullet("Aspiration", [
      "the brand should feel aligned with the routine and identity the audience wants to sustain",
    ]),
  ].filter(Boolean);

  return {
    marketNarrative:
      joinStrategyLines([
        `${client.name} should be framed inside a changing ${category} market where product utility alone is no longer enough to win attention or trust.`,
        `Category context: ${client.name} operates in ${category}, where buyers increasingly evaluate performance, credibility, and brand meaning together rather than as separate decisions.`,
        `Market shift: Demand is moving toward brands that make ${lowerFirst(promiseFrame)} feel credible, differentiated, and easy to understand at a glance.`,
        primarySegments
          ? `Audience behavior: ${primarySegments} compare fit, trust, and everyday relevance before they act, especially when the category needs more explanation than a simple product claim.`
          : "Audience behavior: Buyers compare fit, trust, and everyday relevance before they act, especially when the category needs more explanation than a simple product claim.",
        `Brand relevance: ${client.name} becomes more relevant when it translates ${lowerFirst(differentiatorFrame)} into a message buyers can place inside their routines, standards, and self-image.`,
        `Whitespace / opportunity: Own the space between generic premium positioning and a clearer everyday outcome built around ${lowerFirst(audienceNeed)}.`,
      ]) || fallback.marketNarrative,
    problemGapSolution:
      joinSentences([
        `The core problem is that buyers in ${category} often see options that describe the product but do not reduce uncertainty about fit, trust, or everyday relevance.`,
        dna.targetAudience.pains[0]
          ? `For this audience, the friction shows up as ${dna.targetAudience.pains[0].toLowerCase()}, which slows conversion and makes discovery content harder to turn into action.`
          : "",
        differentiatorFrame
          ? `The gap is not simply product availability; it is the lack of messaging that makes ${lowerFirst(differentiatorFrame)} feel concrete, believable, and easy to act on.`
          : "",
        `The solution is to make ${client.name} communicate the category pain, the missing proof, and the brand-specific solve in one sequence so every section moves from problem to reassurance to action.`,
      ]) || fallback.problemGapSolution,
    brandFoundation:
      joinStrategyLines([
        `${client.name} should be framed as a brand with a clear promise, not just a product descriptor.`,
        `Mission: Build a brand that makes ${lowerFirst(promiseFrame)} feel easier to trust, choose, and repeat.`,
        `Core promise: Deliver ${lowerFirst(promiseFrame)} in a way that feels credible, relevant, and usable in real routines.`,
        `Differentiator: Position ${client.name} as ${lowerFirst(differentiatorFrame)} rather than another brand relying on broad premium language.`,
        `Non-negotiables: ${nonNegotiables.join(", ")}`,
      ]) || fallback.brandFoundation,
    brandPhilosophy:
      joinSentences([
        dna.brandArchetype ? `${client.name} should behave like a ${dna.brandArchetype.toLowerCase()} brand, not a generic content publisher.` : "",
        dna.voice_tone ? `Its communication philosophy should feel ${dna.voice_tone.toLowerCase()}, with every message helping the audience interpret the brand quickly and confidently.` : "",
        dna.personalityTraits.length > 0
          ? `Personality should come through as ${dna.personalityTraits.slice(0, 4).join(", ")}, which shapes how the brand educates, reassures, and differentiates itself.`
          : "",
        dna.toneOfVoice.donts.length > 0
          ? `Just as important, it should avoid ${dna.toneOfVoice.donts.slice(0, 3).join(", ")} so the brand does not collapse into category cliches or overclaiming.`
          : "",
      ]) || fallback.brandPhilosophy,
    audience:
      joinStrategyLines([
        `The audience definition should explain who acts, what they care about, and what finally moves them toward action.`,
        `Primary audience: ${primarySegments || "Decision-makers seeking a more credible category choice"}`,
        audienceSegments.length > 0 ? `Priority segments: ${audienceSegments.join(", ")}` : "",
        audienceMotivations.length > 0 ? `Motivations: ${audienceMotivations.join(", ")}` : "Motivations: Confidence in the choice, fit with identity, and lower decision friction",
        painAndDesire.length > 0 ? `Pains and desires: ${painAndDesire.join(", ")}` : "Pains and desires: Unclear proof, fit concerns, and a desire for a clearer reason to choose",
        buyingTriggers.length > 0 ? `Buying triggers: ${buyingTriggers.join(", ")}` : "",
      ]) || fallback.audience,
    emotionalDrivers:
      joinStrategyLines([
        "The strongest emotional triggers should explain what helps the audience move from interest to action.",
        ...emotionalBullets,
      ]) || fallback.emotionalDrivers,
    platformStrategy:
      joinSentences([
        platformSummary
          ? `The active platform system for ${client.name} is ${platformSummary}, and each channel should have a clear role in moving the audience from discovery to trust to conversion.`
          : "",
        platforms.length > 0
          ? `${activePlatformsLabel} should not repeat the same message in the same format; each platform should translate the same positioning into channel-native behavior and intent.`
          : "",
        dna.platformSignals.instagram.contentPatterns.length > 0
          ? `The strongest reusable platform behavior today comes from patterns such as ${dna.platformSignals.instagram.contentPatterns.slice(0, 3).join(", ")}, which can be adapted into repeatable creative systems.`
          : "",
        toneByPlatform && Object.keys(toneByPlatform).length > 0
          ? `Execution should stay consistent with the selected tone guidance so the audience experiences a coherent brand voice even when the content format changes.`
          : "",
      ]) || fallback.platformStrategy,
    contentStrategy:
      joinSentences([
        dna.contentStrategy.contentPillars.length > 0
          ? `The content strategy should run on a fixed system of pillars such as ${dna.contentStrategy.contentPillars.slice(0, 4).join(", ")}, with each pillar serving a different trust or conversion job.`
          : "",
        contentMixSummary
          ? `The approved content mix of ${contentMixSummary} should be treated as an operating ratio, not a loose suggestion, so each month balances education, positioning, proof, and action.`
          : "",
        hooks
          ? `Hooks should consistently open with angles like ${hooks.toLowerCase()}, while proof angles should come from ${trustSignals || "demonstrable reasons to believe"}.`
          : "",
        platforms.length > 0
          ? `Across ${activePlatformsLabel}, repetition should come from recurring message architecture and recognizable formats, not from reusing the same caption logic everywhere.`
          : "",
      ]) || fallback.contentStrategy,
    kpis:
      joinStrategyLines([
        "Performance should be tracked through business-facing metrics across awareness, engagement, trust, conversion, and retention.",
        "Awareness: Reach growth, discovery efficiency, and new-audience penetration",
        "Engagement: Saves, shares, profile actions, and deeper content interaction",
        "Trust: Proof consumption, repeat visits, and high-intent engagement quality",
        "Conversion: Click-throughs, inquiries, landing-page actions, or purchase-intent signals",
        platforms.length > 0
          ? `Retention: Compare which of ${activePlatformsLabel} keeps returning attention and compounds downstream response over time`
          : "Retention: Returning audience behavior and repeat response over time",
      ]) || fallback.kpis,
    trackingPlan:
      joinSentences([
        `Track performance weekly by section, platform, and format, then review bi-weekly to identify which messages are earning attention versus which ones are actually moving intent.`,
        contentMixSummary ? `Use the approved content mix as a control variable so changes in output quality are not confused with changes in distribution balance.` : "",
        `A monthly review should decide what to scale, what to simplify, and what proof or audience angle still needs reinforcement.`
      ]) || fallback.trackingPlan,
    executionPhases:
      joinSentences([
        `Phase 1 should lock narrative clarity, platform roles, and repeatable creative systems so the strategy has a stable foundation before optimization begins.`,
        `Phase 2 should strengthen proof, audience resonance, and conversion pathways by doubling down on the sections and formats that are earning response.`,
        `Phase 3 should optimize the system using actual performance data, with updates tied to content mix, platform contribution, and the quality of action signals.`
      ]) || fallback.executionPhases,
    assetRequirements:
      joinSentences([
        `The asset plan should cover short-form video, carousels, static design units, caption templates, proof blocks, and reusable CTA-ready copy so the team can execute consistently across the active channels.`,
        platforms.length > 0
          ? `Because ${client.name} is activating ${activePlatformsLabel}, the asset library should include platform-adapted versions rather than one master asset pushed everywhere unchanged.`
          : "",
        trustSignals ? `Priority production inputs should support the strongest proof themes, especially ${trustSignals.toLowerCase()}.` : "",
      ]) || fallback.assetRequirements,
  };
}

async function generateStrategySectionPatch(input: {
  provider: LLMProvider;
  client: Pick<MemoryClient, "id" | "name" | "website" | "instagramHandle" | "oneLineDescription">;
  sectionKey: string;
  structured: Record<string, unknown>;
  businessDna: BusinessDna | null;
  sow: Record<string, unknown> | null | undefined;
  importedResearchBrief?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<string> {
  const websiteSummaryFromDna = summarizeWebsiteForBusinessDnaInput(input.businessDna);
  const resolvedBrandName = resolveClientFacingBrandName(input.client.name, {
    oneLineDescription: input.client.oneLineDescription,
    websiteTitle: websiteSummaryFromDna?.title ?? null,
  });
  const instagramUrl = input.client.instagramHandle?.startsWith("http")
    ? input.client.instagramHandle
    : input.client.instagramHandle
      ? `https://instagram.com/${input.client.instagramHandle.replace(/^@/, "")}`
      : "";
  const context = await getClientContextWithCache({
    clientId: input.client.id,
    websiteUrl: input.client.website ?? "",
    instagramUrlOrHandle: instagramUrl,
    timeoutMs: 6000,
  });
  const mergedInstagram = mergeInstagramForStrategy(
    context.instagramSummary,
    input.businessDna?.platformSignals?.instagram,
  );
  const knownTextBlob = [
    input.client.oneLineDescription,
    input.sow?.industry,
    input.sow?.targetAudience,
    mergedInstagram?.bio,
    input.businessDna?.positioning.valueProposition,
  ]
    .map((item) => String(item ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const approvedResearchContext = compactImportedResearchForJta(input.importedResearchBrief, { knownTextBlob });
  const proofConstraints = buildProofConstraintsFromResearchContext(approvedResearchContext);
  const summary = ((input.structured.__summary as Record<string, unknown> | undefined) ?? {}) as {
    strategy?: string;
    pillarPriorities?: string[];
    monthlyGoals?: string[];
  };
  const patchPayload = {
    client: {
      id: input.client.id,
      name: resolvedBrandName,
      websiteUrl: input.client.website,
      instagramHandle: input.client.instagramHandle,
      oneLineDescription: input.client.oneLineDescription,
    },
    sow: {
      sowVersion: Number(input.sow?.sowVersion ?? 0),
      industry: String(input.sow?.industry ?? ""),
      targetAudience: String(input.sow?.targetAudience ?? ""),
      understandingOfRequirements: String(input.sow?.understandingOfRequirements ?? ""),
      strategyLaunchPlanning: String(input.sow?.strategyLaunchPlanning ?? ""),
      contentCreation: String(input.sow?.contentCreation ?? ""),
      scopeOfWork: effectiveScopeOfWork(input.sow) || String(input.sow?.scopeOfWork ?? ""),
      platforms: readSelectedPlatforms(input.sow),
      monthlyPosts: readMonthlyPosts(input.sow),
      contentMix: readContentMix(input.sow),
      deliverables: Array.isArray(input.sow?.deliverables)
        ? input.sow!.deliverables.map((item) => String(item ?? "").trim()).filter(Boolean)
        : [],
      toneByPlatform: readToneByPlatform(input.sow),
      normalizedSections: getStrategyRelevantNormalizedSowSections(input.sow) ?? {},
      parseMeta:
        ((input.sow?.parseMeta as Record<string, unknown> | undefined) ?? {
          mode: "",
          parseConfidence: 0,
          warnings: [],
        }),
    },
    websiteSummary: {
      url: input.client.website ?? null,
      brandName: resolvedBrandName,
      offerSummary:
        trimSentence(approvedResearchContext?.websiteSignals?.primaryOffers ?? "", 220) ||
        trimSentence(context.websiteSummary?.meta_description ?? websiteSummaryFromDna?.metaDescription ?? "", 220) ||
        null,
      positioningSummary:
        trimSentence(approvedResearchContext?.websiteSignals?.brandPositioning ?? "", 220) ||
        trimSentence(context.websiteSummary?.main_text_excerpt ?? websiteSummaryFromDna?.heroExcerpt ?? "", 220) ||
        null,
      proofPoints: [],
      toneSignals: websiteSummaryFromDna?.messagingPatterns?.slice(0, 4) ?? [],
    },
    websiteSignals: {
      ...(websiteSummaryFromDna ?? {}),
      ...(approvedResearchContext?.websiteSignals ?? {}),
    },
    instagramSummary: {
      handle: input.client.instagramHandle ?? null,
      bioSummary: mergedInstagram?.bio ?? null,
      captionThemes: mergedInstagram?.last_n_caption_snippets?.slice(0, 4) ?? [],
      contentPatterns:
        input.businessDna?.platformSignals?.instagram?.contentPatterns?.slice(0, 4) ??
        mergedInstagram?.last_n_caption_snippets?.slice(0, 4) ??
        [],
      audienceSignals: input.businessDna?.platformSignals.instagram.bioSignals.slice(0, 4) ?? [],
      followerCount: input.businessDna?.platformSignals?.instagram?.engagementSignals?.[0] ?? null,
      ctaPatterns: input.businessDna?.platformSignals?.instagram?.bioSignals?.slice(0, 4) ?? [],
      engagementNotes: input.businessDna?.platformSignals?.instagram?.engagementSignals?.slice(0, 4) ?? [],
      notes: null,
    },
    businessDna: {
      brandNarrative: firstUseful([
        input.businessDna?.purpose,
        input.businessDna?.mission,
        input.businessDna?.positioning.marketAngle,
      ]) || null,
      offerClarity: firstUseful([
        input.businessDna?.offers.transformationPromise,
        input.businessDna?.positioning.valueProposition,
      ]) || null,
      audienceCore: input.businessDna?.targetAudience.segments.slice(0, 3).join(", ") || null,
      voiceAndTone: input.businessDna?.voice_tone || null,
      positioningEdge: input.businessDna?.positioning.differentiators.slice(0, 2).join(", ") || null,
      contentAngles: input.businessDna?.contentStrategy.contentPillars.slice(0, 6) ?? [],
      risksOrGaps: input.businessDna?.targetAudience.objections.slice(0, 4) ?? [],
    },
    approvedResearchContext: approvedResearchContext ?? null,
    proofConstraints: proofConstraints ?? null,
    downstreamContext: {
      priorStrategySummary: typeof summary.strategy === "string" ? summary.strategy : null,
      pillarPriorities: Array.isArray(summary.pillarPriorities) ? summary.pillarPriorities : [],
      monthlyGoals: Array.isArray(summary.monthlyGoals) ? summary.monthlyGoals : [],
    },
    generationMode: "section_patch",
    sectionPatchRequest: {
      sectionKey: input.sectionKey,
      reason: input.reason ?? null,
      preserveContext: {
        currentSection:
          ((input.structured.canonicalSections as Record<string, unknown> | undefined) ?? {})[input.sectionKey] ?? "",
      },
    },
  };

  const template = await loadPromptTemplate("strategy/v1-patch");
  const prompt = injectPromptVariables(
    template,
    { INPUT_JSON: JSON.stringify(patchPayload) },
    { requiredKeys: ["INPUT_JSON"] },
  );
  const parsed = await getStrictJsonWithRetry<StrategyPatchResponse>(input.provider, {
    contextLabel: `strategy section patch:${input.sectionKey}`,
    maxOutputTokens: 700,
    messages: [
      { role: "user", content: prompt },
    ],
  });
  const sectionValue = sanitizeClientFacingText(
    String(parsed.patch?.sectionValue ?? "").trim(),
    input.client.name,
    resolvedBrandName,
  );
  const returnedKey = String(parsed.patch?.sectionKey ?? "").trim();
  if (returnedKey !== input.sectionKey) {
    throw new Error(`Patch returned wrong section key: expected ${input.sectionKey}, got ${returnedKey || "(empty)"}`);
  }
  if (!sectionValue) {
    throw new Error("Patch returned empty section text");
  }
  return sectionValue;
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
  void dna;
  return sections;
}

function joinStrategyLines(lines: Array<string | null | undefined>): string {
  return lines.map((line) => String(line ?? "").trim()).filter(Boolean).join("\n");
}

function cleanCanonicalSectionText(text: string): string {
  return text
    .replace(/â€”/g, "—")
    .replace(/â€¢/g, "•")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSectionComparison(text: string): string {
  return cleanCanonicalSectionText(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const single = stringValue(value);
  return single ? [single] : [];
}

function bulletLines(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

function sentenceCase(text: string): string {
  const clean = text.trim();
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function ensureSentence(text: string): string {
  const clean = cleanCanonicalSectionText(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (/[.!?]$/.test(clean)) return sentenceCase(clean);
  return `${sentenceCase(clean)}.`;
}

function splitCanonicalLines(text: string): string[] {
  return cleanCanonicalSectionText(text)
    .split(/\n+/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return cleanCanonicalSectionText(text)
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function replaceDetectorPhrases(text: string): string {
  return text
    .replace(/testimonials mentioned on site/gi, "customer proof is visible")
    .replace(/case studies mentioned on site/gi, "case-study evidence is available")
    .replace(/certifications referenced/gi, "trust markers are visible")
    .replace(/trusted-by brand block/gi, "brand credibility cues are present")
    .replace(/review or rating language present/gi, "review-based credibility is visible")
    .replace(/direct cta language present on site/gi, "clear conversion language is already present")
    .replace(/audience-specific copy appears on site/gi, "audience-directed messaging is already present");
}

function isDetectorResidueLine(line: string): boolean {
  const normalized = normalizeSectionComparison(line);
  if (!normalized) return true;
  return [
    "website signals",
    "instagram signals",
    "business dna",
    "website discovery",
    "instagram data",
    "proof angles",
    "conversion signals",
    "trust signals to repeat",
    "primary offers",
    "deliverables",
    "scope of work",
    "shop cta present",
    "booking cta present",
    "contact cta present",
    "quiz or assessment cta present",
    "consultation cta present",
  ].some((pattern) => normalized.includes(pattern));
}

function stripCanonicalNoise(sectionKey: string, text: string): string {
  const lines = splitCanonicalLines(replaceDetectorPhrases(text));
  const cleanedLines = lines
    .filter((line) => !isDetectorResidueLine(line))
    .filter((line) => {
      const normalized = normalizeSectionComparison(line);
      if (sectionKey === "marketNarrative") {
        return !/^for this audience the friction shows up as$/.test(normalized);
      }
      if (sectionKey === "emotionalDrivers") {
        return !/\b(tone|personality|archetype|voice)\b/.test(normalized);
      }
      return true;
    });
  return cleanCanonicalSectionText(cleanedLines.join("\n"));
}

function normalizeLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\bcta\b/gi, "CTA")
    .replace(/\bkpis\b/gi, "KPIs")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseLabeledLines(text: string): Array<{ label: string; value: string }> {
  const lines = splitCanonicalLines(text);
  const entries: Array<{ label: string; value: string }> = [];
  let currentLabel = "";
  let currentValues: string[] = [];

  const flush = () => {
    if (!currentLabel || currentValues.length === 0) return;
    entries.push({
      label: normalizeLabel(currentLabel),
      value: ensureSentence(currentValues.join("; ")),
    });
    currentLabel = "";
    currentValues = [];
  };

  for (const line of lines) {
    const inlineMatch = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (inlineMatch) {
      flush();
      entries.push({
        label: normalizeLabel(inlineMatch[1] ?? ""),
        value: ensureSentence(inlineMatch[2] ?? ""),
      });
      continue;
    }

    const labelOnlyMatch = line.match(/^([^:]{2,40}):\s*$/);
    if (labelOnlyMatch) {
      flush();
      currentLabel = labelOnlyMatch[1] ?? "";
      currentValues = [];
      continue;
    }

    if (currentLabel) {
      currentValues.push(line);
    }
  }

  flush();
  return entries;
}

function normalizeBulletLine(line: string): string {
  const match = line.match(/^([^:]{2,40}):\s*(.+)$/);
  if (!match) return ensureSentence(line);
  const label = normalizeLabel(match[1] ?? "");
  const value = String(match[2] ?? "").trim();
  return `${label}: ${value.replace(/[.!?]$/, "")}`;
}

function toSummaryAndBullets(
  text: string,
  options?: { summary?: string; maxBullets?: number },
): string {
  const normalized = stripCanonicalNoise("", text);
  if (!normalized) return "";
  const rawLines = splitCanonicalLines(normalized);
  const firstLine = rawLines[0] ?? "";
  const leadingSummary =
    firstLine && !/^([^:]{2,40}):\s*(.+)?$/.test(firstLine) ? ensureSentence(firstLine) : "";
  const labeled = parseLabeledLines(normalized);
  let summary = options?.summary ? ensureSentence(options.summary) : leadingSummary;
  let bullets: string[] = [];

  if (labeled.length > 0) {
    if (!summary) summary = labeled[0]?.value ?? "";
    bullets = labeled.map((entry) => `${entry.label}: ${entry.value.replace(/[.!?]$/, "")}`);
  } else {
    const lines = rawLines;
    const sentences = splitSentences(normalized);
    const source = lines.length > 1 ? lines : sentences;
    if (!summary) summary = ensureSentence(source[0] ?? "");
    bullets = source.slice(1).map(normalizeBulletLine);
  }

  const uniqueBullets: string[] = [];
  const seen = new Set<string>();
  for (const bullet of bullets) {
    const normalizedBullet = normalizeSectionComparison(bullet);
    if (!normalizedBullet || seen.has(normalizedBullet)) continue;
    if (summary && normalizeSectionComparison(summary).includes(normalizedBullet)) continue;
    seen.add(normalizedBullet);
    uniqueBullets.push(`- ${bullet}`);
  }

  const limitedBullets = uniqueBullets.slice(0, Math.max(2, Math.min(options?.maxBullets ?? 5, 5)));
  if (!summary) return limitedBullets.join("\n");
  if (limitedBullets.length === 0) return summary;
  return `${summary}\n${limitedBullets.join("\n")}`;
}

function finalizeCanonicalSectionText(sectionKey: string, text: string): string {
  const stripped = stripCanonicalNoise(sectionKey, text);
  if (!stripped) return "";

  switch (sectionKey) {
    case "marketNarrative":
      return toSummaryAndBullets(stripped, { maxBullets: 5 });
    case "brandFoundation":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    case "audience":
      return toSummaryAndBullets(stripped, { maxBullets: 5 });
    case "emotionalDrivers":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    case "kpis":
      return toSummaryAndBullets(stripped, {
        summary: "Performance should be tracked through business-facing metrics across awareness, engagement, trust, conversion, and retention.",
        maxBullets: 5,
      });
    case "platformStrategy":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    case "contentStrategy":
      return toSummaryAndBullets(stripped, { maxBullets: 5 });
    case "trackingPlan":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    case "executionPhases":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    case "assetRequirements":
      return toSummaryAndBullets(stripped, { maxBullets: 4 });
    default:
      return stripped;
  }
}

function formatNamedList(label: string, value: unknown): string {
  const items = stringListValue(value);
  return items.length > 0 ? `${label}:\n${bulletLines(items)}` : "";
}

function formatPlatformStrategy(value: unknown): string {
  const record = recordValue(value);
  if (!record) return "";
  const platforms = Array.isArray(record.platforms) ? record.platforms : [];
  const platformLines = platforms
    .map((item) => {
      const entry = recordValue(item);
      if (!entry) return "";
      const platform = stringValue(entry.platform);
      const role = stringValue(entry.role);
      const objective = stringValue(entry.objective);
      const funnel = stringValue(entry.funnel_stage);
      const behavior = stringValue(entry.content_behavior);
      return [
        platform ? `${platform}:` : "",
        role,
        objective ? `Objective: ${objective}` : "",
        funnel ? `Funnel: ${funnel}` : "",
        behavior ? `Behavior: ${behavior}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean);
  return joinStrategyLines([
    platformLines.length > 0 ? bulletLines(platformLines) : "",
    stringValue(record.system_role),
  ]);
}

function formatContentStrategy(value: unknown): string {
  const record = recordValue(value);
  if (!record) return "";
  const pillars = Array.isArray(record.pillars) ? record.pillars : [];
  const pillarLines = pillars
    .map((item) => {
      const entry = recordValue(item);
      if (!entry) return String(item ?? "").trim();
      const name = stringValue(entry.name);
      const angle = stringValue(entry.angle) || stringValue(entry.description);
      return [name, angle].filter(Boolean).join(": ");
    })
    .filter(Boolean);
  return joinStrategyLines([
    pillarLines.length > 0 ? `Pillars:\n${bulletLines(pillarLines)}` : "",
    formatNamedList("Hooks", record.hooks),
    formatNamedList("Formats", record.formats),
    formatNamedList("Proof angles", record.proof_angles),
    stringValue(record.repeatable_system) ? `System: ${stringValue(record.repeatable_system)}` : "",
  ]);
}

function formatKpis(value: unknown): string {
  const record = recordValue(value);
  if (!record) return "";
  return joinStrategyLines([
    formatNamedList("Awareness", record.awareness),
    formatNamedList("Engagement", record.engagement),
    formatNamedList("Trust", record.trust),
    formatNamedList("Conversion", record.conversion),
    formatNamedList("Retention", record.retention),
  ]);
}

function formatTrackingPlan(value: unknown): string {
  const record = recordValue(value);
  if (!record) return "";
  return joinStrategyLines([
    stringValue(record.weekly) ? `Weekly: ${stringValue(record.weekly)}` : "",
    stringValue(record.bi_weekly) ? `Bi-weekly: ${stringValue(record.bi_weekly)}` : "",
    stringValue(record.monthly) ? `Monthly: ${stringValue(record.monthly)}` : "",
    stringValue(record.decision_triggers) ? `Decision triggers: ${stringValue(record.decision_triggers)}` : "",
  ]);
}

function formatPhases(value: unknown): string {
  const phases = Array.isArray(value) ? value : [];
  return phases
    .map((item) => {
      const entry = recordValue(item);
      if (!entry) return String(item ?? "").trim();
      const phase = stringValue(entry.phase) || stringValue(entry.name);
      const objective = stringValue(entry.objective);
      const focus = stringValue(entry.content_focus);
      const signal = stringValue(entry.success_signal);
      return [
        phase ? `${phase}:` : "",
        objective,
        focus ? `Content focus: ${focus}` : "",
        signal ? `Success signal: ${signal}` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function formatAssetRequirements(value: unknown): string {
  const entries = Array.isArray(value) ? value : [];
  const lines = entries
    .map((item) => {
      const entry = recordValue(item);
      if (!entry) return String(item ?? "").trim();
      const asset = stringValue(entry.asset) || stringValue(entry.name);
      const purpose = stringValue(entry.purpose);
      const proof = stringValue(entry.proof_needed);
      return [asset, purpose ? `Purpose: ${purpose}` : "", proof ? `Proof needed: ${proof}` : ""]
        .filter(Boolean)
        .join(" — ");
    })
    .filter(Boolean);
  return lines.length > 0 ? bulletLines(lines) : "";
}

function formatStructuredSection(sectionKey: string, value: unknown): string {
  const asString = stringValue(value);
  if (asString) return finalizeCanonicalSectionText(sectionKey, asString);
  if (Array.isArray(value)) {
    if (sectionKey === "emotionalDrivers") {
      return finalizeCanonicalSectionText(
        sectionKey,
        value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n"),
      );
    }
    return finalizeCanonicalSectionText(
      sectionKey,
      value
      .map((item) => {
        const entry = recordValue(item);
        if (!entry) return String(item ?? "").trim();
        return Object.values(entry).map((part) => String(part ?? "").trim()).filter(Boolean).join(" ");
      })
      .filter(Boolean)
      .join("\n"),
    );
  }
  const record = recordValue(value);
  if (!record) return "";
  switch (sectionKey) {
    case "marketNarrative":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        stringValue(record.category_context),
        stringValue(record.market_shift),
        stringValue(record.consumer_behavior),
        stringValue(record.why_now),
      ]));
    case "problemGapSolution":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        stringValue(record.problem) ? `Problem: ${stringValue(record.problem)}` : "",
        stringValue(record.gap) ? `Gap: ${stringValue(record.gap)}` : "",
        stringValue(record.solution) ? `Solution: ${stringValue(record.solution)}` : "",
      ]));
    case "brandFoundation":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        stringValue(record.mission) ? `Mission: ${stringValue(record.mission)}` : "",
        stringValue(record.core_promise) ? `Core promise: ${stringValue(record.core_promise)}` : "",
        stringValue(record.differentiator) ? `Differentiator: ${stringValue(record.differentiator)}` : "",
        formatNamedList("Non-negotiables", record.non_negotiables),
      ]));
    case "brandPhilosophy":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        stringValue(record.archetype) ? `Archetype: ${stringValue(record.archetype)}` : "",
        stringValue(record.belief_system),
        stringValue(record.personality) ? `Personality: ${stringValue(record.personality)}` : "",
        stringValue(record.tone) ? `Tone: ${stringValue(record.tone)}` : "",
        stringValue(record.emotional_role) ? `Emotional role: ${stringValue(record.emotional_role)}` : "",
        formatNamedList("Avoid", record.avoid_list),
      ]));
    case "audience":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        stringValue(record.primary_audience) ? `Primary audience: ${stringValue(record.primary_audience)}` : "",
        formatNamedList("Priority segments", record.priority_segments),
        formatNamedList("Motivations", record.motivations),
        formatNamedList("Pains and desires", record.pains_and_desires ?? record.pain_points ?? record.desires),
        formatNamedList("Objections", record.objections),
        formatNamedList("Buying triggers", record.buying_triggers),
      ]));
    case "emotionalDrivers":
      return finalizeCanonicalSectionText(sectionKey, joinStrategyLines([
        formatNamedList("Emotional drivers", record.drivers),
        stringValue(record.summary),
      ]));
    case "platformStrategy":
      return finalizeCanonicalSectionText(sectionKey, formatPlatformStrategy(record));
    case "contentStrategy":
      return finalizeCanonicalSectionText(sectionKey, formatContentStrategy(record));
    case "kpis":
      return finalizeCanonicalSectionText(sectionKey, formatKpis(record));
    case "trackingPlan":
      return finalizeCanonicalSectionText(sectionKey, formatTrackingPlan(record));
    case "executionPhases":
      return finalizeCanonicalSectionText(sectionKey, formatPhases(record.phases ?? value));
    case "assetRequirements":
      return finalizeCanonicalSectionText(sectionKey, formatAssetRequirements(record.assets ?? value));
    default:
      return finalizeCanonicalSectionText(
        sectionKey,
        Object.values(record)
        .map((part) => (Array.isArray(part) ? stringListValue(part).join(", ") : String(part ?? "").trim()))
        .filter(Boolean)
        .join("\n"),
      );
  }
}

function extractCanonicalSectionsFromStructured(structured: Record<string, unknown>): Partial<Record<string, string>> {
  const canonical = ((structured.canonicalSections ?? {}) as Record<string, unknown> | undefined) ?? {};
  return {
    marketNarrative: formatStructuredSection("marketNarrative", canonical.marketNarrative ?? structured.market_narrative),
    problemGapSolution: formatStructuredSection("problemGapSolution", canonical.problemGapSolution ?? structured.problem_gap_solution),
    brandFoundation: formatStructuredSection("brandFoundation", canonical.brandFoundation ?? structured.brand_foundation),
    brandPhilosophy: formatStructuredSection("brandPhilosophy", canonical.brandPhilosophy ?? structured.brand_philosophy),
    audience: formatStructuredSection("audience", canonical.audience ?? structured.audience),
    emotionalDrivers: formatStructuredSection("emotionalDrivers", canonical.emotionalDrivers ?? structured.emotional_drivers),
    platformStrategy: formatStructuredSection("platformStrategy", canonical.platformStrategy ?? structured.platform_strategy),
    contentStrategy: formatStructuredSection("contentStrategy", canonical.contentStrategy ?? structured.content_strategy),
    kpis: formatStructuredSection("kpis", canonical.kpis ?? structured.kpis),
    trackingPlan: formatStructuredSection("trackingPlan", canonical.trackingPlan ?? structured.tracking_plan),
    executionPhases: formatStructuredSection("executionPhases", canonical.executionPhases ?? structured.phases),
    assetRequirements: formatStructuredSection("assetRequirements", canonical.assetRequirements ?? structured.asset_requirements),
  };
}

function isLikelyRawSourceDump(sectionKey: string, text: string): boolean {
  const normalized = normalizeSectionComparison(text);
  if (!normalized) return false;
  const rawPatterns = [
    "website signals",
    "instagram signals",
    "business dna",
    "website discovery",
    "instagram data",
    "testimonials mentioned on site",
    "case studies mentioned on site",
    "certifications referenced",
    "trusted by brand block",
    "review or rating language present",
    "booking cta present",
    "shop cta present",
    "contact cta present",
    "quiz or assessment cta present",
    "consultation cta present",
  ];
  if (rawPatterns.some((pattern) => normalized.includes(pattern))) return true;
  if (sectionKey === "assetRequirements" && (normalized.startsWith("deliverables ") || normalized.startsWith("primary offers "))) {
    return true;
  }
  return false;
}

function isWrongSectionContent(sectionKey: string, text: string): boolean {
  const normalized = normalizeSectionComparison(text);
  if (!normalized) return false;
  if (/\bwhy the of\b|\.\.\./.test(normalized)) {
    return true;
  }
  if (sectionKey === "platformStrategy" && (normalized.includes("website signals") || normalized.includes("instagram signals"))) {
    return true;
  }
  if (sectionKey === "kpis" && (normalized.includes("testimonial") || normalized.includes("proof angles"))) {
    return true;
  }
  if (sectionKey === "kpis" && /mentioned on site|cta present|trust markers are visible/.test(normalized)) {
    return true;
  }
  if (
    sectionKey === "contentStrategy" &&
    (normalized.includes("weekly review") || normalized.includes("bi weekly") || normalized.includes("monthly review"))
  ) {
    return true;
  }
  if (sectionKey === "marketNarrative" && /problem:|gap:|solution:|mission:|core promise:/.test(normalized)) {
    return true;
  }
  if (
    sectionKey === "marketNarrative" &&
    normalized.split(" ").length < 18
  ) {
    return true;
  }
  if (sectionKey === "assetRequirements" && (normalized.includes("scope of work") || normalized.includes("primary offers"))) {
    return true;
  }
return false;
}

function filterPlatformStrategy(text: string, activePlatforms: string[]): string {
  if (!text) {
    return "";
  }
  const allKnownPlatforms = ["instagram", "pinterest", "linkedin", "twitter", "x", "youtube", "tiktok", "facebook"];
  let platformsToRemove: string[];
  
  if (!activePlatforms || activePlatforms.length === 0) {
    platformsToRemove = allKnownPlatforms;
  } else {
    const normalizedActive = activePlatforms.map(p => p.toLowerCase().trim());
    platformsToRemove = allKnownPlatforms.filter(p => !normalizedActive.some(ap => ap.includes(p) || p.includes(ap)));
  }
  
  let filtered = text;
  for (const platform of platformsToRemove) {
    const regex = new RegExp(`\\b${platform}\\b(?!\\w)`, "gi");
    filtered = filtered.replace(regex, "___REMOVED___");
  }
  filtered = filtered.replace(/___REMOVED___\s*(?::|,|\.)?\s*/gi, "").replace(/\s+/g, " ").trim();
  return filtered;
}

function mirrorsClientSource(
  text: string,
  client: Pick<MemoryClient, "website" | "instagramHandle" | "oneLineDescription">,
): boolean {
  const normalized = normalizeSectionComparison(text);
  if (!normalized) return false;
  const oneLine = normalizeSectionComparison(client.oneLineDescription ?? "");
  if (oneLine && oneLine.length > 32 && (normalized === oneLine || normalized.includes(oneLine))) {
    return true;
  }
  const website = normalizeSectionComparison(client.website ?? "");
  if (website && website.length > 12 && normalized === website) return true;
  const handle = normalizeSectionComparison(client.instagramHandle ?? "");
  return Boolean(handle && handle.length > 3 && normalized === handle);
}

function hasMinimumUsefulContent(sectionKey: string, text: string): boolean {
  const normalized = cleanCanonicalSectionText(text);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const thresholds: Record<string, number> = {
    marketNarrative: 30,
    problemGapSolution: 28,
    brandFoundation: 24,
    brandPhilosophy: 24,
    audience: 24,
    emotionalDrivers: 16,
    platformStrategy: 30,
    contentStrategy: 30,
    kpis: 22,
    trackingPlan: 18,
    executionPhases: 18,
    assetRequirements: 18,
  };
  return wordCount >= (thresholds[sectionKey] ?? 12);
}

function hasSectionSignals(sectionKey: string, text: string): boolean {
  const normalized = normalizeSectionComparison(text);
  if (!normalized) return false;
  switch (sectionKey) {
    case "marketNarrative":
      return (
        [/\bmarket\b/, /\bcategory\b/, /\baudience\b/, /\bshift\b|\bopportunity\b|\bwhitespace\b/].filter((pattern) =>
          pattern.test(normalized),
        ).length >= 3
      );
    case "brandFoundation":
      return (
        ["mission", "core promise", "differentiator", "non negotiables"].filter((token) =>
          normalized.includes(token),
        ).length >= 2
      );
    case "audience":
      return (
        ["primary audience", "priority segments", "motivations", "buying triggers"].filter((token) =>
          normalized.includes(token),
        ).length >= 3
      );
    case "emotionalDrivers":
      return (
        !/\btone\b|\bpersonality\b|\bvoice\b/.test(normalized) &&
        /\b(confidence|trust|relief|certainty|belonging|status|fear|anxiety|desire|aspiration)\b/.test(normalized)
      );
    case "kpis":
      return (
        ["awareness", "engagement", "trust", "conversion", "retention"].filter((token) =>
          normalized.includes(token),
        ).length >= 3
      );
    default:
      return true;
  }
}

function validateCanonicalSection(
  sectionKey: string,
  text: string,
  client?: Pick<MemoryClient, "website" | "instagramHandle" | "oneLineDescription">,
): string {
  const cleaned = finalizeCanonicalSectionText(sectionKey, text);
  if (!cleaned) return "";
  if (isLikelyRawSourceDump(sectionKey, cleaned)) return "";
  if (isWrongSectionContent(sectionKey, cleaned)) return "";
  if (client && mirrorsClientSource(cleaned, client)) return "";
  if (!hasMinimumUsefulContent(sectionKey, cleaned)) return "";
  if (!hasSectionSignals(sectionKey, cleaned)) return "";
  return cleaned;
}

function dedupeCanonicalSections(
  sections: Record<string, string>,
  fallbackCanonical: Record<string, string>,
): Record<string, string> {
  const seen = new Set<string>();
  const next = { ...sections };
  for (const key of CANONICAL_SECTION_KEYS) {
    const normalized = normalizeSectionComparison(next[key] ?? "");
    if (!normalized) {
      next[key] = fallbackCanonical[key];
      continue;
    }
    if (seen.has(normalized)) {
      next[key] = fallbackCanonical[key];
      continue;
    }
    seen.add(normalized);
  }
  return next;
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
  const monthlyPosts = readMonthlyPosts(sow);
  const toneByPlatform = readToneByPlatform(sow);
  const contentMix = readContentMix(sow);
  const platforms = readSelectedPlatforms(sow);

  const built = buildBootstrapSectionText({
    client: input.client,
    dna,
    sow,
    platforms,
    monthlyPosts,
    contentMix,
    toneByPlatform,
    fallback: base,
  });
const result: Record<string, string> = {};
  for (const key of CANONICAL_SECTION_KEYS) {
    const finalized = finalizeCanonicalSectionText(key, String(built[key] ?? ""));
    const candidate =
      finalized && !isLikelyRawSourceDump(key, finalized) ? finalized : "";
    const fallbackValue =
      validateCanonicalSection(key, String(base[key] ?? ""), input.client) ||
      finalizeCanonicalSectionText(key, String(base[key] ?? ""));
    let finalValue = candidate || fallbackValue;
    if (key === "platformStrategy" && platforms.length > 0) {
      finalValue = filterPlatformStrategy(finalValue, platforms);
    }
    result[key] = finalValue;
  }
  return result as Record<string, string>;
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
  const derivedCanonical = extractCanonicalSectionsFromStructured(structured);
  let canonicalSections = Object.fromEntries(
    CANONICAL_SECTION_KEYS.map((key) => {
      const preferred = validateCanonicalSection(key, String(derivedCanonical[key] ?? ""), client);
      const fallback =
        validateCanonicalSection(key, String(fallbackCanonical[key] ?? ""), client) ||
        buildSectionVariantText(key, client, 0);
      return [key, preferred || fallback];
    }),
  ) as Record<string, string>;
  canonicalSections = mergeBusinessDnaIntoCanonical(businessDna, canonicalSections);
  canonicalSections = dedupeCanonicalSections(canonicalSections, fallbackCanonical);
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
const businessType = client.oneLineDescription?.toLowerCase() || "";
  const isServiceOrAgency = businessType.includes("service") || businessType.includes("agency") || businessType.includes("consulting") || businessType.includes("coach") || businessType.includes("expert") || businessType.includes("firm");
  const isD2C = businessType.includes("product") || businessType.includes("brand") || businessType.includes("store") || businessType.includes("shop") || businessType.includes("retail");
  
  const variants: Record<string, string[]> = {
    marketNarrative: [
      `${client.name} operates in a competitive market where differentiation and audience relevance are key. Building a clear positioning that resonates with target customers is essential for growth.`,
      `${client.name} is establishing its presence in the market. A strong narrative that connects with audience needs and demonstrates unique value will drive sustainable growth.`,
      `${client.name} has an opportunity to capture market attention through clear positioning and consistent messaging that addresses audience pain points and desires.`,
    ],
    problemGapSolution: [
      `Problem: target audience faces challenges that ${client.name} can address.\nGap: unclear differentiation or messaging in the market.\nSolution: ${client.name} provides clarity and value through its unique approach.`,
      `Problem: potential customers struggle to find solutions that meet their specific needs.\nGap: limited awareness of available options.\nSolution: ${client.name} offers a compelling alternative with clear benefits.`,
      `Problem: market lacks clear, trustworthy options for the target audience.\nGap: confusion about what constitutes quality or value.\nSolution: ${client.name} clarifies the choice with transparent positioning.`,
    ],
    brandFoundation: [
      `Mission: deliver value that solves customer problems effectively.\nVision: be the preferred choice for target audience needs.\nValues: quality, reliability, customer focus, continuous improvement.`,
      `Mission: help customers achieve their goals through our offerings.\nVision: build lasting relationships based on trust and results.\nValues: integrity, excellence, innovation, service orientation.`,
      `Mission: create meaningful impact for customers through our work.\nVision: establish recognized excellence in our market segment.\nValues: professionalism, creativity, collaboration, results-driven.`,
    ],
    brandPhilosophy: [
      `${client.name} believes in delivering genuine value and building trust through consistent quality and customer-focused approach.`,
      `${client.name} is committed to excellence and continuous improvement while maintaining authentic connection with the audience.`,
      `${client.name} focuses on practical solutions and measurable results while building long-term relationships.`,
    ],
    audience: [
      `Primary: target customers who need the solutions ${client.name} provides.\nSecondary: broader market segments that could benefit.\nMotivations: solving problems, achieving goals, getting value for investment.`,
      `Primary: audience seeking quality solutions in the market space.\nSecondary: potential customers exploring options.\nNeeds: clarity, trust, reliable options, proof of value.`,
      `Primary: customers with specific needs that ${client.name} addresses.\nSecondary: related audience segments.\nDesires: solutions that work, good value, trustworthy providers.`,
    ],
    emotionalDrivers: [
      `Confidence in choice\nRelief from problem frustration\nTrust in provider\nDesire for better outcomes`,
      `Security in decision\nAspiration for results\nFrustration with current options\nHope for improvement`,
      `Peace of mind\nControl over outcomes\nBelonging to community\nAchievement of goals`,
    ],
    platformStrategy: [
      `Instagram: primary platform for content and community building.\nFocus: consistent posting, audience engagement, content that resonates.\nStrategy: build presence through valuable content and interaction.`,
      `Instagram: key platform for reach and engagement.\nApproach: regular content, stories, reels for visibility.\nGoal: grow following and build community around the brand.`,
      `Instagram: main channel for brand presence and audience connection.\nMethod: varied content formats, engagement tactics, consistent messaging.`,
    ],
    contentStrategy: [
      `Pillars: value-driven content, brand messaging, audience engagement.\nFormats: mix of content types suited to platform and audience.\nVoice: authentic, helpful, consistent.`,
      `Pillars: education, connection, proof of value.\nFormats: varied content to maintain interest and provide value.\nTone: professional yet approachable.`,
      `Pillars: content that serves audience needs, brand storytelling, social proof.\nFormats: platform-appropriate content mix.\nVoice: genuine, knowledgeable, customer-focused.`,
    ],
    kpis: [
      `Follower growth and reach\nEngagement rate and quality\nContent performance metrics\nAudience growth and retention`,
      `Reach and impressions\nEngagement and interactions\nContent effectiveness\nAudience sentiment and growth`,
      `Brand awareness metrics\nEngagement levels\nContent ROI\nCustomer acquisition and retention`,
    ],
    trackingPlan: [
      `Weekly: content performance, engagement metrics, audience growth.\nBi-weekly: top performing content, audience insights.\nMonthly: comprehensive analysis and strategy adjustment.`,
      `Track: key metrics across platforms and content types.\nCadence: regular review cycles for optimization.\nFocus: metrics that indicate growth and engagement.`,
      `Monitor: reach, engagement, growth, and conversion metrics.\nFrequency: weekly and monthly reviews.\nPurpose: continuous improvement of content strategy.`,
    ],
    executionPhases: [
      `Phase 1: establish presence and consistent content baseline.\nPhase 2: grow audience and refine messaging based on feedback.\nPhase 3: optimize for engagement and conversion.`,
      `Phase 1: build foundation with consistent posting.\nPhase 2: expand reach and deepen audience engagement.\nPhase 3: maximize impact through data-driven optimization.`,
      `Phase 1: launch and establish presence.\nPhase 2: grow and engage audience.\nPhase 3: refine and scale successful approaches.`,
    ],
    assetRequirements: [
      `Content creation templates\nBrand messaging guidelines\nEngagement response framework\nAnalytics tracking setup`,
      `Content calendar and planning\nVisual identity elements\nCopy and messaging library\nPerformance tracking tools`,
      `Content templates\nBrand guidelines\nEngagement strategy\nMeasurement framework`,
    ],
  };
  let choices = variants[sectionKey] ?? [`${sectionKey} strategy section for ${client.name}.`];
  
  if (isServiceOrAgency && sectionKey === "platformStrategy") {
    choices = [
      `Instagram: primary platform for content and community building.\nFocus: consistent posting, audience engagement, content that resonates.\nStrategy: build presence through valuable content and interaction.`,
      `Instagram: key platform for reach and engagement.\nApproach: regular content, stories, reels for visibility.\nGoal: grow following and build community around the brand.`,
      `Instagram: main channel for brand presence and audience connection.\nMethod: varied content formats, engagement tactics, consistent messaging.`,
    ];
  } else if (isServiceOrAgency && sectionKey === "contentStrategy") {
    choices = [
      `Pillars: value-driven content, brand messaging, audience engagement.\nFormats: mix of content types suited to platform and audience.\nVoice: authentic, helpful, consistent.`,
      `Pillars: education, connection, proof of value.\nFormats: varied content to maintain interest and provide value.\nTone: professional yet approachable.`,
      `Pillars: content that serves audience needs, brand storytelling, social proof.\nFormats: platform-appropriate content mix.\nVoice: genuine, knowledgeable, customer-focused.`,
    ];
  }
  
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

export function getMemoryOnboardingForWorkflow(clientId: string): MemoryOnboarding | null {
  return memoryOnboarding.get(clientId) ?? null;
}

export function getMemoryStrategyForWorkflow(clientId: string): MemoryStrategy | null {
  return memoryStrategies.get(clientId) ?? null;
}
