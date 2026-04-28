export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ResponseFormat = "json_object" | "text";

export interface ChatCompletionParams {
  messages: ChatMessage[];
  maxOutputTokens: number;
  responseFormat?: ResponseFormat;
  /** Overrides default model for the active provider */
  model?: string;
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
