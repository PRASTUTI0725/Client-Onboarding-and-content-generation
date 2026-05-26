const BULLET_PREFIX_RE = /^\s*(?:[-*•]\s+|\d+[.)]\s*)/;
const OPTIONAL_PLACEHOLDER_PATTERNS: RegExp[] = [
  /^\s*e\.g\./i,
  /^\s*for example\b/i,
  /^\s*paste the\b/i,
  /^\s*optional\b/i,
];

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
  if (parts.length < 3 || parts.length > 8) return false;
  return parts.every((part) => {
    const wordCount = part.split(/\s+/).filter(Boolean).length;
    return wordCount > 0 && wordCount <= 4 && !/[.!?]/.test(part);
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

export function countParsedItems(
  value: string,
  options?: { allowCommaFallback?: boolean },
): number {
  return parseMultilineItems(value, options).length;
}

export function buildInstagramValidationErrors(input: {
  handle: string;
  bio: string;
  offerSummary: string;
  recentCaptionCount: number;
  recurringTopicCount: number;
}): string[] {
  const errors: string[] = [];
  if (!input.handle.trim()) errors.push("Instagram Handle is missing.");
  if (!input.bio.trim()) errors.push("Profile Bio is missing.");
  if (!input.offerSummary.trim()) errors.push("What They Sell / Offer is missing.");
  if (input.recentCaptionCount < 4) {
    errors.push(
      `Recent Post Captions or Post Themes needs at least 4 entries; currently ${input.recentCaptionCount}.`,
    );
  }
  if (input.recurringTopicCount < 3) {
    errors.push(
      `Recurring Content Topics needs at least 3 entries; currently ${input.recurringTopicCount}.`,
    );
  }
  return errors;
}

export function looksLikeOptionalPlaceholder(
  value: string,
  exactExamples: string[] = [],
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (OPTIONAL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  return exactExamples.some((example) => trimmed.toLowerCase() === example.trim().toLowerCase());
}

export function formatInstagramListPreview(
  items: string[],
  maxItems = 4,
): { items: string[]; remaining: number } {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  return {
    items: cleaned.slice(0, maxItems),
    remaining: Math.max(0, cleaned.length - maxItems),
  };
}
