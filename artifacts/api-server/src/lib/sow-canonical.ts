/**
 * Canonical SOW v2 shape: fixed internal fields + parse provenance.
 * Legacy consumers use `effectiveScopeOfWork()` / `effectiveUnderstanding()` for DNA + calendar.
 */

export const SOW_VERSION_LATEST = 2 as const;

export type SowParseMode = "roman" | "classic" | "hybrid" | "llm";

export type SowSectionMapEntry = {
  /** Human label from the PDF (e.g. "I. Objectives & Goals") */
  sourceLabel: string;
  /** 0–1 heuristic confidence */
  confidence: number;
};

export type SowParseMeta = {
  mode: SowParseMode;
  warnings: string[];
  /** Map canonical internal keys to source section info */
  sectionMap: Partial<Record<string, SowSectionMapEntry>>;
  /** 0–1 overall parse confidence */
  parseConfidence: number;
  /** True when length-based fallback split was used (unreliable) */
  usedFallbackSplit?: boolean;
};

export function effectiveScopeOfWork(sow: Record<string, unknown> | null | undefined): string {
  if (!sow || typeof sow !== "object") return "";
  const v = Number((sow as { sowVersion?: unknown }).sowVersion) || 1;
  const legacy = String((sow as { scopeOfWork?: unknown }).scopeOfWork ?? "").trim();
  if (v >= 2) {
    const sl = String((sow as { strategyLaunchPlanning?: unknown }).strategyLaunchPlanning ?? "").trim();
    const cc = String((sow as { contentCreation?: unknown }).contentCreation ?? "").trim();
    const joined = [sl, cc].filter(Boolean).join("\n\n").trim();
    return joined || legacy;
  }
  return legacy;
}

export function effectiveUnderstanding(sow: Record<string, unknown> | null | undefined): string {
  return String((sow as { understandingOfRequirements?: unknown })?.understandingOfRequirements ?? "").trim();
}

/** Ensure legacy `scopeOfWork` stays in sync when v2 fields are saved. */
export function buildLegacyScopeFromV2(parts: {
  strategyLaunchPlanning: string;
  contentCreation: string;
}): string {
  return [parts.strategyLaunchPlanning, parts.contentCreation].filter((s) => s.trim()).join("\n\n").trim();
}
