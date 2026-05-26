import type { Request } from "express";
import { createLLMProvider, createLLMProviderChainFromEntries } from "./factory.js";
import {
  readProviderApiKeys,
  filterProvidersWithCredentials,
  isLocalProviderAlias,
  normalizeProvider,
  readForceRealAI,
  readProviderId,
  readProviderChainEntries,
  readEnvAiProviderRaw,
  type ProviderChainEntry,
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

export type RequestedProviderSource =
  | "explicit_header"
  | "explicit_model_header"
  | "explicit_api_key"
  | "env_alias"
  | "env_provider"
  | "default";

export type ProviderResolutionDiagnostics = {
  requestedProvider: ProviderId;
  requestedProviderSource: RequestedProviderSource;
  forceReal: boolean;
  configuredProviderChain: Array<{ provider: string; model: string; keySlots?: number }>;
  eligibleProviders: Array<{ provider: string; model: string; keySlots?: number }>;
  requestedProviderIncludedInChain: boolean;
  requestedProviderExclusionReason: string | null;
  skippedNoCredentials: ProviderId[];
  skippedProviders: Array<{ provider: string; reason: string }>;
};

function describeProviderChain(chainEntries: readonly ProviderChainEntry[]): Array<{ provider: string; model: string; keySlots?: number }> {
  return chainEntries.flatMap((entry) => {
    try {
      const provider = createLLMProvider(entry.provider, entry.model ? { model: entry.model } : undefined);
      const info = provider.describe?.() ?? { provider: provider.id, model: entry.model ?? "default" };
      return [{ provider: info.provider, model: entry.model ?? info.model, keySlots: Math.max(readProviderApiKeys(entry.provider).length, 1) }];
    } catch {
      return [];
    }
  });
}

function resolveRequestedProviderSource(
  headerRaw: string | undefined,
  apiKeyHeader: string | undefined,
  modelHeader: string | undefined,
): RequestedProviderSource {
  if (headerRaw) return "explicit_header";
  if (apiKeyHeader) return "explicit_api_key";
  if (modelHeader) return "explicit_model_header";
  const rawEnv = readEnvAiProviderRaw();
  if (!rawEnv) return "default";
  return isLocalProviderAlias(rawEnv) ? "env_alias" : "env_provider";
}

function computeProviderResolution(
  input?: { headerRaw?: string; apiKeyHeader?: string; modelHeader?: string },
): {
  requested: ProviderId;
  requestedSource: RequestedProviderSource;
  chainEntries: ProviderChainEntry[];
  skippedNoCreds: ProviderId[];
  requestedProviderIncludedInChain: boolean;
  requestedProviderExclusionReason: string | null;
} {
  const headerRaw = input?.headerRaw?.trim();
  const apiKeyHeader = input?.apiKeyHeader?.trim();
  const modelHeader = input?.modelHeader?.trim();
  const hasExplicit = Boolean(headerRaw || apiKeyHeader || modelHeader);

  let requested: ProviderId;
  try {
    requested = headerRaw ? normalizeProvider(headerRaw) : readProviderId();
  } catch {
    requested = "groq";
  }

  const requestedSource = resolveRequestedProviderSource(headerRaw, apiKeyHeader, modelHeader);
  const priorityEntries = readProviderChainEntries();
  const priorityAll = priorityEntries.map((entry) => entry.provider);
  const skippedNoCreds = priorityAll.filter((id) => !hasProviderCredentials(id));
  const usablePriority = filterProvidersWithCredentials(priorityAll);

  const chainEntries: ProviderChainEntry[] = [];
  if (hasExplicit) {
    if (apiKeyHeader || hasProviderCredentials(requested)) {
      chainEntries.push({ provider: requested, ...(modelHeader ? { model: modelHeader } : {}) });
    }
    for (const entry of priorityEntries) {
      if (!usablePriority.includes(entry.provider)) continue;
      if (!chainEntries.some((item) => item.provider === entry.provider && item.model === entry.model)) {
        chainEntries.push(entry);
      }
    }
  } else {
    if (hasProviderCredentials(requested)) {
      chainEntries.push({ provider: requested });
    }
    for (const entry of priorityEntries) {
      if (!usablePriority.includes(entry.provider)) continue;
      if (!chainEntries.some((item) => item.provider === entry.provider && item.model === entry.model)) {
        chainEntries.push(entry);
      }
    }
  }

  const requestedProviderIncludedInChain = chainEntries.some((entry) => entry.provider === requested);
  let requestedProviderExclusionReason: string | null = null;
  if (!requestedProviderIncludedInChain) {
    requestedProviderExclusionReason = hasProviderCredentials(requested)
      ? "configured_but_not_in_priority"
      : "missing_credentials";
  }

  return {
    requested,
    requestedSource,
    chainEntries,
    skippedNoCreds,
    requestedProviderIncludedInChain,
    requestedProviderExclusionReason,
  };
}

export function getProviderResolutionDiagnostics(): ProviderResolutionDiagnostics {
  const resolved = computeProviderResolution();
  return {
    requestedProvider: resolved.requested,
    requestedProviderSource: resolved.requestedSource,
    forceReal: readForceRealAI(),
    configuredProviderChain: describeProviderChain(resolved.chainEntries),
    eligibleProviders: describeProviderChain(resolved.chainEntries.filter((entry) => hasProviderCredentials(entry.provider))),
    requestedProviderIncludedInChain: resolved.requestedProviderIncludedInChain,
    requestedProviderExclusionReason: resolved.requestedProviderExclusionReason,
    skippedNoCredentials: resolved.skippedNoCreds,
    skippedProviders: resolved.skippedNoCreds.map((provider) => ({ provider, reason: "missing_credentials" })),
  };
}

export function getProviderResolutionDiagnosticsForRequest(req: Request): ProviderResolutionDiagnostics {
  const resolved = computeProviderResolution({
    headerRaw: req.header("x-ai-provider")?.trim(),
    apiKeyHeader: req.header("x-ai-api-key")?.trim(),
    modelHeader: req.header("x-ai-model")?.trim(),
  });
  return {
    requestedProvider: resolved.requested,
    requestedProviderSource: resolved.requestedSource,
    forceReal: readForceRealAI(),
    configuredProviderChain: describeProviderChain(resolved.chainEntries),
    eligibleProviders: describeProviderChain(resolved.chainEntries.filter((entry) => hasProviderCredentials(entry.provider))),
    requestedProviderIncludedInChain: resolved.requestedProviderIncludedInChain,
    requestedProviderExclusionReason: resolved.requestedProviderExclusionReason,
    skippedNoCredentials: resolved.skippedNoCreds,
    skippedProviders: resolved.skippedNoCreds.map((provider) => ({ provider, reason: "missing_credentials" })),
  };
}

function buildProviderChainFromIds(
  chainEntries: readonly ProviderChainEntry[],
  overrides?: { apiKey?: string; model?: string },
  options?: { forceReal?: boolean },
): LLMProvider {
  try {
    return createLLMProviderChainFromEntries(chainEntries, overrides, options);
  } catch {
    throw new NoUsableAiProviderError();
  }
}

export function shouldUseRealAI(req: Request): boolean {
  if (readForceRealAI()) return true;
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
  const resolved = computeProviderResolution({ headerRaw, apiKeyHeader, modelHeader });

  if (resolved.skippedNoCreds.length) {
    console.info(
      `[llm.resolve] env_priority: providers with no server credentials (excluded from automatic selection): ${JSON.stringify(
        resolved.skippedNoCreds,
      )}`,
    );
  }

  if (headerRaw || apiKeyHeader || modelHeader) {
    if (apiKeyHeader) {
      console.info(
        `[llm.resolve] mode=explicit with client API key; primary=${resolved.requested} (key applies to first provider in chain)`,
      );
    } else if (resolved.requestedProviderIncludedInChain) {
      console.info(`[llm.resolve] mode=explicit header model=${Boolean(modelHeader)} primary=${resolved.requested}`);
    } else {
      console.warn(
        `[llm.resolve] x-ai-provider=${resolved.requested} has no valid server credentials and no x-ai-api-key; will use other configured providers only`,
      );
    }
    if (resolved.chainEntries.length === 0) {
      throw new NoUsableAiProviderError();
    }
    return buildProviderChainFromIds(
      resolved.chainEntries,
      { apiKey: apiKeyHeader, model: modelHeader },
      { forceReal: readForceRealAI() },
    );
  }

  if (resolved.requestedProviderIncludedInChain) {
    console.info(`[llm.resolve] mode=default primary=${resolved.requested} chain=${JSON.stringify(resolved.chainEntries)}`);
    return buildProviderChainFromIds(resolved.chainEntries, undefined, { forceReal: readForceRealAI() });
  }

  if (resolved.chainEntries.length === 0) {
    console.warn(
      `[llm.resolve] default provider=${resolved.requested} has no credentials and no other configured providers`,
    );
    throw new NoUsableAiProviderError();
  }
  console.warn(
    `[llm.resolve] default provider id=${resolved.requested} not usable (no server credentials); chain=${JSON.stringify(
      resolved.chainEntries,
    )}`,
  );
  return buildProviderChainFromIds(resolved.chainEntries, undefined, { forceReal: readForceRealAI() });
}
