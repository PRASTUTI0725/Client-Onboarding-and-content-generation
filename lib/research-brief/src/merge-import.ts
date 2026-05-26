import { buildImportedResearchBrief, getApplyFields } from "./map-to-client-fields.js";
import { joinFieldValue } from "./parse-multiline-items.js";
import { getFieldDefById, getFieldLabel } from "./section-registry.js";
import { validateResearchBriefImport } from "./validate-import.js";
import { isUnreliableImportValue } from "./value-quality.js";
import type {
  ExistingClientValues,
  ImportPreview,
  ImportPreviewRow,
  ImportRowStatus,
  ParsedResearchBrief,
  ResearchBriefApplyPayload,
} from "./types.js";

function getExistingValue(existing: ExistingClientValues, fieldId: string): string {
  switch (fieldId) {
    case "client.name":
      return existing.clientName ?? "";
    case "client.website":
      return existing.website ?? "";
    case "client.instagramHandle":
      return existing.instagramHandle ?? "";
    case "client.oneLineDescription":
      return existing.oneLineDescription ?? "";
    case "client.businessType":
      return existing.businessType ?? "";
    case "sow.industry":
      return existing.industry ?? "";
    case "sow.targetAudience":
      return existing.targetAudience ?? "";
    case "sow.understandingOfRequirements":
      return existing.understandingOfRequirements ?? "";
    case "sow.strategyLaunchPlanning":
      return existing.strategyLaunchPlanning ?? "";
    case "sow.contentCreation":
      return existing.contentCreation ?? "";
    case "sow.deliverables":
      return (existing.deliverables ?? []).join("\n");
    case "instagram.handle":
      return existing.instagram?.handle ?? existing.instagramHandle ?? "";
    case "instagram.bio":
      return existing.instagram?.bio ?? "";
    case "instagram.offerSummary":
      return existing.instagram?.offerSummary ?? "";
    case "instagram.recentCaptionSnippets":
      return (existing.instagram?.recentCaptionSnippets ?? []).join("\n");
    case "instagram.recurringTopics":
      return (existing.instagram?.recurringTopics ?? []).join("\n");
    case "instagram.ctaPatterns":
      return (existing.instagram?.ctaPatterns ?? []).join("\n");
    case "instagram.proofSignals":
      return (existing.instagram?.proofSignals ?? []).join("\n");
    case "instagram.followerCount":
      return existing.instagram?.followerCount ?? "";
    case "instagram.category":
      return existing.instagram?.category ?? "";
    case "instagram.visualStyleNotes":
      return existing.instagram?.visualStyleNotes ?? "";
    case "instagram.additionalInstagramNotes":
      return existing.instagram?.additionalInstagramNotes ?? "";
    case "instagram.contentFormatPatterns":
      return existing.instagram?.additionalInstagramNotes ?? "";
    default:
      return "";
  }
}

export function resolveImportAction(existing: string, imported: string): ImportRowStatus {
  if (!imported.trim()) return "skipped";
  if (!existing.trim()) return "will_fill";
  if (existing.trim() === imported.trim()) return "skipped";
  return "will_update";
}

function previewText(value: string | string[], max = 240): string {
  const text = joinFieldValue(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildImportPreview(params: {
  parsed: ParsedResearchBrief;
  rawMarkdown: string;
  existing: ExistingClientValues;
  importFileName?: string;
}): ImportPreview {
  const validation = validateResearchBriefImport(params.parsed, params.existing);
  const { importedResearchBrief, researchBriefImportMeta } = buildImportedResearchBrief({
    parsed: params.parsed,
    rawMarkdown: params.rawMarkdown,
    importFileName: params.importFileName,
  });

  const applyFields = getApplyFields(params.parsed);
  const rows: ImportPreviewRow[] = [];

  for (const field of applyFields) {
    const def = getFieldDefById(field.canonicalFieldId);
    if (!def) continue;

    const importedText = joinFieldValue(field.value);
    const existingText = getExistingValue(params.existing, field.canonicalFieldId);
    let status = resolveImportAction(existingText, importedText);
    let selected = status === "will_fill";
    let warning = status === "will_update" ? "Existing value will be overwritten if selected." : undefined;

    if (isUnreliableImportValue(importedText)) {
      status = "skipped";
      selected = false;
      warning = "Low-confidence value — review before importing.";
    }

    rows.push({
      id: field.canonicalFieldId,
      section: field.sourceHeading,
      extractedValue: previewText(field.value),
      targetField: def.targetPath,
      targetPath: def.targetPath,
      targetLabel: def.label,
      status,
      selected,
      warning,
      value: field.value,
    });
  }

  for (const unmapped of params.parsed.unmappedSections) {
    rows.push({
      id: `unmapped:${unmapped.sourceHeading}`,
      section: unmapped.sourceHeading,
      extractedValue: previewText(unmapped.body),
      targetField: "additionalImportedNotes",
      targetPath: "importedResearchBrief.additionalImportedNotes",
      targetLabel: "Additional imported notes",
      status: "unmapped",
      selected: true,
      value: unmapped.body,
    });
  }

  return {
    rows,
    warnings: validation.warnings,
    errors: validation.errors,
    unmappedSections: params.parsed.unmappedSections,
    parseMeta: params.parsed.parseMeta,
    importedResearchBrief,
    researchBriefImportMeta,
  };
}

function asStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : value.split("\n").map((s) => s.trim()).filter(Boolean);
}

export function buildApplyPayload(
  preview: ImportPreview,
  selectedRowIds: Set<string>,
): ResearchBriefApplyPayload {
  const payload: ResearchBriefApplyPayload = {
    importedResearchBrief: preview.importedResearchBrief,
    researchBriefImportMeta: preview.researchBriefImportMeta,
  };

  const clientBasics: NonNullable<ResearchBriefApplyPayload["clientBasics"]> = {};
  const sow: NonNullable<ResearchBriefApplyPayload["sow"]> = {};
  const instagram: NonNullable<ResearchBriefApplyPayload["instagram"]> = {};

  for (const row of preview.rows) {
    if (!selectedRowIds.has(row.id) || row.status === "skipped" || row.status === "unmapped") continue;

    switch (row.id) {
      case "client.name":
        clientBasics.name = joinFieldValue(row.value);
        break;
      case "client.website":
        clientBasics.website = joinFieldValue(row.value);
        break;
      case "client.instagramHandle":
        clientBasics.instagramHandle = joinFieldValue(row.value);
        break;
      case "client.oneLineDescription":
        clientBasics.oneLineDescription = joinFieldValue(row.value);
        break;
      case "client.businessType":
        clientBasics.businessType = joinFieldValue(row.value);
        break;
      case "sow.industry":
        sow.industry = joinFieldValue(row.value);
        break;
      case "sow.targetAudience":
        sow.targetAudience = joinFieldValue(row.value);
        break;
      case "sow.understandingOfRequirements":
        sow.understandingOfRequirements = joinFieldValue(row.value);
        break;
      case "sow.strategyLaunchPlanning":
        sow.strategyLaunchPlanning = joinFieldValue(row.value);
        break;
      case "sow.contentCreation":
        sow.contentCreation = joinFieldValue(row.value);
        break;
      case "sow.deliverables":
        sow.deliverables = asStringArray(row.value);
        break;
      case "sow.strategyNotes": {
        const note = joinFieldValue(row.value);
        sow.contentCreation = sow.contentCreation ? `${sow.contentCreation}\n\n${note}` : note;
        break;
      }
      case "instagram.handle":
        instagram.handle = joinFieldValue(row.value);
        break;
      case "instagram.bio":
        instagram.bio = joinFieldValue(row.value);
        break;
      case "instagram.offerSummary":
        instagram.offerSummary = joinFieldValue(row.value);
        break;
      case "instagram.recentCaptionSnippets":
        instagram.recentCaptionSnippets = asStringArray(row.value);
        break;
      case "instagram.recurringTopics":
        instagram.recurringTopics = asStringArray(row.value);
        break;
      case "instagram.ctaPatterns":
        instagram.ctaPatterns = asStringArray(row.value);
        break;
      case "instagram.proofSignals":
        instagram.proofSignals = asStringArray(row.value);
        break;
      case "instagram.followerCount":
        instagram.followerCount = joinFieldValue(row.value);
        break;
      case "instagram.category":
        instagram.category = joinFieldValue(row.value);
        break;
      case "instagram.visualStyleNotes":
        instagram.visualStyleNotes = joinFieldValue(row.value);
        break;
      case "instagram.contentFormatPatterns": {
        const note = joinFieldValue(row.value);
        instagram.additionalInstagramNotes = instagram.additionalInstagramNotes
          ? `${instagram.additionalInstagramNotes}\n\n${note}`
          : note;
        break;
      }
      case "instagram.additionalInstagramNotes":
        instagram.additionalInstagramNotes = joinFieldValue(row.value);
        break;
      default:
        break;
    }
  }

  if (Object.keys(clientBasics).length > 0) payload.clientBasics = clientBasics;
  if (Object.keys(sow).length > 0) payload.sow = sow;
  if (Object.keys(instagram).length > 0) payload.instagram = instagram;

  return payload;
}

export function compactImportedResearchForDna(
  brief: import("./types.js").ImportedResearchBrief | null | undefined,
): Record<string, unknown> | null {
  if (!brief) return null;
  const cap = (value: string | undefined, max = 500) => {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  };
  const capRecord = (record: Record<string, string> | undefined) => {
    if (!record) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      const capped = cap(value);
      if (capped) out[key] = capped;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    websiteContext: capRecord(brief.websiteContext),
    researchInputs: brief.researchInputs
      ? Object.fromEntries(
          Object.entries(brief.researchInputs)
            .map(([group, values]) => [group, capRecord(values as Record<string, string>)])
            .filter(([, v]) => v),
        )
      : undefined,
    claimSafetyNotes: brief.claimSafetyNotes
      ? {
          claimsAllowed: cap(brief.claimSafetyNotes.claimsAllowed),
          claimsToAvoid: cap(brief.claimSafetyNotes.claimsToAvoid),
          proofLimitations: cap(brief.claimSafetyNotes.proofLimitations),
          sensitiveCategoryNotes: cap(brief.claimSafetyNotes.sensitiveCategoryNotes),
        }
      : undefined,
    missingInformation: brief.missingInformation?.slice(0, 20),
    additionalNotes: cap(brief.additionalImportedNotes, 800),
    sourceProvenance: cap(brief.sourceProvenance, 800),
  };
}
