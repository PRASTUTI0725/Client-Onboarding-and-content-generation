export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ResponseFormat = "json_object" | "text";

export type ChatCompletionMeta = {
  finishReason?: string | null;
  contentLength: number;
};

export interface ChatCompletionParams {
  messages: ChatMessage[];
  maxOutputTokens: number;
  responseFormat?: ResponseFormat;
  /** Overrides default model for the active provider */
  model?: string;
  /** Request-scoped diagnostic label for provider attempt tracing */
  contextLabel?: string;
  /** Internal flag: allow fallback chain to advance if JSON-stage validation fails after provider success. */
  allowInvalidJsonFailover?: boolean;
  /** Optional hook for finish_reason / output length diagnostics (Business DNA, etc.). */
  onCompletionMeta?: (meta: ChatCompletionMeta) => void;
}

export interface LLMProvider {
  readonly id:
    | "openai"
    | "claude"
    | "codex"
    | "perplexity"
    | "openrouter"
    | "groq"
    | "nvidia"
    | "gemini"
    | "multi";
  chatCompletion(params: ChatCompletionParams): Promise<string>;
  describe?(): { provider: string; model: string };
}
