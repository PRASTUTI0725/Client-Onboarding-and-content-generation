export function isBusinessDnaContextLabel(contextLabel: string): boolean {
  return contextLabel.toLowerCase().includes("business dna");
}

export function looksLikeTruncatedJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of trimmed) {
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
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
  }
  return depth !== 0 || inString;
}

export function logBusinessDnaJsonFailure(params: {
  contextLabel: string;
  attempt: "first" | "retry" | "repair";
  raw: string;
  finishReason?: string | null;
  parseError?: string;
}): void {
  if (!isBusinessDnaContextLabel(params.contextLabel)) return;
  const finishReason = params.finishReason ?? "unknown";
  const truncated =
    finishReason === "length" || finishReason === "max_tokens" || looksLikeTruncatedJson(params.raw);
  console.warn(
    `[business_dna] json_parse_failed attempt=${params.attempt} finish_reason=${finishReason} raw_len=${params.raw.length} truncated_suspect=${truncated}${params.parseError ? ` parse_error=${params.parseError}` : ""}`,
  );
  if (finishReason === "length" || finishReason === "max_tokens") {
    console.warn(
      `[business_dna] provider_output_truncated context=${params.contextLabel} attempt=${params.attempt} raw_len=${params.raw.length}`,
    );
  }
}
