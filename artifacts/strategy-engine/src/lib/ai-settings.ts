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
};

const STORAGE_KEY = "strategy-engine-ai-settings";

export function readAISettings(): AISettings {
  if (typeof window === "undefined") {
    return { useRealAI: true, provider: "openrouter", apiKey: "", model: "" };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { useRealAI: true, provider: "openrouter", apiKey: "", model: "" };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return {
      useRealAI: parsed.useRealAI ?? true,
      provider: parsed.provider ?? "openrouter",
      apiKey: parsed.apiKey ?? "",
      model: parsed.model ?? "",
    };
  } catch {
    return { useRealAI: true, provider: "openrouter", apiKey: "", model: "" };
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
    "x-ai-provider": settings.provider,
    ...(settings.apiKey ? { "x-ai-api-key": settings.apiKey } : {}),
    ...(settings.model ? { "x-ai-model": settings.model } : {}),
  };
}
