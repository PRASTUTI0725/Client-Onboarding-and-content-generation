import type { ImportedResearchBrief } from "@workspace/research-brief";

export type JtaClaimSafety = {
  claimsAllowed?: string;
  claimsToAvoid?: string;
  proofLimitations?: string;
  sensitiveCategoryNotes?: string;
};

export type JtaResearchContext = {
  claimSafety?: JtaClaimSafety;
  proofGaps?: string[];
  websiteSignals?: Record<string, string>;
  researchHighlights?: Record<string, string>;
};

export type JtaProofConstraints = {
  limitations?: string;
  unconfirmedProofTypes?: string[];
};

const PROOF_GAP_KEYWORDS = [
  "testimonial",
  "review",
  "ugc",
  "user-generated",
  "influencer",
  "press",
  "certification",
  "clinical",
  "case study",
  "social proof",
  "rating",
  "endorsement",
];

const RESEARCH_HIGHLIGHT_PICKS: Array<{ group: string; key: string; label: string }> = [
  { group: "positioning", key: "valueProposition", label: "positioning" },
  { group: "positioning", key: "brandPositioning", label: "brandPositioning" },
  { group: "positioning", key: "tagline", label: "tagline" },
  { group: "audience", key: "primary", label: "audience" },
  { group: "offer", key: "primaryOffers", label: "offer" },
  { group: "offer", key: "products", label: "products" },
  { group: "offer", key: "primaryCTAs", label: "ctas" },
  { group: "toneOfVoice", key: "toneKeywords", label: "tone" },
  { group: "contentStrategy", key: "contentPillars", label: "content" },
  { group: "contentStrategy", key: "formatPatterns", label: "formatPatterns" },
  { group: "visualIdentity", key: "visualStyle", label: "visual" },
];

function capText(value: string, maxChars = 250): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function normalizeForOverlap(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isRedundantWithKnown(value: string, knownBlob: string): boolean {
  const normalized = normalizeForOverlap(value);
  if (!normalized || normalized.length < 24) return false;
  return knownBlob.includes(normalized);
}

function filterProofGaps(items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return items
    .map((item) => capText(String(item ?? ""), 200))
    .filter(Boolean)
    .filter((item) => {
      const lower = item.toLowerCase();
      return PROOF_GAP_KEYWORDS.some((keyword) => lower.includes(keyword));
    })
    .slice(0, 8);
}

function inferUnconfirmedProofTypes(proofGaps: string[], proofLimitations?: string): string[] {
  const blob = `${proofGaps.join(" ")} ${proofLimitations ?? ""}`.toLowerCase();
  const types: string[] = [];
  if (/\btestimonial/.test(blob)) types.push("testimonials");
  if (/\breview/.test(blob)) types.push("reviews");
  if (/\bugc\b|user-generated/.test(blob)) types.push("ugc");
  if (/\binfluencer/.test(blob)) types.push("influencer proof");
  if (/\bpress\b/.test(blob)) types.push("press");
  if (/\bcertification|clinical|endorsement/.test(blob)) types.push("certifications");
  if (/\bcase stud/.test(blob)) types.push("case studies");
  return [...new Set(types)];
}

export function buildProofConstraintsFromResearchContext(
  context: JtaResearchContext | null | undefined,
): JtaProofConstraints | null {
  if (!context) return null;
  const limitations = capText(context.claimSafety?.proofLimitations ?? "", 400);
  const proofGaps = context.proofGaps ?? [];
  const unconfirmedProofTypes = inferUnconfirmedProofTypes(proofGaps, limitations);
  if (!limitations && proofGaps.length === 0 && unconfirmedProofTypes.length === 0) {
    return null;
  }
  return {
    ...(limitations ? { limitations } : {}),
    ...(unconfirmedProofTypes.length > 0 ? { unconfirmedProofTypes } : {}),
  };
}

export function compactImportedResearchForJta(
  brief: ImportedResearchBrief | Record<string, unknown> | null | undefined,
  options?: { knownTextBlob?: string },
): JtaResearchContext | null {
  if (!brief || typeof brief !== "object") return null;

  const record = brief as ImportedResearchBrief;
  const knownBlob = normalizeForOverlap(options?.knownTextBlob ?? "");

  const claimSafety: JtaClaimSafety = {};
  if (record.claimSafetyNotes) {
    const notes = record.claimSafetyNotes;
    if (notes.claimsAllowed) claimSafety.claimsAllowed = capText(notes.claimsAllowed, 300);
    if (notes.claimsToAvoid) claimSafety.claimsToAvoid = capText(notes.claimsToAvoid, 300);
    if (notes.proofLimitations) claimSafety.proofLimitations = capText(notes.proofLimitations, 300);
    if (notes.sensitiveCategoryNotes) claimSafety.sensitiveCategoryNotes = capText(notes.sensitiveCategoryNotes, 300);
  }

  const proofGaps = filterProofGaps(record.missingInformation);

  const websiteSignals: Record<string, string> = {};
  if (record.websiteContext) {
    for (const [key, value] of Object.entries(record.websiteContext)) {
      if (typeof value !== "string") continue;
      const capped = capText(value, 250);
      if (!capped || isRedundantWithKnown(capped, knownBlob)) continue;
      websiteSignals[key] = capped;
    }
  }

  const researchHighlights: Record<string, string> = {};
  if (record.researchInputs) {
    for (const pick of RESEARCH_HIGHLIGHT_PICKS) {
      const group = record.researchInputs[pick.group as keyof typeof record.researchInputs];
      if (!group || typeof group !== "object") continue;
      const raw = (group as Record<string, string>)[pick.key];
      if (typeof raw !== "string") continue;
      const capped = capText(raw, 250);
      if (!capped || isRedundantWithKnown(capped, knownBlob)) continue;
      if (!researchHighlights[pick.label]) {
        researchHighlights[pick.label] = capped;
      }
    }
  }

  const out: JtaResearchContext = {};
  if (Object.keys(claimSafety).length > 0) out.claimSafety = claimSafety;
  if (proofGaps.length > 0) out.proofGaps = proofGaps;
  if (Object.keys(websiteSignals).length > 0) out.websiteSignals = websiteSignals;
  if (Object.keys(researchHighlights).length > 0) out.researchHighlights = researchHighlights;

  return Object.keys(out).length > 0 ? out : null;
}

export function countJtaResearchContextFields(context: JtaResearchContext | null | undefined): number {
  if (!context) return 0;
  let count = 0;
  if (context.claimSafety) count += Object.keys(context.claimSafety).length;
  count += context.proofGaps?.length ?? 0;
  count += Object.keys(context.websiteSignals ?? {}).length;
  count += Object.keys(context.researchHighlights ?? {}).length;
  return count;
}
