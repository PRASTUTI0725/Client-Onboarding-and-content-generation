import type { ImportedResearchBrief, ParsedField, ParsedResearchBrief, ResearchBriefImportMeta } from "./types.js";
import { simpleHash } from "./normalize-heading.js";
import { joinFieldValue } from "./parse-multiline-items.js";
import { getFieldDefById } from "./section-registry.js";

function setNested(obj: Record<string, unknown>, path: string, value: string): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function appendMissing(items: string[], value: string | string[]): void {
  const next = Array.isArray(value) ? value : parseMultilineItems(value);
  for (const item of next) {
    const trimmed = item.trim();
    if (trimmed && !items.includes(trimmed)) items.push(trimmed);
  }
}

function parseMultilineItems(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s*)/, "").trim())
    .filter(Boolean);
}

export function buildImportedResearchBrief(params: {
  parsed: ParsedResearchBrief;
  rawMarkdown: string;
  importFileName?: string;
}): { importedResearchBrief: ImportedResearchBrief; researchBriefImportMeta: ResearchBriefImportMeta } {
  const importHash = simpleHash(params.rawMarkdown);
  const importedAt = new Date().toISOString();

  const websiteContext: Record<string, string> = {};
  const researchInputs: NonNullable<ImportedResearchBrief["researchInputs"]> = {};
  const claimSafetyNotes: NonNullable<ImportedResearchBrief["claimSafetyNotes"]> = {};
  const missingInformation: string[] = [];
  let sourceProvenance = "";
  let additionalImportedNotes = "";
  const fieldProvenance: ResearchBriefImportMeta["fieldProvenance"] = {};
  const sectionMap: ResearchBriefImportMeta["sectionMap"] = {};

  for (const section of params.parsed.sections) {
    if (section.canonicalId) {
      sectionMap[section.canonicalId] = {
        sourceHeading: section.sourceHeading,
        canonicalId: section.canonicalId,
      };
    }
  }

  for (const field of params.parsed.fields) {
    const def = getFieldDefById(field.canonicalFieldId);
    const textValue = joinFieldValue(field.value);
    fieldProvenance[field.canonicalFieldId] = {
      source: "imported_markdown",
      sourceHeading: field.sourceHeading,
      originalSectionId: def?.sectionId ?? "unknown",
      confidence: field.confidence,
      importedAt,
      importFileName: params.importFileName,
      importHash,
    };

    if (field.canonicalFieldId.startsWith("website.")) {
      const key = field.canonicalFieldId.replace("website.", "");
      if (key === "gaps") appendMissing(missingInformation, field.value);
      else websiteContext[key] = textValue;
      continue;
    }

    if (field.canonicalFieldId.startsWith("research.")) {
      const rest = field.canonicalFieldId.replace("research.", "");
      const [group, key] = rest.split(".");
      if (group && key) {
        if (!researchInputs[group as keyof typeof researchInputs]) {
          researchInputs[group as keyof typeof researchInputs] = {};
        }
        setNested(researchInputs as Record<string, unknown>, `${group}.${key}`, textValue);
      }
      continue;
    }

    if (field.canonicalFieldId.startsWith("claim.")) {
      const key = field.canonicalFieldId.replace("claim.", "");
      claimSafetyNotes[key as keyof typeof claimSafetyNotes] = textValue;
      continue;
    }

    if (field.canonicalFieldId === "preserve.sourceProvenance") {
      sourceProvenance = sourceProvenance ? `${sourceProvenance}\n\n${textValue}` : textValue;
      continue;
    }

    if (field.canonicalFieldId === "preserve.missingInformation") {
      appendMissing(missingInformation, field.value);
      continue;
    }

    if (field.canonicalFieldId === "instagram.gaps" || field.canonicalFieldId === "website.gaps") {
      appendMissing(missingInformation, field.value);
    }
  }

  for (const unmapped of params.parsed.unmappedSections) {
    additionalImportedNotes += `## ${unmapped.sourceHeading}\n${unmapped.body}\n\n`;
  }

  const importedResearchBrief: ImportedResearchBrief = {
    version: 1,
    rawMarkdownHash: importHash,
    importedAt,
    ...(params.importFileName ? { importFileName: params.importFileName } : {}),
    ...(Object.keys(websiteContext).length > 0 ? { websiteContext } : {}),
    ...(Object.keys(researchInputs).length > 0 ? { researchInputs } : {}),
    ...(Object.keys(claimSafetyNotes).length > 0 ? { claimSafetyNotes } : {}),
    ...(sourceProvenance ? { sourceProvenance } : {}),
    ...(missingInformation.length > 0 ? { missingInformation } : {}),
    ...(additionalImportedNotes.trim() ? { additionalImportedNotes: additionalImportedNotes.trim() } : {}),
    fieldProvenance,
  };

  const researchBriefImportMeta: ResearchBriefImportMeta = {
    lastImportedAt: importedAt,
    importHash,
    ...(params.importFileName ? { importFileName: params.importFileName } : {}),
    fieldProvenance,
    sectionMap,
  };

  return { importedResearchBrief, researchBriefImportMeta };
}

export function fieldToTargetPath(fieldId: string): string | null {
  const def = getFieldDefById(fieldId);
  if (!def || def.skip || fieldId.startsWith("preserve.")) return null;
  return def.targetPath;
}

export function getApplyFields(parsed: ParsedResearchBrief): ParsedField[] {
  return parsed.fields.filter((field) => {
    const def = getFieldDefById(field.canonicalFieldId);
    return def && !def.skip && !field.canonicalFieldId.startsWith("preserve.");
  });
}
