/**
 * Map numeric confidence 0..1 to founder-friendly label + percent for display.
 */
export function confidenceToLabel(score: number | undefined | null): {
  label: "High" | "Medium" | "Low" | "—";
  pct: string;
} {
  if (score == null || Number.isNaN(Number(score))) return { label: "—", pct: "—" };
  const s = Math.max(0, Math.min(1, Number(score)));
  const label = s >= 0.67 ? "High" : s >= 0.34 ? "Medium" : "Low";
  return { label, pct: `${Math.round(s * 100)}%` };
}

export function formatList(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(String).filter(Boolean).join(", ") || "—";
  if (typeof v === "string") return v.trim() || "—";
  return String(v);
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Map internal field-source tokens to a short, founder-friendly label (no `website.title` style paths). */
export function humanizeFieldSourceToken(token: string): string {
  const t = token.trim();
  if (!t) return t;
  if (t === "sow") return "SOW";
  if (t.startsWith("sow") || t.includes("SOW")) return "SOW";
  if (t === "onboarding" || t === "instagramSummaryNotes") return "Onboarding form";
  if (t === "inferred") return "Synthesized from your materials";
  if (t === "instagram" || t.startsWith("instagram:") || t.startsWith("instagram.")) return "Instagram";
  if (t === "website" || t.startsWith("website:") || t.startsWith("website.")) {
    if (t.includes("meta") || t.endsWith("meta") || t.includes("metaDescription")) {
      return "Website (search & preview text)";
    }
    if (t.includes("title")) return "Website (page title)";
    if (t.includes("hero") || t.includes("heroExcerpt")) return "Website (homepage messaging)";
  }
  if (t === "website:meta" || t === "website:hero") {
    return t === "website:meta" ? "Website (search & preview text)" : "Website (homepage messaging)";
  }
  return t.replace(/website[.:]meta/i, "Website").replace(/[:.]/g, " ").replace(/\s+/g, " ").trim() || t;
}

/** One internal provenance key → plain label for the “Attribution” card. */
export function humanizeAttributionItem(path: string): string {
  const p = path.trim();
  const map: Record<string, string> = {
    "website.metaDescription": "Search and preview text from the website",
    "website.title": "Website page title",
    "website.heroExcerpt": "Homepage lead text",
    "sow.sections": "Statement of work (signed sections)",
    "instagramSummaryNotes": "Instagram notes you added in onboarding",
    "oneLineDescription": "One-line business description from onboarding",
    "instagramHandle": "Instagram from onboarding",
    "instagram.bioSignals": "Instagram profile text",
    "instagram.handle": "Instagram",
    "instagram.contentPatterns": "Patterns from Instagram content",
  };
  if (map[p]) return map[p]!;
  return humanizeFieldSourceToken(p);
}
