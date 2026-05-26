let fallbackUsed = false;
let aiFallbackUsed = false;

/** Most recent public AI failure (for health `?debug=1` / dev only). */
let lastDebugAiFailure: Record<string, unknown> | null = null;
let latestAiUsage: Record<string, unknown> | null = null;
let latestOpenRouterCredits: Record<string, unknown> | null = null;
let latestProviderAttempts: Record<string, unknown>[] = [];
let lastFailureStage: string | null = null;

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

export function setLatestProviderAttempts(attempts: Record<string, unknown>[]) {
  latestProviderAttempts = attempts.map((attempt) => ({ ...attempt }));
}

export function getLatestProviderAttempts(): Record<string, unknown>[] {
  return latestProviderAttempts.map((attempt) => ({ ...attempt }));
}

export function setLastFailureStage(stage: string | null) {
  lastFailureStage = stage;
}

export function getLastFailureStage(): string | null {
  return lastFailureStage;
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
