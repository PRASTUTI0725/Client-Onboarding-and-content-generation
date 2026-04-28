import type { ChatCompletionParams, LLMProvider } from "./types.js";
import { ProviderRequestError } from "./provider-errors.js";

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export class ClaudeProvider implements LLMProvider {
  readonly id = "claude" as const;
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(baseURL: string, apiKey: string, defaultModel: string) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<string> {
    const systemParts = params.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content);
    const userParts = params.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role.toUpperCase()}:\n${m.content}`);

    let system =
      systemParts.join("\n\n") ||
      "You are a helpful assistant for a marketing strategy product.";
    if (params.responseFormat === "json_object") {
      system += `\n\nYou must respond with a single valid JSON object only. No markdown fences, no prose outside JSON.`;
    }

    const userContent = userParts.join("\n\n") || "(no user message)";

    const model = params.model ?? this.defaultModel;
    const url = `${this.baseURL}/v1/messages`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(params.maxOutputTokens, 8192),
        system,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    const json = (await res.json()) as AnthropicMessageResponse;
    if (!res.ok) {
      throw new ProviderRequestError({
        provider: this.id,
        model,
        message: `Claude API error ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`,
        httpStatus: res.status,
      });
    }
    const text = json.content?.find((c) => c.type === "text")?.text ?? "";
    return text;
  }

  describe() {
    return { provider: this.id, model: this.defaultModel };
  }
}
