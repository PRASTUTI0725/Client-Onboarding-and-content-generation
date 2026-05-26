/** Normalize ATX heading text for alias matching. */
export function normalizeHeading(raw: string): string {
  let text = raw.trim();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/^#+\s*/, "").trim();
  text = text.replace(/^\d+[.)]\s*/, "");
  text = text.replace(/^[ivxlcdm]+[.)]\s*/i, "");
  text = text.replace(/[:：]+$/g, "").trim();
  text = text.replace(/\s+/g, " ").toLowerCase();
  return text;
}

/** Field/section alias matching: collapse slash spacing and strip source suffixes. */
export function normalizeFieldHeading(raw: string): string {
  let text = normalizeHeading(raw);
  text = text.replace(/\s*\/\s*/g, "/");
  text = text.replace(/\s+from\s+(sow|instagram|website)\s*$/i, "").trim();
  return text;
}

export function fieldHeadingMatchKeys(raw: string): string[] {
  const fieldKey = normalizeFieldHeading(raw);
  const legacyKey = normalizeHeading(raw);
  return fieldKey === legacyKey ? [fieldKey] : [fieldKey, legacyKey];
}

export function normalizeLineEndings(text: string): string {
  let out = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  return out;
}

export function looksLikeBinary(text: string): boolean {
  return /\0/.test(text.slice(0, 4096));
}

export function simpleHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
