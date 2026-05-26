function getLocalApiKey(): string {
  const value = import.meta.env.VITE_LOCAL_API_KEY;
  return typeof value === "string" ? value.trim() : "";
}

function resolveLocalApiMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function resolveLocalApiUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return input.toString();
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function buildLocalApiNetworkFailure(
  cause: unknown,
  requestInfo: { method: string; url: string },
): Error {
  const message =
    cause instanceof Error && cause.message
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "Failed to fetch";
  const error = new Error(
    `Network request failed for ${requestInfo.method} ${requestInfo.url}: ${message}`,
  );
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

export function buildLocalApiHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  const key = getLocalApiKey();
  if (key && !merged.has("x-api-key")) {
    merged.set("x-api-key", key);
  }
  return merged;
}

function prepareLocalApiHeaders(headers: HeadersInit | undefined, body: BodyInit | null | undefined): Headers {
  const merged = buildLocalApiHeaders(headers);
  if (typeof body === "string" && !merged.has("content-type") && looksLikeJson(body)) {
    merged.set("content-type", "application/json");
  }
  return merged;
}

export async function localApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = resolveLocalApiMethod(input, init.method);
  const url = resolveLocalApiUrl(input);
  try {
    return await fetch(input, {
      ...init,
      method,
      headers: prepareLocalApiHeaders(init.headers, init.body),
    });
  } catch (cause) {
    throw buildLocalApiNetworkFailure(cause, { method, url });
  }
}
