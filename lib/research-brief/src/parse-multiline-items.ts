const BULLET_PREFIX_RE = /^\s*(?:[-*•]\s+|\d+[.)]\s*)/;

function stripListPrefix(value: string): string {
  return value.replace(BULLET_PREFIX_RE, "").trim();
}

function splitLineItems(value: string): string[] {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripListPrefix)
    .filter(Boolean);
}

function looksLikeSafeCommaTopicList(value: string): boolean {
  if (value.includes("\n") || value.includes(";")) return false;
  const parts = value
    .split(",")
    .map((part) => stripListPrefix(part))
    .filter(Boolean);
  if (parts.length < 3 || parts.length > 12) return false;
  return parts.every((part) => {
    const wordCount = part.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= 8 && !/[.!?]/.test(part);
  });
}

export function parseMultilineItems(
  value: string,
  options?: { allowCommaFallback?: boolean },
): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lineItems = splitLineItems(normalized);
  if (lineItems.length > 1) return lineItems;

  const single = stripListPrefix(normalized);
  if (!single) return [];

  const semicolonItems = single
    .split(/\s*;\s*/)
    .map(stripListPrefix)
    .filter(Boolean);
  if (semicolonItems.length > 1) return semicolonItems;

  if (options?.allowCommaFallback && looksLikeSafeCommaTopicList(single)) {
    return single
      .split(/\s*,\s*/)
      .map(stripListPrefix)
      .filter(Boolean);
  }

  return [single];
}

export function joinFieldValue(value: string | string[]): string {
  if (Array.isArray(value)) return value.join("\n");
  return value;
}

export function detectConfidence(body: string): "confirmed" | "inferred" | "missing" | undefined {
  const lower = body.toLowerCase();
  if (/\bnot confirmed\b|\bneeds client confirmation\b|\bunverified\b/.test(lower)) return "inferred";
  if (/\bnot available\b|\bmissing\b|\bunknown\b|\btbd\b/.test(lower)) return "missing";
  if (/\bconfirmed\b|\bverified\b/.test(lower)) return "confirmed";
  return undefined;
}
