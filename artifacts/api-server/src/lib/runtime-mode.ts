let fallbackUsed = false;
let aiFallbackUsed = false;

/** Most recent public AI failure (for health `?debug=1` / dev only). */
let lastDebugAiFailure: Record<string, unknown> | null = null;
let latestAiUsage: Record<string, unknown> | null = null;
let latestOpenRouterCredits: Record<string, unknown> | null = null;

export function recordDebugAiFailure(f: Record<string, unknown>) {
  lastDebugAiFailure = f;
}

export function getLastDebugAiFailure(): Record<string, unknown> | null {
  return lastDebugAiFailure;
}

export function recordLatestAiUsage(usage: Record<string, unknown>) {
  latestAiUsage = {
    ...usage,
    updatedAt: new Date().toISOString(),
  };
}

export function getLatestAiUsage(): Record<string, unknown> | null {
  return latestAiUsage;
}

export function setLatestOpenRouterCredits(credits: Record<string, unknown> | null) {
  latestOpenRouterCredits = credits;
}

export function getLatestOpenRouterCredits(): Record<string, unknown> | null {
  return latestOpenRouterCredits;
}

export function markFallbackUsed() {
  fallbackUsed = true;
}

export function clearFallbackUsed() {
  fallbackUsed = false;
}

export function getFallbackUsed() {
  return fallbackUsed;
}

export function markAIFallbackUsed() {
  aiFallbackUsed = true;
}

export function clearAIFallbackUsed() {
  aiFallbackUsed = false;
}

export function getAIFallbackUsed() {
  return aiFallbackUsed;
}
