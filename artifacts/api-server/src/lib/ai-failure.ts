import { recordDebugAiFailure } from "./runtime-mode.js";

/**
 * Sanitized provider failure for API responses (no secrets, bounded length).
 */
export type PublicAiFailure = {
  providerId: string;
  model: string;
  message: string;
  code?: "provider_error" | "real_ai_disabled" | "empty_output";
  httpStatus?: number;
  errorCode?: string;
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
  const f: PublicAiFailure = {
    providerId: ctx.providerId,
    model: ctx.model,
    message: raw.replace(/\b(sk-[a-zA-Z0-9]+|Bearer\s+[^\s]+)\b/g, "[redacted]").slice(0, 500),
    code: "provider_error",
    ...(httpStatus !== undefined ? { httpStatus } : {}),
  };
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}

export function realAiDisabledFailure(ctx: { providerId: string; model: string }): PublicAiFailure {
  const f: PublicAiFailure = {
    ...ctx,
    message: "Real AI is disabled for this request (e.g. USE_REAL_AI / provider keys). A deterministic template is used instead.",
    code: "real_ai_disabled",
  };
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}

export function emptyModelOutputFailure(ctx: { providerId: string; model: string }): PublicAiFailure {
  const f: PublicAiFailure = {
    ...ctx,
    message: "The model returned no usable output; a safe template was used instead.",
    code: "empty_output",
  };
  recordDebugAiFailure(f as unknown as Record<string, unknown>);
  return f;
}
