import type { ImportPreview, ImportPreviewRow, ResearchBriefApplyPayload } from "@workspace/research-brief";
import {
  buildApplyPayload,
  buildImportPreview,
  looksLikeBinary,
  MAX_FILE_BYTES,
  parseResearchBriefMarkdown,
  validateFileInput,
} from "@workspace/research-brief";
import type { ExistingClientValues } from "@workspace/research-brief";

export type { ImportPreview, ImportPreviewRow, ResearchBriefApplyPayload, ExistingClientValues };

export function parseResearchBriefInput(params: {
  text: string;
  fileName?: string;
  existing: ExistingClientValues;
}): { preview: ImportPreview | null; error: string | null } {
  const text = params.text.trim();
  if (!text) {
    return { preview: null, error: "Paste or upload a research brief first." };
  }
  if (looksLikeBinary(text)) {
    return { preview: null, error: "File appears to be binary. Use UTF-8 .md or .txt." };
  }
  const parsed = parseResearchBriefMarkdown(text);
  if (parsed.errors.length > 0 && parsed.parseMeta.headingCount === 0) {
    return { preview: null, error: parsed.errors[0] ?? "Could not parse brief." };
  }
  const preview = buildImportPreview({
    parsed,
    rawMarkdown: text,
    existing: params.existing,
    importFileName: params.fileName,
  });
  return { preview, error: null };
}

export function validateResearchBriefFile(file: File): string | null {
  return validateFileInput({ name: file.name, size: file.size }, MAX_FILE_BYTES);
}

export function readResearchBriefFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}

export { buildApplyPayload, buildImportPreview };
