const UNRELIABLE_VALUE_PATTERNS: RegExp[] = [
  /\bnot confirmed\b/i,
  /\bnot found\b/i,
  /\bnot returned\b/i,
  /\bunknown\b/i,
  /\binsufficient data\b/i,
];

const PROFILE_CATEGORY_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bnot returned by apify\b/i,
  /\bbusiness category name not returned\b/i,
  /\bspecific instagram business category name not returned\b/i,
  /\bcategory name not returned\b/i,
];

export function isUnreliableImportValue(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return UNRELIABLE_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isProfileCategoryPlaceholder(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return PROFILE_CATEGORY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}
