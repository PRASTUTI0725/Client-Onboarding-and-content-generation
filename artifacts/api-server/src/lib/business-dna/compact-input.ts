import { trimToTokenBudget } from "../llm/prompt-budget.js";
import type { BusinessDnaGeneratorInput } from "./generate.js";

export type CompactionTier = 0 | 1 | 2 | 3;

function normalizeForOverlap(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function capText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function capStringList(items: string[] | undefined, maxItems: number, maxItemChars: number): string[] {
  if (!items?.length) return [];
  const out: string[] = [];
  for (const item of items) {
    const text = capText(String(item ?? ""), maxItemChars);
    if (!text) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function hasStructuredInstagram(instagram: BusinessDnaGeneratorInput["instagram"]): boolean {
  if (!instagram) return false;
  return Boolean(
    instagram.bio ||
      instagram.offerSummary ||
      instagram.recentCaptionSnippets.length > 0 ||
      instagram.recurringTopics.length > 0 ||
      (instagram.ctaPatterns?.length ?? 0) > 0 ||
      (instagram.proofSignals?.length ?? 0) > 0 ||
      instagram.visualStyleNotes,
  );
}

function collectKnownText(input: BusinessDnaGeneratorInput): string {
  const parts: string[] = [
    input.client.oneLineDescription,
    input.sow.industry,
    input.sow.targetAudience,
    input.sow.understandingOfRequirements,
    input.sow.strategyLaunchPlanning,
    input.sow.contentCreation,
    input.instagram?.bio ?? "",
    input.instagram?.offerSummary ?? "",
    ...(input.instagram?.recentCaptionSnippets ?? []),
    ...(input.instagram?.recurringTopics ?? []),
  ];
  return normalizeForOverlap(parts.filter(Boolean).join(" "));
}

function isRedundantWithKnown(value: string, knownBlob: string): boolean {
  const normalized = normalizeForOverlap(value);
  if (!normalized || normalized.length < 24) return false;
  return knownBlob.includes(normalized);
}

function slimImportedResearch(
  imported: Record<string, unknown> | null | undefined,
  tier: CompactionTier,
  knownBlob: string,
): Record<string, unknown> | null {
  if (!imported) return null;

  const claimSafetyNotes =
    imported.claimSafetyNotes && typeof imported.claimSafetyNotes === "object"
      ? (imported.claimSafetyNotes as Record<string, unknown>)
      : undefined;

  const capField = (value: unknown, max = tier >= 2 ? 250 : 400): string | undefined => {
    if (typeof value !== "string") return undefined;
    const capped = capText(value, max);
    return capped || undefined;
  };

  const claimSafety =
    claimSafetyNotes && typeof claimSafetyNotes === "object"
      ? Object.fromEntries(
          Object.entries(claimSafetyNotes)
            .map(([key, value]) => [key, capField(value)])
            .filter(([, value]) => Boolean(value)),
        )
      : undefined;

  if (tier >= 3) {
    return Object.keys(claimSafety ?? {}).length > 0 ? { claimSafetyNotes: claimSafety } : null;
  }

  const websiteContext =
    imported.websiteContext && typeof imported.websiteContext === "object"
      ? Object.fromEntries(
          Object.entries(imported.websiteContext as Record<string, unknown>)
            .map(([key, value]) => [key, capField(value)])
            .filter(([, value]) => Boolean(value)),
        )
      : undefined;

  const researchHighlights: Record<string, string> = {};
  if (tier >= 2 && imported.researchInputs && typeof imported.researchInputs === "object") {
    const groups = imported.researchInputs as Record<string, Record<string, unknown>>;
    const picks: Array<[string, string]> = [
      ["positioning.valueProposition", "positioning"],
      ["audience.primary", "audience"],
      ["offer.primaryOffers", "offer"],
      ["tone.toneKeywords", "tone"],
      ["content.contentPillars", "content"],
    ];
    for (const [path, label] of picks) {
      const [group, key] = path.split(".");
      const raw = groups[group]?.[key ?? ""];
      if (typeof raw !== "string") continue;
      const capped = capField(raw, 250);
      if (!capped || isRedundantWithKnown(capped, knownBlob)) continue;
      researchHighlights[label] = capped;
    }
  } else if (imported.researchInputs && typeof imported.researchInputs === "object" && tier < 2) {
    // tier 0-1: keep researchInputs but cap each field
    const slimGroups: Record<string, Record<string, string>> = {};
    for (const [group, values] of Object.entries(imported.researchInputs as Record<string, unknown>)) {
      if (!values || typeof values !== "object") continue;
      const cappedEntries = Object.entries(values as Record<string, unknown>)
        .map(([key, value]) => [key, capField(value, 400)] as const)
        .filter(([, value]) => Boolean(value)) as Array<[string, string]>;
      if (cappedEntries.length > 0) {
        slimGroups[group] = Object.fromEntries(cappedEntries);
      }
    }
    if (Object.keys(slimGroups).length > 0) {
      return {
        ...(Object.keys(claimSafety ?? {}).length > 0 ? { claimSafetyNotes: claimSafety } : {}),
        ...(Object.keys(websiteContext ?? {}).length > 0 ? { websiteContext } : {}),
        researchInputs: slimGroups,
        ...(Array.isArray(imported.missingInformation)
          ? {
              missingInformation: (imported.missingInformation as unknown[])
                .map((item) => capText(String(item ?? ""), 120))
                .filter(Boolean)
                .slice(0, tier >= 2 ? 5 : 10),
            }
          : {}),
      };
    }
  }

  const missingInformation = Array.isArray(imported.missingInformation)
    ? (imported.missingInformation as unknown[])
        .map((item) => capText(String(item ?? ""), 120))
        .filter(Boolean)
        .slice(0, tier >= 2 ? 5 : 10)
    : undefined;

  const additionalNotes =
    tier < 2 && typeof imported.additionalNotes === "string"
      ? capField(imported.additionalNotes, tier >= 2 ? 200 : 400)
      : undefined;

  const out: Record<string, unknown> = {};
  if (claimSafety && Object.keys(claimSafety).length > 0) out.claimSafetyNotes = claimSafety;
  if (websiteContext && Object.keys(websiteContext).length > 0) out.websiteContext = websiteContext;
  if (Object.keys(researchHighlights).length > 0) out.researchHighlights = researchHighlights;
  if (missingInformation?.length) out.missingInformation = missingInformation;
  if (additionalNotes) out.additionalNotes = additionalNotes;

  return Object.keys(out).length > 0 ? out : null;
}

function mergeWebsiteBlocks(
  website: BusinessDnaGeneratorInput["website"],
  importedWebsite: Record<string, unknown> | undefined,
): BusinessDnaGeneratorInput["website"] {
  const merged = { ...(website ?? {}) };
  if (!importedWebsite) return merged;

  for (const [key, value] of Object.entries(importedWebsite)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const existing = (merged as Record<string, unknown>)[key];
    if (Array.isArray(existing) && existing.length > 0) continue;
    if (typeof existing === "string" && existing.trim()) continue;
    if (key === "homepageSummary" && !merged.heroExcerpt) {
      merged.heroExcerpt = capText(value, 400);
      continue;
    }
    if (key === "brandPositioning" && !(merged.messagingPatterns?.length ?? 0)) {
      merged.messagingPatterns = [capText(value, 200)];
      continue;
    }
  }
  return merged;
}

function applyTier0(input: BusinessDnaGeneratorInput): BusinessDnaGeneratorInput {
  const sow = { ...input.sow };
  if (sow.strategyLaunchPlanning.trim() && sow.contentCreation.trim()) {
    sow.scopeOfWork = "";
  }

  sow.industry = capText(sow.industry, 400);
  sow.targetAudience = capText(sow.targetAudience, 400);
  sow.understandingOfRequirements = capText(sow.understandingOfRequirements, 500);
  sow.strategyLaunchPlanning = capText(sow.strategyLaunchPlanning, 500);
  sow.contentCreation = capText(sow.contentCreation, 500);
  sow.scopeOfWork = capText(sow.scopeOfWork, 500);

  let instagram = input.instagram ? { ...input.instagram } : null;
  if (instagram && hasStructuredInstagram(instagram)) {
    delete instagram.instagramSummaryNotes;
  }

  const knownBlob = collectKnownText({ ...input, sow, instagram });
  const importedWebsite =
    input.importedResearch?.websiteContext && typeof input.importedResearch.websiteContext === "object"
      ? (input.importedResearch.websiteContext as Record<string, unknown>)
      : undefined;

  return {
    ...input,
    sow,
    instagram,
    website: mergeWebsiteBlocks(input.website ?? null, importedWebsite),
    importedResearch: slimImportedResearch(input.importedResearch, 0, knownBlob),
  };
}

function applyTier1(input: BusinessDnaGeneratorInput): BusinessDnaGeneratorInput {
  const sow = {
    ...input.sow,
    deliverables: capStringList(input.sow.deliverables, 8, 120),
  };

  let instagram = input.instagram ? { ...input.instagram } : null;
  if (instagram) {
    instagram = {
      ...instagram,
      bio: capText(instagram.bio, 300),
      offerSummary: capText(instagram.offerSummary, 300),
      additionalInstagramNotes: instagram.additionalInstagramNotes
        ? capText(instagram.additionalInstagramNotes, 300)
        : undefined,
      visualStyleNotes: instagram.visualStyleNotes ? capText(instagram.visualStyleNotes, 200) : undefined,
      recentCaptionSnippets: capStringList(instagram.recentCaptionSnippets, 4, 200),
      recurringTopics: capStringList(instagram.recurringTopics, 6, 120),
      ctaPatterns: capStringList(instagram.ctaPatterns, 6, 120),
      proofSignals: capStringList(instagram.proofSignals, 6, 120),
    };
  }

  const knownBlob = collectKnownText({ ...input, sow, instagram });
  return {
    ...input,
    sow,
    instagram,
    importedResearch: slimImportedResearch(input.importedResearch, 1, knownBlob),
  };
}

function applyTier2(input: BusinessDnaGeneratorInput): BusinessDnaGeneratorInput {
  const knownBlob = collectKnownText(input);
  return {
    ...input,
    importedResearch: slimImportedResearch(input.importedResearch, 2, knownBlob),
  };
}

function applyTier3(input: BusinessDnaGeneratorInput): BusinessDnaGeneratorInput {
  const knownBlob = collectKnownText(input);
  const sow = {
    ...input.sow,
    scopeOfWork: "",
    monthlyPosts: {},
    contentMix: {},
    strategyLaunchPlanning: trimToTokenBudget(input.sow.strategyLaunchPlanning, 80),
    contentCreation: trimToTokenBudget(input.sow.contentCreation, 80),
    understandingOfRequirements: trimToTokenBudget(input.sow.understandingOfRequirements, 80),
  };

  return {
    ...input,
    sow,
    importedResearch: slimImportedResearch(input.importedResearch, 3, knownBlob),
  };
}

export function compactBusinessDnaGeneratorInput(
  input: BusinessDnaGeneratorInput,
  tier: CompactionTier,
): BusinessDnaGeneratorInput {
  let current = applyTier0(input);
  if (tier >= 1) current = applyTier1(current);
  if (tier >= 2) current = applyTier2(current);
  if (tier >= 3) current = applyTier3(current);
  return current;
}
