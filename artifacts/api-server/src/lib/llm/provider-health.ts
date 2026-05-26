import { readGeminiCredentials, readOpenRouterCredentials } from "./env.js";
import { estimateOpenRouterAffordableMaxTokens } from "../business-dna/provider-budget.js";
import { OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS } from "../business-dna/constants.js";

const openRouterCreditsCache: {
  expiresAt: number;
  usable: boolean;
  reason: string;
  remainingCredits: number | null;
} = {
  expiresAt: 0,
  usable: false,
  reason: "uninitialized",
  remainingCredits: null,
};

const geminiModelCache = new Map<string, { expiresAt: number; valid: boolean; reason: string }>();

export async function checkOpenRouterCreditsAvailable(): Promise<{
  usable: boolean;
  reason: string;
  remainingCredits: number | null;
}> {
  if (openRouterCreditsCache.expiresAt > Date.now()) {
    return {
      usable: openRouterCreditsCache.usable,
      reason: openRouterCreditsCache.reason,
      remainingCredits: openRouterCreditsCache.remainingCredits,
    };
  }
  try {
    const { apiKey, baseURL } = readOpenRouterCredentials();
    const creditsUrl = new URL("credits", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
    const res = await fetch(creditsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const reason = `credits_check_http_${res.status}`;
      setOpenRouterCache(false, reason, 30_000, null);
      return { usable: false, reason, remainingCredits: null };
    }
    const json = (await res.json()) as {
      data?: { remaining_credits?: number; total_credits?: number; total_usage?: number };
    };
    const remaining =
      typeof json.data?.remaining_credits === "number"
        ? json.data.remaining_credits
        : typeof json.data?.total_credits === "number" && typeof json.data?.total_usage === "number"
          ? json.data.total_credits - json.data.total_usage
          : -1;
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setOpenRouterCache(false, "credits_exhausted", 120_000, remaining);
      return { usable: false, reason: "credits_exhausted", remainingCredits: remaining };
    }
    setOpenRouterCache(true, "ok", 30_000, remaining);
    return { usable: true, reason: "ok", remainingCredits: remaining };
  } catch {
    setOpenRouterCache(false, "credits_check_failed", 30_000, null);
    return { usable: false, reason: "credits_check_failed", remainingCredits: null };
  }
}

export async function getOpenRouterAffordableMaxTokens(): Promise<number | null> {
  const credits = await checkOpenRouterCreditsAvailable();
  if (!credits.usable) return 0;
  return estimateOpenRouterAffordableMaxTokens(credits.remainingCredits);
}

export async function validateGeminiModel(model: string): Promise<{ valid: boolean; reason: string }> {
  const cached = geminiModelCache.get(model);
  if (cached && cached.expiresAt > Date.now()) {
    return { valid: cached.valid, reason: cached.reason };
  }
  try {
    const { apiKey } = readGeminiCredentials();
    const encoded = encodeURIComponent(model);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encoded}?key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      geminiModelCache.set(model, { valid: true, reason: "ok", expiresAt: Date.now() + 5 * 60_000 });
      return { valid: true, reason: "ok" };
    }
    if (res.status === 404) {
      geminiModelCache.set(model, {
        valid: false,
        reason: "model_not_found",
        expiresAt: Date.now() + 10 * 60_000,
      });
      return { valid: false, reason: "model_not_found" };
    }
    const reason = `model_check_http_${res.status}`;
    geminiModelCache.set(model, { valid: false, reason, expiresAt: Date.now() + 2 * 60_000 });
    return { valid: false, reason };
  } catch {
    geminiModelCache.set(model, {
      valid: false,
      reason: "model_check_failed",
      expiresAt: Date.now() + 60_000,
    });
    return { valid: false, reason: "model_check_failed" };
  }
}

function setOpenRouterCache(
  usable: boolean,
  reason: string,
  ttlMs: number,
  remainingCredits: number | null,
) {
  openRouterCreditsCache.usable = usable;
  openRouterCreditsCache.reason = reason;
  openRouterCreditsCache.remainingCredits = remainingCredits;
  openRouterCreditsCache.expiresAt = Date.now() + ttlMs;
}
