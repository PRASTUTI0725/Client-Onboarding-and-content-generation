import type { Request } from "express";
import { createLLMProvider, createLLMProviderChain } from "./factory.js";
import {
  filterProvidersWithCredentials,
  normalizeProvider,
  readProviderId,
  readProviderPriority,
  readUseRealAI,
  hasProviderCredentials,
  type ProviderId,
} from "./env.js";
import type { LLMProvider } from "./types.js";
import { FallbackProvider } from "./fallback-provider.js";

const NO_USABLE_USER_MESSAGE =
  "No usable AI provider is configured. Please select a provider you have API keys for in AI settings, set keys on the server, or enable demo fallback (turn off “Use real AI”) for local use.";

export class NoUsableAiProviderError extends Error {
  constructor(message = NO_USABLE_USER_MESSAGE) {
    super(message);
    this.name = "NoUsableAiProviderError";
  }
}

export function isNoUsableAiProviderError(err: unknown): err is NoUsableAiProviderError {
  return err instanceof NoUsableAiProviderError;
}

export function getNoUsableAiProviderUserMessage(): string {
  return NO_USABLE_USER_MESSAGE;
}

function buildProviderChainFromIds(
  chainIds: readonly ProviderId[],
  overrides?: { apiKey?: string; model?: string },
): LLMProvider {
  const providers: LLMProvider[] = [];
  let first = true;
  for (const id of chainIds) {
    try {
      providers.push(
        createLLMProvider(
          id,
          first && overrides && (overrides.apiKey || overrides.model)
            ? {
                ...(overrides.apiKey ? { apiKey: overrides.apiKey } : {}),
                ...(overrides.model ? { model: overrides.model } : {}),
              }
            : undefined,
        ),
      );
      first = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[llm.resolve] skip provider id=${id} reason=${msg}`);
    }
  }
  if (providers.length === 0) {
    throw new NoUsableAiProviderError();
  }
  return new FallbackProvider(providers);
}

export function shouldUseRealAI(req: Request): boolean {
  const header = req.header("x-use-real-ai")?.trim().toLowerCase();
  if (header === "true" || header === "1" || header === "yes") return true;
  if (header === "false" || header === "0" || header === "no") return false;
  return readUseRealAI();
}

/**
 * Resolves a usable LLM provider chain. Never selects a provider that lacks valid server credentials,
 * except when the client passes `x-ai-api-key` (then the named provider is used with that key even if
 * server env has no key for that id). Perplexity is never selected without a key in either place.
 */
export function getRequestLLMProvider(req: Request): LLMProvider {
  const headerRaw = req.header("x-ai-provider")?.trim();
  const apiKeyHeader = req.header("x-ai-api-key")?.trim();
  const modelHeader = req.header("x-ai-model")?.trim();
  const hasExplicit = Boolean(headerRaw || apiKeyHeader || modelHeader);

  let requested: ProviderId;
  try {
    requested = headerRaw ? normalizeProvider(headerRaw) : readProviderId();
  } catch {
    requested = "groq";
  }

  const priorityAll = readProviderPriority();
  const skippedNoCreds: ProviderId[] = [];
  for (const id of priorityAll) {
    if (!hasProviderCredentials(id)) {
      skippedNoCreds.push(id);
    }
  }
  if (skippedNoCreds.length) {
    console.info(
      `[llm.resolve] env_priority: providers with no server credentials (excluded from automatic selection): ${JSON.stringify(
        skippedNoCreds,
      )}`,
    );
  }

  const usableSet = new Set(filterProvidersWithCredentials(priorityAll));

  if (hasExplicit) {
    const chain: ProviderId[] = [];
    if (apiKeyHeader) {
      chain.push(requested);
      console.info(
        `[llm.resolve] mode=explicit with client API key; primary=${requested} (key applies to first provider in chain)`,
      );
    } else if (usableSet.has(requested)) {
      chain.push(requested);
      console.info(`[llm.resolve] mode=explicit header model=${Boolean(modelHeader)} primary=${requested}`);
    } else {
      console.warn(
        `[llm.resolve] x-ai-provider=${requested} has no valid server credentials and no x-ai-api-key; will use other configured providers only`,
      );
    }
    for (const id of priorityAll) {
      if (!chain.includes(id) && usableSet.has(id)) {
        chain.push(id);
      }
    }
    if (chain.length === 0) {
      throw new NoUsableAiProviderError();
    }
    return buildProviderChainFromIds(chain, { apiKey: apiKeyHeader, model: modelHeader });
  }

  if (usableSet.has(requested)) {
    const ordered = [requested, ...priorityAll.filter((p) => p !== requested && usableSet.has(p))];
    console.info(`[llm.resolve] mode=default primary=${requested} chain=${JSON.stringify(ordered)}`);
    return buildProviderChainFromIds(ordered, undefined);
  }

  const fallbackChain = filterProvidersWithCredentials(priorityAll);
  if (fallbackChain.length === 0) {
    console.warn(
      `[llm.resolve] default provider=${requested} has no credentials and no other configured providers`,
    );
    throw new NoUsableAiProviderError();
  }
  console.warn(
    `[llm.resolve] default provider id=${requested} not usable (no server credentials); chain=${JSON.stringify(
      fallbackChain,
    )}`,
  );
  return buildProviderChainFromIds(fallbackChain, undefined);
}
