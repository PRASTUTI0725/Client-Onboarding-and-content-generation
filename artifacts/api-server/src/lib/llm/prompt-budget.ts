export interface PromptBudgetStats {
  label: string;
  estimatedInputTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  estimatedTotalTokens: number;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function trimToTokenBudget(text: string, maxTokens: number): string {
  const clean = text.trim();
  if (!clean) return "";
  if (estimateTokens(clean) <= maxTokens) return clean;

  const words = clean.split(/\s+/);
  let low = 0;
  let high = words.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = words.slice(0, mid).join(" ");
    if (estimateTokens(candidate) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  return words.slice(0, Math.max(low, 1)).join(" ").trim();
}

export function buildPromptBudgetStats(
  label: string,
  parts: unknown[],
  maxInputTokens: number,
  maxOutputTokens: number,
): PromptBudgetStats {
  const estimatedInputTokens = parts.reduce<number>((sum, part) => sum + estimateTokens(part), 0);
  return {
    label,
    estimatedInputTokens,
    maxInputTokens,
    maxOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + maxOutputTokens,
  };
}

export function assertPromptWithinBudget(
  label: string,
  parts: unknown[],
  maxInputTokens: number,
  maxOutputTokens: number,
): PromptBudgetStats {
  const stats = buildPromptBudgetStats(label, parts, maxInputTokens, maxOutputTokens);
  if (stats.estimatedInputTokens > maxInputTokens) {
    throw new Error(
      `Prompt too large for free tier - upgrade credits or shorten inputs (${label}: estimated ${stats.estimatedInputTokens} input tokens, max ${maxInputTokens}).`,
    );
  }
  return stats;
}
