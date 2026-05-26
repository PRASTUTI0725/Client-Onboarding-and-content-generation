export type AIProvider =
  | "openrouter"
  | "groq"
  | "nvidia"
  | "gemini"
  | "perplexity"
  | "openai"
  | "claude"
  | "codex";

export type AISettings = {
  useRealAI: boolean;
  provider: AIProvider;
  apiKey: string;
  model: string;
  providerOverrideEnabled?: boolean;
};

const STORAGE_KEY = "strategy-engine-ai-settings";

export function readAISettings(): AISettings {
  if (typeof window === "undefined") {
    return { useRealAI: true, provider: "groq", apiKey: "", model: "", providerOverrideEnabled: false };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { useRealAI: true, provider: "groq", apiKey: "", model: "", providerOverrideEnabled: false };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return {
      useRealAI: parsed.useRealAI ?? true,
      provider: parsed.provider ?? "groq",
      apiKey: parsed.apiKey ?? "",
      model: parsed.model ?? "",
      providerOverrideEnabled: parsed.providerOverrideEnabled === true,
    };
  } catch {
    return { useRealAI: true, provider: "groq", apiKey: "", model: "", providerOverrideEnabled: false };
  }
}

export function writeAISettings(next: AISettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("ai-settings-updated"));
}

export function buildAIHeaders(settings: AISettings): Record<string, string> {
  return {
    "x-use-real-ai": settings.useRealAI ? "true" : "false",
    ...(settings.providerOverrideEnabled ? { "x-ai-provider": settings.provider } : {}),
    ...(settings.apiKey ? { "x-ai-api-key": settings.apiKey } : {}),
    ...(settings.providerOverrideEnabled && settings.model ? { "x-ai-model": settings.model } : {}),
  };
}
