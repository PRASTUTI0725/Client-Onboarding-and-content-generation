import { createHash } from "node:crypto";
import { getLLMProvider, type LLMProvider } from "../llm/index.js";
import { createLLMProvider } from "../llm/factory.js";
import { getStrictJsonWithRetry, JsonStageFailureError } from "../llm/json-retry.js";
import { assertPromptWithinBudget, buildPromptBudgetStats, estimateTokens, PromptBudgetError, trimToTokenBudget } from "../llm/prompt-budget.js";
import { checkOpenRouterCreditsAvailable } from "../llm/provider-health.js";
import { classifyProviderError } from "../llm/provider-errors.js";
import { FallbackProvider, type ProviderAttemptDiagnostic } from "../llm/fallback-provider.js";
import { buildPillarMeta, type PillarMeta } from "./pillars.js";
import { buildPostDetailPayload } from "./post-detail.js";
import {
  attachCalendarGenerationTrace,
  getLastCalendarGenerationTrace,
  publishCalendarGenerationTrace,
  resetCalendarGenerationTrace,
  snapshotStageBudget,
  type CalendarGenerationTrace,
} from "./calendar-generation-trace.js";
import {
  buildCompactCalendarContext,
  buildCompactCalendarWeekContext,
  buildPlannerPromptFromCompactContext,
  buildWeeklyPromptPartsFromCompact,
  type CompactCalendarWeekContext,
  type CalendarCompactionTier,
} from "./compact-calendar-context.js";
import {
  calendarWeekStaggerMs,
  isCalendarRequestWithinGroqBudget,
  normalizeCalendarProviderId,
  resolveCalendarMaxOutputTokens,
  resolveCalendarTargetInputTokens,
  resolveCalendarWeekConcurrency,
  resolveGroqWeekCallDelayMs,
  CALENDAR_REPAIR_MAX_OUTPUT,
} from "./provider-budget.js";
import { GroqRunTokenPacer } from "./groq-run-pacer.js";
import {
  buildTier3WeekBrief,
  compactWeeklyBriefForProvider,
  enforceWeeklyInputBeforeProviderCall,
  isGroqRateLimitError,
} from "./weekly-generation-budget.js";
import { buildWeeklyInstructionBlock } from "./weekly-prompt.js";
import type { BusinessDna } from "../business-dna.js";
import type {
  InstagramSummary,
  WebsiteSummary,
} from "../extraction/summaries.js";

export interface SowInput {
  platforms: string[];
  monthlyPosts: Record<string, number>;
  contentMix: Record<string, number>;
  deliverables: string[];
  toneByPlatform: Record<string, string>;
}

export interface MonthlyBrief {
  month: string;
  startDate: string;
  goal: string;
  notes: string;
}

export interface CalendarBrief {
  client: {
    name: string;
    businessType: string | null;
    strategyType: string;
    oneLinePositioning: string | null;
    offer: string | null;
    productTruths: string[];
    differentiators: string[];
    specificReferences: string[];
    paidScopeExplicit: boolean;
  };
  requirements: {
    month: string;
    startDate: string;
    totalPosts: number;
    platforms: string[];
    platformCounts: Record<string, number>;
    contentBuckets: Record<string, number>;
    deliverables: string[];
    hardConstraints: string[];
  };
  audience: {
    primarySegments: string[];
    stage: string | null;
    pains: string[];
    desires: string[];
    objections: string[];
  };
  brandVoice: {
    tone: string | null;
    personality: string | null;
    avoidList: string[];
  };
  contentPillars: Array<{ name: string; angle?: string }>;
  platformStrategy: Array<{
    platform: string;
    role: string;
    objective: string;
    contentBehavior: string;
  }>;
  strategicContext: {
    jtaContentStrategySummary: string | null;
    jtaPlatformStrategySummary: string | null;
  };
  weeklyFlow: string[];
  ctaStyleByPlatform: Record<string, string>;
  kpis: string[];
  trustSignals: string[];
  proofContract: {
    proofAssetsAvailable: boolean;
    availableProofTypes: string[];
    testimonialStyleAllowed: boolean;
  };
  safety: {
    forbiddenTerms: string[];
    healthClaimSafetyMode: "standard" | "wellness_beauty_softened";
    paidAllowed: boolean;
  };
  planningContext: {
    monthlyGoal: string | null;
    normalizedNotes: string[];
  };
}

export interface BuildCalendarBriefInput {
  brandName: string;
  enriched: Record<string, unknown>;
  structured: Record<string, unknown>;
  sow: SowInput;
  brief: MonthlyBrief;
  extraction?: {
    businessDna?: BusinessDna | null;
    websiteSummary?: WebsiteSummary | null;
    instagramSummary?: InstagramSummary | null;
    strategySummary?: string | null;
    pillarPriorities?: string[] | null;
    monthlyGoals?: string[] | null;
    strategyType?: string | null;
  };
}

export interface PlannerLayer {
  distribution: Record<string, number>;
  formats: Record<string, number>;
  platformSplit: Record<string, number>;
  angleBank: Record<string, string[]>;
  hookStyles: string[];
  weeklyFlow: Record<string, string>;
  pillars: PillarMeta[];
  kpis: Record<string, string>;
  phases: Array<{ name: string; focus: string }>;
  metadata?: Record<string, unknown>;
}

export type Priority = "high" | "medium" | "low";

export interface CalendarSkeletonPost {
  date: string;
  week: "week_1" | "week_2" | "week_3" | "week_4";
  platform: string;
  pillar: string;
  format: string;
  topic: string;
  repurposeTargets?: string[];
  objective: string;
  hook: string;
  cta: string;
  strategicAngle?: string;
  audienceTension?: string;
  specificReference?: string;
  proofMode?: string;
  proofSource?: string;
  claimSafetyNote?: string;
  priority: Priority;
  status: "draft";
}

interface WeeklyCalendarBrief {
  clientName: string;
  businessType: string | null;
  strategyType: string;
  positioningLine: string | null;
  offer: string | null;
  truths: string[];
  differentiators: string[];
  specificReferences: string[];
  segments: string[];
  pains: string[];
  desires: string[];
  objections: string[];
  activePlatforms: string[];
  activePlatformStrategy: Array<{
    platform: string;
    role: string;
    objective: string;
    contentBehavior: string;
  }>;
  weekStartDate: string;
  weekLabel: string;
  weeklyTotalPosts: number;
  weeklyPlatformTargets: Record<string, number>;
  bucketTargets: Record<string, number>;
  requiredBuckets: string[];
  themes: string[];
  allowedAngles: string[];
  brandVoice: string[];
  jtaContentStrategySummary: string | null;
  jtaPlatformStrategySummary: string | null;
  executionPhase: string | null;
  proofAssetsAvailable: boolean;
  availableProofTypes: string[];
  testimonialStyleAllowed: boolean;
  hardConstraints: string[];
  forbiddenTerms: string[];
  healthClaimSafetyMode: "standard" | "wellness_beauty_softened";
  paidAllowed: boolean;
  monthlyGoal: string | null;
  normalizedNotes: string[];
  weeklyFocus: string | null;
}

export interface CalendarPost {
  date: string;
  platform: string;
  pillar: string;
  angle: string;
  format: string;
  repurposeTargets?: string[];
  objective: string;
  hook: string;
  cta: string;
  caption?: string | null;
  hashtags?: string[] | null;
  strategicIntent: string;
  expectedMetric: string;
  expectedReason: string;
  priority: Priority;
  execution: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GenerationResult {
  planner: PlannerLayer;
  posts: CalendarPost[];
}

interface BucketRepairChange {
  index: number;
  date: string;
  platform: string;
  format: string;
  fromBucket: string;
  toBucket: string;
  reason: string;
}

interface BucketRepairSummary {
  attempted: boolean;
  succeeded: boolean;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  changes: BucketRepairChange[];
}

interface RepairRequest {
  index: number;
  post: CalendarPost;
  issues: Array<{ code: string; field: string }>;
  targetBucket?: string;
}

type ValidationDiagnostics = {
  runMode: string;
  stage: "initial_validation" | "repair_failed" | "post_repair_validation";
  invalidPostIndexes: number[];
  fieldCounts: Record<string, number>;
  issueCounts: Record<string, number>;
  repairReason?: string | null;
  repairBatchSize?: number;
  repairBatchCount?: number;
  repairProvider?: { provider: string; model: string } | null;
  creditsStateBeforeRepair?: { usable: boolean; reason: string } | null;
  fieldRepairAttempted?: boolean;
  fieldRepairSucceeded?: boolean;
  fieldRepairCount?: number;
};

type BusinessFamily = "fragrance_beauty" | "agency_marketing" | "product_brand" | "service_brand";

class CalendarValidationError extends Error {
  readonly repairAttempted: boolean;
  readonly repairSucceeded: boolean;
  readonly repairChanges: BucketRepairChange[];
  readonly validationDiagnostics: ValidationDiagnostics | null;

  constructor(
    message: string,
    details?: {
      repairAttempted?: boolean;
      repairSucceeded?: boolean;
      repairChanges?: BucketRepairChange[];
      validationDiagnostics?: ValidationDiagnostics | null;
    },
  ) {
    super(message);
    this.name = "CalendarValidationError";
    this.repairAttempted = details?.repairAttempted === true;
    this.repairSucceeded = details?.repairSucceeded === true;
    this.repairChanges = details?.repairChanges ?? [];
    this.validationDiagnostics = details?.validationDiagnostics ?? null;
  }
}

const CALENDAR_RELIABLE_MODE = "reliable_v1";

function isCalendarPromptBudgetGuardEnabled(): boolean {
  const value =
    process.env.CALENDAR_LOCAL_BUDGET_GUARD?.trim().toLowerCase() ??
    process.env.ENABLE_CALENDAR_PROMPT_BUDGET_GUARD?.trim().toLowerCase() ??
    "true";
  if (value === "0" || value === "false" || value === "no") return false;
  return value === "1" || value === "true" || value === "yes";
}

export type CalendarBudgetDiagnostics = {
  compactionTier: CalendarCompactionTier;
  estimatedInputTokens: number;
  maxInputTokens: number;
  estimatedOutputTokens: number;
  promptSegments?: Array<{ label: string; chars: number; estimatedTokens: number }>;
  stage?: string;
};

function resolvePrimaryCalendarProviderId(provider: LLMProvider): string {
  if (provider instanceof FallbackProvider) {
    const first = provider.getConfiguredProviders()[0];
    return normalizeCalendarProviderId(first?.provider ?? provider.id);
  }
  const info = provider.describe?.() ?? { provider: provider.id, model: "default" };
  return normalizeCalendarProviderId(info.provider);
}

function attachCalendarBudgetDiagnostics(err: unknown, diagnostics: CalendarBudgetDiagnostics): void {
  if (err && typeof err === "object") {
    (err as { calendarBudgetDiagnostics?: CalendarBudgetDiagnostics }).calendarBudgetDiagnostics = diagnostics;
  }
}

const PLANNER_SYSTEM = `You are a senior social strategist. Return STRICT compact JSON only.
Output:
{
  "planner": {
    "distribution": { "<pillar_key>": <number> },
    "formats": { "<format_key>": <number> },
    "platformSplit": { "<platform>": <number> },
    "angleBank": { "<pillar_key>": ["...", "..."] },
    "hookStyles": ["...", "..."],
    "weeklyFlow": { "week_1": "...", "week_2": "...", "week_3": "...", "week_4": "..." },
    "kpis": { "<metric>": "<target/definition>" },
    "phases": [{ "name": "Week 1", "focus": "..." }]
  }
}
Rules: concise values only.`;

const REPAIR_POSTS_SYSTEM = `You repair invalid monthly planning skeleton posts. Return STRICT JSON only:
{
  "posts": [
    {
      "index": 0,
      "bucket": "<canonical bucket label>",
      "theme": "<specific strategic theme>",
      "objective": "<short objective>",
      "hook": "<short hook>",
      "cta": "<cta direction>",
      "strategicAngle": "<short strategic angle>",
      "audienceTension": "<short audience tension>",
      "specificReference": "<specific reference>",
      "proofMode": "<safe proof mode>",
      "proofSource": "<proof source>",
      "claimSafetyNote": "<claim safety note>"
    }
  ]
}
Rules:
- Repair only the requested fields.
- If targetBucket is provided, rewrite the post so theme/objective/hook/cta clearly fit that bucket and return that canonical bucket label.
- Keep outputs concise, specific, and publish-plannable.
- Theme, objective, hook, and CTA must be non-empty and must not contain placeholders.
- objective should be 4-10 words.
- hook should be 4-14 words and natural.
- cta should be 2-10 words and action-clear.
- strategicAngle, audienceTension, and specificReference should sharpen specificity rather than sounding poetic.
- If proof assets are unavailable, do not invent testimonials, reviews, metrics, "people love", or "real results" language.
- Use only approved client truths and safe wording.
- Do not use treatment, cure, guaranteed results, eco-packaging, sustainability, clinical, or unsupported claims unless explicitly supported.`;

const FIELD_REPAIR_SYSTEM = `You repair only the requested fields on monthly planning skeleton posts. Return STRICT JSON only:
{
  "posts": [
    {
      "index": 0,
      "theme": "<only when requested>",
      "objective": "<only when requested>",
      "hook": "<only when requested>",
      "cta": "<only when requested>",
      "strategicAngle": "<only when requested>",
      "audienceTension": "<only when requested>",
      "specificReference": "<only when requested>",
      "proofMode": "<only when requested>",
      "proofSource": "<only when requested>",
      "claimSafetyNote": "<only when requested>"
    }
  ]
}
Rules:
- Rewrite only the exact requested fields.
- Keep each field concise, specific, and publish-plannable.
- theme must be a short strategic theme.
- objective should be 4-10 words.
- hook should be 4-14 words and natural.
- cta should be 2-10 words and action-clear.
- Use strategicAngle, audienceTension, specificReference, proofMode, proofSource, and claimSafetyNote only when those fields are requested.
- Do not use fake review, testimonial, result, or customer-favorite language when proof assets are absent.
- Use only approved client truths and safe wording.
- Do not invent unsupported claims, testimonials, sustainability angles, or medical/wellness guarantees.`;

export function buildCalendarBrief(input: BuildCalendarBriefInput): CalendarBrief {
  const businessDna = input.extraction?.businessDna ?? null;
  const targetPlatformCounts = normalizePlatformTargets(input.sow.monthlyPosts, input.sow.platforms);
  const totalPosts = Object.values(targetPlatformCounts).reduce((a, b) => a + (Number(b) || 0), 0);
  const strategyType = normalizeStrategyType(input.extraction?.strategyType);
  const paidScopeExplicit = hasExplicitPaidScope(input.sow);
  const canonicalBuckets = buildCanonicalBucketList(input.sow.contentMix);
  const pillars = deriveCalendarPillars(
    canonicalBuckets,
    input.structured,
    businessDna,
  );
  const productTruths = buildProductTruths(input, businessDna);
  const differentiators = buildDifferentiators(input, businessDna);
  const specificReferences = buildSpecificReferences(input, businessDna);
  const proofContract = buildProofContract(input, businessDna);
  const healthClaimSafetyMode = inferHealthClaimSafetyMode(input, businessDna);

  return {
    client: {
      name: input.brandName,
      businessType: firstNonEmptyString(
        readString(input.enriched.business_type),
        readString((input.structured.brand_foundation as Record<string, unknown> | undefined)?.business_type),
      ),
      strategyType,
      oneLinePositioning: trimNullable(
        firstNonEmptyString(
          readString(input.enriched.positioning),
          input.extraction?.strategySummary ?? null,
          input.extraction?.websiteSummary?.meta_description ?? null,
        ),
        32,
      ),
      offer: trimNullable(
        firstNonEmptyString(
          readString(input.enriched.offer),
          businessDna?.offers?.primaryOffers?.[0] ?? null,
          input.extraction?.instagramSummary?.bio ?? null,
        ),
        24,
      ),
      productTruths,
      differentiators,
      specificReferences,
      paidScopeExplicit,
    },
    requirements: {
      month: input.brief.month,
      startDate: input.brief.startDate,
      totalPosts,
      platforms: Object.keys(targetPlatformCounts),
      platformCounts: targetPlatformCounts,
      contentBuckets: normalizeContentBuckets(input.sow.contentMix),
      deliverables: sanitizeShortList(input.sow.deliverables, 6, 18),
      hardConstraints: buildHardConstraints(input.sow, input.brief, strategyType, productTruths),
    },
    audience: {
      primarySegments: sanitizeShortList(
        businessDna?.targetAudience?.segments ??
          splitToShortItems(readString((input.enriched.target_audience as Record<string, unknown> | undefined)?.who)),
        4,
        10,
      ),
      stage: trimNullable(
        firstNonEmptyString(
          readString((input.enriched.target_audience as Record<string, unknown> | undefined)?.stage),
          businessDna?.targetAudience?.psychographics?.[0] ?? null,
        ),
        12,
      ),
      pains: sanitizeShortList(
        businessDna?.targetAudience?.pains ??
          splitToShortItems(readString((input.enriched.target_audience as Record<string, unknown> | undefined)?.pains)),
        4,
        10,
      ),
      desires: sanitizeShortList(businessDna?.targetAudience?.desires ?? [], 4, 10),
      objections: sanitizeShortList(businessDna?.targetAudience?.objections ?? [], 4, 10),
    },
    brandVoice: {
      tone: trimNullable(
        firstNonEmptyString(
          businessDna?.languageStyle?.ctaStyle ?? null,
          businessDna?.toneOfVoice?.style?.join(", ") ?? null,
        ),
        18,
      ),
      personality: trimNullable(
        firstNonEmptyString(
          businessDna?.personalityTraits?.join(", ") ?? null,
          readString(input.enriched.content_preference),
        ),
        18,
      ),
      avoidList: buildAvoidList(strategyType, paidScopeExplicit, businessDna),
    },
    contentPillars: pillars,
    platformStrategy: buildPlatformStrategy(strategyType, Object.keys(targetPlatformCounts), input.structured),
    strategicContext: {
      jtaContentStrategySummary: trimNullable(stringifyValue(input.structured["content_strategy"]), 40),
      jtaPlatformStrategySummary: trimNullable(stringifyValue(input.structured["platform_strategy"]), 40),
    },
    weeklyFlow: buildWeeklyFlow(
      strategyType,
      input.extraction?.monthlyGoals,
      readString(input.brief.goal),
    ),
    ctaStyleByPlatform: buildCtaStyleByPlatform(
      Object.keys(targetPlatformCounts),
      strategyType,
      paidScopeExplicit,
      input.extraction?.instagramSummary,
    ),
    kpis: buildKpis(input.structured, input.extraction?.monthlyGoals),
    trustSignals: sanitizeShortList(
      businessDna?.contentStrategy?.trustSignalsToRepeat ?? businessDna?.positioning?.reasonToBelieve ?? [],
      5,
      12,
    ),
    proofContract,
    safety: {
      forbiddenTerms: buildForbiddenTerms(proofContract, healthClaimSafetyMode),
      healthClaimSafetyMode,
      paidAllowed: paidScopeExplicit,
    },
    planningContext: {
      monthlyGoal: trimNullable(readString(input.brief.goal), 18),
      normalizedNotes: normalizePlanningNotes(input.brief.notes),
    },
  };
}

async function getCalendarJsonWithProviderFailover<T>(
  provider: LLMProvider,
  options: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxOutputTokens: number;
    contextLabel: string;
    onRawResponse?: (raw: string, attempt: "first" | "retry" | "repair") => void;
  },
): Promise<T> {
  if (!(provider instanceof FallbackProvider)) {
    return getStrictJsonWithRetry<T>(provider, options);
  }

  const slots = provider.getProviderSlots();
  const forceReal = provider.getForceReal();
  const stageErrors: string[] = [];
  let lastError: unknown = null;

  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const singleProvider = new FallbackProvider([slot], { forceReal });
    try {
      const parsed = await getStrictJsonWithRetry<T>(singleProvider, options);
      provider.appendExternalAttemptDiagnostics(singleProvider.getCumulativeAttemptDiagnostics());
      return parsed;
    } catch (err) {
      const stageAttempts = [...singleProvider.getCumulativeAttemptDiagnostics()];
      const classified = classifyProviderError(err);
      const slotInfo = slot.describe?.() ?? { provider: slot.id, model: "default" };
      const nextProviderAttempted = index < slots.length - 1;
      if (err instanceof JsonStageFailureError) {
        stageAttempts.push({
          contextLabel: options.contextLabel,
          provider: err.provider || slotInfo.provider,
          model: err.model || slotInfo.model,
          keySlot:
            (slot.describe?.() as { keySlot?: string | null } | undefined)?.keySlot ??
            (stageAttempts.length > 0 ? (stageAttempts[stageAttempts.length - 1]?.keySlot ?? null) : null),
          status: "failed",
          reason: err.finalReason,
          errorClass: "json_stage",
          errorCode: err.errorCode,
          attempt: 1,
          retryRan: err.retryRan,
          repairRan: err.repairRan,
          jsonFailureClass: err.finalReason,
          rawFailedGenerationHash: err.rawRepairHash ?? err.rawRetryHash ?? err.rawFirstHash,
          failoverDecision:
            classified.failoverEligible && !classified.terminalForChain && nextProviderAttempted
              ? "next_provider"
              : classified.terminalForChain
                ? "abort_chain"
                : "next_provider",
        });
      }
      provider.appendExternalAttemptDiagnostics(stageAttempts);
      console.warn(
        `[llm-observe] ${options.contextLabel} provider_stage_failed provider=${slotInfo.provider} model=${slotInfo.model} ` +
          `error_class=${classified.reason} retry_ran=${err instanceof JsonStageFailureError ? err.retryRan : false} ` +
          `repair_ran=${err instanceof JsonStageFailureError ? err.repairRan : false} next_provider_attempted=${nextProviderAttempted}`,
      );
      stageErrors.push(`${slotInfo.provider}: ${classified.message}`);
      lastError = err;
      if (!classified.failoverEligible || classified.terminalForChain || !nextProviderAttempted) {
        break;
      }
    }
  }

  if (lastError instanceof Error && stageErrors.length > 1) {
    lastError.message = `All configured providers failed: ${stageErrors.join(" | ")}`;
  }
  throw lastError instanceof Error ? lastError : new Error(`All configured providers failed: ${stageErrors.join(" | ")}`);
}

export async function generateMonthlyPlan(
  calendarBrief: CalendarBrief,
  provider?: LLMProvider,
): Promise<GenerationResult> {
  resetCalendarGenerationTrace();
  try {
    return await generateMonthlyPlanInner(calendarBrief, provider);
  } catch (err) {
    const trace = getLastCalendarGenerationTrace();
    attachCalendarGenerationTrace(err, trace);
    const lastStage = trace?.stagesAttempted[trace.stagesAttempted.length - 1];
    if (lastStage) {
      attachCalendarBudgetDiagnostics(err, {
        compactionTier: lastStage.compactionTier as CalendarCompactionTier,
        estimatedInputTokens: lastStage.estimatedInputTokens,
        maxInputTokens: lastStage.maxInputTokens,
        estimatedOutputTokens: lastStage.estimatedOutputTokens,
        promptSegments: lastStage.promptSegments,
        stage: lastStage.stage,
      });
    }
    console.error(
      `[llm-observe] calendar.trace.failure stage=${trace?.lastAttemptedStage ?? "unknown"} trace=${JSON.stringify(trace)}`,
    );
    throw err;
  }
}

async function generateMonthlyPlanInner(
  calendarBrief: CalendarBrief,
  provider?: LLMProvider,
): Promise<GenerationResult> {
  const budgetGuardEnabled = isCalendarPromptBudgetGuardEnabled();
  const pillars = buildPillarMeta({
    pillars: calendarBrief.contentPillars.map((pillar) => ({
      name: pillar.name,
      description: pillar.angle ?? "",
    })),
  });
  const targetPlatformCounts = calendarBrief.requirements.platformCounts;
  const totalPosts = calendarBrief.requirements.totalPosts;
  const formatKeys = inferFormatKeys({
    platforms: calendarBrief.requirements.platforms,
    monthlyPosts: targetPlatformCounts,
    contentMix: calendarBrief.requirements.contentBuckets,
    deliverables: calendarBrief.requirements.deliverables,
    toneByPlatform: {},
  });

  const llmProvider = provider ?? getLLMProvider();
  const primaryProviderId = resolvePrimaryCalendarProviderId(llmProvider);
  const weekConcurrency = resolveCalendarWeekConcurrency(primaryProviderId);
  const weekStaggerMs = calendarWeekStaggerMs(primaryProviderId);
  const groqPacer = new GroqRunTokenPacer(primaryProviderId);
  const trace: CalendarGenerationTrace = {
    updatedAt: new Date().toISOString(),
    codePath: "compact_calendar_v1",
    primaryProviderId,
    weekConcurrency,
    weekStaggerMs,
    plannerBudget: null,
    weeklyBriefHashes: null,
    calendarPlan: null,
    lastAttemptedStage: null,
    stagesAttempted: [],
  };
  const syncTrace = () => {
    trace.updatedAt = new Date().toISOString();
    publishCalendarGenerationTrace(trace);
  };
  syncTrace();

  const plannerCompactionTier: CalendarCompactionTier = 0;
  const compactPlannerContext = buildCompactCalendarContext(calendarBrief, plannerCompactionTier);
  const pillarLines = pillars
    .map((p) => `- ${p.name} (key: ${pillarKey(p.name)})${p.description ? ` — ${p.description}` : ""}`)
    .join("\n");
  const userPrompt = buildPlannerPromptFromCompactContext(compactPlannerContext, pillarLines);
  const plannerMaxOutput = resolveCalendarMaxOutputTokens({
    providerId: primaryProviderId,
    stage: "planner",
  });
  const plannerMaxInput = resolveCalendarTargetInputTokens(primaryProviderId, "planner");

  const enforcePlannerBudget = () => {
    const stats = buildPromptBudgetStats(
      "calendar planner",
      [PLANNER_SYSTEM, userPrompt],
      plannerMaxInput,
      plannerMaxOutput,
    );
    if (
      primaryProviderId === "groq" &&
      !isCalendarRequestWithinGroqBudget(stats.estimatedInputTokens, plannerMaxOutput)
    ) {
      const err = new PromptBudgetError(stats);
      attachCalendarBudgetDiagnostics(err, {
        compactionTier: plannerCompactionTier,
        estimatedInputTokens: stats.estimatedInputTokens,
        maxInputTokens: stats.maxInputTokens,
        estimatedOutputTokens: plannerMaxOutput,
        promptSegments: stats.segments,
        stage: "calendar planner",
      });
      throw err;
    }
    return stats;
  };

  const plannerBudget = budgetGuardEnabled
    ? assertPromptWithinBudget("calendar planner", [PLANNER_SYSTEM, userPrompt], plannerMaxInput, plannerMaxOutput)
    : enforcePlannerBudget();
  trace.plannerBudget = snapshotStageBudget({
    stage: "calendar planner",
    estimatedInputTokens: plannerBudget.estimatedInputTokens,
    maxInputTokens: plannerBudget.maxInputTokens,
    estimatedOutputTokens: plannerMaxOutput,
    compactionTier: plannerCompactionTier,
    promptSegments: plannerBudget.segments,
  });
  trace.lastAttemptedStage = "calendar planner";
  trace.stagesAttempted.push(trace.plannerBudget);
  syncTrace();
  console.info(
    `[llm-observe] calendar.planner.budget guard_enabled=${budgetGuardEnabled} provider=${primaryProviderId} input_tokens=${plannerBudget.estimatedInputTokens}/${plannerBudget.maxInputTokens} max_output=${plannerMaxOutput} compaction_tier=${plannerCompactionTier} estimated_total=${trace.plannerBudget.estimatedTotalTokens}`,
  );
  console.info(
    `[llm-observe] calendar.trace.before_planner_call provider=${primaryProviderId} weekConcurrency=${weekConcurrency} compact_context_tokens=${estimateTokens(compactPlannerContext)} groqWeekDelayMs=${resolveGroqWeekCallDelayMs()}`,
  );
  const plannerStartedAt = Date.now();
  const parsedPlanner = await getCalendarJsonWithProviderFailover<{
    planner?: Partial<PlannerLayer>;
  }>(llmProvider, {
    contextLabel: "calendar planner",
    maxOutputTokens: plannerMaxOutput,
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });
  if (process.env.NODE_ENV !== "production") {
    const plannerRawJson = JSON.stringify(parsedPlanner);
    console.info(
      `[llm-observe] calendar.planner.raw hash=${hashPreview(plannerRawJson)} preview=${plannerRawJson.slice(0, 1000)}`,
    );
  }
  console.info(
    `[llm-observe] calendar.planner ttft_ms=unavailable total_ms=${Date.now() - plannerStartedAt}`,
  );
  groqPacer.recordCall(plannerBudget.estimatedInputTokens, plannerMaxOutput);

  const pillarKeys = pillars.map((p) => pillarKey(p.name));
  const planner: PlannerLayer = {
    distribution: normalizePercents(
      parsedPlanner.planner?.distribution ?? toPillarKeyMap(calendarBrief.requirements.contentBuckets, pillars),
      pillarKeys,
    ),
    formats: normalizePercents(parsedPlanner.planner?.formats, formatKeys),
    platformSplit: targetPlatformCounts,
    angleBank: parsedPlanner.planner?.angleBank ?? {},
    hookStyles:
      Array.isArray(parsedPlanner.planner?.hookStyles) && parsedPlanner.planner!.hookStyles!.length
        ? (parsedPlanner.planner!.hookStyles as string[])
        : ["curiosity", "authority", "story", "contrarian", "data"],
    weeklyFlow:
      parsedPlanner.planner?.weeklyFlow ?? toWeeklyFlowRecord(calendarBrief.weeklyFlow),
    pillars,
    kpis: parsedPlanner.planner?.kpis ?? toKpiMap(calendarBrief.kpis),
    phases: Array.isArray(parsedPlanner.planner?.phases)
      ? (parsedPlanner.planner!.phases as Array<{ name: string; focus: string }>)
      : buildDefaultPhases(calendarBrief.weeklyFlow),
    metadata: {
      budgetGuardEnabled,
      budgetGuardBypassed: !budgetGuardEnabled,
      budgetTelemetryOnly: !budgetGuardEnabled,
      compactionTier: plannerCompactionTier,
      plannerBudget: {
        estimatedInputTokens: plannerBudget.estimatedInputTokens,
        maxInputTokens: plannerBudget.maxInputTokens,
        estimatedOutputTokens: plannerMaxOutput,
        promptSegments: plannerBudget.segments ?? [],
        compactionTier: plannerCompactionTier,
      },
    },
  };

  const start = new Date(calendarBrief.requirements.startDate + "T00:00:00Z");
  const fallbackPlatform = preferredFallbackPlatform(calendarBrief.requirements.platforms);
  const fallbackPillar = pillars[0]?.name ?? "Education";
  const weeklyTargets = splitAcrossWeeks(totalPosts, 4);
  const sharedCompactContext = compactPlannerContext;
  const priorWeekThemeSummaries: string[] = [];
  const weekTasks: Array<{
    weekIndex: number;
    targetCount: number;
    prompt: string;
    promptParts: Array<{ label: string; value: string }>;
    systemPrompt: string;
    requiredBuckets: string[];
    briefHash: string;
    briefPreview: string;
    beforeCompactionTokens: number;
    afterCompactionTokens: number;
    providerBudgetTarget: number;
    compactionApplied: boolean;
    compactionTier: CalendarCompactionTier;
    trimmedFields: string[];
    maxOutputTokens: number;
    weekBudgetStats: ReturnType<typeof buildPromptBudgetStats>;
    richWeekBrief: CompactCalendarWeekContext;
  }> = [];
  for (let week = 0; week < weeklyTargets.length; week += 1) {
    const targetCount = weeklyTargets[week]!;
    if (targetCount <= 0) continue;
    const weekStart = new Date(start);
    weekStart.setUTCDate(weekStart.getUTCDate() + week * 7);
    const richWeekBrief = buildCompactCalendarWeekContext({
      brief: calendarBrief,
      planner,
      baseContext: sharedCompactContext,
      weekIndex: week,
      weekStartDate: weekStart.toISOString().slice(0, 10),
      targetPosts: targetCount,
      priorWeekThemes: priorWeekThemeSummaries.slice(-4),
      tier: 0,
    });
    const compactedWeek = compactWeeklyBriefForProvider({
      brief: richWeekBrief,
      targetCount,
      providerId: primaryProviderId,
    });
    const weekMaxOutput = resolveCalendarMaxOutputTokens({
      providerId: primaryProviderId,
      stage: "week",
      postsInBatch: targetCount,
    });
    const weekMaxInput = resolveCalendarTargetInputTokens(primaryProviderId, "week");
    const weekBudgetStats = buildPromptBudgetStats(
      `calendar week ${week + 1}`,
      [{ label: "system", value: compactedWeek.systemPrompt }, ...compactedWeek.promptParts],
      weekMaxInput,
      weekMaxOutput,
    );
    console.info(
      `[llm-observe] calendar.week${week + 1}.compaction provider=${primaryProviderId} model=${resolveWeeklyPromptBudgetTarget(llmProvider).model} ` +
        `before_tokens=${compactedWeek.beforeTokens} after_tokens=${compactedWeek.afterTokens} target=${compactedWeek.providerBudgetTarget} ` +
        `applied=${compactedWeek.compactionApplied} tier=${compactedWeek.compactionTier} trimmed_fields=${JSON.stringify(compactedWeek.trimmedFields)} max_output=${weekMaxOutput} over_budget=${compactedWeek.overBudget}`,
    );
    if (compactedWeek.overBudget) {
      const err = new PromptBudgetError(weekBudgetStats);
      attachCalendarBudgetDiagnostics(err, {
        compactionTier: compactedWeek.compactionTier,
        estimatedInputTokens: weekBudgetStats.estimatedInputTokens,
        maxInputTokens: weekBudgetStats.maxInputTokens,
        estimatedOutputTokens: weekMaxOutput,
        promptSegments: weekBudgetStats.segments,
        stage: `calendar week ${week + 1}`,
      });
      throw err;
    }
    const compactWeekBriefJson = JSON.stringify(compactedWeek.brief);
    weekTasks.push({
      weekIndex: week,
      targetCount,
      prompt: compactedWeek.prompt,
      promptParts: compactedWeek.promptParts,
      systemPrompt: compactedWeek.systemPrompt,
      requiredBuckets: compactedWeek.brief.requiredBuckets,
      briefHash: hashPreview(compactWeekBriefJson),
      briefPreview: compactWeekBriefJson.slice(0, 500),
      beforeCompactionTokens: compactedWeek.beforeTokens,
      afterCompactionTokens: compactedWeek.afterTokens,
      providerBudgetTarget: compactedWeek.providerBudgetTarget,
      compactionApplied: compactedWeek.compactionApplied,
      compactionTier: compactedWeek.compactionTier,
      trimmedFields: compactedWeek.trimmedFields,
      maxOutputTokens: weekMaxOutput,
      weekBudgetStats,
      richWeekBrief,
    });
  }

  trace.weeklyBriefHashes = weekTasks.map((task) => ({
    weekIndex: task.weekIndex,
    estimatedInputTokens: task.weekBudgetStats.estimatedInputTokens,
    maxInputTokens: task.weekBudgetStats.maxInputTokens,
    estimatedOutputTokens: task.maxOutputTokens,
    estimatedTotalTokens: task.weekBudgetStats.estimatedInputTokens + task.maxOutputTokens,
    compactionTier: task.compactionTier,
    beforeCompactionTokens: task.beforeCompactionTokens,
    afterCompactionTokens: task.afterCompactionTokens,
    providerBudgetTarget: task.providerBudgetTarget,
    compactionApplied: task.compactionApplied,
    trimmedFields: task.trimmedFields,
  }));
  trace.calendarPlan = {
    distribution: planner.distribution,
    weeklyFlow: planner.weeklyFlow,
    phases: planner.phases,
  };
  syncTrace();
  console.info(
    `[llm-observe] calendar.trace.before_week_calls provider=${primaryProviderId} weekConcurrency=${weekConcurrency} weekStaggerMs=${weekStaggerMs} cumulativeGroqTokens=${groqPacer.getCumulativeEstimatedTokens()} weeks=${JSON.stringify(trace.weeklyBriefHashes)}`,
  );

  const rawPostsByWeek = await runWithConcurrency(
    weekTasks,
    weekConcurrency,
    async (task) => {
      const runWeekGeneration = async (
        promptParts: Array<{ label: string; value: string }>,
        prompt: string,
        systemPrompt: string,
        maxOutputTokens: number,
        compactionTier: CalendarCompactionTier,
        weekRetryCount: number,
      ) => {
        const paceSnapshot = await groqPacer.waitBeforeNextCall();
        const weekBudget = enforceWeeklyInputBeforeProviderCall({
          providerId: primaryProviderId,
          stageLabel: `calendar week ${task.weekIndex + 1}`,
          systemPrompt,
          promptParts,
          maxOutputTokens,
          compactionTier,
          budgetGuardEnabled,
        });
        if (
          primaryProviderId === "groq" &&
          !isCalendarRequestWithinGroqBudget(weekBudget.estimatedInputTokens, maxOutputTokens)
        ) {
          const err = new PromptBudgetError(weekBudget);
          attachCalendarBudgetDiagnostics(err, {
            compactionTier,
            estimatedInputTokens: weekBudget.estimatedInputTokens,
            maxInputTokens: weekBudget.maxInputTokens,
            estimatedOutputTokens: maxOutputTokens,
            promptSegments: weekBudget.segments,
            stage: `calendar week ${task.weekIndex + 1}`,
          });
          throw err;
        }
        console.info(
          `[llm-observe] calendar.week${task.weekIndex + 1}.budget guard_enabled=${budgetGuardEnabled} input_tokens=${weekBudget.estimatedInputTokens}/${weekBudget.maxInputTokens} ` +
            `before_compaction=${task.beforeCompactionTokens} after_compaction=${task.afterCompactionTokens} target=${task.providerBudgetTarget} ` +
            `budget_telemetry_only=${!budgetGuardEnabled} compaction_tier=${compactionTier} max_output=${maxOutputTokens} estimated_total=${weekBudget.estimatedInputTokens + maxOutputTokens} ` +
            `cumulative_groq_tokens=${paceSnapshot.cumulativeEstimatedTokens} delay_ms=${paceSnapshot.delayMsApplied} week_retry=${weekRetryCount} segments=${JSON.stringify(weekBudget.segments ?? [])}`,
        );
        const stageSnapshot = snapshotStageBudget({
          stage: `calendar week ${task.weekIndex + 1}`,
          estimatedInputTokens: weekBudget.estimatedInputTokens,
          maxInputTokens: weekBudget.maxInputTokens,
          estimatedOutputTokens: maxOutputTokens,
          compactionTier,
          promptSegments: weekBudget.segments,
        });
        stageSnapshot.cumulativeEstimatedGroqTokens =
          paceSnapshot.cumulativeEstimatedTokens + weekBudget.estimatedInputTokens + maxOutputTokens;
        stageSnapshot.delayMsApplied = paceSnapshot.delayMsApplied;
        stageSnapshot.weekRetryCount = weekRetryCount;
        stageSnapshot.failedWeekIndex = task.weekIndex;
        stageSnapshot.beforeCompactionTokens = task.beforeCompactionTokens;
        stageSnapshot.afterCompactionTokens = task.afterCompactionTokens;
        trace.lastAttemptedStage = stageSnapshot.stage;
        trace.stagesAttempted.push(stageSnapshot);
        syncTrace();
        console.info(
          `[llm-observe] calendar.trace.before_week_call provider=${primaryProviderId} model=${resolveWeeklyPromptBudgetTarget(llmProvider).model} stage=${stageSnapshot.stage} input=${stageSnapshot.estimatedInputTokens} output=${stageSnapshot.estimatedOutputTokens} cumulative=${stageSnapshot.cumulativeEstimatedGroqTokens} delay_ms=${stageSnapshot.delayMsApplied ?? 0}`,
        );
        const weekStartedAt = Date.now();
        const parsedWeek = await getCalendarJsonWithProviderFailover<{ posts?: Array<Partial<CalendarSkeletonPost>> }>(
          llmProvider,
          {
            contextLabel: `calendar week ${task.weekIndex + 1}`,
            maxOutputTokens,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
          },
        );
        groqPacer.recordCall(weekBudget.estimatedInputTokens, maxOutputTokens);
        const postsForWeek = Array.isArray(parsedWeek.posts)
          ? parsedWeek.posts.slice(0, task.targetCount)
          : [];
        console.info(
          `[llm-observe] calendar.week${task.weekIndex + 1} ttft_ms=unavailable total_ms=${Date.now() - weekStartedAt} posts=${postsForWeek.length} cumulative_groq_tokens=${groqPacer.getCumulativeEstimatedTokens()}`,
        );
        return { weekIndex: task.weekIndex, posts: postsForWeek, weekBudget, compactionTier, weekRetryCount };
      };

      let weekRetryCount = 0;
      try {
        return await runWeekGeneration(
          task.promptParts,
          task.prompt,
          task.systemPrompt,
          task.maxOutputTokens,
          task.compactionTier,
          weekRetryCount,
        );
      } catch (firstErr) {
        if (isGroqRateLimitError(firstErr) && primaryProviderId === "groq") {
          weekRetryCount += 1;
          console.warn(
            `[llm-observe] calendar.week${task.weekIndex + 1}.retry429 attempt=${weekRetryCount} reason=${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
          );
          await sleep(resolveGroqWeekCallDelayMs());
          const tier3 = buildTier3WeekBrief({
            brief: task.richWeekBrief,
            targetCount: task.targetCount,
            providerId: primaryProviderId,
          });
          if (tier3.overBudget) {
            attachCalendarBudgetDiagnostics(firstErr, {
              compactionTier: tier3.compactionTier,
              estimatedInputTokens: tier3.afterTokens,
              maxInputTokens: tier3.providerBudgetTarget,
              estimatedOutputTokens: task.maxOutputTokens,
              stage: `calendar week ${task.weekIndex + 1}`,
            });
            throw firstErr;
          }
          return runWeekGeneration(
            tier3.promptParts,
            tier3.prompt,
            tier3.systemPrompt,
            task.maxOutputTokens,
            3,
            weekRetryCount,
          );
        }
        attachCalendarBudgetDiagnostics(firstErr, {
          compactionTier: task.compactionTier,
          estimatedInputTokens: task.weekBudgetStats.estimatedInputTokens,
          maxInputTokens: task.weekBudgetStats.maxInputTokens,
          estimatedOutputTokens: task.maxOutputTokens,
          promptSegments: task.weekBudgetStats.segments,
          stage: `calendar week ${task.weekIndex + 1}`,
        });
        throw firstErr;
      }
    },
  );

  for (const entry of rawPostsByWeek.sort((a, b) => a.weekIndex - b.weekIndex)) {
    for (const post of entry.posts) {
      const theme = readString(post.topic);
      if (theme) priorWeekThemeSummaries.push(theme);
    }
  }

  const rawPosts: Array<Partial<CalendarSkeletonPost>> = rawPostsByWeek
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .flatMap((entry) => entry.posts);
  if (process.env.NODE_ENV !== "production") {
    const rawWeekJson = JSON.stringify(rawPostsByWeek);
    console.info(
      `[llm-observe] calendar.weeks.raw hash=${hashPreview(rawWeekJson)} preview=${rawWeekJson.slice(0, 1000)}`,
    );
  }
  planner.metadata = {
    ...(planner.metadata ?? {}),
    calendarBriefHash: hashPreview(JSON.stringify(compactPlannerContext)),
    calendarPlan: {
      distribution: planner.distribution,
      weeklyFlow: planner.weeklyFlow,
      phases: planner.phases,
      angleBank: planner.angleBank,
    },
    weekConcurrency,
    weekStaggerMs,
    weeklyBriefHashes: weekTasks.map((task) => ({
      weekIndex: task.weekIndex,
      hash: task.briefHash,
      preview: task.briefPreview,
      beforeCompactionTokens: task.beforeCompactionTokens,
      afterCompactionTokens: task.afterCompactionTokens,
      providerBudgetTarget: task.providerBudgetTarget,
      compactionApplied: task.compactionApplied,
      compactionTier: task.compactionTier,
      trimmedFields: task.trimmedFields,
      estimatedInputTokens: task.weekBudgetStats.estimatedInputTokens,
      maxInputTokens: task.weekBudgetStats.maxInputTokens,
      estimatedOutputTokens: task.maxOutputTokens,
      promptSegments: task.weekBudgetStats.segments ?? [],
    })),
    rawWeekSampleHash: hashPreview(JSON.stringify(rawPostsByWeek[0] ?? {})),
    rawWeekSamplePreview: JSON.stringify(rawPostsByWeek[0] ?? {}).slice(0, 1000),
  };
  const requiredBuckets = weekTasks
    .slice()
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .flatMap((task) => task.requiredBuckets);
  const assignedPlatforms = assignPlatformsByQuota(rawPosts, targetPlatformCounts, fallbackPlatform);
  const sourcePosts = Array.from({ length: totalPosts }, (_, index) => rawPosts[index] ?? {});

  const normalizeStartedAt = Date.now();
  const posts: CalendarPost[] = sourcePosts.map((p, i) => {
    const fallback = new Date(start);
    fallback.setUTCDate(fallback.getUTCDate() + i);
    const fallbackIso = fallback.toISOString().slice(0, 10);
    const normalizedPlatform = assignedPlatforms[i] ?? fallbackPlatform;
    const normalizedFormat = normalizeFormatForPlatform(
      typeof p.format === "string" ? p.format : "",
      normalizedPlatform,
    );
    const expectedBucket = requiredBuckets[i] ?? fallbackPillar;
    const modelBucket = normalizePillarForCalendar(p.pillar, calendarBrief.requirements.contentBuckets, expectedBucket);
    const repurposeTargets = normalizeRepurposeTargets(
      p.repurposeTargets,
      calendarBrief.requirements.platforms,
      normalizedPlatform,
    );
    const cta = readString(p.cta) ?? "";
    const strategicAngle = readString((p as Record<string, unknown>).strategicAngle);
    const audienceTension = readString((p as Record<string, unknown>).audienceTension);
    const specificReference = readString((p as Record<string, unknown>).specificReference);
    const proofMode = readString((p as Record<string, unknown>).proofMode);
    const proofSource = readString((p as Record<string, unknown>).proofSource);
    const claimSafetyNote = readString((p as Record<string, unknown>).claimSafetyNote);
    const normalizedDetail = buildPostDetailPayload(
      {
        format: normalizedFormat,
        platform: normalizedPlatform,
        activePlatforms: calendarBrief.requirements.platforms,
        pillar: p.pillar || fallbackPillar,
        objective: readString(p.objective) ?? "",
        hook: readString(p.hook) ?? "",
        cta,
        caption: null,
        hashtags: null,
        strategicIntent: readString(p.objective) ?? "",
        expectedMetric: "reach",
        expectedReason: "",
        priority: normalizePriority(p.priority),
        execution: {
          planning_stage: "monthly_skeleton",
          bucket_forced: modelBucket !== expectedBucket,
          ...(p.week ? { week: p.week } : {}),
          ...(repurposeTargets.length > 0 ? { repurpose_targets: repurposeTargets } : {}),
        },
      },
      { includeCopy: false },
    );
    return {
      date:
        typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
          ? p.date
          : fallbackIso,
      platform: normalizedPlatform,
      pillar: expectedBucket,
      angle: readString(p.topic) ?? "",
      format: normalizedFormat,
      ...(repurposeTargets.length > 0 ? { repurposeTargets } : {}),
      objective: readString(p.objective) ?? "",
      hook: readString(p.hook) ?? "",
      caption: null,
      hashtags: null,
      cta,
      strategicIntent: strategicAngle ?? readString(p.objective) ?? "",
      expectedMetric: "reach",
      expectedReason: audienceTension ?? specificReference ?? "",
      priority: normalizePriority(p.priority),
      execution: normalizedDetail.execution,
      metadata: {
        bucket: expectedBucket,
        plannedBucket: expectedBucket,
        modelBucket,
        bucketForced: modelBucket !== expectedBucket,
        theme: trimNullable(readString(p.topic), 18),
        strategicAngle: trimNullable(strategicAngle, 18),
        audienceTension: trimNullable(audienceTension, 18),
        specificReference: trimNullable(specificReference, 18),
        proofMode: trimNullable(proofMode, 8),
        proofSource: trimNullable(proofSource, 8),
        claimSafetyNote: trimNullable(claimSafetyNote, 14),
      },
    };
  });
  const normalizedPosts = ensureCreativeFormatCoverage(posts);
  const validationResult = await validateAndRepairCalendarPosts(normalizedPosts, calendarBrief, llmProvider);
  const validatedPosts = validationResult.posts;
  if (validationResult.repairSummary?.attempted) {
    planner.metadata = {
      ...(planner.metadata ?? {}),
      bucketRepair: validationResult.repairSummary,
    };
  }
  if (validationResult.validationDiagnostics) {
    planner.metadata = {
      ...(planner.metadata ?? {}),
      validationFlow: validationResult.validationDiagnostics,
    };
  }
  planner.metadata = {
    ...(planner.metadata ?? {}),
    repairRan: (validationResult.repairPostCount ?? 0) > 0,
    repairReason: validationResult.validationDiagnostics?.repairReason ?? null,
    fieldsRepairedCount: validationResult.validationDiagnostics?.fieldRepairCount ?? 0,
    postRepairRan: (validationResult.repairPostCount ?? 0) > 0,
    fieldRepairRan: validationResult.validationDiagnostics?.fieldRepairAttempted === true,
    finalWeekSampleHash: hashPreview(JSON.stringify(validatedPosts.slice(0, 4))),
    finalWeekSamplePreview: JSON.stringify(validatedPosts.slice(0, 4)).slice(0, 1000),
  };
  console.info(
    `[llm-observe] calendar.postprocess normalize_ms=${Date.now() - normalizeStartedAt} posts=${validatedPosts.length}`,
  );
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[llm-observe] calendar.creative_mutation helper_modified_creative_fields=no llm_repair_posts=${validationResult.repairPostCount ?? 0}`,
    );
  }
  return { planner, posts: validatedPosts };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function hashPreview(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = readString(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function trimNullable(value: string | null | undefined, maxTokens: number): string | null {
  if (!value) return null;
  const trimmed = trimToTokenBudget(value, maxTokens).trim();
  return trimmed || null;
}

function splitToShortItems(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,;|]+/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizePlanningNotes(value: string | null | undefined): string[] {
  if (!value) return [];
  const candidates = value
    .split(/[\n\r]+|[•·]+|(?<=[.!?])\s+(?=[A-Z0-9-])/)
    .map((item) => item.replace(/^[\-\*\d.)\s]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => trimToTokenBudget(item, 14))
    .filter(Boolean);
  const seen = new Set<string>();
  const compact: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    if (key.length < 8 && !/\b(no|avoid|must|only|keep|use|with)\b/.test(key)) continue;
    seen.add(key);
    compact.push(candidate);
    if (compact.length >= 5) break;
  }
  return compact;
}

const BUSINESS_FAMILY_KEYWORDS: Record<BusinessFamily, string[]> = {
  fragrance_beauty: [
    "perfume",
    "fragrance",
    "botanical",
    "beauty",
    "wellness",
    "skin-safe",
    "alcohol-free",
    "magnesium",
    "self-care",
    "wind-down",
  ],
  agency_marketing: [
    "social media",
    "content strategy",
    "content planning",
    "brand positioning",
    "audience attention",
    "reels",
    "carousel",
    "agency",
    "marketing",
    "inbound enquiries",
  ],
  product_brand: [
    "collection",
    "product",
    "variant",
    "ingredients",
    "routine",
    "shop",
    "purchase",
    "use case",
  ],
  service_brand: [
    "offer",
    "service",
    "audit",
    "framework",
    "client",
    "lead",
    "enquiry",
    "strategy",
  ],
};

function uniqueNormalized(items: Array<string | null | undefined>, maxItems: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const normalized = readString(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function splitToAnchorCandidates(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n;|]+|,\s+|\s+\band\b\s+/i)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 4)
    .map((item) => trimToTokenBudget(item, 8))
    .map((item) => item.replace(/^[^a-z0-9]+|[^a-z0-9?!]+$/gi, "").trim())
    .filter((item) => item.length >= 4);
}

function buildSourceContextStrings(calendarBrief: CalendarBrief): string[] {
  return [
    calendarBrief.client.businessType,
    calendarBrief.client.oneLinePositioning,
    calendarBrief.client.offer,
    ...calendarBrief.client.productTruths,
    ...calendarBrief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
    ...calendarBrief.audience.pains,
    ...calendarBrief.audience.desires,
    ...calendarBrief.trustSignals,
    ...calendarBrief.planningContext.normalizedNotes,
  ].filter((value): value is string => Boolean(readString(value)));
}

function buildClientIdeaAnchors(calendarBrief: CalendarBrief, maxItems = 6): string[] {
  const raw = [
    ...calendarBrief.client.productTruths,
    ...calendarBrief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
    calendarBrief.client.offer,
    calendarBrief.client.oneLinePositioning,
    calendarBrief.client.businessType,
    ...calendarBrief.audience.desires,
    ...calendarBrief.audience.pains,
  ].flatMap((value) => splitToAnchorCandidates(value));
  return uniqueNormalized(raw, maxItems);
}

function primaryAnchor(calendarBrief: CalendarBrief): string {
  return (
    buildClientIdeaAnchors(calendarBrief, 1)[0] ??
    readString(calendarBrief.client.offer) ??
    readString(calendarBrief.client.oneLinePositioning) ??
    readString(calendarBrief.client.businessType) ??
    calendarBrief.client.name
  );
}

function inferBusinessFamiliesFromText(value: string): Set<BusinessFamily> {
  const normalized = value.toLowerCase();
  const families = new Set<BusinessFamily>();
  for (const [family, keywords] of Object.entries(BUSINESS_FAMILY_KEYWORDS) as Array<[BusinessFamily, string[]]>) {
    const hits = keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
    if (hits.length >= 2) families.add(family);
  }
  if (families.size === 0) {
    if (/\bagency|marketing|service|strategy\b/i.test(normalized)) families.add("service_brand");
    if (/\bproduct|collection|variant|routine|shop\b/i.test(normalized)) families.add("product_brand");
  }
  return families;
}

function getAllowedBusinessFamilies(calendarBrief: CalendarBrief): Set<BusinessFamily> {
  const sourceText = buildSourceContextStrings(calendarBrief).join(" ");
  return inferBusinessFamiliesFromText(sourceText);
}

function findBusinessTypeMismatchTerms(value: string | null | undefined, calendarBrief: CalendarBrief): string[] {
  const normalized = readString(value)?.toLowerCase();
  if (!normalized) return [];
  const sourceText = buildSourceContextStrings(calendarBrief).join(" ").toLowerCase();
  const allowedFamilies = getAllowedBusinessFamilies(calendarBrief);
  const mismatches: string[] = [];
  for (const [family, keywords] of Object.entries(BUSINESS_FAMILY_KEYWORDS) as Array<[BusinessFamily, string[]]>) {
    if (allowedFamilies.has(family)) continue;
    const matched = keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()) && !sourceText.includes(keyword.toLowerCase()));
    if (matched.length >= 2) mismatches.push(...matched.slice(0, 3));
  }
  return Array.from(new Set(mismatches));
}

function containsBusinessTypeMismatch(value: string | null | undefined, calendarBrief: CalendarBrief): boolean {
  return findBusinessTypeMismatchTerms(value, calendarBrief).length > 0;
}

function sanitizeShortList(
  values: Array<unknown> | null | undefined,
  maxItems: number,
  maxTokensPerItem: number,
): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => (typeof value === "string" ? trimToTokenBudget(value, maxTokensPerItem).trim() : ""))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeStrategyType(strategyType: string | null | undefined): string {
  const raw = readString(strategyType)?.toLowerCase().replace(/\s+/g, "_") ?? "brand_building";
  if (raw.includes("performance")) return "performance_marketing";
  if (raw.includes("personal")) return "personal_brand";
  if (raw.includes("d2c")) return "d2c_growth";
  return "brand_building";
}

function normalizeContentBuckets(contentMix: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(contentMix ?? {})) {
    const trimmed = canonicalBucketLabel(key);
    if (!trimmed) continue;
    const count = Number(value) || 0;
    if (count <= 0) continue;
    out[trimmed] = count;
  }
  return out;
}

function buildCanonicalBucketList(contentMix: Record<string, number>): string[] {
  const normalized = normalizeContentBuckets(contentMix);
  const buckets = Object.keys(normalized);
  return buckets.length > 0 ? buckets : ["Education", "Promotion", "Social proof", "Thought leadership"];
}

function deriveCalendarPillars(
  canonicalBuckets: string[],
  structured: Record<string, unknown>,
  businessDna: BusinessDna | null,
): Array<{ name: string; angle?: string }> {
  const structuredPillars = buildPillarMeta(structured["content_strategy"] as Record<string, unknown>);
  return canonicalBuckets.map((name) => {
    const match = structuredPillars.find((pillar) =>
      normalizeBucketToken(pillar.name) === normalizeBucketToken(name),
    );
    const fallbackAngle = defaultAngleForBucket(name, businessDna);
    return {
      name,
      angle: trimToTokenBudget(match?.description || fallbackAngle, 20),
    };
  });
}

function defaultAngleForBucket(bucket: string, businessDna: BusinessDna | null): string {
  const token = normalizeBucketToken(bucket);
  const themes = sanitizeShortList(businessDna?.contentStrategy?.themes ?? [], 3, 8);
  if (token === "education") {
    return themes.length > 0
      ? `Teach concrete category education through ${themes.join(", ")}.`
      : "Teach something useful, specific, and easy to apply.";
  }
  if (token === "social_proof") {
    return "Show believable trust through reassurance, FAQ answers, objection handling, sourced proof, or product experience.";
  }
  if (token === "promotion") {
    return "Drive soft product discovery or next-step action without hard-sell pressure.";
  }
  if (token === "thought_leadership") {
    return "Share founder perspective, category insight, or a strong point of view.";
  }
  return "Stay specific, useful, and brand-relevant.";
}

function buildHardConstraints(
  sow: SowInput,
  brief: MonthlyBrief,
  strategyType: string,
  productTruths: string[],
): string[] {
  const out = [
    `Use only active platforms: ${normalizePlatformTargets(sow.monthlyPosts, sow.platforms) ? Object.keys(normalizePlatformTargets(sow.monthlyPosts, sow.platforms)).join(", ") : "Instagram"}.`,
    `Respect exact monthly platform counts and content bucket totals from the approved SOW.`,
    `Use only these canonical bucket labels for pillar: ${buildCanonicalBucketList(sow.contentMix).join(", ")}.`,
    `Keep the monthly planner skeleton-only: no captions or hashtag generation in this call.`,
    productTruths.length > 0 ? `Anchor every idea to specific product truths: ${productTruths.join("; ")}.` : null,
    brief.goal ? `Support this monthly goal: ${trimToTokenBudget(brief.goal, 18)}.` : null,
    brief.notes ? `Account for planner notes: ${trimToTokenBudget(brief.notes, 24)}.` : null,
    strategyType === "brand_building" && !hasExplicitPaidScope(sow)
      ? "Avoid paid ads, CAC, ROAS, retargeting, pixel, ad spend, or acquisition-media language."
      : null,
    "Avoid medical or treatment claims. Use ritual, education, sensory, and wellness-support framing instead.",
  ].filter((value): value is string => Boolean(value));
  return out.slice(0, 6);
}

function buildWeeklyCalendarBrief(input: {
  calendarBrief: CalendarBrief;
  planner: PlannerLayer;
  weekIndex: number;
  weekStartDate: string;
  targetPosts: number;
}): WeeklyCalendarBrief {
  const { calendarBrief, planner, weekIndex, weekStartDate, targetPosts } = input;
  const weekLabel = `week_${weekIndex + 1}`;
  const weeklyPlatformTargets = splitRecordAcrossWeeks(calendarBrief.requirements.platformCounts, weekIndex);
  const bucketTargets = splitRecordAcrossWeeks(calendarBrief.requirements.contentBuckets, weekIndex);
  const audienceSignals = buildWeeklyAudienceSignals(calendarBrief);
  const proofContract = buildWeeklyProofContract(calendarBrief);
  return {
    clientName: calendarBrief.client.name,
    businessType: calendarBrief.client.businessType,
    strategyType: calendarBrief.client.strategyType,
    positioningLine: trimNullable(calendarBrief.client.oneLinePositioning, 16),
    offer: trimNullable(calendarBrief.client.offer, 16),
    truths: calendarBrief.client.productTruths.slice(0, 5).map((item) => trimToTokenBudget(item, 10)),
    differentiators: buildWeeklyDifferentiators(calendarBrief),
    specificReferences: buildWeeklySpecificReferences(calendarBrief),
    segments: audienceSignals.segments,
    pains: audienceSignals.pains,
    desires: audienceSignals.desires,
    objections: audienceSignals.objections,
    activePlatforms: calendarBrief.requirements.platforms,
    activePlatformStrategy: calendarBrief.platformStrategy
      .filter((entry) => calendarBrief.requirements.platforms.includes(entry.platform))
      .map((entry) => ({
        platform: entry.platform,
        role: trimToTokenBudget(entry.role, 8),
        objective: trimToTokenBudget(entry.objective, 10),
        contentBehavior: trimToTokenBudget(entry.contentBehavior, 18),
      }))
      .slice(0, 3),
    weekStartDate,
    weekLabel,
    weeklyTotalPosts: targetPosts,
    weeklyPlatformTargets,
    bucketTargets,
    requiredBuckets: expandWeeklyBucketSequence(
      bucketTargets,
      targetPosts,
    ),
    themes: buildWeeklyThemes(calendarBrief),
    allowedAngles: buildWeeklyAllowedAngles(calendarBrief),
    brandVoice: buildWeeklyVoiceNotes(calendarBrief),
    jtaContentStrategySummary: trimNullable(calendarBrief.strategicContext.jtaContentStrategySummary, 20),
    jtaPlatformStrategySummary: trimNullable(calendarBrief.strategicContext.jtaPlatformStrategySummary, 20),
    executionPhase:
      trimNullable(planner.phases[weekIndex]?.focus ?? planner.weeklyFlow[weekLabel as keyof typeof planner.weeklyFlow] ?? null, 14),
    proofAssetsAvailable: proofContract.proofAssetsAvailable,
    availableProofTypes: proofContract.availableProofTypes,
    testimonialStyleAllowed: proofContract.testimonialStyleAllowed,
    hardConstraints: calendarBrief.requirements.hardConstraints.slice(0, 5).map((item) => trimToTokenBudget(item, 14)),
    forbiddenTerms: calendarBrief.safety.forbiddenTerms.slice(0, 6),
    healthClaimSafetyMode: calendarBrief.safety.healthClaimSafetyMode,
    paidAllowed: calendarBrief.safety.paidAllowed,
    monthlyGoal: calendarBrief.planningContext.monthlyGoal,
    normalizedNotes: calendarBrief.planningContext.normalizedNotes.slice(0, 5),
    weeklyFocus:
      trimNullable(planner.weeklyFlow[weekLabel] ?? calendarBrief.weeklyFlow[weekIndex] ?? null, 12) ?? null,
  };
}

function resolveWeeklyPromptBudgetTarget(provider: LLMProvider): {
  provider: string;
  model: string;
  targetInputTokens: number;
} {
  const providerId = resolvePrimaryCalendarProviderId(provider);
  if (provider instanceof FallbackProvider) {
    const first = provider.getConfiguredProviders()[0] ?? { provider: "multi", model: "fallback-chain" };
    return {
      provider: first.provider,
      model: first.model,
      targetInputTokens: resolveCalendarTargetInputTokens(providerId, "week"),
    };
  }
  const info = provider.describe?.() ?? { provider: provider.id, model: "default" };
  return {
    provider: info.provider,
    model: info.model,
    targetInputTokens: resolveCalendarTargetInputTokens(providerId, "week"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWeeklyPromptParts(brief: WeeklyCalendarBrief, targetCount: number): Array<{ label: string; value: string }> {
  return buildWeeklyPromptPartsFromCompact(
    brief as unknown as CompactCalendarWeekContext,
    targetCount,
    buildWeeklyInstructionBlock("openrouter", targetCount),
  );
}

function expandWeeklyBucketSequence(bucketTargets: Record<string, number>, totalPosts: number): string[] {
  const entries = Object.entries(bucketTargets)
    .filter(([, count]) => (Number(count) || 0) > 0)
    .map(([bucket, count]) => ({ bucket, remaining: Math.max(0, Math.round(Number(count) || 0)) }));
  const ordered: string[] = [];
  while (ordered.length < totalPosts && entries.some((entry) => entry.remaining > 0)) {
    for (const entry of entries) {
      if (entry.remaining <= 0) continue;
      ordered.push(entry.bucket);
      entry.remaining -= 1;
      if (ordered.length >= totalPosts) break;
    }
  }
  return ordered.slice(0, totalPosts);
}

function splitRecordAcrossWeeks(source: Record<string, number>, weekIndex: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, total] of Object.entries(source)) {
    const split = splitAcrossWeeks(Number(total) || 0, 4);
    const count = split[weekIndex] ?? 0;
    if (count > 0) out[key] = count;
  }
  return out;
}

function buildWeeklyThemes(calendarBrief: CalendarBrief): string[] {
  const candidates = [
    ...calendarBrief.client.productTruths,
    ...calendarBrief.client.differentiators,
    ...calendarBrief.client.specificReferences,
    ...calendarBrief.contentPillars.map((pillar) => pillar.angle || pillar.name),
    ...calendarBrief.trustSignals,
  ]
    .map((value) => trimToTokenBudget(value, 10).trim())
    .filter(Boolean);
  return Array.from(new Set(candidates)).slice(0, 8);
}

function buildWeeklyAllowedAngles(calendarBrief: CalendarBrief): string[] {
  const candidates = [
    ...calendarBrief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
    calendarBrief.strategicContext.jtaContentStrategySummary,
    calendarBrief.strategicContext.jtaPlatformStrategySummary,
    ...calendarBrief.client.differentiators,
    ...calendarBrief.client.specificReferences,
  ]
    .flatMap((value) => splitToAnchorCandidates(value))
    .map((value) => trimToTokenBudget(value, 10))
    .filter(Boolean);
  return Array.from(new Set(candidates)).slice(0, 8);
}

function buildWeeklyVoiceNotes(calendarBrief: CalendarBrief): string[] {
  const candidates = [
    calendarBrief.brandVoice.tone,
    calendarBrief.brandVoice.personality,
    ...calendarBrief.brandVoice.avoidList.map((item) => `Avoid ${item}`),
  ]
    .filter(Boolean)
    .map((value) => trimToTokenBudget(String(value), 10).trim())
    .filter(Boolean);
  return Array.from(new Set(candidates)).slice(0, 5);
}

function buildAvoidList(
  strategyType: string,
  paidScopeExplicit: boolean,
  businessDna: BusinessDna | null,
): string[] {
  const avoid = new Set<string>(
    sanitizeShortList(businessDna?.contentStrategy?.topicsToAvoid ?? [], 6, 8),
  );
  if (strategyType === "brand_building" && !paidScopeExplicit) {
    ["CAC", "ROAS", "retargeting", "pixel setup", "ad spend", "campaign targeting"].forEach((item) =>
      avoid.add(item),
    );
  }
  return Array.from(avoid).slice(0, 6);
}

function buildPlatformStrategy(
  strategyType: string,
  platforms: string[],
  structured: Record<string, unknown>,
): Array<{ platform: string; role: string; objective: string; contentBehavior: string }> {
  const platformSummary = trimToTokenBudget(stringifyValue(structured["platform_strategy"]), 120);
  return platforms.map((platform) => ({
    platform,
    role: defaultPlatformRole(platform, strategyType),
    objective: defaultPlatformObjective(platform, strategyType),
    contentBehavior: platformSummary
      ? `${defaultPlatformBehavior(platform)} Strategy note: ${platformSummary}`
      : defaultPlatformBehavior(platform),
  }));
}

function buildWeeklyFlow(
  strategyType: string,
  monthlyGoals: string[] | null | undefined,
  explicitGoal: string | null,
): string[] {
  const goalHint = sanitizeShortList(monthlyGoals ?? [], 4, 10);
  if (goalHint.length >= 4) return goalHint.slice(0, 4);
  if (strategyType === "performance_marketing") {
    return [
      "Awareness and problem agitation",
      "Education and objection handling",
      "Offer and action momentum",
      "Proof and conversion reinforcement",
    ];
  }
  if (strategyType === "personal_brand") {
    return [
      "Founder story and beliefs",
      "Authority and lived expertise",
      "Proof and audience resonance",
      "Community and invitation to respond",
    ];
  }
  if (strategyType === "d2c_growth") {
    return [
      "Use cases and product discovery",
      "Education and objection handling",
      "Proof and repeat-use reinforcement",
      "Offer and retention nudges",
    ];
  }
  return [
    "Awareness and audience resonance",
    "Education and trust-building",
    explicitGoal ? trimToTokenBudget(explicitGoal, 10) : "Offer and conversion support",
    "Proof and community reinforcement",
  ];
}

function buildCtaStyleByPlatform(
  platforms: string[],
  strategyType: string,
  paidScopeExplicit: boolean,
  instagramSummary?: InstagramSummary | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const instagramClue = instagramSummary?.last_n_caption_snippets?.join(" ").toLowerCase() ?? "";
  for (const platform of platforms) {
    out[platform] = defaultCtaStyleForPlatform(platform, strategyType, paidScopeExplicit, instagramClue);
  }
  return out;
}

function buildKpis(structured: Record<string, unknown>, monthlyGoals?: string[] | null): string[] {
  const structuredKpis = splitToShortItems(trimToTokenBudget(stringifyValue(structured["kpis"]), 80));
  const goals = sanitizeShortList(monthlyGoals ?? [], 4, 10);
  return Array.from(new Set([...structuredKpis, ...goals])).slice(0, 6);
}

function buildProductTruths(
  input: BuildCalendarBriefInput,
  businessDna: BusinessDna | null,
): string[] {
  const candidates = [
    readString(input.enriched.offer),
    readString(input.enriched.positioning),
    input.extraction?.websiteSummary?.meta_description ?? null,
    input.extraction?.websiteSummary?.main_text_excerpt ?? null,
    input.extraction?.instagramSummary?.bio ?? null,
    businessDna?.positioning?.valueProposition ?? null,
    ...(businessDna?.positioning?.differentiators ?? []),
    ...(businessDna?.contentStrategy?.themes ?? []),
  ].flatMap((value) => splitToAnchorCandidates(value));
  return uniqueNormalized(candidates, 6);
}

function buildDifferentiators(
  input: BuildCalendarBriefInput,
  businessDna: BusinessDna | null,
): string[] {
  const candidates = [
    ...(businessDna?.positioning?.differentiators ?? []),
    businessDna?.positioning?.valueProposition ?? null,
    readString(input.enriched.positioning),
    input.extraction?.strategySummary ?? null,
  ].flatMap((value) => splitToAnchorCandidates(value));
  return uniqueNormalized(candidates, 6);
}

function buildSpecificReferences(
  input: BuildCalendarBriefInput,
  businessDna: BusinessDna | null,
): string[] {
  const candidates = [
    ...(businessDna?.contentStrategy?.themes ?? []),
    ...(businessDna?.offers?.primaryOffers ?? []),
    input.extraction?.websiteSummary?.meta_description ?? null,
    input.extraction?.websiteSummary?.main_text_excerpt ?? null,
    input.extraction?.instagramSummary?.bio ?? null,
    input.extraction?.strategySummary ?? null,
  ].flatMap((value) => splitToAnchorCandidates(value));
  return uniqueNormalized(candidates, 8);
}

function buildProofContract(
  input: BuildCalendarBriefInput,
  businessDna: BusinessDna | null,
): CalendarBrief["proofContract"] {
  const sourceText = [
    input.extraction?.websiteSummary?.main_text_excerpt,
    input.extraction?.websiteSummary?.meta_description,
    input.extraction?.instagramSummary?.bio,
    ...(input.extraction?.instagramSummary?.last_n_caption_snippets ?? []),
    ...(businessDna?.contentStrategy?.trustSignalsToRepeat ?? []),
    ...(businessDna?.positioning?.reasonToBelieve ?? []),
    input.extraction?.strategySummary,
  ]
    .filter((value): value is string => Boolean(readString(value)))
    .join(" ")
    .toLowerCase();
  const availableProofTypes = uniqueNormalized([
    /\breview|testimonial|rated|ugc\b/.test(sourceText) ? "reviews" : null,
    /\bcase stud|case-study|before\/after\b/.test(sourceText) ? "case studies" : null,
    /\bmetric|stat|conversion|repeat rate|ctr|reach\b/.test(sourceText) ? "metrics" : null,
    /\bfaq|question|objection\b/.test(sourceText) ? "faq" : null,
    /\bingredient|formula|botanical|alcohol[-\s]?free|process\b/.test(sourceText) ? "ingredients" : null,
    /\bprocess|how it['’]?s made|behind the scenes\b/.test(sourceText) ? "process" : null,
  ], 6);
  const testimonialStyleAllowed = availableProofTypes.some((item) =>
    ["reviews", "case studies", "metrics"].includes(item.toLowerCase()),
  );
  return {
    proofAssetsAvailable: availableProofTypes.length > 0,
    availableProofTypes,
    testimonialStyleAllowed,
  };
}

function inferHealthClaimSafetyMode(
  input: BuildCalendarBriefInput,
  businessDna: BusinessDna | null,
): CalendarBrief["safety"]["healthClaimSafetyMode"] {
  const sourceText = [
    readString(input.enriched.business_type),
    readString(input.enriched.positioning),
    businessDna?.positioning?.valueProposition ?? null,
    ...(businessDna?.contentStrategy?.themes ?? []),
  ]
    .filter((value): value is string => Boolean(readString(value)))
    .join(" ")
    .toLowerCase();
  return /\bwellness|beauty|personal care|skincare|fragrance|perfume|ritual|self-care\b/.test(sourceText)
    ? "wellness_beauty_softened"
    : "standard";
}

function buildForbiddenTerms(
  proofContract: CalendarBrief["proofContract"],
  healthClaimSafetyMode: CalendarBrief["safety"]["healthClaimSafetyMode"],
): string[] {
  const terms = new Set<string>();
  if (!proofContract.testimonialStyleAllowed) {
    ["real results", "people love", "customer favorite", "testimonial", "reviews prove"].forEach((item) => terms.add(item));
  }
  if (healthClaimSafetyMode === "wellness_beauty_softened") {
    ["cure", "fix sleep", "natural stress relief", "guaranteed relaxation", "medical results"].forEach((item) => terms.add(item));
  }
  return Array.from(terms).slice(0, 8);
}

function buildWeeklyAudienceSignals(calendarBrief: CalendarBrief): {
  segments: string[];
  pains: string[];
  desires: string[];
  objections: string[];
} {
  return {
    segments: calendarBrief.audience.primarySegments.slice(0, 4).map((item) => trimToTokenBudget(item, 10)),
    pains: calendarBrief.audience.pains.slice(0, 4).map((item) => trimToTokenBudget(item, 10)),
    desires: calendarBrief.audience.desires.slice(0, 4).map((item) => trimToTokenBudget(item, 10)),
    objections: calendarBrief.audience.objections.slice(0, 4).map((item) => trimToTokenBudget(item, 10)),
  };
}

function buildWeeklyProofContract(calendarBrief: CalendarBrief): CalendarBrief["proofContract"] {
  return {
    proofAssetsAvailable: calendarBrief.proofContract.proofAssetsAvailable,
    availableProofTypes: calendarBrief.proofContract.availableProofTypes.slice(0, 5).map((item) => trimToTokenBudget(item, 6)),
    testimonialStyleAllowed: calendarBrief.proofContract.testimonialStyleAllowed,
  };
}

function buildWeeklyDifferentiators(calendarBrief: CalendarBrief): string[] {
  return calendarBrief.client.differentiators.slice(0, 4).map((item) => trimToTokenBudget(item, 10));
}

function buildWeeklySpecificReferences(calendarBrief: CalendarBrief): string[] {
  return calendarBrief.client.specificReferences.slice(0, 6).map((item) => trimToTokenBudget(item, 10));
}

function buildCompactRepairBrief(
  calendarBrief: CalendarBrief,
  provider: LLMProvider,
  mode: "post" | "field",
): {
  brief: Record<string, unknown>;
  beforeTokens: number;
  afterTokens: number;
  providerBudgetTarget: number;
  compactionApplied: boolean;
  trimmedFields: string[];
} {
  const baseBrief: Record<string, unknown> = mode === "post"
    ? {
        client: {
          name: calendarBrief.client.name,
          businessType: calendarBrief.client.businessType,
          strategyType: calendarBrief.client.strategyType,
          oneLinePositioning: calendarBrief.client.oneLinePositioning,
          offer: trimNullable(calendarBrief.client.offer, 10),
          productTruths: calendarBrief.client.productTruths.slice(0, 3),
          differentiators: calendarBrief.client.differentiators.slice(0, 3),
          specificReferences: calendarBrief.client.specificReferences.slice(0, 3),
        },
        requirements: {
          month: calendarBrief.requirements.month,
          platforms: calendarBrief.requirements.platforms,
          contentBuckets: calendarBrief.requirements.contentBuckets,
        },
        proofContract: {
          proofAssetsAvailable: calendarBrief.proofContract.proofAssetsAvailable,
          availableProofTypes: calendarBrief.proofContract.availableProofTypes.slice(0, 4),
          testimonialStyleAllowed: calendarBrief.proofContract.testimonialStyleAllowed,
        },
        safety: {
          forbiddenTerms: calendarBrief.safety.forbiddenTerms.slice(0, 4),
          healthClaimSafetyMode: calendarBrief.safety.healthClaimSafetyMode,
          paidAllowed: calendarBrief.safety.paidAllowed,
        },
        notes: calendarBrief.planningContext.normalizedNotes.slice(0, 2),
      }
    : {
        client: {
          name: calendarBrief.client.name,
          businessType: calendarBrief.client.businessType,
          strategyType: calendarBrief.client.strategyType,
          oneLinePositioning: calendarBrief.client.oneLinePositioning,
          offer: trimNullable(calendarBrief.client.offer, 8),
          productTruths: calendarBrief.client.productTruths.slice(0, 2),
          differentiators: calendarBrief.client.differentiators.slice(0, 2),
          specificReferences: calendarBrief.client.specificReferences.slice(0, 2),
        },
        proofContract: {
          proofAssetsAvailable: calendarBrief.proofContract.proofAssetsAvailable,
          availableProofTypes: calendarBrief.proofContract.availableProofTypes.slice(0, 3),
          testimonialStyleAllowed: calendarBrief.proofContract.testimonialStyleAllowed,
        },
        safety: {
          forbiddenTerms: calendarBrief.safety.forbiddenTerms.slice(0, 3),
          healthClaimSafetyMode: calendarBrief.safety.healthClaimSafetyMode,
          paidAllowed: calendarBrief.safety.paidAllowed,
        },
        notes: calendarBrief.planningContext.normalizedNotes.slice(0, 1),
      };
  const providerBudget = resolveWeeklyPromptBudgetTarget(provider);
  const target = Math.max(700, providerBudget.targetInputTokens - 350);
  const before = buildPromptBudgetStats(`calendar ${mode} repair brief`, [JSON.stringify(baseBrief)], target, 180);
  return {
    brief: baseBrief,
    beforeTokens: before.estimatedInputTokens,
    afterTokens: before.estimatedInputTokens,
    providerBudgetTarget: target,
    compactionApplied: false,
    trimmedFields: [],
  };
}

function inferFormatKeys(sow: SowInput): string[] {
  const set = new Set<string>();
  for (const p of sow.platforms) {
    const lower = p.toLowerCase();
    if (lower.includes("instagram")) {
      ["reel", "carousel", "static", "story"].forEach((f) => set.add(f));
    } else if (lower.includes("linkedin")) {
      ["text post", "carousel", "pdf carousel", "short video"].forEach((f) => set.add(f));
    } else if (lower.includes("twitter") || lower === "x") {
      ["text post", "thread", "image post"].forEach((f) => set.add(f));
    } else if (lower.includes("pinterest")) {
      ["static pin", "video pin"].forEach((f) => set.add(f));
    } else if (lower.includes("youtube")) {
      ["short video", "long video", "community post"].forEach((f) => set.add(f));
    }
  }
  if (set.size === 0) ["reel", "carousel", "static"].forEach((f) => set.add(f));
  return Array.from(set);
}

function hasExplicitPaidScope(sow: SowInput): boolean {
  const text = JSON.stringify(sow).toLowerCase();
  return /\b(paid media|paid ads?|paid advertising|ad spend|meta ads?|google ads?|retargeting|pixel|roas|cac|performance marketing)\b/.test(
    text,
  );
}

function toPillarKeyMap(
  contentMix: Record<string, number>,
  pillars: PillarMeta[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const pillarNames = pillars.map((p) => p.name.toLowerCase());
  for (const [k, v] of Object.entries(contentMix)) {
    const lower = k.toLowerCase();
    const matched = pillarNames.find((n) => lower.includes(n) || n.includes(lower));
    const key = matched ? pillarKey(matched) : pillarKey(k);
    out[key] = (out[key] ?? 0) + Number(v);
  }
  return out;
}

function normalizePillarForCalendar(
  value: unknown,
  contentBuckets: Record<string, number>,
  fallback: string,
): string {
  const raw = readString(value);
  if (!raw) return fallback;
  const canonicalBuckets = Object.keys(contentBuckets);
  const normalizedRaw = normalizeBucketToken(raw);
  const direct = canonicalBuckets.find((bucket) => normalizeBucketToken(bucket) === normalizedRaw);
  if (direct) return direct;
  const mapped = canonicalBuckets.find((bucket) => {
    const token = normalizeBucketToken(bucket);
    if (token === "social_proof") {
      return /\bproof|testimonial|ugc|case|review|results?\b/i.test(raw);
    }
    if (token === "thought_leadership") {
      return /\bthought|founder|perspective|opinion|point of view|leadership\b/i.test(raw);
    }
    if (token === "promotion") {
      return /\bpromotion|offer|conversion|launch|product discovery|cta|buy\b/i.test(raw);
    }
    if (token === "education") {
      return /\beducat|guide|how to|learn|explain|awareness\b/i.test(raw);
    }
    return false;
  });
  return mapped ?? fallback;
}

function normalizePriority(p: unknown): Priority {
  if (p === "high" || p === "medium" || p === "low") return p;
  return "medium";
}

function pillarKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function normalizePercents(
  input: Record<string, number> | undefined,
  expectedKeys: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "number" && !Number.isNaN(v)) out[k] = v;
    }
  }
  if (Object.keys(out).length === 0 && expectedKeys.length > 0) {
    const each = Math.floor(100 / expectedKeys.length);
    for (const k of expectedKeys) out[k] = each;
    out[expectedKeys[0]!] = 100 - each * (expectedKeys.length - 1);
  }
  return out;
}

export { pillarKey };

function canonicalBucketLabel(value: string): string {
  const token = normalizeBucketToken(value);
  if (!token) return "";
  if (token.includes("social") || token.includes("proof") || token.includes("testimonial") || token.includes("case")) {
    return "Social proof";
  }
  if (token.includes("thought") || token.includes("leadership") || token.includes("founder") || token.includes("perspective")) {
    return "Thought leadership";
  }
  if (token.includes("promotion") || token.includes("offer") || token.includes("conversion")) {
    return "Promotion";
  }
  if (token.includes("education") || token.includes("educational") || token.includes("awareness")) {
    return "Education";
  }
  return titleCaseBucket(value);
}

function normalizeBucketToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleCaseBucket(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

function normalizePlatformTargets(
  monthlyPosts: Record<string, number>,
  platforms: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const platform of platforms) {
    const normalized = normalizePlatformName(platform, platform);
    out[normalized] = Number(monthlyPosts[platform] ?? monthlyPosts[normalized] ?? 0) || 0;
  }
  for (const [platform, count] of Object.entries(monthlyPosts)) {
    const normalized = normalizePlatformName(platform, platform);
    out[normalized] = Math.max(out[normalized] ?? 0, Number(count) || 0);
  }
  return Object.fromEntries(Object.entries(out).filter(([, count]) => count > 0));
}

function assignPlatformsByQuota(
  rawPosts: Array<Partial<CalendarPost>>,
  targetCounts: Record<string, number>,
  fallbackPlatform: string,
): string[] {
  const remaining = new Map<string, number>(Object.entries(targetCounts));
  const preferredOrder = Object.keys(targetCounts);
  const assigned: string[] = [];
  for (const post of rawPosts.slice(0, preferredOrder.reduce((sum, key) => sum + (targetCounts[key] ?? 0), 0))) {
    const preferred = normalizePlatformName(post.platform, fallbackPlatform);
    const preferredRemaining = remaining.get(preferred) ?? 0;
    if (preferredRemaining > 0) {
      assigned.push(preferred);
      remaining.set(preferred, preferredRemaining - 1);
      continue;
    }
    const nextPlatform =
      preferredOrder.find((platform) => (remaining.get(platform) ?? 0) > 0) ?? fallbackPlatform;
    assigned.push(nextPlatform);
    remaining.set(nextPlatform, Math.max(0, (remaining.get(nextPlatform) ?? 0) - 1));
  }
  for (const platform of preferredOrder) {
    let left = remaining.get(platform) ?? 0;
    while (left > 0) {
      assigned.push(platform);
      left -= 1;
    }
  }
  return assigned;
}

function ensureCreativeFormatCoverage(posts: CalendarPost[]): CalendarPost[] {
  const next = posts.map((post) => ({ ...post }));
  const byPlatform = new Map<string, number[]>();
  next.forEach((post, idx) => {
    const key = post.platform.trim().toLowerCase();
    const bucket = byPlatform.get(key) ?? [];
    bucket.push(idx);
    byPlatform.set(key, bucket);
  });
  for (const [platform, indices] of byPlatform.entries()) {
    const required = requiredFormatsForPlatform(platform, indices.length);
    if (required.length === 0) continue;
    const present = new Set(indices.map((i) => next[i]!.format.trim().toLowerCase()));
    let writePtr = 0;
    for (const requiredFormat of required) {
      if (present.has(requiredFormat)) continue;
      const targetIdx = indices[writePtr % indices.length]!;
      const targetPost = next[targetIdx]!;
      const rebuilt = buildPostDetailPayload(
        {
          format: requiredFormat,
          platform: targetPost.platform,
          activePlatforms: readStringArray(readRecord(targetPost.execution).active_platforms),
          pillar: targetPost.pillar,
          objective: targetPost.objective,
          hook: targetPost.hook,
          cta: targetPost.cta,
          caption: null,
          hashtags: null,
          strategicIntent: targetPost.strategicIntent,
          expectedMetric: targetPost.expectedMetric,
          expectedReason: targetPost.expectedReason,
          priority: targetPost.priority,
          execution: buildExecutionSeedForFormatRemap(targetPost),
        },
        { includeCopy: false },
      );
      next[targetIdx] = {
        ...targetPost,
        format: requiredFormat,
        execution: rebuilt.execution,
      };
      writePtr += 1;
    }
  }
  return next;
}

function buildExecutionSeedForFormatRemap(post: CalendarPost): Record<string, unknown> {
  const execution = readRecord(post.execution);
  const seed: Record<string, unknown> = {};
  const planningStage = readString(execution.planning_stage);
  if (planningStage) seed.planning_stage = planningStage;
  const week = readString(execution.week);
  if (week) seed.week = week;
  const targets = readStringArray(execution.repurpose_targets);
  if (targets.length > 0) seed.repurpose_targets = targets;
  const activePlatforms = readStringArray(execution.active_platforms);
  if (activePlatforms.length > 0) seed.active_platforms = activePlatforms;
  return seed;
}

async function validateAndRepairCalendarPosts(
  posts: CalendarPost[],
  calendarBrief: CalendarBrief,
  provider: LLMProvider,
): Promise<{
  posts: CalendarPost[];
  repairSummary?: BucketRepairSummary | null;
  repairPostCount?: number;
  validationDiagnostics?: {
    repairProvider?: { provider: string; model: string } | null;
    repairReason?: string | null;
    fieldRepairAttempted?: boolean;
    fieldRepairSucceeded?: boolean;
    fieldRepairCount?: number;
  };
}> {
  const workingPosts = posts.map((post) => structurallyNormalizeCalendarPost(post, calendarBrief));
  const aggregateIssues = validateCalendarAggregate(workingPosts, calendarBrief);
  const bucketRepairPlan = buildBucketRepairPlanIfNeeded(workingPosts, calendarBrief, aggregateIssues);
  const nonBucketAggregateIssues = aggregateIssues.filter((issue) => !issue.startsWith("bucket_"));
  if (nonBucketAggregateIssues.length > 0) {
    throw new CalendarValidationError(`Calendar aggregate validation failed: ${aggregateIssues.join("; ")}`, {
      repairAttempted: false,
      repairSucceeded: false,
    });
  }

  const initialFailures = workingPosts
    .map((post, index) => ({ index, post, issues: validateCalendarPost(post, calendarBrief) }))
    .filter((entry) => entry.issues.length > 0);
  const initialSummary = summarizeValidationEntries(initialFailures);
  if (initialFailures.length > 0) {
    console.info(
      `[llm-observe] calendar.validation.initial mode=${CALENDAR_RELIABLE_MODE} invalid_posts=${initialFailures.length} field_counts=${JSON.stringify(initialSummary.fieldCounts)} issue_counts=${JSON.stringify(initialSummary.issueCounts)}`,
    );
  }
  const repairableFailures: RepairRequest[] = initialFailures.filter((entry) =>
    entry.issues.every((issue) =>
      [
        "theme_invalid",
        "objective_invalid",
        "hook_invalid",
        "cta_invalid",
        "hook_generic",
        "unsupported_claim",
        "proof_contract_invalid",
        "wellness_claim_invalid",
        "business_type_mismatch",
      ].includes(issue.code),
    ),
  );
  const unrecoverableFailures = initialFailures.filter((entry) => !repairableFailures.includes(entry));
  if (unrecoverableFailures.length > 0) {
    throw new Error(
      `Calendar semantic validation failed: ${unrecoverableFailures
        .map((entry) => `post ${entry.index + 1} (${entry.issues.map((issue) => issue.code).join(", ")})`)
        .join("; ")}`,
    );
  }

  let repairSummary: BucketRepairSummary | null = null;
  if (bucketRepairPlan) {
    repairSummary = {
      attempted: true,
      succeeded: false,
      beforeCounts: countPostsBy(workingPosts, (post) => post.pillar),
      afterCounts: countPostsBy(workingPosts, (post) => post.pillar),
      changes: bucketRepairPlan.changes,
    };
    const byIndex = new Map<number, RepairRequest>();
    for (const failure of repairableFailures) byIndex.set(failure.index, failure);
    for (const repair of bucketRepairPlan.repairs) {
      const existing = byIndex.get(repair.index);
      if (existing) {
        existing.targetBucket = repair.targetBucket;
        existing.issues = [...existing.issues, { code: "bucket_mismatch_repair", field: "pillar" }];
      } else {
        byIndex.set(repair.index, {
          index: repair.index,
          post: repair.post,
          targetBucket: repair.targetBucket,
          issues: [{ code: "bucket_mismatch_repair", field: "pillar" }],
        });
      }
    }
    repairableFailures.splice(0, repairableFailures.length, ...Array.from(byIndex.values()).sort((a, b) => a.index - b.index));
  }

  if (repairableFailures.length === 0) {
    if (aggregateIssues.length === 0) {
      return {
        posts: workingPosts,
        repairSummary,
        repairPostCount: 0,
        validationDiagnostics: {
          repairProvider: null,
          repairReason: null,
          fieldRepairAttempted: false,
          fieldRepairSucceeded: false,
          fieldRepairCount: 0,
        },
      };
    }
    throw new CalendarValidationError(`Calendar aggregate validation failed: ${aggregateIssues.join("; ")}`, {
      repairAttempted: false,
      repairSucceeded: false,
      validationDiagnostics: {
        runMode: CALENDAR_RELIABLE_MODE,
        stage: "initial_validation",
        ...initialSummary,
      },
    });
  }

  const repairProvider = resolveRepairProvider(provider);
  const repairProviderInfo = repairProvider.describe?.() ?? null;
  const repairCreditsState = await readRepairCreditsState(provider);
  const repairedByModel = await repairInvalidCalendarPosts(repairableFailures, calendarBrief, repairProvider, {
    runMode: CALENDAR_RELIABLE_MODE,
    creditsStateBeforeRepair: repairCreditsState,
  });
  let merged = workingPosts.map((post, index) => repairedByModel.get(index) ?? post);
  let finalAggregateIssues = validateCalendarAggregate(merged, calendarBrief);
  let finalFailures = merged
    .map((post, index) => ({ index, issues: validateCalendarPost(post, calendarBrief) }))
    .filter((entry) => entry.issues.length > 0);
  let fieldRepairAttempted = false;
  let fieldRepairSucceeded = false;
  let fieldRepairCount = 0;
  const fieldRepairableFailures = finalFailures.filter((entry) =>
    entry.issues.every((issue) =>
      ["theme_invalid", "objective_invalid", "hook_invalid", "cta_invalid", "hook_generic"].includes(issue.code),
    ),
  );
  if (fieldRepairableFailures.length > 0 && fieldRepairableFailures.length <= 4) {
    fieldRepairAttempted = true;
    const fieldFixed = await repairInvalidCalendarFields(fieldRepairableFailures, merged, calendarBrief, repairProvider, {
      runMode: CALENDAR_RELIABLE_MODE,
      creditsStateBeforeRepair: repairCreditsState,
    });
    fieldRepairCount = fieldFixed.size;
    if (fieldFixed.size > 0) {
      merged = merged.map((post, index) => fieldFixed.get(index) ?? post);
      finalAggregateIssues = validateCalendarAggregate(merged, calendarBrief);
      finalFailures = merged
        .map((post, index) => ({ index, issues: validateCalendarPost(post, calendarBrief) }))
        .filter((entry) => entry.issues.length > 0);
      fieldRepairSucceeded = finalFailures.length === 0 && finalAggregateIssues.length === 0;
    }
  }
  const finalSummary = summarizeValidationEntries(finalFailures);
  if (finalFailures.length > 0 || finalAggregateIssues.length > 0) {
    console.info(
      `[llm-observe] calendar.validation.final mode=${CALENDAR_RELIABLE_MODE} invalid_posts=${finalFailures.length} field_counts=${JSON.stringify(finalSummary.fieldCounts)} issue_counts=${JSON.stringify(finalSummary.issueCounts)} aggregate_issues=${JSON.stringify(finalAggregateIssues)} field_repair_attempted=${fieldRepairAttempted} field_repair_succeeded=${fieldRepairSucceeded} field_repair_count=${fieldRepairCount}`,
    );
  }
  if (finalAggregateIssues.length === 0 && finalFailures.length === 0) {
    if (repairSummary) {
      repairSummary.succeeded = true;
      repairSummary.afterCounts = countPostsBy(merged, (post) => post.pillar);
    }
    return {
      posts: merged,
      repairSummary,
      repairPostCount: repairedByModel.size,
      validationDiagnostics: {
        repairProvider: repairProviderInfo,
        repairReason: repairedByModel.size > 0 ? "semantic_field_repair" : null,
        fieldRepairAttempted,
        fieldRepairSucceeded,
        fieldRepairCount,
      },
    };
  }
  if (finalFailures.length > 0) {
    throw new CalendarValidationError(
      `Calendar semantic validation failed after repair: ${finalFailures
        .map((entry) => `post ${entry.index + 1} (${entry.issues.map((issue) => issue.code).join(", ")})`)
        .join("; ")}`,
      {
        repairAttempted: repairedByModel.size > 0 || repairSummary?.attempted === true,
        repairSucceeded: false,
        repairChanges: repairSummary?.changes ?? [],
        validationDiagnostics: {
          runMode: CALENDAR_RELIABLE_MODE,
          stage: "repair_failed",
          ...finalSummary,
          repairBatchSize: 2,
          repairBatchCount: Math.ceil(repairableFailures.length / 2),
          repairReason: "semantic_field_repair",
          repairProvider: repairProviderInfo,
          creditsStateBeforeRepair: repairCreditsState,
          fieldRepairAttempted,
          fieldRepairSucceeded,
          fieldRepairCount,
        },
      },
    );
  }
  throw new CalendarValidationError(`Calendar aggregate validation failed after repair: ${finalAggregateIssues.join("; ")}`, {
    repairAttempted: repairSummary?.attempted === true,
    repairSucceeded: false,
    repairChanges: repairSummary?.changes ?? [],
    validationDiagnostics: {
      runMode: CALENDAR_RELIABLE_MODE,
      stage: "post_repair_validation",
      ...finalSummary,
      repairBatchSize: 2,
      repairBatchCount: Math.ceil(repairableFailures.length / 2),
      repairReason: "aggregate_bucket_repair",
      repairProvider: repairProviderInfo,
      creditsStateBeforeRepair: repairCreditsState,
      fieldRepairAttempted,
      fieldRepairSucceeded,
      fieldRepairCount,
    },
  });
}

async function repairInvalidCalendarPosts(
  invalidPosts: RepairRequest[],
  calendarBrief: CalendarBrief,
  provider: LLMProvider,
  options?: {
    runMode?: string;
    creditsStateBeforeRepair?: { usable: boolean; reason: string } | null;
  },
): Promise<Map<number, CalendarPost>> {
  const repaired = new Map<number, CalendarPost>();
  const batchSize = 2;
  const repairBriefMeta = buildCompactRepairBrief(calendarBrief, provider, "post");
  const briefForRepair = repairBriefMeta.brief;
  const providerInfo = provider.describe?.() ?? null;
  console.info(
    `[llm-observe] calendar.repair.start mode=${options?.runMode ?? CALENDAR_RELIABLE_MODE} invalid_posts=${invalidPosts.length} batch_size=${batchSize} batch_count=${Math.ceil(invalidPosts.length / batchSize)} repair_provider=${JSON.stringify(providerInfo)} credits=${JSON.stringify(options?.creditsStateBeforeRepair ?? null)} before_tokens=${repairBriefMeta.beforeTokens} after_tokens=${repairBriefMeta.afterTokens} target=${repairBriefMeta.providerBudgetTarget} trimmed_fields=${JSON.stringify(repairBriefMeta.trimmedFields)}`,
  );
  for (let offset = 0; offset < invalidPosts.length; offset += batchSize) {
    const batch = invalidPosts.slice(offset, offset + batchSize);
    const userPrompt = `CALENDAR BRIEF:
${JSON.stringify(briefForRepair)}

INVALID POSTS TO REPAIR:
${JSON.stringify(
      batch.map((entry) => ({
        index: entry.index,
        date: entry.post.date,
        platform: entry.post.platform,
        bucket: entry.targetBucket ?? entry.post.pillar,
        format: entry.post.format,
        theme: readCalendarMetadata(entry.post.metadata).theme ?? entry.post.angle,
        objective: entry.post.objective,
        hook: entry.post.hook,
        cta: entry.post.cta,
        strategicAngle: readCalendarMetadata(entry.post.metadata).strategicAngle ?? entry.post.strategicIntent,
        audienceTension: readCalendarMetadata(entry.post.metadata).audienceTension ?? entry.post.expectedReason,
        specificReference: readCalendarMetadata(entry.post.metadata).specificReference ?? null,
        proofMode: readCalendarMetadata(entry.post.metadata).proofMode ?? null,
        proofSource: readCalendarMetadata(entry.post.metadata).proofSource ?? null,
        claimSafetyNote: readCalendarMetadata(entry.post.metadata).claimSafetyNote ?? null,
        issues: entry.issues.map((issue) => issue.code),
        targetBucket: entry.targetBucket ?? entry.post.pillar,
      })),
      null,
      2,
    )}

Return repaired fields for every listed post.`;
    const repairPromptHash = hashPreview(userPrompt);
    console.info(
      `[llm-observe] calendar.repair.batch index=${Math.floor(offset / batchSize) + 1} size=${batch.length} prompt_hash=${repairPromptHash}`,
    );
    const parsed = await getCalendarJsonWithProviderFailover<{ posts?: Array<{
      index?: number;
      bucket?: string;
      theme?: string;
      objective?: string;
      hook?: string;
      cta?: string;
      strategicAngle?: string;
      audienceTension?: string;
      specificReference?: string;
      proofMode?: string;
      proofSource?: string;
      claimSafetyNote?: string;
    }> }>(provider, {
      contextLabel: "calendar repair",
      maxOutputTokens: CALENDAR_REPAIR_MAX_OUTPUT,
      messages: [
        { role: "system", content: REPAIR_POSTS_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    for (const candidate of parsed.posts ?? []) {
      const index = typeof candidate.index === "number" ? candidate.index : -1;
      const target = batch.find((entry) => entry.index === index);
      if (!target) continue;
      const repairedBucket = normalizePillarForCalendar(
        candidate.bucket ?? target.targetBucket ?? target.post.pillar,
        calendarBrief.requirements.contentBuckets,
        target.targetBucket ?? target.post.pillar,
      );
      repaired.set(index, structurallyNormalizeCalendarPost(
        {
          ...target.post,
          pillar: repairedBucket,
          angle: candidate.theme ?? target.post.angle,
          objective: candidate.objective ?? target.post.objective,
          hook: candidate.hook ?? target.post.hook,
          cta: candidate.cta ?? target.post.cta,
          strategicIntent: candidate.strategicAngle ?? candidate.objective ?? target.post.strategicIntent,
          expectedReason: candidate.audienceTension ?? candidate.specificReference ?? target.post.expectedReason,
          metadata: {
            ...(target.post.metadata ?? {}),
            bucket: repairedBucket,
            plannedBucket: target.targetBucket ?? readCalendarMetadata(target.post.metadata).plannedBucket ?? target.post.pillar,
            modelBucket: readCalendarMetadata(target.post.metadata).modelBucket ?? target.post.pillar,
            bucketForced: target.targetBucket ? repairedBucket !== target.post.pillar : readCalendarMetadata(target.post.metadata).bucketForced,
            theme: candidate.theme ?? readCalendarMetadata(target.post.metadata).theme ?? target.post.angle,
            strategicAngle: candidate.strategicAngle ?? readCalendarMetadata(target.post.metadata).strategicAngle ?? target.post.strategicIntent,
            audienceTension: candidate.audienceTension ?? readCalendarMetadata(target.post.metadata).audienceTension ?? target.post.expectedReason,
            specificReference: candidate.specificReference ?? readCalendarMetadata(target.post.metadata).specificReference,
            proofMode: candidate.proofMode ?? readCalendarMetadata(target.post.metadata).proofMode,
            proofSource: candidate.proofSource ?? readCalendarMetadata(target.post.metadata).proofSource,
            claimSafetyNote: candidate.claimSafetyNote ?? readCalendarMetadata(target.post.metadata).claimSafetyNote,
          },
        },
        calendarBrief,
      ));
    }
  }
  return repaired;
}

async function repairInvalidCalendarFields(
  invalidEntries: Array<{ index: number; issues: Array<{ code: string; field: string }> }>,
  posts: CalendarPost[],
  calendarBrief: CalendarBrief,
  provider: LLMProvider,
  options?: {
    runMode?: string;
    creditsStateBeforeRepair?: { usable: boolean; reason: string } | null;
  },
): Promise<Map<number, CalendarPost>> {
  const repaired = new Map<number, CalendarPost>();
  const batchSize = 2;
  const repairBriefMeta = buildCompactRepairBrief(calendarBrief, provider, "field");
  const briefForRepair = repairBriefMeta.brief;
  console.info(
    `[llm-observe] calendar.field_repair.start mode=${options?.runMode ?? CALENDAR_RELIABLE_MODE} invalid_posts=${invalidEntries.length} batch_size=${batchSize} credits=${JSON.stringify(options?.creditsStateBeforeRepair ?? null)} before_tokens=${repairBriefMeta.beforeTokens} after_tokens=${repairBriefMeta.afterTokens} target=${repairBriefMeta.providerBudgetTarget} trimmed_fields=${JSON.stringify(repairBriefMeta.trimmedFields)}`,
  );
  for (let offset = 0; offset < invalidEntries.length; offset += batchSize) {
    const batch = invalidEntries.slice(offset, offset + batchSize);
    const userPrompt = `CALENDAR BRIEF:
${JSON.stringify(briefForRepair)}

POST FIELDS TO REPAIR:
${JSON.stringify(
      batch.map((entry) => {
        const post = posts[entry.index]!;
        const theme = readCalendarMetadata(post.metadata).theme ?? post.angle;
        return {
          index: entry.index,
          platform: post.platform,
          bucket: post.pillar,
          format: post.format,
          current: {
            theme,
            objective: post.objective,
            hook: post.hook,
            cta: post.cta,
            strategicAngle: readCalendarMetadata(post.metadata).strategicAngle ?? post.strategicIntent,
            audienceTension: readCalendarMetadata(post.metadata).audienceTension ?? post.expectedReason,
            specificReference: readCalendarMetadata(post.metadata).specificReference ?? null,
            proofMode: readCalendarMetadata(post.metadata).proofMode ?? null,
            proofSource: readCalendarMetadata(post.metadata).proofSource ?? null,
            claimSafetyNote: readCalendarMetadata(post.metadata).claimSafetyNote ?? null,
          },
          invalidFields: entry.issues
            .map((issue) => issue.field),
        };
      }),
      null,
      2,
    )}

Return only the repaired requested fields for each listed post.`;
    const promptHash = hashPreview(userPrompt);
    console.info(
      `[llm-observe] calendar.field_repair.batch index=${Math.floor(offset / batchSize) + 1} size=${batch.length} prompt_hash=${promptHash}`,
    );
    const parsed = await getCalendarJsonWithProviderFailover<{ posts?: Array<{
      index?: number;
      theme?: string;
      objective?: string;
      hook?: string;
      cta?: string;
      strategicAngle?: string;
      audienceTension?: string;
      specificReference?: string;
      proofMode?: string;
      proofSource?: string;
      claimSafetyNote?: string;
    }> }>(provider, {
      contextLabel: "calendar field repair",
      maxOutputTokens: 120,
      messages: [
        { role: "system", content: FIELD_REPAIR_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });
    for (const candidate of parsed.posts ?? []) {
      const index = typeof candidate.index === "number" ? candidate.index : -1;
      const target = batch.find((entry) => entry.index === index);
      if (!target) continue;
      const post = posts[index]!;
      repaired.set(index, structurallyNormalizeCalendarPost(
        {
          ...post,
          angle: candidate.theme ?? post.angle,
          objective: candidate.objective ?? post.objective,
          hook: candidate.hook ?? post.hook,
          cta: candidate.cta ?? post.cta,
          strategicIntent: candidate.strategicAngle ?? candidate.objective ?? post.strategicIntent,
          expectedReason: candidate.audienceTension ?? candidate.specificReference ?? post.expectedReason,
          metadata: {
            ...(post.metadata ?? {}),
            theme: candidate.theme ?? readCalendarMetadata(post.metadata).theme ?? post.angle,
            strategicAngle: candidate.strategicAngle ?? readCalendarMetadata(post.metadata).strategicAngle ?? post.strategicIntent,
            audienceTension: candidate.audienceTension ?? readCalendarMetadata(post.metadata).audienceTension ?? post.expectedReason,
            specificReference: candidate.specificReference ?? readCalendarMetadata(post.metadata).specificReference,
            proofMode: candidate.proofMode ?? readCalendarMetadata(post.metadata).proofMode,
            proofSource: candidate.proofSource ?? readCalendarMetadata(post.metadata).proofSource,
            claimSafetyNote: candidate.claimSafetyNote ?? readCalendarMetadata(post.metadata).claimSafetyNote,
          },
        },
        calendarBrief,
      ));
    }
  }
  return repaired;
}

function structurallyNormalizeCalendarPost(post: CalendarPost, calendarBrief: CalendarBrief): CalendarPost {
  const bucket = normalizePillarForCalendar(
    post.pillar,
    calendarBrief.requirements.contentBuckets,
    Object.keys(calendarBrief.requirements.contentBuckets)[0] ?? "Education",
  );
  const metadata = readCalendarMetadata(post.metadata);
  const safeTheme = normalizeSemanticString(metadata.theme) ?? normalizeSemanticString(post.angle) ?? "";
  const safeObjective = normalizeSemanticString(post.objective) ?? "";
  const safeHook = normalizeSemanticString(post.hook) ?? "";
  const safeCta = normalizeSemanticString(post.cta) ?? "";
  const safeStrategicAngle = normalizeSemanticString(metadata.strategicAngle) ?? normalizeSemanticString(post.strategicIntent);
  const safeAudienceTension = normalizeSemanticString(metadata.audienceTension) ?? normalizeSemanticString(post.expectedReason);
  const safeSpecificReference = normalizeSemanticString(metadata.specificReference);
  const safeProofMode = normalizeSemanticString(metadata.proofMode);
  const safeProofSource = normalizeSemanticString(metadata.proofSource);
  const safeClaimSafetyNote = normalizeSemanticString(metadata.claimSafetyNote);
  const rebuilt = buildPostDetailPayload(
    {
      format: post.format,
      platform: post.platform,
      activePlatforms: calendarBrief.requirements.platforms,
      pillar: bucket,
      objective: safeObjective,
      hook: safeHook,
      cta: safeCta,
      caption: null,
      hashtags: null,
      strategicIntent: safeStrategicAngle ?? normalizeSemanticString(post.strategicIntent) ?? safeObjective,
      expectedMetric: post.expectedMetric,
      expectedReason: safeAudienceTension ?? post.expectedReason,
      priority: post.priority,
      execution: {
        ...(post.execution ?? {}),
        planning_stage: "monthly_skeleton",
      },
    },
    { includeCopy: false },
  );
  return {
    ...post,
    pillar: bucket,
    angle: safeTheme,
    objective: safeObjective,
    hook: safeHook,
    cta: safeCta,
    strategicIntent: safeStrategicAngle ?? post.strategicIntent,
    expectedReason: safeAudienceTension ?? post.expectedReason,
    execution: rebuilt.execution,
    metadata: {
      ...(post.metadata ?? {}),
      bucket,
      plannedBucket: metadata.plannedBucket ?? bucket,
      modelBucket: metadata.modelBucket ?? bucket,
      bucketForced: metadata.bucketForced === true,
      theme: safeTheme,
      strategicAngle: safeStrategicAngle,
      audienceTension: safeAudienceTension,
      specificReference: safeSpecificReference,
      proofMode: safeProofMode,
      proofSource: safeProofSource,
      claimSafetyNote: safeClaimSafetyNote,
    },
  };
}

function buildBucketRepairPlanIfNeeded(
  posts: CalendarPost[],
  calendarBrief: CalendarBrief,
  issues: string[],
): { repairs: Array<{ index: number; post: CalendarPost; targetBucket: string }>; changes: BucketRepairChange[] } | null {
  const bucketIssues = issues.filter((issue) => issue.startsWith("bucket_"));
  const nonBucketIssues = issues.filter((issue) => !issue.startsWith("bucket_"));
  if (bucketIssues.length === 0 || nonBucketIssues.length > 0) return null;
  const expected = calendarBrief.requirements.contentBuckets;
  const actual = countPostsBy(posts, (post) => post.pillar);
  const surplus = Object.entries(expected)
    .map(([bucket, target]) => ({ bucket, delta: (actual[bucket] ?? 0) - target }))
    .filter((entry) => entry.delta > 0);
  const deficits = Object.entries(expected)
    .map(([bucket, target]) => ({ bucket, delta: target - (actual[bucket] ?? 0) }))
    .filter((entry) => entry.delta > 0);
  const totalMovesNeeded = deficits.reduce((sum, entry) => sum + entry.delta, 0);
  if (surplus.length === 0 || deficits.length === 0) return null;
  if (totalMovesNeeded > 4) return null;
  const used = new Set<number>();
  const repairs: Array<{ index: number; post: CalendarPost; targetBucket: string }> = [];
  const changes: BucketRepairChange[] = [];
  for (const deficit of deficits) {
    let remaining = deficit.delta;
    while (remaining > 0) {
      const candidate = selectBucketRepairCandidate(posts, surplus, deficit.bucket, used);
      if (!candidate) return null;
      const targetPost = posts[candidate.index]!;
      used.add(candidate.index);
      repairs.push({ index: candidate.index, post: targetPost, targetBucket: deficit.bucket });
      changes.push({
        index: candidate.index,
        date: targetPost.date,
        platform: targetPost.platform,
        format: targetPost.format,
        fromBucket: candidate.fromBucket,
        toBucket: deficit.bucket,
        reason: candidate.reason,
      });
      const sourceBucket = surplus.find((entry) => entry.bucket === candidate.fromBucket);
      if (sourceBucket) sourceBucket.delta -= 1;
      remaining -= 1;
    }
  }
  return { repairs, changes };
}

function selectBucketRepairCandidate(
  posts: CalendarPost[],
  surplus: Array<{ bucket: string; delta: number }>,
  targetBucket: string,
  used: Set<number>,
): { index: number; fromBucket: string; reason: string } | null {
  const candidates = posts
    .map((post, index) => ({ post, index }))
    .filter(({ post, index }) => !used.has(index) && (surplus.find((entry) => entry.bucket === post.pillar)?.delta ?? 0) > 0)
    .map(({ post, index }) => {
      const metadata = readCalendarMetadata(post.metadata);
      const semanticText = [metadata.theme, post.angle, post.objective, post.hook].filter(Boolean).join(" ");
      let score = 0;
      if (!isSemanticallyAlignedWithBucket(semanticText, post.pillar)) score += 4;
      if (isSemanticallyAlignedWithBucket(semanticText, targetBucket)) score += 5;
      if (metadata.modelBucket && normalizeBucketToken(metadata.modelBucket) === normalizeBucketToken(targetBucket)) score += 3;
      if (post.platform === "Pinterest" && normalizeBucketToken(targetBucket) === "social_proof") score += 1;
      if (normalizeBucketToken(post.pillar) === "education" && normalizeBucketToken(targetBucket) === "social_proof") score += 2;
      return {
        index,
        fromBucket: post.pillar,
        score,
        reason:
          score >= 8
            ? "existing semantics were closer to the deficit bucket than the source bucket"
            : "minimal deterministic bucket rebalance",
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0] ?? null;
}

function validateCalendarPost(
  post: CalendarPost,
  calendarBrief: CalendarBrief,
): Array<{ code: string; field: string }> {
  const issues: Array<{ code: string; field: string }> = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date)) issues.push({ code: "date_invalid", field: "date" });
  if (!calendarBrief.requirements.platforms.includes(post.platform)) {
    issues.push({ code: "platform_invalid", field: "platform" });
  }
  if (!Object.prototype.hasOwnProperty.call(calendarBrief.requirements.contentBuckets, post.pillar)) {
    issues.push({ code: "bucket_invalid", field: "pillar" });
  }
  const metadata = readCalendarMetadata(post.metadata);
  const theme = metadata.theme ?? post.angle;
  if (!isValidSemanticField(theme)) issues.push({ code: "theme_invalid", field: "theme" });
  if (!isValidSemanticField(post.objective)) issues.push({ code: "objective_invalid", field: "objective" });
  if (!isValidSemanticField(post.hook)) issues.push({ code: "hook_invalid", field: "hook" });
  if (!isValidSemanticField(post.cta)) issues.push({ code: "cta_invalid", field: "cta" });
  if (isOverGenericHook(post.hook, calendarBrief)) issues.push({ code: "hook_generic", field: "hook" });
  if (!post.execution || typeof post.execution !== "object" || Array.isArray(post.execution)) {
    issues.push({ code: "execution_missing", field: "execution" });
  }
  const combined = [
    theme,
    post.objective,
    post.hook,
    post.cta,
    metadata.strategicAngle,
    metadata.audienceTension,
    metadata.specificReference,
    metadata.proofMode,
    metadata.proofSource,
    metadata.claimSafetyNote,
  ].join(" ");
  if (containsUnsupportedClaims(combined)) {
    issues.push({ code: "unsupported_claim", field: "semantic_fields" });
  }
  if (usesDisallowedProofLanguage(combined, calendarBrief)) {
    issues.push({ code: "proof_contract_invalid", field: "semantic_fields" });
  }
  if (usesUnsafeWellnessClaim(combined, calendarBrief)) {
    issues.push({ code: "wellness_claim_invalid", field: "semantic_fields" });
  }
  if (containsBusinessTypeMismatch(combined, calendarBrief)) {
    issues.push({ code: "business_type_mismatch", field: "semantic_fields" });
  }
  return issues;
}

function readCalendarMetadata(
  metadata: Record<string, unknown> | null | undefined,
): {
  bucket?: string;
  theme?: string;
  plannedBucket?: string;
  modelBucket?: string;
  bucketForced?: boolean;
  strategicAngle?: string;
  audienceTension?: string;
  specificReference?: string;
  proofMode?: string;
  proofSource?: string;
  claimSafetyNote?: string;
} {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    bucket: typeof record.bucket === "string" ? record.bucket.trim() : undefined,
    theme: typeof record.theme === "string" ? record.theme.trim() : undefined,
    plannedBucket: typeof record.plannedBucket === "string" ? record.plannedBucket.trim() : undefined,
    modelBucket: typeof record.modelBucket === "string" ? record.modelBucket.trim() : undefined,
    bucketForced: record.bucketForced === true,
    strategicAngle: typeof record.strategicAngle === "string" ? record.strategicAngle.trim() : undefined,
    audienceTension: typeof record.audienceTension === "string" ? record.audienceTension.trim() : undefined,
    specificReference: typeof record.specificReference === "string" ? record.specificReference.trim() : undefined,
    proofMode: typeof record.proofMode === "string" ? record.proofMode.trim() : undefined,
    proofSource: typeof record.proofSource === "string" ? record.proofSource.trim() : undefined,
    claimSafetyNote: typeof record.claimSafetyNote === "string" ? record.claimSafetyNote.trim() : undefined,
  };
}

function normalizeSemanticString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function isValidSemanticField(value: string | null | undefined): boolean {
  const normalized = normalizeSemanticString(value);
  if (!normalized) return false;
  if (containsPlaceholderText(normalized)) return false;
  if (containsUnsupportedClaims(normalized)) return false;
  return true;
}

function isOverGenericHook(value: string | null | undefined, calendarBrief: CalendarBrief): boolean {
  const normalized = normalizeSemanticString(value)?.toLowerCase();
  if (!normalized) return false;
  const genericPatterns = [
    /\bdiscover\b.*\bcalm\b/,
    /\bperfect gift\b/,
    /\bfind your perfect\b/,
    /\bpeople love\b/,
    /\breal people\b.*\breal results\b/,
    /\bnatural stress relief\b/,
  ];
  if (genericPatterns.some((pattern) => pattern.test(normalized))) return true;
  const anchors = buildClientIdeaAnchors(calendarBrief, 8).map((item) => item.toLowerCase());
  const hasAnchor = anchors.some((anchor) => anchor.length >= 4 && normalized.includes(anchor));
  return !hasAnchor && normalized.split(/\s+/).length <= 6 && /\bdiscover|find|perfect|love|calm|better\b/.test(normalized);
}

function containsPlaceholderText(value: string): boolean {
  return /\btheme to refine\b|\bnot set yet\b|why the current approach keeps\b/i.test(value);
}

function containsUnsupportedClaims(value: string): boolean {
  return /\beco(?:-|\s)?friendly\b|\bsustainab(?:le|ility)\b|\beco(?:-|\s)?packag(?:e|ing)\b|\bgreener planet\b|\bclean[-\s]?label\b|\banxiety\b|\btreat(?:s|ing|ment)?\b|\bcure\b|\bfix(?:es|ing)?\b|\bguaranteed\b|\bphysiological\b/i.test(
    value,
  );
}

function usesDisallowedProofLanguage(value: string, calendarBrief: CalendarBrief): boolean {
  if (calendarBrief.proofContract.testimonialStyleAllowed) return false;
  return /\breal people\b|\breal results\b|\btestimonial\b|\bpeople love\b|\bcustomer favorite\b|\buser review\b|\bsee reviews\b/i.test(value);
}

function usesUnsafeWellnessClaim(value: string, calendarBrief: CalendarBrief): boolean {
  if (calendarBrief.safety.healthClaimSafetyMode !== "wellness_beauty_softened") return false;
  return /\bnatural stress relief\b|\bhelps calm minds\b|\bfix(?:es|ing)? sleep\b|\bsee calm results\b|\bguaranteed relaxation\b/i.test(value);
}

function seedFromPost(post?: Pick<CalendarPost, "date" | "platform" | "format">): number {
  const input = `${post?.date ?? ""}|${post?.platform ?? ""}|${post?.format ?? ""}`;
  if (!input.trim()) return 0;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isSemanticallyAlignedWithBucket(value: string | null | undefined, bucket: string): boolean {
  const normalized = normalizeSemanticString(value)?.toLowerCase();
  if (!normalized) return false;
  const token = normalizeBucketToken(bucket);
  if (token === "promotion") return /\bdiscover|shop|gift|choose|explore|collection|variant|notes|ritual fit|buy\b/.test(normalized);
  if (token === "social_proof") return /\bproof|faq|reassur|objection|review|question|trust|believable|what to know\b/.test(normalized);
  if (token === "thought_leadership") return /\bfounder|perspective|point of view|category|why|trend|rethink|lens\b/.test(normalized);
  return /\bhow|what|why|guide|benefit|explain|difference|education|learn\b/.test(normalized);
}

function validateCalendarAggregate(posts: CalendarPost[], calendarBrief: CalendarBrief): string[] {
  const issues: string[] = [];
  if (posts.length !== calendarBrief.requirements.totalPosts) {
    issues.push(`total_posts expected ${calendarBrief.requirements.totalPosts} got ${posts.length}`);
  }
  const actualPlatforms = countPostsBy(posts, (post) => post.platform);
  for (const [platform, expected] of Object.entries(calendarBrief.requirements.platformCounts)) {
    const actual = actualPlatforms[platform] ?? 0;
    if (actual !== expected) issues.push(`platform_${platform} expected ${expected} got ${actual}`);
  }
  const actualBuckets = countPostsBy(posts, (post) => post.pillar);
  for (const [bucket, expected] of Object.entries(calendarBrief.requirements.contentBuckets)) {
    const actual = actualBuckets[bucket] ?? 0;
    if (actual !== expected) issues.push(`bucket_${bucket} expected ${expected} got ${actual}`);
  }
  return issues;
}

function countPostsBy(posts: CalendarPost[], getValue: (post: CalendarPost) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const post of posts) {
    const key = getValue(post);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function summarizeValidationEntries(
  entries: Array<{ index: number; issues: Array<{ code: string; field: string }> }>,
): Pick<ValidationDiagnostics, "invalidPostIndexes" | "fieldCounts" | "issueCounts"> {
  const fieldCounts: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};
  for (const entry of entries) {
    for (const issue of entry.issues) {
      fieldCounts[issue.field] = (fieldCounts[issue.field] ?? 0) + 1;
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }
  return {
    invalidPostIndexes: entries.map((entry) => entry.index),
    fieldCounts,
    issueCounts,
  };
}

function resolveRepairProvider(provider: LLMProvider): LLMProvider {
  const info = provider.describe?.();
  if (!info || !info.provider || info.provider === "multi" || info.provider === "fallback") {
    return provider;
  }
  try {
    return createLLMProvider(info.provider as Parameters<typeof createLLMProvider>[0], { model: info.model });
  } catch {
    return provider;
  }
}

async function readRepairCreditsState(provider: LLMProvider): Promise<{ usable: boolean; reason: string } | null> {
  const info = provider.describe?.();
  if (!info) return null;
  if (info.provider === "openrouter" || info.provider === "multi") {
    try {
      return await checkOpenRouterCreditsAvailable();
    } catch {
      return { usable: false, reason: "credits_check_failed" };
    }
  }
  return null;
}

function preferredFallbackPlatform(platforms: string[]): string {
  const ordered = ["Instagram", "LinkedIn", "X", "Pinterest", "YouTube"];
  for (const platform of ordered) {
    const match = platforms.find((value) => normalizePlatformName(value, platform) === platform);
    if (match) return normalizePlatformName(match, platform);
  }
  return normalizePlatformName(platforms[0], "Instagram");
}

function normalizePlatformName(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "x" || raw.includes("twitter")) return "X";
  if (raw.includes("linkedin")) return "LinkedIn";
  if (raw.includes("pinterest")) return "Pinterest";
  if (raw.includes("youtube")) return "YouTube";
  if (raw.includes("instagram")) return "Instagram";
  return fallback;
}

function normalizeFormatForPlatform(format: string, platform: string): string {
  const lower = format.trim().toLowerCase();
  if (platform === "Instagram") {
    if (lower.includes("story")) return "story";
    if (lower.includes("carousel")) return "carousel";
    if (lower.includes("static") || lower.includes("image")) return "static";
    if (lower.includes("reel") || lower.includes("short") || lower.includes("video")) return "reel";
    return "carousel";
  }
  if (platform === "LinkedIn") {
    if (lower.includes("pdf")) return "pdf carousel";
    if (lower.includes("carousel")) return "carousel";
    if (lower.includes("video") || lower.includes("short")) return "short video";
    if (lower.includes("text") || lower.includes("post")) return "text post";
    return "text post";
  }
  if (platform === "X") {
    if (lower.includes("thread")) return "thread";
    if (lower.includes("image") || lower.includes("static")) return "image post";
    if (lower.includes("text") || lower.includes("post")) return "text post";
    return "text post";
  }
  if (platform === "Pinterest") {
    if (lower.includes("video")) return "video pin";
    if (lower.includes("pin") || lower.includes("static") || lower.includes("image")) return "static pin";
    return "static pin";
  }
  if (platform === "YouTube") {
    if (lower.includes("community")) return "community post";
    if (lower.includes("long")) return "long video";
    if (lower.includes("short") || lower.includes("reel") || lower.includes("video")) return "short video";
    return "short video";
  }
  return lower || "carousel";
}

function defaultPlatformRole(platform: string, strategyType: string): string {
  if (platform === "Instagram") {
    if (strategyType === "personal_brand") return "Daily audience trust and personality transfer";
    if (strategyType === "performance_marketing") return "Top-to-mid funnel demand capture and proof";
    return "Visual trust-building and repeat discovery";
  }
  if (platform === "LinkedIn") return "Authority building and professional trust";
  if (platform === "X") return "Fast perspective-led conversation";
  if (platform === "Pinterest") return "Searchable evergreen discovery";
  if (platform === "YouTube") return "Deeper education and trust transfer";
  return "Audience growth and brand reinforcement";
}

function defaultPlatformObjective(platform: string, strategyType: string): string {
  if (strategyType === "performance_marketing") {
    if (platform === "Pinterest") return "Drive qualified clicks to specific offers";
    return "Convert qualified attention into direct action";
  }
  if (strategyType === "personal_brand") return "Strengthen familiarity, trust, and response";
  if (strategyType === "d2c_growth") return "Increase product interest, proof, and repeat intent";
  return "Build awareness, trust, and meaningful engagement";
}

function defaultPlatformBehavior(platform: string): string {
  if (platform === "Instagram") return "Use hooks that stop the scroll and reward saves, shares, DMs, or comments.";
  if (platform === "LinkedIn") return "Lead with a sharp professional insight, observation, or framework.";
  if (platform === "X") return "Keep ideas punchy, opinionated, and easy to react to or repost.";
  if (platform === "Pinterest") return "Favor evergreen, practical, searchable, click-worthy planning angles.";
  if (platform === "YouTube") return "Favor educational depth, curiosity, and strong retention hooks.";
  return "Keep the content native to the platform and concise.";
}

function defaultCtaStyleForPlatform(
  platform: string,
  strategyType: string,
  paidScopeExplicit: boolean,
  instagramClue: string,
): string {
  if (platform === "Instagram") {
    if (strategyType === "brand_building" && !paidScopeExplicit) {
      return instagramClue.includes("dm") ? "DM, reply, save, share, or comment" : "Save, share, reply, or comment";
    }
    return "DM, comment, click, or save";
  }
  if (platform === "LinkedIn") return "Comment, connect, follow, or DM";
  if (platform === "X") return "Reply, repost, or bookmark";
  if (platform === "Pinterest") return "Save or click";
  if (platform === "YouTube") return "Comment, subscribe, or watch next";
  return "Comment or click";
}

function normalizeRepurposeTargets(
  value: unknown,
  activePlatforms: string[],
  sourcePlatform: string,
): string[] {
  const allowed = new Set(activePlatforms.map((platform) => normalizePlatformName(platform, platform)));
  allowed.add(normalizePlatformName(sourcePlatform, sourcePlatform));
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .filter((target) => {
          const targetPlatform = normalizePlatformName(target.split("-")[0] ?? "", "");
          return allowed.has(targetPlatform);
        })
        .slice(0, 2)
    : [];
}

function requiredFormatsForPlatform(platform: string, count: number): string[] {
  if (count < 2) return [];
  if (platform.includes("instagram")) return count >= 4 ? ["carousel", "reel", "story"] : ["carousel", "reel"];
  if (platform.includes("linkedin")) return ["text post", "carousel"];
  if (platform === "x") return ["text post", "thread"];
  if (platform.includes("pinterest")) return ["static pin", "video pin"];
  if (platform.includes("youtube")) return ["short video", "community post"];
  return [];
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitAcrossWeeks(total: number, weeks: number): number[] {
  if (weeks <= 0) return [];
  const base = Math.floor(total / weeks);
  const remainder = total % weeks;
  return Array.from({ length: weeks }, (_, idx) => base + (idx < remainder ? 1 : 0));
}

async function runWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const out: TResult[] = [];
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      out.push(await worker(next));
    }
  });
  await Promise.all(workers);
  return out;
}

function toWeeklyFlowRecord(weeklyFlow: string[]): Record<string, string> {
  return {
    week_1: weeklyFlow[0] ?? "Awareness and discovery",
    week_2: weeklyFlow[1] ?? "Education and trust",
    week_3: weeklyFlow[2] ?? "Offer and action momentum",
    week_4: weeklyFlow[3] ?? "Proof and community reinforcement",
  };
}

function toKpiMap(kpis: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  kpis.slice(0, 6).forEach((kpi, index) => {
    out[`kpi_${index + 1}`] = kpi;
  });
  return out;
}

function buildDefaultPhases(weeklyFlow: string[]): Array<{ name: string; focus: string }> {
  return weeklyFlow.slice(0, 4).map((focus, index) => ({
    name: `Week ${index + 1}`,
    focus,
  }));
}
