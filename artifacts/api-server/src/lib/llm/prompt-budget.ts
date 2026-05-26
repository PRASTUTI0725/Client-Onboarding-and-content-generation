export interface PromptBudgetStats {
  label: string;
  estimatedInputTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  estimatedTotalTokens: number;
  segments?: PromptBudgetSegment[];
}

export interface PromptBudgetSegment {
  label: string;
  chars: number;
  estimatedTokens: number;
}

export type PromptBudgetPart = unknown | { label: string; value: unknown };

export class PromptBudgetError extends Error {
  readonly label: string;
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly segments?: PromptBudgetSegment[];

  constructor(stats: PromptBudgetStats) {
    super(
      `Prompt too large for free tier - upgrade credits or shorten inputs (${stats.label}: estimated ${stats.estimatedInputTokens} input tokens, max ${stats.maxInputTokens}).`,
    );
    this.name = "PromptBudgetError";
    this.label = stats.label;
    this.estimatedInputTokens = stats.estimatedInputTokens;
    this.maxInputTokens = stats.maxInputTokens;
    this.maxOutputTokens = stats.maxOutputTokens;
    this.segments = stats.segments;
  }
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
  parts: PromptBudgetPart[],
  maxInputTokens: number,
  maxOutputTokens: number,
): PromptBudgetStats {
  const segments = parts.map((part, index) => {
    const named = isNamedPromptBudgetPart(part);
    const value = named ? part.value : part;
    const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return {
      label: named ? part.label : `part_${index + 1}`,
      chars: text.length,
      estimatedTokens: estimateTokens(text),
    };
  });
  const estimatedInputTokens = segments.reduce<number>((sum, segment) => sum + segment.estimatedTokens, 0);
  return {
    label,
    estimatedInputTokens,
    maxInputTokens,
    maxOutputTokens,
    estimatedTotalTokens: estimatedInputTokens + maxOutputTokens,
    segments,
  };
}

export function assertPromptWithinBudget(
  label: string,
  parts: PromptBudgetPart[],
  maxInputTokens: number,
  maxOutputTokens: number,
): PromptBudgetStats {
  const stats = buildPromptBudgetStats(label, parts, maxInputTokens, maxOutputTokens);
  if (stats.estimatedInputTokens > maxInputTokens) {
    throw new PromptBudgetError(stats);
  }
  return stats;
}

function isNamedPromptBudgetPart(part: PromptBudgetPart): part is { label: string; value: unknown } {
  return part != null && typeof part === "object" && "label" in part && "value" in part;
}
