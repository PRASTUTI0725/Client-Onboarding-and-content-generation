import type { ExistingClientValues, ParsedResearchBrief } from "./types.js";

const SOW_FIELD_IDS = new Set([
  "sow.industry",
  "sow.targetAudience",
  "sow.understandingOfRequirements",
  "sow.strategyLaunchPlanning",
  "sow.contentCreation",
  "sow.deliverables",
  "sow.strategyNotes",
]);

export type ImportValidationResult = {
  errors: string[];
  warnings: string[];
};

export function validateResearchBriefImport(
  parsed: ParsedResearchBrief,
  existing: ExistingClientValues,
): ImportValidationResult {
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];

  const fieldIds = new Set(parsed.fields.map((f) => f.canonicalFieldId));

  const hasClientName =
    fieldIds.has("client.name") || Boolean(existing.clientName?.trim());
  if (!hasClientName) {
    errors.push("Client name required (in brief or on client record).");
  }

  const hasWebsite = fieldIds.has("client.website") || Boolean(existing.website?.trim());
  const hasInstagram =
    fieldIds.has("client.instagramHandle") ||
    fieldIds.has("instagram.handle") ||
    Boolean(existing.instagramHandle?.trim());
  if (!hasWebsite && !hasInstagram) {
    warnings.push("Add website or Instagram for better Business DNA.");
  }

  const hasSowField = parsed.fields.some((f) => SOW_FIELD_IDS.has(f.canonicalFieldId));
  const hasExistingSow =
    Boolean(existing.industry?.trim()) ||
    Boolean(existing.targetAudience?.trim()) ||
    Boolean(existing.understandingOfRequirements?.trim()) ||
    Boolean(existing.strategyLaunchPlanning?.trim()) ||
    Boolean(existing.contentCreation?.trim());
  if (!hasSowField && !hasExistingSow) {
    warnings.push("No SOW summary sections detected.");
  }

  return { errors, warnings };
}

export function validateFileInput(file: { name: string; size: number }, maxBytes: number): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext !== "md" && ext !== "txt") {
    return "Use .md or .txt only.";
  }
  if (file.size > maxBytes) {
    return "File exceeds 512 KB limit.";
  }
  return null;
}
