import {
  buildPromptBudgetStats,
  PromptBudgetError,
  type PromptBudgetStats,
} from "../llm/prompt-budget.js";
import {
  applyWeekCompactionTier,
  buildWeeklyPromptPartsFromCompact,
  type CalendarCompactionTier,
  type CompactCalendarWeekContext,
} from "./compact-calendar-context.js";
import {
  resolveCalendarMaxOutputTokens,
  resolveCalendarTargetInputTokens,
  CALENDAR_WEEK_SAFE_INPUT_GROQ,
} from "./provider-budget.js";
import {
  buildWeeklyInstructionBlock,
  resolveWeekPostsSystemPrompt,
} from "./weekly-prompt.js";

export type WeeklyCompactionResult = {
  brief: CompactCalendarWeekContext;
  beforeTokens: number;
  afterTokens: number;
  providerBudgetTarget: number;
  compactionApplied: boolean;
  compactionTier: CalendarCompactionTier;
  trimmedFields: string[];
  systemPrompt: string;
  promptParts: Array<{ label: string; value: string }>;
  prompt: string;
  overBudget: boolean;
};

function resolveWeekCompactionTarget(providerId: string): number {
  return providerId === "groq"
    ? CALENDAR_WEEK_SAFE_INPUT_GROQ
    : resolveCalendarTargetInputTokens(providerId, "week");
}

function measureWeeklyPromptInput(
  label: string,
  providerId: string,
  brief: CompactCalendarWeekContext,
  targetCount: number,
  systemPrompt: string,
  maxOutputTokens: number,
  compactionTier: CalendarCompactionTier = 0,
): PromptBudgetStats {
  const instructionBlock = buildWeeklyInstructionBlock(providerId, targetCount);
  return buildPromptBudgetStats(
    label,
    [
      { label: "system", value: systemPrompt },
      ...buildWeeklyPromptPartsFromCompact(brief, targetCount, instructionBlock, {
        providerId,
        compactionTier,
      }),
    ],
    resolveCalendarTargetInputTokens(providerId, "week"),
    maxOutputTokens,
  );
}

export function compactWeeklyBriefForProvider(input: {
  brief: CompactCalendarWeekContext;
  targetCount: number;
  providerId: string;
}): WeeklyCompactionResult {
  const providerBudgetTarget = resolveCalendarTargetInputTokens(input.providerId, "week");
  const compactionTarget = resolveWeekCompactionTarget(input.providerId);
  const systemPrompt = resolveWeekPostsSystemPrompt(input.providerId);
  const maxOutputTokens = resolveCalendarMaxOutputTokens({
    providerId: input.providerId,
    stage: "week",
    postsInBatch: input.targetCount,
  });

  const beforeStats = measureWeeklyPromptInput(
    `${input.brief.weekLabel} pre-compact`,
    input.providerId,
    input.brief,
    input.targetCount,
    systemPrompt,
    maxOutputTokens,
    0,
  );

  const buildResult = (
    brief: CompactCalendarWeekContext,
    tier: CalendarCompactionTier,
    trimmedFields: string[],
    afterStats: PromptBudgetStats,
  ): WeeklyCompactionResult => {
    const instructionBlock = buildWeeklyInstructionBlock(input.providerId, input.targetCount);
    const promptParts = buildWeeklyPromptPartsFromCompact(brief, input.targetCount, instructionBlock, {
      providerId: input.providerId,
      compactionTier: tier,
    });
    const prompt = promptParts.map((part) => part.value).join("");
    return {
      brief,
      beforeTokens: beforeStats.estimatedInputTokens,
      afterTokens: afterStats.estimatedInputTokens,
      providerBudgetTarget,
      compactionApplied: afterStats.estimatedInputTokens < beforeStats.estimatedInputTokens,
      compactionTier: tier,
      trimmedFields,
      systemPrompt,
      promptParts,
      prompt,
      overBudget: afterStats.estimatedInputTokens > providerBudgetTarget,
    };
  };

  if (beforeStats.estimatedInputTokens <= compactionTarget) {
    return buildResult(input.brief, 0, [], beforeStats);
  }

  const tiers: Array<{ tier: CalendarCompactionTier; label: string }> = [
    { tier: 1, label: "tier_1_compaction" },
    { tier: 2, label: "tier_2_compaction" },
    { tier: 3, label: "tier_3_compaction" },
  ];

  let draft = input.brief;
  let afterStats = beforeStats;
  let compactionTier: CalendarCompactionTier = 0;
  const trimmedFields: string[] = [];

  for (const step of tiers) {
    draft = applyWeekCompactionTier(input.brief, step.tier);
    afterStats = measureWeeklyPromptInput(
      `${draft.weekLabel} compact tier ${step.tier}`,
      input.providerId,
      draft,
      input.targetCount,
      systemPrompt,
      maxOutputTokens,
      step.tier,
    );
    compactionTier = step.tier;
    trimmedFields.push(step.label);
    if (afterStats.estimatedInputTokens <= compactionTarget) {
      return buildResult(draft, compactionTier, trimmedFields, afterStats);
    }
  }

  return buildResult(draft, compactionTier, trimmedFields, afterStats);
}

export function enforceWeeklyInputBeforeProviderCall(input: {
  providerId: string;
  stageLabel: string;
  systemPrompt: string;
  promptParts: Array<{ label: string; value: string }>;
  maxOutputTokens: number;
  compactionTier: CalendarCompactionTier;
  budgetGuardEnabled: boolean;
}): PromptBudgetStats {
  const maxInput = resolveCalendarTargetInputTokens(input.providerId, "week");
  const stats = buildPromptBudgetStats(
    input.stageLabel,
    [{ label: "system", value: input.systemPrompt }, ...input.promptParts],
    maxInput,
    input.maxOutputTokens,
  );

  const groqOverTarget =
    input.providerId === "groq" && stats.estimatedInputTokens > maxInput;

  if (groqOverTarget || input.budgetGuardEnabled) {
    if (stats.estimatedInputTokens > maxInput) {
      const err = new PromptBudgetError(stats);
      Object.assign(err, { compactionTier: input.compactionTier });
      throw err;
    }
  }

  return stats;
}

export function buildTier3WeekBrief(input: {
  brief: CompactCalendarWeekContext;
  targetCount: number;
  providerId: string;
}): WeeklyCompactionResult {
  const tier3Brief = applyWeekCompactionTier(input.brief, 3);
  const systemPrompt = resolveWeekPostsSystemPrompt(input.providerId);
  const maxOutputTokens = resolveCalendarMaxOutputTokens({
    providerId: input.providerId,
    stage: "week",
    postsInBatch: input.targetCount,
  });
  const afterStats = measureWeeklyPromptInput(
    `${tier3Brief.weekLabel} tier 3 retry`,
    input.providerId,
    tier3Brief,
    input.targetCount,
    systemPrompt,
    maxOutputTokens,
    3,
  );
  const instructionBlock = buildWeeklyInstructionBlock(input.providerId, input.targetCount);
  const promptParts = buildWeeklyPromptPartsFromCompact(tier3Brief, input.targetCount, instructionBlock, {
    providerId: input.providerId,
    compactionTier: 3,
  });
  return {
    brief: tier3Brief,
    beforeTokens: afterStats.estimatedInputTokens,
    afterTokens: afterStats.estimatedInputTokens,
    providerBudgetTarget: resolveCalendarTargetInputTokens(input.providerId, "week"),
    compactionApplied: true,
    compactionTier: 3,
    trimmedFields: ["tier_3_compaction"],
    systemPrompt,
    promptParts,
    prompt: promptParts.map((part) => part.value).join(""),
    overBudget: afterStats.estimatedInputTokens > resolveCalendarTargetInputTokens(input.providerId, "week"),
  };
}

export function isGroqRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const httpStatus =
    err && typeof err === "object" && "httpStatus" in err
      ? (err as { httpStatus?: number }).httpStatus
      : err && typeof err === "object" && "status" in err
        ? (err as { status?: number }).status
        : undefined;
  return (
    httpStatus === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("tokens per minute") ||
    /\btpm\b/.test(lower)
  );
}
