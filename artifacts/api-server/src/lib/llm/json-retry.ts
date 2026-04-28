import type { ChatMessage, LLMProvider } from "./types.js";

export async function getStrictJsonWithRetry<T>(
  provider: LLMProvider,
  options: {
    messages: ChatMessage[];
    maxOutputTokens: number;
    contextLabel: string;
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

  const first = await provider.chatCompletion({
    messages: options.messages,
    maxOutputTokens: options.maxOutputTokens,
    responseFormat: "json_object",
  });
  const diag = process.env.LLM_DIAGNOSTICS === "1" || process.env.OPENAI_COMPAT_DEBUG === "1";
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
  const enableRetry = process.env.LLM_JSON_RETRY === "1";
  if (!enableRetry) {
    throw new Error(`Invalid JSON from LLM for ${options.contextLabel} (retry disabled)`);
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
    const retry = await provider.chatCompletion({
      messages: [
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
      maxOutputTokens: options.maxOutputTokens,
      responseFormat: "json_object",
    });
    const parsedRetry = tryParse(retry || "");
    if (parsedRetry != null) {
      console.info(`[llm-observe] ${options.contextLabel} total_json_stage_ms=${Date.now() - startedAt}`);
      return parsedRetry;
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
      throw new Error(`Invalid JSON from LLM after retry for ${options.contextLabel}: ${reason}`);
    }
  }
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
