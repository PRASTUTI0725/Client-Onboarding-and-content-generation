import { recordDebugAiFailure } from "./runtime-mode.js";
import { getLastFailureStage, setLastFailureStage } from "./runtime-mode.js";
import { PromptBudgetError } from "./llm/prompt-budget.js";

/**
 * Sanitized provider failure for API responses (no secrets, bounded length).
 */
export type PublicAiFailure = {
  providerId: string;
  model: string;
  message: string;
  code?: "provider_error" | "real_ai_disabled" | "empty_output" | "validation_failed";
  failureClass?:
    | "timeout"
    | "rate_limit"
    | "invalid_json"
    | "empty_output"
    | "provider_error"
    | "real_ai_disabled"
    | "validation_failed";
  failureStage?: string | null;
  failureOrigin?:
    | "local_budget_guard"
    | "provider_http"
    | "json_parse"
    | "empty_output"
    | "timeout"
    | "provider_unknown"
    | "validation_failed / bucket_mismatch"
    | "validation_failed";
  failedContextLabel?: string | null;
  estimatedInputTokens?: number;
  maxInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedTotalTokens?: number;
  compactionTier?: number;
  promptSegments?: Array<{ label: string; chars: number; estimatedTokens: number }>;
  httpStatus?: number;
  errorCode?: string;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  repairChanges?: Array<{
    index: number;
    date: string;
    platform: string;
    format: string;
    fromBucket: string;
    toBucket: string;
    reason: string;
  }>;
  validationDiagnostics?: {
    runMode?: string;
    stage?: string;
    invalidPostIndexes?: number[];
    fieldCounts?: Record<string, number>;
    issueCounts?: Record<string, number>;
    repairBatchSize?: number;
    repairBatchCount?: number;
    repairProvider?: { provider: string; model: string } | null;
    creditsStateBeforeRepair?: { usable: boolean; reason: string } | null;
    fieldRepairAttempted?: boolean;
    fieldRepairSucceeded?: boolean;
    fieldRepairCount?: number;
  };
};

function httpStatusFromError(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === "number" && Number.isFinite(s) ? s : undefined;
  }
  return undefined;
}

export function toPublicAiFailure(
  err: unknown,
  ctx: { providerId: string; model: string },
): PublicAiFailure {
  const raw = err instanceof Error ? err.message : String(err);
  const httpStatus = httpStatusFromError(err);
  const failureClass = classifyFailure(raw, httpStatus);
  const failureOrigin = classifyFailureOrigin(err, raw, httpStatus);
  const priorStage = getLastFailureStage();
  const failureStage =
    failureClass === "validation_failed"
      ? "ai_generated_but_validation_failed"
      : priorStage && priorStage !== "fallback_used"
      ? priorStage
      : failureOrigin === "local_budget_guard"
        ? "prompt_budget_exceeded"
        : "provider_call_failed";
  const f: PublicAiFailure = {
    providerId: ctx.providerId,
    model: ctx.model,
    message: raw.replace(/\b(sk-[a-zA-Z0-9]+|Bearer\s+[^\s]+)\b/g, "[redacted]").slice(0, 500),
    code: failureClass === "validation_failed" ? "validation_failed" : "provider_error",
    failureClass,
    failureStage,
    failureOrigin,
    failedContextLabel: err instanceof PromptBudgetError ? err.label : null,
    ...(err instanceof PromptBudgetError
        ? {
          estimatedInputTokens: err.estimatedInputTokens,
          maxInputTokens: err.maxInputTokens,
          promptSegments: err.segments,
        }
      : {}),
    ...(err && typeof err === "object" && "calendarGenerationTrace" in err
      ? (() => {
          const trace = (err as { calendarGenerationTrace?: {
            plannerBudget?: { estimatedInputTokens?: number; maxInputTokens?: number; estimatedOutputTokens?: number; estimatedTotalTokens?: number; compactionTier?: number; promptSegments?: PublicAiFailure["promptSegments"] };
            lastAttemptedStage?: string | null;
            stagesAttempted?: Array<{ stage?: string; estimatedInputTokens?: number; maxInputTokens?: number; estimatedOutputTokens?: number; estimatedTotalTokens?: number; compactionTier?: number; promptSegments?: PublicAiFailure["promptSegments"] }>;
          } }).calendarGenerationTrace;
          if (!trace) return {};
          const lastStage = trace.stagesAttempted?.[trace.stagesAttempted.length - 1];
          const plannerBudget = trace.plannerBudget;
          const estimatedInputTokens =
            lastStage?.estimatedInputTokens ?? plannerBudget?.estimatedInputTokens;
          const estimatedOutputTokens =
            lastStage?.estimatedOutputTokens ?? plannerBudget?.estimatedOutputTokens;
          return {
            failedContextLabel: trace.lastAttemptedStage ?? lastStage?.stage ?? null,
            estimatedInputTokens,
            maxInputTokens: lastStage?.maxInputTokens ?? plannerBudget?.maxInputTokens,
            estimatedOutputTokens,
            estimatedTotalTokens:
              estimatedInputTokens != null && estimatedOutputTokens != null
                ? estimatedInputTokens + estimatedOutputTokens
                : lastStage?.estimatedTotalTokens ?? plannerBudget?.estimatedTotalTokens,
            compactionTier: lastStage?.compactionTier ?? plannerBudget?.compactionTier,
            promptSegments: lastStage?.promptSegments ?? plannerBudget?.promptSegments,
          };
        })()
      : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(err && typeof err === "object" && "repairAttempted" in err
      ? {
          repairAttempted: (err as { repairAttempted?: unknown }).repairAttempted === true,
          repairSucceeded: (err as { repairSucceeded?: unknown }).repairSucceeded === true,
          repairChanges: Array.isArray((err as { repairChanges?: unknown }).repairChanges)
            ? (((err as { repairChanges?: unknown }).repairChanges as unknown[]) as PublicAiFailure["repairChanges"])
            : undefined,
        }
      : {}),
    ...(err && typeof err === "object" && "validationDiagnostics" in err
      ? {
          validationDiagnostics:
            ((err as { validationDiagnostics?: unknown }).validationDiagnostics as PublicAiFailure["validationDiagnostics"] | undefined) ??
            undefined,
        }
      : {}),
  };
  setLastFailureStage(failureStage);
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}

export function realAiDisabledFailure(ctx: { providerId: string; model: string }): PublicAiFailure {
  const f: PublicAiFailure = {
    ...ctx,
    message: "Real AI is disabled for this request (e.g. USE_REAL_AI / provider keys). A deterministic template is used instead.",
    code: "real_ai_disabled",
    failureClass: "real_ai_disabled",
    failureStage: "fallback_used",
  };
  setLastFailureStage("fallback_used");
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}

export function emptyModelOutputFailure(ctx: { providerId: string; model: string }): PublicAiFailure {
  const f: PublicAiFailure = {
    ...ctx,
    message: "The model returned no usable output; a safe template was used instead.",
    code: "empty_output",
    failureClass: "empty_output",
    failureStage: "fallback_used",
  };
  setLastFailureStage("fallback_used");
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}

function classifyFailure(message: string, httpStatus?: number): NonNullable<PublicAiFailure["failureClass"]> {
  const text = message.toLowerCase();
  if (/calendar aggregate validation failed|bucket_[^;]+ expected \d+ got \d+/.test(text)) return "validation_failed";
  if (httpStatus === 429 || /\brate limit|quota|too many requests\b/.test(text)) return "rate_limit";
  if (/\btimeout|timed out|abort/.test(text)) return "timeout";
  if (/invalid json|json_parse|parse failed|not valid json/.test(text)) return "invalid_json";
  if (/empty|no usable output|full response/.test(text)) return "empty_output";
  return "provider_error";
}

function classifyFailureOrigin(
  err: unknown,
  message: string,
  httpStatus?: number,
): NonNullable<PublicAiFailure["failureOrigin"]> {
  const text = message.toLowerCase();
  if (err instanceof PromptBudgetError) return "local_budget_guard";
  if (/bucket_[^;]+ expected \d+ got \d+/.test(text)) return "validation_failed / bucket_mismatch";
  if (/calendar aggregate validation failed|calendar semantic validation failed/.test(text)) return "validation_failed";
  if (/\btimeout|timed out|abort/.test(text)) return "timeout";
  if (/invalid json|json_parse|parse failed|not valid json/.test(text)) return "json_parse";
  if (/empty|no usable output|full response/.test(text)) return "empty_output";
  if (httpStatus !== undefined) return "provider_http";
  return "provider_unknown";
}
