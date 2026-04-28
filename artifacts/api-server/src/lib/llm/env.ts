export type ProviderId =
  | "openai"
  | "claude"
  | "codex"
  | "perplexity"
  | "openrouter"
  | "groq"
  | "nvidia"
  | "gemini";

export function normalizeProvider(raw: string | undefined): ProviderId {
  let s = (raw ?? "openai").trim() || "openai";
  const sl = s.toLowerCase();
  if (["local", "ollama", "lmstudio", "lm_studio", "openai-local"].includes(sl)) {
    s = "openai";
  }
  const v = s.toLowerCase();
  if (
    v === "openai" ||
    v === "claude" ||
    v === "codex" ||
    v === "perplexity" ||
    v === "openrouter" ||
    v === "groq" ||
    v === "nvidia" ||
    v === "gemini"
  )
    return v;
  throw new Error(
    `AI_PROVIDER must be one of: openai, claude, codex, perplexity, openrouter, groq, nvidia, gemini, or an alias: local, ollama, lmstudio (OpenAI-compatible) (got "${raw ?? ""}")`,
  );
}

export function readProviderId(): ProviderId {
  try {
    return normalizeProvider(process.env.AI_PROVIDER || "groq");
  } catch {
    return "groq";
  }
}

/** Raw AI_PROVIDER (before local→openai); for diagnostics only. */
export function readEnvAiProviderRaw(): string {
  return process.env.AI_PROVIDER?.trim() || "";
}

export type AiRuntimeSummary = {
  envAiProviderRaw: string;
  resolvedProviderId: ProviderId;
  displayLabel: string;
  defaultModel: string;
  openaiBaseIsLocal: boolean;
};

function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
  if (h.startsWith("172.")) {
    const p = h.split(".");
    const second = Number(p[1]);
    return p.length === 4 && second >= 16 && second <= 31;
  }
  return false;
}

/** For /healthz: accurate routing + default model, no secrets. */
export function getAiRuntimeSummary(): AiRuntimeSummary {
  const envAiProviderRaw = readEnvAiProviderRaw() || "(unset: priority defaults apply)";
  const resolvedProviderId = readProviderId();
  const base = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  let openaiBaseIsLocal = false;
  try {
    openaiBaseIsLocal = isLocalHostname(new URL(base).hostname);
  } catch {
    openaiBaseIsLocal = false;
  }

  const envLower = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  let displayLabel: string;
  if (
    resolvedProviderId === "openai" &&
    (envLower === "local" || envLower === "ollama" || envLower === "lmstudio" || envLower === "lm_studio" || envLower === "openai-local")
  ) {
    displayLabel = "local (OpenAI-compatible)";
  } else if (resolvedProviderId === "openai" && openaiBaseIsLocal) {
    displayLabel = "openai (custom / local base URL)";
  } else {
    displayLabel = resolvedProviderId;
  }

  const defaultModel = (() => {
    switch (resolvedProviderId) {
      case "openai": {
        return readOpenAIModel();
      }
      case "claude": {
        return readClaudeModel();
      }
      case "codex": {
        return readCodexModel();
      }
      case "perplexity": {
        return "sonar-pro";
      }
      case "openrouter": {
        return readOpenRouterModel();
      }
      case "groq": {
        return readGroqModel();
      }
      case "nvidia": {
        return readNvidiaModel();
      }
      case "gemini": {
        return readGeminiModel();
      }
      default: {
        const _e: never = resolvedProviderId;
        return _e;
      }
    }
  })();

  return { envAiProviderRaw, resolvedProviderId, displayLabel, defaultModel, openaiBaseIsLocal };
}

export function readProviderPriority(): ProviderId[] {
  const raw = process.env.AI_PROVIDER_PRIORITY?.trim();
  if (!raw) return defaultProviderPriority();
  const values: ProviderId[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    try {
      values.push(normalizeProvider(v));
    } catch {
      /* skip invalid token */
    }
  }
  return values.length ? values : defaultProviderPriority();
}

export function readUseRealAI(): boolean {
  const value = process.env.USE_REAL_AI?.trim().toLowerCase();
  if (!value) return true;
  return value === "1" || value === "true" || value === "yes";
}

export function readOpenAIModel(): string {
  return process.env.AI_MODEL_OPENAI?.trim() || "gpt-5.2";
}

export function readClaudeModel(): string {
  return (
    process.env.AI_MODEL_CLAUDE?.trim() || "claude-3-5-sonnet-20241022"
  );
}

export function readCodexModel(): string {
  return process.env.AI_MODEL_CODEX?.trim() || "gpt-4o-mini";
}

export function readOpenRouterModel(): string {
  return process.env.AI_MODEL_OPENROUTER?.trim() || "google/gemini-flash-1.5-8b";
}

export function readGroqModel(): string {
  return process.env.AI_MODEL_GROQ?.trim() || "llama-3.3-70b-versatile";
}

export function readGeminiModel(): string {
  return process.env.AI_MODEL_GEMINI?.trim() || "gemini-1.5-flash-latest";
}

export function readNvidiaModel(): string {
  return process.env.AI_MODEL_NVIDIA?.trim() || "meta/llama-3.3-70b-instruct";
}

/** OpenAI-compatible NVIDIA NIM (build.nvidia.com, nvapi-… keys). Never log the key. */
export function readNvidiaCredentials(): { baseURL: string; apiKey: string } {
  const apiKey =
    process.env.NVIDIA_API_KEY?.trim() ?? process.env.AI_INTEGRATIONS_NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("NVIDIA provider requires NVIDIA_API_KEY or AI_INTEGRATIONS_NVIDIA_API_KEY");
  }
  const baseURL =
    process.env.NVIDIA_BASE_URL?.trim() ??
    process.env.AI_INTEGRATIONS_NVIDIA_BASE_URL?.trim() ??
    "https://integrate.api.nvidia.com/v1";
  return { baseURL, apiKey };
}

function defaultProviderPriority(): ProviderId[] {
  const defaults: ProviderId[] = ["groq", "openrouter", "gemini", "nvidia"];
  const localBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() ?? "";
  if (/localhost|127\.0\.0\.1|192\.168\.|10\./i.test(localBase)) {
    defaults.push("openai");
  }
  return defaults;
}

const OPENAI_OFFICIAL_HOST = "api.openai.com";

export function readOpenAICredentials(): { baseURL: string; apiKey: string } {
  const baseURL =
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  const rawKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const isOfficialOpenAI = baseURL.includes(OPENAI_OFFICIAL_HOST);
  if (isOfficialOpenAI && !rawKey) {
    throw new Error(
      "OpenAI (api.openai.com) requires AI_INTEGRATIONS_OPENAI_API_KEY",
    );
  }
  // Ollama, LM Studio, and other local OpenAI-compatible servers ignore the key;
  // the client still needs a non-empty string.
  const apiKey = rawKey || "not-needed";
  return { baseURL, apiKey };
}

export function readClaudeCredentials(): {
  baseURL: string;
  apiKey: string;
} {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Claude provider requires AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    );
  }
  const baseURL =
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL?.trim() ||
    "https://api.anthropic.com";
  return { baseURL, apiKey };
}

export function readCodexCredentials(): { baseURL: string; apiKey: string } {
  const baseURL = process.env.AI_INTEGRATIONS_CODEX_BASE_URL?.trim();
  const apiKey = process.env.AI_INTEGRATIONS_CODEX_API_KEY?.trim();
  if (!baseURL || !apiKey) {
    throw new Error(
      "Codex provider requires AI_INTEGRATIONS_CODEX_BASE_URL and AI_INTEGRATIONS_CODEX_API_KEY (OpenAI-compatible Chat Completions API)",
    );
  }
  return { baseURL, apiKey };
}

export function readPerplexityCredentials(): { baseURL: string; apiKey: string } {
  const apiKey =
    process.env.PERPLEXITY_API_KEY?.trim() ??
    process.env.AI_INTEGRATIONS_PERPLEXITY_API_KEY?.trim();
  const baseURL =
    process.env.AI_INTEGRATIONS_PERPLEXITY_BASE_URL?.trim() ?? "https://api.perplexity.ai";
  if (!apiKey) {
    throw new Error(
      "Perplexity provider requires PERPLEXITY_API_KEY or AI_INTEGRATIONS_PERPLEXITY_API_KEY",
    );
  }
  return { baseURL, apiKey };
}

export function readOpenRouterCredentials(): { baseURL: string; apiKey: string } {
  const baseURL = process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenRouter provider requires OPENROUTER_API_KEY");
  }
  return { baseURL, apiKey };
}

export function readGroqCredentials(): { baseURL: string; apiKey: string } {
  const baseURL = process.env.AI_INTEGRATIONS_GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1";
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Groq provider requires GROQ_API_KEY");
  }
  return { baseURL, apiKey };
}

export function readGeminiCredentials(): { apiKey: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Gemini provider requires GEMINI_API_KEY");
  }
  return { apiKey };
}

/** True if this provider can be constructed without missing-credential errors. Perplexity is excluded when keys are unset. */
export function hasProviderCredentials(id: ProviderId): boolean {
  try {
    switch (id) {
      case "openai": {
        readOpenAICredentials();
        return true;
      }
      case "claude": {
        readClaudeCredentials();
        return true;
      }
      case "codex": {
        readCodexCredentials();
        return true;
      }
      case "perplexity": {
        const k =
          process.env.PERPLEXITY_API_KEY?.trim() ?? process.env.AI_INTEGRATIONS_PERPLEXITY_API_KEY?.trim();
        return Boolean(k);
      }
      case "openrouter": {
        readOpenRouterCredentials();
        return true;
      }
      case "groq": {
        readGroqCredentials();
        return true;
      }
      case "nvidia": {
        const k =
          process.env.NVIDIA_API_KEY?.trim() ?? process.env.AI_INTEGRATIONS_NVIDIA_API_KEY?.trim();
        return Boolean(k);
      }
      case "gemini": {
        readGeminiCredentials();
        return true;
      }
      default: {
        const _e: never = id;
        return _e;
      }
    }
  } catch {
    return false;
  }
}

export function filterProvidersWithCredentials(ids: readonly ProviderId[]): ProviderId[] {
  return ids.filter((id) => hasProviderCredentials(id));
}
