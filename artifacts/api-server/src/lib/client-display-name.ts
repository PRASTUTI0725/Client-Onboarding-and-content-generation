export type ClientDisplayNameHints = {
  oneLineDescription?: string | null;
  websiteTitle?: string | null;
};

const INTERNAL_NAME_PATTERN = /\(\s*client\s*\)/i;
const TRAILING_NUMBER_PATTERN = /\s+\d+$/;
const SENTENCE_VERB_PATTERN = /\b(is|are|was|were|'s|offers|provides|helps|brings|makes|has|have)\b/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeInternalCrmLabel(rawName: string): boolean {
  const normalized = normalizeWhitespace(rawName);
  if (!normalized) return false;
  return INTERNAL_NAME_PATTERN.test(normalized) || /\(\w+\)\s*\d+$/i.test(normalized);
}

function stripInternalSuffixes(rawName: string): string {
  let next = normalizeWhitespace(rawName);
  next = next.replace(/\(\s*client\s*\)[^)]*$/i, "").trim();
  next = next.replace(/\(\s*client\s*\)/gi, "").trim();
  next = next.replace(TRAILING_NUMBER_PATTERN, "").trim();
  return next;
}

function extractLeadingBrandFromRawName(rawName: string): string | null {
  let candidate = normalizeWhitespace(rawName);
  if (!candidate) return null;

  if (INTERNAL_NAME_PATTERN.test(candidate)) {
    candidate = normalizeWhitespace(candidate.split(/\(\s*client\s*\)/i)[0] ?? "");
  }
  candidate = candidate.replace(TRAILING_NUMBER_PATTERN, "").trim();
  if (!candidate) return null;

  if (looksLikeSentenceFragment(candidate)) return null;
  if (candidate.length < 2 || candidate.length > 48) return null;
  if (candidate.split(/\s+/).length > 4) return null;

  return candidate;
}

function looksLikeSentenceFragment(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return true;
  if (SENTENCE_VERB_PATTERN.test(normalized)) return true;
  return normalized.split(/\s+/).length > 4;
}

function isUsableBrandName(name: string): boolean {
  const normalized = normalizeWhitespace(name);
  if (!normalized || normalized.length < 2 || normalized.length > 48) return false;
  return !looksLikeSentenceFragment(normalized);
}

function brandFromDescription(description: string | null | undefined): string | null {
  const clean = normalizeWhitespace(String(description ?? ""));
  if (!clean) return null;

  const dashMatch = clean.match(/^(.{2,48}?)\s[-–—]\s+/);
  if (dashMatch?.[1]) {
    const token = normalizeWhitespace(dashMatch[1]);
    if (isUsableBrandName(token)) return token;
  }

  const words = clean.split(/\s+/);
  const firstWord = words[0] ?? "";
  if (!firstWord || firstWord.length < 2) return null;

  const remainder = words.slice(1).join(" ");
  if (/^(is|are|was|were|'s|has|have)\b/i.test(remainder)) {
    return firstWord;
  }

  return null;
}

export function resolveClientFacingBrandName(
  rawName: string,
  hints?: ClientDisplayNameHints,
): string {
  const normalizedRaw = normalizeWhitespace(rawName);

  const leadingFromRaw = extractLeadingBrandFromRawName(rawName);
  if (leadingFromRaw && isUsableBrandName(leadingFromRaw)) {
    return leadingFromRaw;
  }

  const stripped = stripInternalSuffixes(rawName);
  if (stripped && isUsableBrandName(stripped) && !looksLikeInternalCrmLabel(rawName)) {
    return stripped;
  }

  if (stripped && looksLikeInternalCrmLabel(rawName) && isUsableBrandName(stripped)) {
    return stripped;
  }

  if (!normalizedRaw || looksLikeInternalCrmLabel(rawName)) {
    const fromDescription = brandFromDescription(hints?.oneLineDescription);
    if (fromDescription && isUsableBrandName(fromDescription)) return fromDescription;

    const fromWebsite = normalizeWhitespace(String(hints?.websiteTitle ?? ""));
    if (fromWebsite && isUsableBrandName(fromWebsite)) return fromWebsite;
  }

  if (stripped && isUsableBrandName(stripped)) return stripped;
  if (normalizedRaw && isUsableBrandName(normalizedRaw)) return normalizedRaw;
  return normalizedRaw || "the brand";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeClientFacingText(text: string, rawName: string, resolvedBrandName: string): string {
  const raw = normalizeWhitespace(rawName);
  const resolved = normalizeWhitespace(resolvedBrandName);
  if (!text) return text;

  let output = text;
  if (raw && raw !== resolved) {
    output = output.split(raw).join(resolved);
  }

  if (resolved) {
    const escaped = escapeRegExp(resolved);
    output = output.replace(new RegExp(`At ${escaped} is [A-Za-z]+(?:'s)?`, "gi"), `At ${resolved},`);
    output = output.replace(new RegExp(`At ${escaped} is\\b`, "gi"), `At ${resolved},`);
    output = output.replace(new RegExp(`\\b${escaped} is [A-Za-z]+(?:'s)?`, "gi"), resolved);
    output = output.replace(new RegExp(`\\b${escaped}'s is`, "gi"), resolved);
  }

  return output;
}
