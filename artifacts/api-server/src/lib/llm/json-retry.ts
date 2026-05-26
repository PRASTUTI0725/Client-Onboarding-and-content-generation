import type { ChatCompletionMeta, ChatMessage, LLMProvider } from "./types.js";

import { logBusinessDnaJsonFailure } from "../business-dna/json-log.js";
import { setLastFailureStage } from "../runtime-mode.js";

export class JsonStageFailureError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly contextLabel: string;
  readonly retryRan: boolean;
  readonly repairRan: boolean;
  readonly finalReason: string;
  readonly rawFirstHash: string;
  readonly rawFirstPreview: string;
  readonly rawRetryHash?: string;
  readonly rawRetryPreview?: string;
  readonly rawRepairHash?: string;
  readonly rawRepairPreview?: string;
  readonly errorCode = "invalid_json_after_retry";

  constructor(input: {
    provider: string;
    model: string;
    contextLabel: string;
    retryRan: boolean;
    repairRan: boolean;
    finalReason: string;
    rawFirst: string;
    rawRetry?: string;
    rawRepair?: string;
  }) {
    super(`Invalid JSON from LLM for ${input.contextLabel}: ${input.finalReason}`);
    this.name = "JsonStageFailureError";
    this.provider = input.provider;
    this.model = input.model;
    this.contextLabel = input.contextLabel;
    this.retryRan = input.retryRan;
    this.repairRan = input.repairRan;
    this.finalReason = input.finalReason;
    this.rawFirstHash = hashPreview(input.rawFirst || "");
    this.rawFirstPreview = (input.rawFirst || "").slice(0, 600);
    if (typeof input.rawRetry === "string") {
      this.rawRetryHash = hashPreview(input.rawRetry);
      this.rawRetryPreview = input.rawRetry.slice(0, 600);
    }
    if (typeof input.rawRepair === "string") {
      this.rawRepairHash = hashPreview(input.rawRepair);
      this.rawRepairPreview = input.rawRepair.slice(0, 600);
    }
  }
}

export async function getStrictJsonWithRetry<T>(
  provider: LLMProvider,
  options: {
    messages: ChatMessage[];
    maxOutputTokens: number;
    contextLabel: string;
    onRawResponse?: (raw: string, attempt: "first" | "retry" | "repair") => void;
    onCompletionMeta?: (meta: ChatCompletionMeta, attempt: "first" | "retry" | "repair") => void;
  },
): Promise<T> {
  const startedAt = Date.now();
  const tryParse = (raw: string): T | null => {
    const parseStartedAt = Date.now();
    const attempts = buildJsonParseAttempts(raw || "");
    for (const candidate of attempts) {
      try {
        const parsed = JSON.parse(candidate) as T;
        console.info(
          `[llm-observe] ${options.contextLabel} json_parse_ms=${Date.now() - parseStartedAt} candidate_count=${attempts.length}`,
        );
        return parsed;
      } catch {
        // Try next repair variant.
      }
    }
    console.info(
      `[llm-observe] ${options.contextLabel} json_parse_ms=${Date.now() - parseStartedAt} candidate_count=${attempts.length} parsed=false`,
    );
    return null;
  };

  const chatParams = (
    messages: ChatMessage[],
    attempt: "first" | "retry" | "repair",
    contextLabel = options.contextLabel,
  ) => {
    let finishReason: string | null = null;
    return {
      request: {
        messages,
        maxOutputTokens: options.maxOutputTokens,
        responseFormat: "json_object" as const,
        contextLabel,
        onCompletionMeta: (meta: ChatCompletionMeta) => {
          finishReason = meta.finishReason ?? null;
          options.onCompletionMeta?.(meta, attempt);
        },
      },
      finishReason: () => finishReason,
    };
  };

  const firstCall = chatParams(options.messages, "first");
  const first = await provider.chatCompletion(firstCall.request);
  options.onRawResponse?.(first || "", "first");
  const diag = process.env.LLM_DIAGNOSTICS === "1" || process.env.OPENAI_COMPAT_DEBUG === "1";
  const providerInfo = provider.describe?.() ?? { provider: provider.id, model: "default" };
  if (diag) {
    const pv = (first || "").replace(/\s+/g, " ").trim().slice(0, 240);
    console.info(
      `[llm-json] ${options.contextLabel} first_response len=${(first || "").length} preview=${pv || "(empty)"}`,
    );
  }
  const parsedFirst = tryParse(first || "");
  if (parsedFirst != null) {
    console.info(`[llm-observe] ${options.contextLabel} total_json_stage_ms=${Date.now() - startedAt}`);
    return parsedFirst;
  }
  logBusinessDnaJsonFailure({
    contextLabel: options.contextLabel,
    attempt: "first",
    raw: first || "",
    finishReason: firstCall.finishReason(),
  });
  if (diag) {
    console.warn(
      `[llm-json] ${options.contextLabel} failed_generation attempt=first hash=${hashPreview(first || "")} preview=${(first || "").slice(0, 600)}`,
    );
  }
  const enableRetry = process.env.LLM_JSON_RETRY === "1";
  if (!enableRetry) {
    setLastFailureStage("json_parse_failed");
    throw new JsonStageFailureError({
      provider: providerInfo.provider,
      model: providerInfo.model,
      contextLabel: options.contextLabel,
      retryRan: false,
      repairRan: false,
      finalReason: "retry disabled",
      rawFirst: first || "",
    });
  }
  {
    const firstErr = new Error("first parse failed");
    if (diag) {
      const msg = firstErr.message;
      console.warn(
        `[llm-json] ${options.contextLabel} parse_1 failed: ${msg} snippet=${(first || "").slice(0, 400)}`,
      );
    }
    await sleep(800);
    const retryCall = chatParams(
      [
        ...options.messages,
        {
          role: "assistant",
          content: first,
        },
        {
          role: "user",
          content:
            `Your previous ${options.contextLabel} output was not valid JSON. ` +
            "Retry now with ONE valid JSON object only. No markdown, no commentary, no trailing text.",
        },
      ],
      "retry",
      `${options.contextLabel} retry`,
    );
    const retry = await provider.chatCompletion(retryCall.request);
    options.onRawResponse?.(retry || "", "retry");
    const parsedRetry = tryParse(retry || "");
    if (parsedRetry != null) {
      console.info(`[llm-observe] ${options.contextLabel} total_json_stage_ms=${Date.now() - startedAt}`);
      return parsedRetry;
    }
    logBusinessDnaJsonFailure({
      contextLabel: options.contextLabel,
      attempt: "retry",
      raw: retry || "",
      finishReason: retryCall.finishReason(),
    });
    if (diag) {
      console.warn(
        `[llm-json] ${options.contextLabel} failed_generation attempt=retry hash=${hashPreview(retry || "")} preview=${(retry || "").slice(0, 600)}`,
      );
    }
    const enableRepair = (process.env.LLM_JSON_REPAIR?.trim().toLowerCase() ?? "1");
    if (enableRepair === "1" || enableRepair === "true" || enableRepair === "yes") {
      const repairCall = chatParams(
        [
          {
            role: "system",
            content:
              "You are a JSON repair assistant. Convert the provided malformed model output into one valid JSON object only. Preserve the original structure and intent. Do not add commentary or markdown.",
          },
          {
            role: "user",
            content:
              `Repair this into one valid JSON object for ${options.contextLabel}. ` +
              "If content is incomplete, salvage what is clearly present and keep the structure compact.\n\n" +
              retry,
          },
        ],
        "repair",
        `${options.contextLabel} json repair`,
      );
      const repair = await provider.chatCompletion(repairCall.request);
      options.onRawResponse?.(repair || "", "repair");
      const parsedRepair = tryParse(repair || "");
      if (parsedRepair != null) {
        console.info(`[llm-observe] ${options.contextLabel} total_json_stage_ms=${Date.now() - startedAt}`);
        return parsedRepair;
      }
      logBusinessDnaJsonFailure({
        contextLabel: options.contextLabel,
        attempt: "repair",
        raw: repair || "",
        finishReason: repairCall.finishReason(),
      });
      if (diag) {
        console.warn(
          `[llm-json] ${options.contextLabel} failed_generation attempt=repair hash=${hashPreview(repair || "")} preview=${(repair || "").slice(0, 600)}`,
        );
      }
      setLastFailureStage("json_parse_failed");
      throw new JsonStageFailureError({
        provider: providerInfo.provider,
        model: providerInfo.model,
        contextLabel: options.contextLabel,
        retryRan: true,
        repairRan: true,
        finalReason: "retry and repair failed",
        rawFirst: first || "",
        rawRetry: retry || "",
        rawRepair: repair || "",
      });
    }
    {
      const retryErr = new Error("retry parse failed");
      const reason =
        retryErr instanceof Error ? retryErr.message : String(retryErr ?? firstErr ?? "Unknown parse error");
      if (diag) {
        console.warn(
          `[llm-json] ${options.contextLabel} parse_2 failed: ${reason} ` +
            `retry_len=${(retry || "").length} retry_snip=${(retry || "").slice(0, 400)}`,
        );
      }
      setLastFailureStage("json_parse_failed");
      throw new JsonStageFailureError({
        provider: providerInfo.provider,
        model: providerInfo.model,
        contextLabel: options.contextLabel,
        retryRan: true,
        repairRan: false,
        finalReason: reason,
        rawFirst: first || "",
        rawRetry: retry || "",
      });
    }
  }
}

function hashPreview(value: string, length = 16): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(length, "0").slice(0, length);
}

function buildJsonParseAttempts(input: string): string[] {
  const trimmed = (input || "").trim();
  if (!trimmed) return [];

  const normalized = normalizeJsonNoise(trimmed);
  const extracted = extractBalancedJson(normalized);
  const attempts = [
    trimmed,
    stripMarkdownCodeFences(trimmed),
    normalized,
    extracted,
    extracted ? removeTrailingCommas(extracted) : null,
    extracted ? normalizeJsonNoise(extracted) : null,
    extracted ? forceCloseJsonDelimiters(extracted) : null,
    extracted ? forceCloseJsonDelimiters(removeTrailingCommas(normalizeJsonNoise(extracted))) : null,
  ].filter((v): v is string => Boolean(v && v.trim()));

  return Array.from(new Set(attempts));
}

function normalizeJsonNoise(input: string): string {
  return removeTrailingCommas(
    stripMarkdownCodeFences(input)
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2018|\u2019/g, "'")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n"),
  ).trim();
}

function stripMarkdownCodeFences(input: string): string {
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return input.replace(/```json|```/gi, "").trim();
}

function removeTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedJson(input: string): string | null {
  const startIdx = firstJsonStartIndex(input);
  if (startIdx === -1) return null;

  const open = input[startIdx]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < input.length; i += 1) {
    const ch = input[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return input.slice(startIdx, i + 1).trim();
    }
  }

  return input.slice(startIdx).trim();
}

function forceCloseJsonDelimiters(input: string): string {
  const startIdx = firstJsonStartIndex(input);
  if (startIdx === -1) return input.trim();
  const body = input.slice(startIdx);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) stack.pop();
  }

  return `${body.trim()}${stack.reverse().join("")}`;
}

function firstJsonStartIndex(input: string): number {
  const obj = input.indexOf("{");
  const arr = input.indexOf("[");
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
