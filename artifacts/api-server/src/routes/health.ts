import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getAIFallbackUsed,
  getLastFailureStage,
  getFallbackUsed,
  getLatestProviderAttempts,
  getLastDebugAiFailure,
  getLatestAiUsage,
  getLatestOpenRouterCredits,
  setLatestOpenRouterCredits,
} from "../lib/runtime-mode.js";
import {
  getAiRuntimeSummary,
  readOpenRouterCredentials,
  readProviderId,
  readProviderPriority,
  readUseRealAI,
} from "../lib/llm/env.js";
import { getProviderResolutionDiagnostics } from "../lib/llm/request-provider.js";

const router: IRouter = Router();

router.get("/healthz", async (req, res) => {
  let dbConnected = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbConnected = false;
  }

  const data = HealthCheckResponse.parse({ status: "ok" });
  let aiProvider: string = "openai";
  try {
    aiProvider = readProviderId();
  } catch {
    aiProvider = "invalid_ai_provider_env";
  }

  const q = req.query.debug;
  const debugOn = (Array.isArray(q) ? q[0] : q) === "1";
  const showLastError = debugOn || process.env.NODE_ENV === "development";
  const lastError = showLastError ? getLastDebugAiFailure() : undefined;
  const lastUsage = getLatestAiUsage();
  const providerResolution = getProviderResolutionDiagnostics();
  const providerAttempts = showLastError ? getLatestProviderAttempts() : undefined;
  const lastFailureStage = showLastError ? getLastFailureStage() : undefined;
  const credits = showLastError ? await fetchOpenRouterCreditsSnapshot() : undefined;
  const runtime = getAiRuntimeSummary();
  res.json({
    ...data,
    mode: dbConnected ? "db" : "fallback",
    persistence: dbConnected ? "persistent" : "temporary",
    fallbackUsed: getFallbackUsed(),
    aiFallbackUsed: getAIFallbackUsed(),
    useRealAI: readUseRealAI(),
    aiProvider,
    /** Same as `aiProvider` (resolved id, e.g. openai when AI_PROVIDER=local). */
    aiProviderResolved: runtime.resolvedProviderId,
    /** Human-readable: local server vs cloud provider. */
    aiProviderLabel: runtime.displayLabel,
    /** Default model for the resolved provider (from env; last call may differ). */
    aiDefaultModel: runtime.defaultModel,
    envAiProvider: runtime.envAiProviderRaw,
    openaiBaseIsLocal: runtime.openaiBaseIsLocal,
    aiProviderPriority: readProviderPriority(),
    requestedProvider: providerResolution.requestedProvider,
    requestedProviderSource: providerResolution.requestedProviderSource,
    configuredProviderChain: providerResolution.configuredProviderChain,
    eligibleProviders: providerResolution.eligibleProviders,
    requestedProviderIncludedInChain: providerResolution.requestedProviderIncludedInChain,
    requestedProviderExclusionReason: providerResolution.requestedProviderExclusionReason,
    skippedProviders: providerResolution.skippedProviders,
    aiConfig: {
      openrouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      groqKeyPresent: Boolean(process.env.GROQ_API_KEY?.trim()),
      nvidiaKeyPresent: Boolean(
        process.env.NVIDIA_API_KEY?.trim() ?? process.env.AI_INTEGRATIONS_NVIDIA_API_KEY?.trim(),
      ),
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY?.trim()),
      openaiKeyPresent: Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim()),
      llmJsonRetryEnabled: process.env.LLM_JSON_RETRY === "1",
      llmJsonRepairEnabled: ["1", "true", "yes"].includes((process.env.LLM_JSON_REPAIR?.trim().toLowerCase() ?? "1")),
    },
    ...(lastUsage ? { aiUsage: lastUsage } : {}),
    ...(providerAttempts ? { providerAttempts } : {}),
    ...(lastFailureStage ? { lastFailureStage } : {}),
    ...(credits ? { openrouterCredits: credits } : {}),
    ...(lastError ? { lastError } : {}),
  });
});

export default router;

let creditsCache: { expiresAt: number; value: Record<string, unknown> | null } | null = null;

async function fetchOpenRouterCreditsSnapshot(): Promise<Record<string, unknown> | undefined> {
  if (creditsCache && creditsCache.expiresAt > Date.now()) {
    return creditsCache.value ?? undefined;
  }
  try {
    const { apiKey } = readOpenRouterCredentials();
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const unavailable = {
        status: "unavailable",
        message: `OpenRouter credits unavailable (${res.status})`,
        remainingCredits: "unknown",
      };
      creditsCache = { expiresAt: Date.now() + 30_000, value: unavailable };
      setLatestOpenRouterCredits(unavailable);
      return unavailable;
    }
    const json = (await res.json()) as {
      data?: {
        total_credits?: number;
        total_usage?: number;
        remaining_credits?: number;
      };
    };
    const remaining =
      json.data?.remaining_credits ??
      (typeof json.data?.total_credits === "number" && typeof json.data?.total_usage === "number"
        ? json.data.total_credits - json.data.total_usage
        : "unknown");
    const next = {
      status: "available",
      remainingCredits: remaining,
      totalCredits: json.data?.total_credits ?? "unknown",
      totalUsage: json.data?.total_usage ?? "unknown",
    };
    creditsCache = { expiresAt: Date.now() + 30_000, value: next };
    setLatestOpenRouterCredits(next);
    return next;
  } catch (err) {
    const fallback =
      getLatestOpenRouterCredits() ??
      {
        status: "unavailable",
        message: err instanceof Error ? err.message : String(err),
        remainingCredits: "unknown",
      };
    creditsCache = { expiresAt: Date.now() + 30_000, value: fallback };
    setLatestOpenRouterCredits(fallback);
    return fallback;
  }
}
