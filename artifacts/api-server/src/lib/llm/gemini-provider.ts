import type { ChatCompletionParams, LLMProvider } from "./types.js";
import { estimateTokens } from "./prompt-budget.js";
import { recordLatestAiUsage } from "../runtime-mode.js";
import { ProviderRequestError } from "./provider-errors.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  private readonly apiKey: string;
  private readonly defaultModel: string;

  constructor(apiKey: string, defaultModel: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<string> {
    const model = params.model ?? this.defaultModel;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const prompt = params.messages
      .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
      .join("\n\n");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType:
            params.responseFormat === "json_object" ? "application/json" : "text/plain",
          maxOutputTokens: Math.min(params.maxOutputTokens, 8192),
        },
      }),
    });
    const json = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      const message = json.error?.message ?? JSON.stringify(json);
      recordLatestAiUsage({
        provider: this.id,
        model,
        requestStatus: "failed",
        estimatedInputTokens: estimateTokens(prompt),
        estimatedOutputTokens: params.maxOutputTokens,
        httpStatus: res.status,
        error: message,
      });
      throw new ProviderRequestError({
        provider: this.id,
        model,
        message: `Gemini API error ${res.status}: ${message}`,
        httpStatus: res.status,
      });
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    params.onCompletionMeta?.({ finishReason: null, contentLength: text.length });
    const usage = json.usageMetadata;
    recordLatestAiUsage({
      provider: this.id,
      model,
      requestStatus: "success",
      estimatedInputTokens: usage?.promptTokenCount ?? estimateTokens(prompt),
      estimatedOutputTokens: usage?.candidatesTokenCount ?? params.maxOutputTokens,
      totalTokens: usage?.totalTokenCount ?? null,
      rateLimits: null,
    });
    if (process.env.LLM_DIAGNOSTICS === "1" || process.env.OPENAI_COMPAT_DEBUG === "1") {
      console.info(
        `[llm] gemini.generate ok model=${model} content_len=${text.length} ` +
          `usage_prompt=${usage?.promptTokenCount ?? "n/a"} usage_completion=${usage?.candidatesTokenCount ?? "n/a"} usage_total=${usage?.totalTokenCount ?? "n/a"}`,
      );
    }
    return text;
  }

  describe() {
    return { provider: this.id, model: this.defaultModel };
  }
}
