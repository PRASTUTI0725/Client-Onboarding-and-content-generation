export type CalendarStageBudgetSnapshot = {
  stage: string;
  estimatedInputTokens: number;
  maxInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  compactionTier: number;
  promptSegments?: Array<{ label: string; chars: number; estimatedTokens: number }>;
  cumulativeEstimatedGroqTokens?: number;
  delayMsApplied?: number;
  weekRetryCount?: number;
  failedWeekIndex?: number;
  beforeCompactionTokens?: number;
  afterCompactionTokens?: number;
};

export type CalendarGenerationTrace = {
  updatedAt: string;
  codePath: "compact_calendar_v1";
  primaryProviderId: string;
  weekConcurrency: number;
  weekStaggerMs: number;
  plannerBudget: CalendarStageBudgetSnapshot | null;
  weeklyBriefHashes: Array<Record<string, unknown>> | null;
  calendarPlan: Record<string, unknown> | null;
  lastAttemptedStage: string | null;
  stagesAttempted: CalendarStageBudgetSnapshot[];
};

let lastCalendarGenerationTrace: CalendarGenerationTrace | null = null;

export function resetCalendarGenerationTrace(): void {
  lastCalendarGenerationTrace = null;
}

export function getLastCalendarGenerationTrace(): CalendarGenerationTrace | null {
  return lastCalendarGenerationTrace;
}

export function publishCalendarGenerationTrace(trace: CalendarGenerationTrace): void {
  lastCalendarGenerationTrace = trace;
}

export function snapshotStageBudget(input: {
  stage: string;
  estimatedInputTokens: number;
  maxInputTokens: number;
  estimatedOutputTokens: number;
  compactionTier?: number;
  promptSegments?: Array<{ label: string; chars: number; estimatedTokens: number }>;
}): CalendarStageBudgetSnapshot {
  return {
    stage: input.stage,
    estimatedInputTokens: input.estimatedInputTokens,
    maxInputTokens: input.maxInputTokens,
    estimatedOutputTokens: input.estimatedOutputTokens,
    estimatedTotalTokens: input.estimatedInputTokens + input.estimatedOutputTokens,
    compactionTier: input.compactionTier ?? 0,
    ...(input.promptSegments ? { promptSegments: input.promptSegments } : {}),
  };
}

export function attachCalendarGenerationTrace(err: unknown, trace: CalendarGenerationTrace | null): void {
  if (!err || typeof err !== "object" || !trace) return;
  (err as { calendarGenerationTrace?: CalendarGenerationTrace }).calendarGenerationTrace = trace;
}
