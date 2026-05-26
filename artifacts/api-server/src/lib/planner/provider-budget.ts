/** Groq TPM guard: estimated input + reserved max_output should stay under this per call. */
export const CALENDAR_GROQ_MAX_TOTAL_TOKENS = 6000;

export const CALENDAR_PLANNER_MAX_OUTPUT = 450;
export const CALENDAR_WEEK_MAX_OUTPUT_GROQ = 420;
export const CALENDAR_WEEK_MAX_OUTPUT_DEFAULT = 600;
export const CALENDAR_WEEK_OUTPUT_TOKENS_PER_POST = 120;
export const CALENDAR_REPAIR_MAX_OUTPUT = 180;

export const CALENDAR_PLANNER_TARGET_INPUT = 1200;
export const CALENDAR_WEEK_TARGET_INPUT_GROQ = 1000;
export const CALENDAR_WEEK_TARGET_INPUT_DEFAULT = 1550;

export type CalendarBudgetStage = "planner" | "week" | "repair";

export function resolveCalendarMaxOutputTokens(params: {
  providerId: string;
  stage: CalendarBudgetStage;
  postsInBatch?: number;
}): number {
  const posts = Math.max(1, params.postsInBatch ?? 1);
  if (params.stage === "planner") return CALENDAR_PLANNER_MAX_OUTPUT;
  if (params.stage === "repair") return CALENDAR_REPAIR_MAX_OUTPUT;
  const perPost =
    params.providerId === "groq"
      ? CALENDAR_WEEK_OUTPUT_TOKENS_PER_POST
      : Math.ceil(CALENDAR_WEEK_MAX_OUTPUT_DEFAULT / 4);
  const scaled = perPost * posts;
  const cap =
    params.providerId === "groq" ? CALENDAR_WEEK_MAX_OUTPUT_GROQ : CALENDAR_WEEK_MAX_OUTPUT_DEFAULT;
  return Math.min(cap, Math.max(perPost, scaled));
}

export function resolveCalendarTargetInputTokens(
  providerId: string,
  stage: "planner" | "week",
): number {
  if (stage === "planner") return CALENDAR_PLANNER_TARGET_INPUT;
  return providerId === "groq" ? CALENDAR_WEEK_TARGET_INPUT_GROQ : CALENDAR_WEEK_TARGET_INPUT_DEFAULT;
}

export function isCalendarRequestWithinGroqBudget(
  estimatedInputTokens: number,
  maxOutputTokens: number,
): boolean {
  return estimatedInputTokens + maxOutputTokens <= CALENDAR_GROQ_MAX_TOTAL_TOKENS;
}

export function resolveCalendarWeekConcurrency(providerId: string): number {
  return providerId === "groq" ? 1 : 2;
}

/** Soft cumulative TPM guard for a single calendar run (planner + weeks). */
export const CALENDAR_GROQ_RUN_TPM_SOFT_LIMIT = 12000;

const DEFAULT_GROQ_WEEK_CALL_DELAY_MS = 10_000;

export function resolveGroqWeekCallDelayMs(): number {
  const raw = process.env.CALENDAR_GROQ_WEEK_CALL_DELAY_MS?.trim();
  if (!raw) return DEFAULT_GROQ_WEEK_CALL_DELAY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_GROQ_WEEK_CALL_DELAY_MS;
  return Math.round(parsed);
}

export function calendarWeekStaggerMs(providerId: string): number {
  return providerId === "groq" ? resolveGroqWeekCallDelayMs() : 0;
}

export function normalizeCalendarProviderId(providerId: string | undefined | null): string {
  const normalized = String(providerId ?? "").trim().toLowerCase();
  if (!normalized || normalized === "multi" || normalized === "fallback") return "groq";
  return normalized;
}
