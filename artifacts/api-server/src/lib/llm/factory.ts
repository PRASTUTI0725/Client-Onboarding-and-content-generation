import type { LLMProvider } from "./types.js";
import {
  readClaudeCredentials,
  readClaudeModel,
  readCodexCredentials,
  readCodexModel,
  readGeminiCredentials,
  readGeminiModel,
  readGroqCredentials,
  readGroqModel,
  readOpenRouterCredentials,
  readOpenRouterModel,
  readOpenAICredentials,
  readOpenAIModel,
  readPerplexityCredentials,
  readNvidiaCredentials,
  readNvidiaModel,
  readProviderPriority,
  readProviderId,
  filterProvidersWithCredentials,
  type ProviderId,
} from "./env.js";
import { OpenAICompatProvider } from "./openai-compat-provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { FallbackProvider } from "./fallback-provider.js";

type ProviderOverrides = {
  apiKey?: string;
  baseURL?: string;
  model?: string;
};

export function createLLMProvider(
  kind?: ProviderId,
  overrides?: ProviderOverrides,
): LLMProvider {
  const id = kind ?? readProviderId();
  switch (id) {
    case "openai": {
      const { baseURL, apiKey } = readOpenAICredentials();
      return new OpenAICompatProvider(
        "openai",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readOpenAIModel(),
      );
    }
    case "claude": {
      const { baseURL, apiKey } = readClaudeCredentials();
      return new ClaudeProvider(
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readClaudeModel(),
      );
    }
    case "codex": {
      const { baseURL, apiKey } = readCodexCredentials();
      return new OpenAICompatProvider(
        "codex",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readCodexModel(),
      );
    }
    case "perplexity": {
      if (overrides?.apiKey?.trim()) {
        const baseURL =
          overrides.baseURL?.trim() ??
          process.env.AI_INTEGRATIONS_PERPLEXITY_BASE_URL?.trim() ??
          "https://api.perplexity.ai";
        return new OpenAICompatProvider(
          "perplexity",
          baseURL,
          overrides.apiKey.trim(),
          overrides.model ?? "sonar-pro",
        );
      }
      const { baseURL, apiKey } = readPerplexityCredentials();
      return new OpenAICompatProvider(
        "perplexity",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? "sonar-pro",
      );
    }
    case "openrouter": {
      if (overrides?.apiKey?.trim()) {
        const baseURL =
          overrides.baseURL?.trim() ||
          process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL?.trim() ||
          "https://openrouter.ai/api/v1";
        return new OpenAICompatProvider(
          "openrouter",
          baseURL,
          overrides.apiKey.trim(),
          overrides.model ?? readOpenRouterModel(),
        );
      }
      const { baseURL, apiKey } = readOpenRouterCredentials();
      return new OpenAICompatProvider(
        "openrouter",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readOpenRouterModel(),
      );
    }
    case "groq": {
      if (overrides?.apiKey?.trim()) {
        const baseURL =
          overrides.baseURL?.trim() ||
          process.env.AI_INTEGRATIONS_GROQ_BASE_URL?.trim() ||
          "https://api.groq.com/openai/v1";
        return new OpenAICompatProvider(
          "groq",
          baseURL,
          overrides.apiKey.trim(),
          overrides.model ?? readGroqModel(),
        );
      }
      const { baseURL, apiKey } = readGroqCredentials();
      return new OpenAICompatProvider(
        "groq",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readGroqModel(),
      );
    }
    case "nvidia": {
      if (overrides?.apiKey?.trim()) {
        const baseURL =
          overrides.baseURL?.trim() ||
          process.env.NVIDIA_BASE_URL?.trim() ||
          process.env.AI_INTEGRATIONS_NVIDIA_BASE_URL?.trim() ||
          "https://integrate.api.nvidia.com/v1";
        return new OpenAICompatProvider(
          "nvidia",
          baseURL,
          overrides.apiKey.trim(),
          overrides.model ?? readNvidiaModel(),
        );
      }
      const { baseURL, apiKey } = readNvidiaCredentials();
      return new OpenAICompatProvider(
        "nvidia",
        overrides?.baseURL ?? baseURL,
        overrides?.apiKey ?? apiKey,
        overrides?.model ?? readNvidiaModel(),
      );
    }
    case "gemini": {
      if (overrides?.apiKey?.trim()) {
        return new GeminiProvider(overrides.apiKey.trim(), overrides.model ?? readGeminiModel());
      }
      const { apiKey } = readGeminiCredentials();
      return new GeminiProvider(overrides?.apiKey ?? apiKey, overrides?.model ?? readGeminiModel());
    }
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function createLLMProviderChain(priorities?: ProviderId[]): LLMProvider {
  const raw = priorities?.length ? priorities : readProviderPriority();
  const order = filterProvidersWithCredentials(raw);
  for (const id of raw) {
    if (!order.includes(id)) {
      console.info(`[llm.factory] createLLMProviderChain: skipped (no env credentials) id=${id}`);
    }
  }
  const providers: LLMProvider[] = [];
  for (const id of order) {
    try {
      providers.push(createLLMProvider(id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] skipped provider=${id} reason=${message}`);
    }
  }
  if (providers.length === 0) {
    throw new Error("No usable LLM providers found from configured priority list");
  }
  return new FallbackProvider(providers);
}
