type ErrorKind = "transient" | "permanent";

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly httpStatus?: number;
  readonly errorCode?: string;

  constructor(input: {
    provider: string;
    model: string;
    message: string;
    httpStatus?: number;
    errorCode?: string;
  }) {
    super(input.message);
    this.name = "ProviderRequestError";
    this.provider = input.provider;
    this.model = input.model;
    this.httpStatus = input.httpStatus;
    this.errorCode = input.errorCode;
  }
}

export function classifyProviderError(err: unknown): {
  kind: ErrorKind;
  reason: string;
  httpStatus?: number;
  errorCode?: string;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  const status = getHttpStatus(err, message);
  const code = getErrorCode(err);

  if (isTransientStatus(status)) {
    return {
      kind: "transient",
      reason: `http_${status}`,
      httpStatus: status,
      errorCode: code,
      message,
    };
  }

  if (status === 402) {
    return {
      kind: "permanent",
      reason: "credits_exhausted",
      httpStatus: status,
      errorCode: code,
      message,
    };
  }

  if (
    lower.includes("decommissioned") ||
    lower.includes("model_decommissioned") ||
    lower.includes("invalid model") ||
    lower.includes("not a valid model") ||
    lower.includes("unsupported model") ||
    lower.includes("model not found") ||
    (status === 404 && lower.includes("model")) ||
    lower.includes("provider requires") ||
    lower.includes("misconfiguration") ||
    lower.includes("must be set")
  ) {
    return {
      kind: "permanent",
      reason: "provider_or_model_configuration",
      httpStatus: status,
      errorCode: code,
      message,
    };
  }

  // Unknown non-transient errors are treated as permanent to avoid long useless retries.
  return {
    kind: "permanent",
    reason: "non_transient_error",
    httpStatus: status,
    errorCode: code,
    message,
  };
}

function isTransientStatus(status: number | undefined): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function getHttpStatus(err: unknown, message: string): number | undefined {
  if (err && typeof err === "object" && "httpStatus" in err) {
    const v = (err as { httpStatus?: unknown }).httpStatus;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  if (err && typeof err === "object" && "status" in err) {
    const v = (err as { status?: unknown }).status;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  const match = message.match(/\b(?:http\s*)?(4\d{2}|5\d{2})\b/i);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "errorCode" in err) {
    const v = (err as { errorCode?: unknown }).errorCode;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (err && typeof err === "object" && "code" in err) {
    const v = (err as { code?: unknown }).code;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}
