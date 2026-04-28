import OpenAI from "openai";
import type { ChatCompletionParams, LLMProvider } from "./types.js";
import { estimateTokens } from "./prompt-budget.js";
import { recordLatestAiUsage } from "../runtime-mode.js";
import { ProviderRequestError } from "./provider-errors.js";

export class OpenAICompatProvider implements LLMProvider {
  readonly id: "openai" | "codex" | "perplexity" | "openrouter" | "groq" | "nvidia";
  private readonly client: OpenAI;
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private localHealthChecked = false;

  constructor(
    id: "openai" | "codex" | "perplexity" | "openrouter" | "groq" | "nvidia",
    baseURL: string,
    apiKey: string,
    defaultModel: string,
  ) {
    this.id = id;
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.client = new OpenAI({ baseURL, apiKey });
    this.defaultModel = defaultModel;
  }

  private isLocalBaseURL(): boolean {
    try {
      const host = new URL(this.baseURL).hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1") return true;
      if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
      const parts = host.split(".");
      if (parts.length !== 4 || parts[0] !== "172") return false;
      const second = Number(parts[1]);
      return Number.isInteger(second) && second >= 16 && second <= 31;
    } catch {
      return false;
    }
  }

  private async ensureLocalHealth(model: string) {
    if (!this.isLocalBaseURL() || this.localHealthChecked) return;
    await this.client.chat.completions.create({
      model,
      max_tokens: 8,
      messages: [{ role: "user", content: "hello" }],
    });
    this.localHealthChecked = true;
    console.info(
      `[llm] local model health=ok provider=${this.id} base_url=${this.baseURL} model=${model}`,
    );
  }

  async chatCompletion(params: ChatCompletionParams): Promise<string> {
    const model = params.model ?? this.defaultModel;
    const useCompletionTokens = /^(gpt-5|o\d|o1)/i.test(model);
    const diag = process.env.LLM_DIAGNOSTICS === "1" || process.env.OPENAI_COMPAT_DEBUG === "1";
    if (diag) {
      console.info(
        `[llm] openai_compat.create begin provider=${this.id} model=${model} ` +
          `json_mode=${params.responseFormat === "json_object"} max_out=${params.maxOutputTokens} msgs=${params.messages.length}`,
      );
    }
    try {
      await this.ensureLocalHealth(model);
      const response = await fetch(new URL("chat/completions", this.baseURL.endsWith("/") ? this.baseURL : `${this.baseURL}/`), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          ...(useCompletionTokens
            ? { max_completion_tokens: params.maxOutputTokens }
            : { max_tokens: params.maxOutputTokens }),
          ...(params.responseFormat === "json_object"
            ? { response_format: { type: "json_object" as const } }
            : {}),
          messages: params.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const completion = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string; type?: string }> }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        error?: { message?: string; code?: string };
      };
      if (!response.ok) {
        const message = completion.error?.message ?? `HTTP ${response.status}`;
        recordLatestAiUsage({
          provider: this.id,
          model,
          requestStatus: "failed",
          estimatedInputTokens: estimateTokens(params.messages.map((m) => m.content).join("\n\n")),
          estimatedOutputTokens: params.maxOutputTokens,
          httpStatus: response.status,
          error: message,
          rateLimits: extractRateLimits(this.id, response.headers),
        });
        throw new ProviderRequestError({
          provider: this.id,
          model,
          message,
          httpStatus: response.status,
          errorCode: completion.error?.code,
        });
      }
      const content = completion.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : "";
      const fr = completion.choices?.[0]?.finish_reason;
      const usage = completion.usage ?? null;
      recordLatestAiUsage({
        provider: this.id,
        model,
        requestStatus: "success",
        estimatedInputTokens: usage?.prompt_tokens ?? estimateTokens(params.messages.map((m) => m.content).join("\n\n")),
        estimatedOutputTokens: usage?.completion_tokens ?? params.maxOutputTokens,
        totalTokens: usage?.total_tokens ?? null,
        rateLimits: extractRateLimits(this.id, response.headers),
      });
      if (diag) {
        console.info(
          `[llm] openai_compat.create ok provider=${this.id} model=${model} ` +
            `status=200 content_len=${text.length} finish_reason=${fr ?? "n/a"} ` +
            `usage_prompt=${usage?.prompt_tokens ?? "n/a"} usage_completion=${usage?.completion_tokens ?? "n/a"} usage_total=${usage?.total_tokens ?? "n/a"}`,
        );
      }
      if (!text.trim() && diag) {
        console.warn(
          `[llm] openai_compat empty content provider=${this.id} model=${model} ` +
            `finish_reason=${fr ?? "n/a"} raw_choice=${JSON.stringify(completion.choices?.[0] ?? null).slice(0, 500)}`,
        );
      }
      return text;
    } catch (err) {
      const e = err as { status?: number; message?: string; error?: unknown; code?: string };
      const errBody =
        e.error !== undefined
          ? typeof e.error === "string"
            ? e.error
            : JSON.stringify(e.error)
          : "";
      console.error(
        `[llm] openai_compat.create FAILED provider=${this.id} model=${model} ` +
          `path=client.chat.completions.create status=${e.status ?? "n/a"} ` +
          `code=${e.code ?? "n/a"} message=${e.message ?? String(err)} ` +
          `err_body=${errBody || "(none)"}`,
      );
      throw err;
    }
  }

  describe() {
    return { provider: this.id, model: this.defaultModel };
  }
}

function extractRateLimits(provider: string, headers: Headers) {
  const get = (name: string) => headers.get(name) ?? headers.get(name.toLowerCase()) ?? headers.get(name.toUpperCase());
  if (provider === "groq") {
    return {
      remainingRequests: get("x-ratelimit-remaining-requests") ?? "unknown",
      remainingTokens: get("x-ratelimit-remaining-tokens") ?? "unknown",
      resetRequests: get("x-ratelimit-reset-requests") ?? get("retry-after") ?? "unknown",
      resetTokens: get("x-ratelimit-reset-tokens") ?? "unknown",
    };
  }
  if (provider === "openrouter") {
    return {
      remainingRequests: get("x-ratelimit-remaining") ?? "unknown",
      remainingTokens: get("x-ratelimit-remaining-tokens") ?? "unknown",
      resetRequests: get("x-ratelimit-reset") ?? "unknown",
      resetTokens: get("x-ratelimit-reset-tokens") ?? "unknown",
    };
  }
  return null;
}
