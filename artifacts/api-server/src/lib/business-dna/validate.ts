import type { BusinessDna } from "../business-dna.js";

export type ValidationStatus = "passed" | "warning" | "failed";
export type ValidationOutcome = "clean_pass" | "repair_required" | "blocker_fail";
export type ValidationSeverity = "warning" | "blocker";

export type BusinessDnaIssueCategory =
  | "structure_missing_field"
  | "mission_similarity_launch"
  | "mission_similarity_scope"
  | "pain_source_leakage"
  | "pillar_caption_overlap"
  | "hook_formula"
  | "category_mismatch_severe"
  | "audience_name_leakage_severe"
  | "theme_raw_dump"
  | "generic_strategist_language"
  | "sample_phrase_genericness"
  | "differentiator_genericness"
  | "value_prop_genericness"
  | "theme_genericness"
  | "hook_blandness"
  | "trust_signal_genericness"
  | "proof_signal_mapping_missing"
  | "audience_fallback_phrase"
  | "unsupported_geographies"
  | "unsupported_pricing_signals"
  | "unsupported_urgency_claims"
  | "unsupported_proof_claims"
  | "unsupported_values_claims"
  | "unsupported_wellness_claims"
  | "unsupported_typography_claims"
  | "unsupported_differentiator_claims"
  | "psychographics_genericness"
  | "tone_specificity_weak";

export type BusinessDnaValidationIssue = {
  category: BusinessDnaIssueCategory;
  severity: ValidationSeverity;
  fields: string[];
  message: string;
  evidence?: {
    comparedText?: string;
    sourceText?: string;
    similarity?: Partial<Record<"containment" | "jaccard" | "bigramOverlap" | "tokenOverlap", number>>;
  };
};

type RubricDimensionName =
  | "specificity"
  | "audienceGrounding"
  | "distinctiveness"
  | "sourceDumpRisk"
  | "brandFit";

type RubricDimension = {
  score: 0 | 1 | 2;
  weight: number;
  weightedScore: number;
  reasons: string[];
};

export type BusinessDnaValidationRubric = Record<RubricDimensionName, RubricDimension> & {
  totalWeightedScore: number;
  maxWeightedScore: number;
};

export type BusinessDnaValidationResult = {
  ok: boolean;
  status: ValidationStatus;
  outcome: ValidationOutcome;
  issues: string[];
  issueDetails: BusinessDnaValidationIssue[];
  blockerCount: number;
  warningCount: number;
  rubric?: BusinessDnaValidationRubric;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "them",
  "this",
  "to",
  "we",
  "with",
  "your",
  "you",
]);

const BENIGN_SHARED_TOKENS = new Set(["social", "media", "brand", "founders", "content"]);

const GENERIC_STRATEGIST_PHRASES = [
  "strong online presence",
  "drive meaningful engagement",
  "build meaningful relationships",
  "elevate your brand",
  "take your social media presence to the next level",
  "stand out online",
  "grow your business through social media",
  "memorable online experiences",
];

const GENERIC_THEME_PHRASES = [
  "building a strong online presence",
  "creating engaging content",
  "growing through social media",
  "improving brand visibility",
];

const GENERIC_HOOK_PREFIXES = ["want to ", "ready to ", "did you know"];
const FORMULA_HOOK_PATTERNS = [
  /^start (?:from|with)\b/,
  /^lead with\b/,
  /^open with\b/,
  /^use a hook like\b/,
  /\bpain\s*[-=]>\s*promise\b/,
  /\bquestion\s*\+\s*curiosity\b/,
  /^promise desire:/,
  /^start from pain:/,
];

const GENERIC_ADJECTIVE_DIFFERENTIATORS = new Set([
  "creative",
  "strategic",
  "personalized",
  "authentic",
  "innovative",
  "expert",
  "relatable",
  "professional",
]);

const GENERIC_TRUST_SIGNALS = [
  "client success stories",
  "customer testimonials",
  "expertise",
  "proven track record",
  "personalized approach",
];

const SUSPICIOUS_GEOGRAPHY_TERMS = [
  "united states",
  "usa",
  "europe",
  "asia",
  "australia",
  "canada",
  "uk",
  "worldwide",
  "global",
  "international",
];

const UNSUPPORTED_PRICING_PATTERNS = [
  /\bcustom(?:ized)? pricing\b/,
  /\bpackage deals?\b/,
  /\bdiscounts?\b/,
  /\blong term discounts?\b/,
  /\bretainer\b/,
  /\bstarting at\b/,
  /\bpriced? at\b/,
];

const UNSUPPORTED_URGENCY_PATTERNS = [
  /\blimited spots?\b/,
  /\blimited availability\b/,
  /\blimited time\b/,
  /\bexclusive promotions?\b/,
  /\bpromo(?:tion)?\b/,
  /\bdiscount\b/,
  /\boffer ends\b/,
  /\bspots? (?:are )?limited\b/,
];

const UNSUPPORTED_PROOF_PATTERNS = [
  /\breviews?\b/,
  /\btestimonials?\b/,
  /\bcase studies?\b/,
  /\bawards?\b/,
  /\baward winning\b/,
  /\brecognized\b/,
  /\bfeatured in\b/,
  /\bindustry recognition\b/,
  /\bproven track record\b/,
  /\bexpert endorsements?\b/,
  /\bexpert backed\b/,
  /\bexpert approved\b/,
  /\bclinically backed\b/,
  /\bclinically proven\b/,
  /\bdermatologist approved\b/,
  /\bdoctor approved\b/,
  /\bcertifications?\b/,
  /\bcertified\b/,
];

const UNSUPPORTED_VALUES_PATTERNS = [
  /\bsustainab(?:le|ility)\b/,
  /\binclusiv(?:e|ity)\b/,
  /\bethical(?:ly)?\b/,
  /\bcruelty free\b/,
  /\bvegan\b/,
  /\beco friendly\b/,
];

const UNSUPPORTED_WELLNESS_CLAIM_PATTERNS = [
  /\btreats?\b/,
  /\bcures?\b/,
  /\bheals?\b/,
  /\bguaranteed relief\b/,
  /\bclinically proven\b/,
  /\bmedical grade\b/,
  /\btherapeutic\b/,
  /\breduces anxiety\b/,
  /\bfix(?:es)? sleep\b/,
  /\bsolves? stress\b/,
];

const UNSUPPORTED_DIFFERENTIATOR_PATTERNS = [
  /\baudit(?:ing)?\s+\d+\s+(?:months?|years?)\b/,
  /\b12 months of real content\b/,
  /\bour team is made up of\b/,
  /\bexperienced creators? and strategists?\b/,
  /\bproven track record\b/,
];

const GENERIC_PSYCHOGRAPHIC_PATTERNS = [
  /\bambitious founders?\b/,
  /\bbrands? seeking growth\b/,
  /\bvalue quality and consistency\b/,
  /\bwant to grow online\b/,
  /\bwant a strong online presence\b/,
];

const GENERIC_TONE_STYLE_TERMS = new Set([
  "professional",
  "friendly",
  "clear",
  "strategic",
  "authentic",
  "helpful",
  "confident",
  "warm",
]);

const GENERIC_TYPOGRAPHY_VALUES = new Set([
  "",
  "system / unknown",
  "system",
  "unknown",
  "not available from current inputs",
  "needs client confirmation",
]);

function looksLikeNamedFont(value: string): boolean {
  const normalized = normalizeForComparison(value);
  if (!normalized || GENERIC_TYPOGRAPHY_VALUES.has(normalized)) return false;
  if (/\bserif\b|\bsans serif\b|\bsans\b|\bmonospace\b|\bdisplay\b|\bscript\b/.test(normalized)) return false;
  return /[a-z]/.test(normalized);
}

const MIN_TOKEN_COUNTS = {
  missionComparison: 8,
  painComparison: 5,
  pillarComparison: 4,
  themeEvaluation: 3,
  samplePhraseEvaluation: 4,
} as const;

const DNA_RUBRIC_WEIGHTS = {
  specificity: 3,
  audienceGrounding: 2,
  distinctiveness: 2,
  sourceDumpRisk: 2,
  brandFit: 3,
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function toValidationStatus(outcome: ValidationOutcome): ValidationStatus {
  if (outcome === "blocker_fail") return "failed";
  if (outcome === "repair_required") return "warning";
  return "passed";
}

function finalizeResult(
  issueDetails: BusinessDnaValidationIssue[],
  outcome: ValidationOutcome,
  rubric?: BusinessDnaValidationRubric,
): BusinessDnaValidationResult {
  const blockerCount = issueDetails.filter((issue) => issue.severity === "blocker").length;
  const warningCount = issueDetails.filter((issue) => issue.severity === "warning").length;
  return {
    ok: outcome !== "blocker_fail",
    status: toValidationStatus(outcome),
    outcome,
    issues: issueDetails.map((issue) => issue.message),
    issueDetails,
    blockerCount,
    warningCount,
    ...(rubric ? { rubric } : {}),
  };
}

export function normalizeForComparison(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[_/\\|]+/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string, options?: { removeStopwords?: boolean }): string[] {
  const normalized = normalizeForComparison(text);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !(options?.removeStopwords && STOPWORDS.has(token)));
}

export function buildNgrams(tokens: string[], n: number): string[] {
  if (n <= 1 || tokens.length < n) return [];
  const grams: string[] = [];
  for (let index = 0; index <= tokens.length - n; index += 1) {
    grams.push(tokens.slice(index, index + n).join(" "));
  }
  return grams;
}

export function tokenCount(value: unknown): number {
  return tokenize(String(value ?? "")).length;
}

export function tokenOverlapRatio(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (BENIGN_SHARED_TOKENS.has(token)) continue;
    if (rightSet.has(token)) overlap += 1;
  }
  const denominator = Math.max(1, Math.min(leftSet.size, rightSet.size));
  return overlap / denominator;
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  let intersection = 0;
  for (const token of union) {
    if (BENIGN_SHARED_TOKENS.has(token)) continue;
    if (leftSet.has(token) && rightSet.has(token)) intersection += 1;
  }
  const filteredUnionSize = Array.from(union).filter((token) => !BENIGN_SHARED_TOKENS.has(token)).length;
  return filteredUnionSize === 0 ? 0 : intersection / filteredUnionSize;
}

export function containmentRatio(source: string[], candidate: string[]): number {
  if (source.length === 0 || candidate.length === 0) return 0;
  const sourceSet = new Set(source.filter((token) => !BENIGN_SHARED_TOKENS.has(token)));
  const candidateSet = new Set(candidate.filter((token) => !BENIGN_SHARED_TOKENS.has(token)));
  if (sourceSet.size === 0 || candidateSet.size === 0) return 0;
  let overlap = 0;
  for (const token of candidateSet) {
    if (sourceSet.has(token)) overlap += 1;
  }
  return overlap / candidateSet.size;
}

export function ngramOverlapRatio(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const gram of leftSet) {
    if (rightSet.has(gram)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

type SimilarityDiagnostics = {
  tokenOverlap: number;
  jaccard: number;
  containment: number;
  bigramOverlap: number;
};

function compareTexts(left: string, right: string): SimilarityDiagnostics {
  const leftTokens = tokenize(left, { removeStopwords: true });
  const rightTokens = tokenize(right, { removeStopwords: true });
  return {
    tokenOverlap: tokenOverlapRatio(leftTokens, rightTokens),
    jaccard: jaccardSimilarity(leftTokens, rightTokens),
    containment: containmentRatio(rightTokens, leftTokens),
    bigramOverlap: ngramOverlapRatio(buildNgrams(leftTokens, 2), buildNgrams(rightTokens, 2)),
  };
}

function meetsBlockerThreshold(diag: SimilarityDiagnostics, thresholds: {
  containment: number;
  jaccard: number;
  bigramOverlap?: number;
}): boolean {
  let signals = 0;
  if (diag.containment >= thresholds.containment) signals += 1;
  if (diag.jaccard >= thresholds.jaccard) signals += 1;
  if (typeof thresholds.bigramOverlap === "number" && diag.bigramOverlap >= thresholds.bigramOverlap) signals += 1;
  return signals >= 2;
}

function matchesPhraseBank(text: string, phrases: readonly string[]): number {
  const normalized = normalizeForComparison(text);
  return phrases.filter((phrase) => normalized.includes(phrase)).length;
}

function isFormulaHook(hook: string): boolean {
  const normalized = normalizeForComparison(hook);
  return FORMULA_HOOK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isRawDumpTheme(theme: string): boolean {
  const normalized = String(theme ?? "").trim();
  return (
    normalized.includes("\n") ||
    /[,:;].*[,:;]/.test(normalized) ||
    tokenCount(normalized) > 18 ||
    /(?:\bwe\b.*\bhelp\b.*\bbrands\b)|(?:\btopic:\b)|(?:\|)/i.test(normalized)
  );
}

function isGenericSamplePhrase(phrase: string): boolean {
  const normalized = normalizeForComparison(phrase);
  if (tokenCount(normalized) < MIN_TOKEN_COUNTS.samplePhraseEvaluation) return false;
  return (
    /let s make your brand/.test(normalized) ||
    /we re here to help you/.test(normalized) ||
    /take your .* to the next level/.test(normalized) ||
    matchesPhraseBank(normalized, GENERIC_STRATEGIST_PHRASES) > 0
  );
}

function isWeakDifferentiator(text: string): boolean {
  const tokens = tokenize(text, { removeStopwords: true });
  if (tokens.length === 0) return false;
  if (tokens.length <= 3 && tokens.every((token) => GENERIC_ADJECTIVE_DIFFERENTIATORS.has(token))) {
    return true;
  }
  return false;
}

function containsPattern(text: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalizeForComparison(text);
  return patterns.some((pattern) => pattern.test(normalized));
}

function countMatches(text: string, terms: readonly string[]): number {
  const normalized = normalizeForComparison(text);
  return terms.filter((term) => normalized.includes(term)).length;
}

function createIssue(params: {
  category: BusinessDnaIssueCategory;
  severity: ValidationSeverity;
  fields: string[];
  message: string;
  evidence?: BusinessDnaValidationIssue["evidence"];
}): BusinessDnaValidationIssue {
  return params;
}

function buildRubric(issueDetails: BusinessDnaValidationIssue[]): BusinessDnaValidationRubric {
  const categories = new Set(issueDetails.map((issue) => issue.category));

  const specificityScore: 0 | 1 | 2 =
    categories.has("mission_similarity_launch") ||
    categories.has("mission_similarity_scope") ||
    categories.has("value_prop_genericness") ||
    categories.has("generic_strategist_language")
      ? categories.has("value_prop_genericness") && categories.has("generic_strategist_language")
        ? 0
        : 1
      : 2;

  const audienceGroundingScore: 0 | 1 | 2 =
    categories.has("pain_source_leakage") || categories.has("audience_name_leakage_severe")
      ? 0
      : categories.has("audience_fallback_phrase") || categories.has("psychographics_genericness")
        ? 1
        : 2;

  const distinctivenessScore: 0 | 1 | 2 =
    categories.has("differentiator_genericness") && categories.has("sample_phrase_genericness")
      ? 0
      : categories.has("differentiator_genericness") ||
          categories.has("sample_phrase_genericness") ||
          categories.has("unsupported_differentiator_claims") ||
          categories.has("hook_blandness") ||
          categories.has("tone_specificity_weak")
        ? 1
        : 2;

  const sourceDumpRiskScore: 0 | 1 | 2 =
    categories.has("pillar_caption_overlap") || categories.has("theme_raw_dump") || categories.has("pain_source_leakage")
      ? 0
      : categories.has("theme_genericness")
        ? 1
        : 2;

  const brandFitScore: 0 | 1 | 2 =
    categories.has("category_mismatch_severe") ||
    categories.has("audience_name_leakage_severe") ||
    categories.has("unsupported_geographies") ||
    categories.has("unsupported_pricing_signals") ||
    categories.has("unsupported_urgency_claims") ||
    categories.has("unsupported_proof_claims") ||
    categories.has("unsupported_values_claims") ||
    categories.has("unsupported_wellness_claims") ||
    categories.has("unsupported_differentiator_claims")
      ? 0
      : categories.has("trust_signal_genericness") || categories.has("audience_fallback_phrase")
        ? 1
        : 2;

  const rubricBase = {
    specificity: {
      score: specificityScore,
      weight: DNA_RUBRIC_WEIGHTS.specificity,
      weightedScore: specificityScore * DNA_RUBRIC_WEIGHTS.specificity,
      reasons: issueDetails
        .filter((issue) => ["mission_similarity_launch", "mission_similarity_scope", "value_prop_genericness", "generic_strategist_language"].includes(issue.category))
        .map((issue) => issue.message),
    },
    audienceGrounding: {
      score: audienceGroundingScore,
      weight: DNA_RUBRIC_WEIGHTS.audienceGrounding,
      weightedScore: audienceGroundingScore * DNA_RUBRIC_WEIGHTS.audienceGrounding,
      reasons: issueDetails
        .filter((issue) => ["pain_source_leakage", "audience_name_leakage_severe", "audience_fallback_phrase", "psychographics_genericness"].includes(issue.category))
        .map((issue) => issue.message),
    },
    distinctiveness: {
      score: distinctivenessScore,
      weight: DNA_RUBRIC_WEIGHTS.distinctiveness,
      weightedScore: distinctivenessScore * DNA_RUBRIC_WEIGHTS.distinctiveness,
      reasons: issueDetails
        .filter((issue) => ["differentiator_genericness", "sample_phrase_genericness", "unsupported_differentiator_claims", "hook_blandness", "tone_specificity_weak"].includes(issue.category))
        .map((issue) => issue.message),
    },
    sourceDumpRisk: {
      score: sourceDumpRiskScore,
      weight: DNA_RUBRIC_WEIGHTS.sourceDumpRisk,
      weightedScore: sourceDumpRiskScore * DNA_RUBRIC_WEIGHTS.sourceDumpRisk,
      reasons: issueDetails
        .filter((issue) => ["pillar_caption_overlap", "theme_raw_dump", "pain_source_leakage", "theme_genericness"].includes(issue.category))
        .map((issue) => issue.message),
    },
    brandFit: {
      score: brandFitScore,
      weight: DNA_RUBRIC_WEIGHTS.brandFit,
      weightedScore: brandFitScore * DNA_RUBRIC_WEIGHTS.brandFit,
      reasons: issueDetails
        .filter((issue) =>
          [
            "category_mismatch_severe",
            "audience_name_leakage_severe",
            "trust_signal_genericness",
            "audience_fallback_phrase",
            "unsupported_geographies",
            "unsupported_pricing_signals",
            "unsupported_urgency_claims",
            "unsupported_proof_claims",
            "unsupported_values_claims",
            "unsupported_wellness_claims",
            "unsupported_differentiator_claims",
          ].includes(issue.category),
        )
        .map((issue) => issue.message),
    },
  };

  const totalWeightedScore = Object.values(rubricBase).reduce((sum, item) => sum + item.weightedScore, 0);
  const maxWeightedScore = Object.values(DNA_RUBRIC_WEIGHTS).reduce((sum, weight) => sum + weight * 2, 0);

  return {
    ...rubricBase,
    totalWeightedScore,
    maxWeightedScore,
  };
}

function deriveOutcome(issueDetails: BusinessDnaValidationIssue[], rubric?: BusinessDnaValidationRubric): ValidationOutcome {
  const blockerCount = issueDetails.filter((issue) => issue.severity === "blocker").length;
  if (blockerCount > 0) return "blocker_fail";
  if (!rubric) return issueDetails.length === 0 ? "clean_pass" : "repair_required";

  const warningCategories = new Set(issueDetails.filter((issue) => issue.severity === "warning").map((issue) => issue.category));
  const dimensionsBelowStrong = [
    rubric.specificity.score,
    rubric.audienceGrounding.score,
    rubric.distinctiveness.score,
    rubric.sourceDumpRisk.score,
    rubric.brandFit.score,
  ].filter((score) => score < 2).length;

  if (warningCategories.size >= 6 && rubric.totalWeightedScore <= 15) return "blocker_fail";
  if (rubric.specificity.score === 0 && rubric.distinctiveness.score === 0) return "blocker_fail";
  if (rubric.audienceGrounding.score === 0 && rubric.brandFit.score === 0) return "blocker_fail";
  if (rubric.totalWeightedScore <= 12) return "blocker_fail";
  if (warningCategories.size >= 3 && dimensionsBelowStrong >= 2) return "repair_required";
  if (rubric.totalWeightedScore <= 18) return "repair_required";
  return "clean_pass";
}

export function validateBusinessDnaStructure(value: unknown): BusinessDnaValidationResult {
  const dna = asRecord(value);
  if (!dna) {
    return finalizeResult(
      [createIssue({
        category: "structure_missing_field",
        severity: "blocker",
        fields: ["businessDna"],
        message: "Business DNA must be an object.",
      })],
      "blocker_fail",
    );
  }

  const positioning = asRecord(dna.positioning);
  const targetAudience = asRecord(dna.targetAudience);
  const contentStrategy = asRecord(dna.contentStrategy);

  const issueDetails: BusinessDnaValidationIssue[] = [];

  if (!normalizeForComparison(dna.purpose)) {
    issueDetails.push(createIssue({
      category: "structure_missing_field",
      severity: "blocker",
      fields: ["purpose"],
      message: "Missing purpose.",
    }));
  }
  if (!normalizeForComparison(dna.mission)) {
    issueDetails.push(createIssue({
      category: "structure_missing_field",
      severity: "blocker",
      fields: ["mission"],
      message: "Missing mission.",
    }));
  }
  if (!positioning || !normalizeForComparison(positioning.category)) {
    issueDetails.push(createIssue({
      category: "structure_missing_field",
      severity: "blocker",
      fields: ["positioning.category"],
      message: "Missing positioning category.",
    }));
  }
  if (!targetAudience || asStringList(targetAudience.segments).length === 0) {
    issueDetails.push(createIssue({
      category: "structure_missing_field",
      severity: "blocker",
      fields: ["targetAudience.segments"],
      message: "Missing target audience segments.",
    }));
  }
  if (!contentStrategy || asStringList(contentStrategy.contentPillars).length === 0) {
    issueDetails.push(createIssue({
      category: "structure_missing_field",
      severity: "blocker",
      fields: ["contentStrategy.contentPillars"],
      message: "Missing content strategy pillars.",
    }));
  }

  return finalizeResult(issueDetails, issueDetails.length === 0 ? "clean_pass" : "blocker_fail");
}

export function validateBusinessDnaSemantics(
  dna: BusinessDna | null | undefined,
  input?: {
    strategyLaunchPlanning?: string | null | undefined;
    scopeOfWork?: string | null | undefined;
    recentCaptionSnippets?: string[] | null | undefined;
    proofSignals?: string[] | null | undefined;
    brandName?: string | null | undefined;
    clientName?: string | null | undefined;
    businessTypePrimary?: string | null | undefined;
    instagramBio?: string | null | undefined;
    offerSummary?: string | null | undefined;
  },
): BusinessDnaValidationResult {
  if (!dna) {
    return finalizeResult(
      [createIssue({
        category: "structure_missing_field",
        severity: "blocker",
        fields: ["businessDna"],
        message: "Business DNA not available for semantic validation.",
      })],
      "blocker_fail",
    );
  }

  const issueDetails: BusinessDnaValidationIssue[] = [];
  const mission = String(dna.mission ?? "");
  const audienceSegments = dna.targetAudience?.segments ?? [];
  const psychographics = dna.targetAudience?.psychographics ?? [];
  const pains = dna.targetAudience?.pains ?? [];
  const category = String(dna.positioning?.category ?? "");
  const valueProp = String(dna.positioning?.valueProposition ?? "");
  const coreValues = dna.coreValues ?? [];
  const differentiators = dna.positioning?.differentiators ?? [];
  const pillars = dna.contentStrategy?.contentPillars ?? [];
  const themes = dna.contentStrategy?.themes ?? [];
  const hooks = dna.contentStrategy?.hooksThatFitBrand ?? [];
  const trustSignals = dna.contentStrategy?.trustSignalsToRepeat ?? [];
  const samplePhrases = dna.toneOfVoice?.samplePhrases ?? [];
  const toneStyle = dna.toneOfVoice?.style ?? [];
  const geographies = dna.targetAudience?.geographies ?? [];
  const pricingSignals = dna.offers?.pricingSignals ?? [];
  const transformationPromise = String(dna.offers?.transformationPromise ?? "");
  const urgencyStyle = String(dna.offers?.urgencyStyle ?? "");
  const reasonToBelieve = dna.positioning?.reasonToBelieve ?? [];
  const topicsToAvoid = dna.contentStrategy?.topicsToAvoid ?? [];
  const typographyPrimary = String(dna.visualIdentity?.typography?.primary ?? "");
  const typographySecondary = String(dna.visualIdentity?.typography?.secondary ?? "");

  const strategyLaunchPlanning = String(input?.strategyLaunchPlanning ?? "");
  const scopeOfWork = String(input?.scopeOfWork ?? "");
  const recentCaptionSnippets = input?.recentCaptionSnippets ?? [];
  const proofSignals = input?.proofSignals ?? [];
  const instagramBio = String(input?.instagramBio ?? "");
  const offerSummary = String(input?.offerSummary ?? "");
  const approvedSourceText = [strategyLaunchPlanning, scopeOfWork, instagramBio, offerSummary, ...proofSignals].join(" ");

  if (
    tokenCount(mission) >= MIN_TOKEN_COUNTS.missionComparison &&
    tokenCount(strategyLaunchPlanning) >= MIN_TOKEN_COUNTS.missionComparison
  ) {
    const similarity = compareTexts(mission, strategyLaunchPlanning);
    if (meetsBlockerThreshold(similarity, { containment: 0.72, jaccard: 0.68, bigramOverlap: 0.6 })) {
      issueDetails.push(createIssue({
        category: "mission_similarity_launch",
        severity: "blocker",
        fields: ["mission"],
        message: "Mission overlaps too closely with strategy launch planning text.",
        evidence: { comparedText: mission, sourceText: strategyLaunchPlanning, similarity },
      }));
    }
  }

  if (tokenCount(mission) >= MIN_TOKEN_COUNTS.missionComparison && tokenCount(scopeOfWork) >= MIN_TOKEN_COUNTS.missionComparison) {
    const similarity = compareTexts(mission, scopeOfWork);
    if (meetsBlockerThreshold(similarity, { containment: 0.72, jaccard: 0.68, bigramOverlap: 0.6 })) {
      issueDetails.push(createIssue({
        category: "mission_similarity_scope",
        severity: "blocker",
        fields: ["mission"],
        message: "Mission overlaps too closely with scope of work text.",
        evidence: { comparedText: mission, sourceText: scopeOfWork, similarity },
      }));
    }
  }

  for (const pain of pains) {
    if (tokenCount(pain) < MIN_TOKEN_COUNTS.painComparison) continue;
    for (const sourceText of [instagramBio, offerSummary]) {
      if (tokenCount(sourceText) < MIN_TOKEN_COUNTS.painComparison) continue;
      const similarity = compareTexts(pain, sourceText);
      if (meetsBlockerThreshold(similarity, { containment: 0.7, jaccard: 0.65 })) {
        issueDetails.push(createIssue({
          category: "pain_source_leakage",
          severity: "blocker",
          fields: ["targetAudience.pains"],
          message: "Audience pains appear to leak Instagram bio or offer-summary language.",
          evidence: { comparedText: pain, sourceText, similarity },
        }));
        break;
      }
    }
  }

  for (const pillar of pillars) {
    if (tokenCount(pillar) < MIN_TOKEN_COUNTS.pillarComparison) continue;
    for (const caption of recentCaptionSnippets) {
      if (tokenCount(caption) < MIN_TOKEN_COUNTS.pillarComparison) continue;
      const similarity = compareTexts(pillar, caption);
      if (meetsBlockerThreshold(similarity, { containment: 0.75, jaccard: 0.7 })) {
        issueDetails.push(createIssue({
          category: "pillar_caption_overlap",
          severity: "blocker",
          fields: ["contentStrategy.contentPillars"],
          message: "Content pillars substantially overlap recent caption snippets.",
          evidence: { comparedText: pillar, sourceText: caption, similarity },
        }));
        break;
      }
    }
  }

  if (hooks.some((hook) => isFormulaHook(hook))) {
    issueDetails.push(createIssue({
      category: "hook_formula",
      severity: "blocker",
      fields: ["contentStrategy.hooksThatFitBrand"],
      message: "Hooks contain formula-style or instructional placeholders instead of publish-ready lines.",
    }));
  }

  const normalizedCategory = normalizeForComparison(category);
  if (
    input?.businessTypePrimary === "service_agency" &&
    /\b(software|platform|saas|b2b)\b/.test(normalizedCategory) &&
    !/\b(agency|service|marketing|studio|consulting)\b/.test(normalizedCategory)
  ) {
    issueDetails.push(createIssue({
      category: "category_mismatch_severe",
      severity: "blocker",
      fields: ["positioning.category"],
      message: "Category appears misaligned with a service-agency business type.",
    }));
  }

  if (
    input?.brandName &&
    input?.clientName &&
    normalizeForComparison(input.brandName) !== normalizeForComparison(input.clientName)
  ) {
    const clientName = normalizeForComparison(input.clientName);
    if ([...audienceSegments, ...pains, ...(dna.targetAudience?.desires ?? [])].some((entry) => normalizeForComparison(entry).includes(clientName))) {
      issueDetails.push(createIssue({
        category: "audience_name_leakage_severe",
        severity: "blocker",
        fields: ["targetAudience.segments", "targetAudience.pains", "targetAudience.desires"],
        message: "Audience framing appears to reference client/founder name instead of brand or audience.",
      }));
    }
  }

  if (themes.some((theme) => isRawDumpTheme(theme))) {
    issueDetails.push(createIssue({
      category: "theme_raw_dump",
      severity: "blocker",
      fields: ["contentStrategy.themes"],
      message: "Themes look like pasted source dumps instead of concise editorial lanes.",
    }));
  }

  const strategistLanguageHits =
    matchesPhraseBank(mission, GENERIC_STRATEGIST_PHRASES) +
    matchesPhraseBank(valueProp, GENERIC_STRATEGIST_PHRASES) +
    themes.reduce((sum, theme) => sum + matchesPhraseBank(theme, GENERIC_STRATEGIST_PHRASES), 0) +
    hooks.reduce((sum, hook) => sum + matchesPhraseBank(hook, GENERIC_STRATEGIST_PHRASES), 0) +
    samplePhrases.reduce((sum, phrase) => sum + matchesPhraseBank(phrase, GENERIC_STRATEGIST_PHRASES), 0);
  if (strategistLanguageHits >= 2) {
    issueDetails.push(createIssue({
      category: "generic_strategist_language",
      severity: "warning",
      fields: [
        "mission",
        "positioning.valueProposition",
        "contentStrategy.themes",
        "contentStrategy.hooksThatFitBrand",
        "toneOfVoice.samplePhrases",
      ],
      message: "Business DNA uses repeated generic strategist language across multiple fields.",
    }));
  }

  if (samplePhrases.filter((phrase) => isGenericSamplePhrase(phrase)).length >= 2) {
    issueDetails.push(createIssue({
      category: "sample_phrase_genericness",
      severity: "warning",
      fields: ["toneOfVoice.samplePhrases"],
      message: "Sample phrases sound interchangeable with generic agency copy.",
    }));
  }

  const weakDifferentiatorCount = differentiators.filter((entry) => isWeakDifferentiator(entry)).length;
  if (differentiators.length > 0 && weakDifferentiatorCount >= Math.max(2, differentiators.length)) {
    issueDetails.push(createIssue({
      category: "differentiator_genericness",
      severity: "warning",
      fields: ["positioning.differentiators"],
      message: "Differentiators read like generic adjectives without a clear mechanism or angle.",
    }));
  }
  if (
    differentiators.some((entry) => containsPattern(entry, UNSUPPORTED_DIFFERENTIATOR_PATTERNS)) &&
    proofSignals.length === 0
  ) {
    issueDetails.push(createIssue({
      category: "unsupported_differentiator_claims",
      severity: "warning",
      fields: ["positioning.differentiators"],
      message: 'Differentiators contain factual-looking process or team claims that may be unsupported. Reframe them as supported proof or "Suggested angle — needs confirmation."',
    }));
  }

  if (
    tokenCount(valueProp) >= MIN_TOKEN_COUNTS.samplePhraseEvaluation &&
    (matchesPhraseBank(valueProp, GENERIC_STRATEGIST_PHRASES) > 0 ||
      /help .* grow|build a strong online presence|drive business growth/.test(normalizeForComparison(valueProp)))
  ) {
    issueDetails.push(createIssue({
      category: "value_prop_genericness",
      severity: "warning",
      fields: ["positioning.valueProposition"],
      message: "Value proposition is broad and interchangeable with generic agency messaging.",
    }));
  }

  if (
    themes.filter((theme) => tokenCount(theme) >= MIN_TOKEN_COUNTS.themeEvaluation)
      .some((theme) => matchesPhraseBank(theme, GENERIC_THEME_PHRASES) > 0)
  ) {
    issueDetails.push(createIssue({
      category: "theme_genericness",
      severity: "warning",
      fields: ["contentStrategy.themes"],
      message: "Themes read like abstract growth goals instead of editorial lanes.",
    }));
  }

  const blandHookCount = hooks.filter((hook) => {
    const normalized = normalizeForComparison(hook);
    return GENERIC_HOOK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }).length;
  if (hooks.length > 0 && blandHookCount >= Math.max(2, Math.ceil(hooks.length / 2))) {
    issueDetails.push(createIssue({
      category: "hook_blandness",
      severity: "warning",
      fields: ["contentStrategy.hooksThatFitBrand"],
      message: "Hooks are mostly bland starter patterns without a brand-specific angle.",
    }));
  }

  const normalizedTrustSignals = trustSignals.map((signal) => normalizeForComparison(signal));
  if (proofSignals.length > 0) {
    const normalizedProofSignals = proofSignals.map((signal) => normalizeForComparison(signal));
    const reflected = normalizedProofSignals.some((signal) =>
      normalizedTrustSignals.some((trust) => trust.includes(signal) || signal.includes(trust)),
    );
    if (!reflected) {
      issueDetails.push(createIssue({
        category: "proof_signal_mapping_missing",
        severity: "warning",
        fields: ["contentStrategy.trustSignalsToRepeat"],
        message: "Proof signals are not clearly reflected in trust signals.",
      }));
    }
  }
  if (
    normalizedTrustSignals.length > 0 &&
    normalizedTrustSignals.every((signal) => GENERIC_TRUST_SIGNALS.some((generic) => signal.includes(generic)))
  ) {
    issueDetails.push(createIssue({
      category: "trust_signal_genericness",
      severity: "warning",
      fields: ["contentStrategy.trustSignalsToRepeat"],
      message: "Trust signals read like generic placeholders instead of specific proof anchors.",
    }));
  }

  if (audienceSegments.some((segment) => normalizeForComparison(segment).includes("shoppers and fans aligned with"))) {
    issueDetails.push(createIssue({
      category: "audience_fallback_phrase",
      severity: "warning",
      fields: ["targetAudience.segments"],
      message: "Audience contains low-quality fallback phrasing.",
    }));
  }
  if (
    psychographics.length > 0 &&
    psychographics.every((entry) => GENERIC_PSYCHOGRAPHIC_PATTERNS.some((pattern) => pattern.test(normalizeForComparison(entry))))
  ) {
    issueDetails.push(createIssue({
      category: "psychographics_genericness",
      severity: "warning",
      fields: ["targetAudience.psychographics"],
      message: "Psychographics feel broad and interchangeable instead of grounded in the approved audience context.",
    }));
  }

  const geographyHitCount = geographies.reduce((sum, entry) => sum + countMatches(entry, SUSPICIOUS_GEOGRAPHY_TERMS), 0);
  if (geographies.length > 0 && geographyHitCount >= Math.max(2, geographies.length)) {
    issueDetails.push(createIssue({
      category: "unsupported_geographies",
      severity: "warning",
      fields: ["targetAudience.geographies"],
      message: "Geographies read like unsupported market guesses rather than confirmed audience coverage.",
    }));
  }

  if (pricingSignals.some((entry) => containsPattern(entry, UNSUPPORTED_PRICING_PATTERNS))) {
    issueDetails.push(createIssue({
      category: "unsupported_pricing_signals",
      severity: "warning",
      fields: ["offers.pricingSignals"],
      message: "Pricing signals introduce packages, discounts, or pricing certainty that may not be supported by the approved inputs.",
    }));
  }

  if (urgencyStyle && containsPattern(urgencyStyle, UNSUPPORTED_URGENCY_PATTERNS)) {
    issueDetails.push(createIssue({
      category: "unsupported_urgency_claims",
      severity: "warning",
      fields: ["offers.urgencyStyle"],
      message: "Urgency or promotion language appears more certain than the approved inputs justify.",
    }));
  }

  const combinedProofText = [...trustSignals, ...reasonToBelieve].join(" ");
  if (containsPattern(combinedProofText, UNSUPPORTED_PROOF_PATTERNS) && (proofSignals?.length ?? 0) === 0) {
    issueDetails.push(createIssue({
      category: "unsupported_proof_claims",
      severity: "warning",
      fields: ["positioning.reasonToBelieve", "contentStrategy.trustSignalsToRepeat"],
      message: "Proof language references testimonials, case studies, awards, or recognition without clear supporting proof inputs.",
    }));
  }
  const combinedValuesText = [...coreValues, valueProp, ...differentiators, ...trustSignals, ...reasonToBelieve].join(" ");
  if (
    containsPattern(combinedValuesText, UNSUPPORTED_VALUES_PATTERNS) &&
    !containsPattern(approvedSourceText, UNSUPPORTED_VALUES_PATTERNS)
  ) {
    issueDetails.push(createIssue({
      category: "unsupported_values_claims",
      severity: "warning",
      fields: ["coreValues", "positioning.valueProposition", "positioning.differentiators", "contentStrategy.trustSignalsToRepeat"],
      message: "Values such as sustainability, inclusivity, vegan, cruelty-free, or ethical sourcing appear without clear supporting inputs.",
    }));
  }
  const combinedWellnessText = [
    valueProp,
    ...differentiators,
    transformationPromise,
    ...trustSignals,
    ...reasonToBelieve,
    ...topicsToAvoid,
  ].join(" ");
  if (
    containsPattern(combinedWellnessText, UNSUPPORTED_WELLNESS_CLAIM_PATTERNS) &&
    !containsPattern(approvedSourceText, UNSUPPORTED_WELLNESS_CLAIM_PATTERNS)
  ) {
    issueDetails.push(createIssue({
      category: "unsupported_wellness_claims",
      severity: "warning",
      fields: ["positioning.valueProposition", "offers.transformationPromise", "contentStrategy.trustSignalsToRepeat", "contentStrategy.topicsToAvoid"],
      message: "Wellness or cosmetic language reads like a therapeutic, medical, clinical, or guaranteed claim without source support.",
    }));
  }
  if ([typographyPrimary, typographySecondary].some((value) => looksLikeNamedFont(value))) {
    issueDetails.push(createIssue({
      category: "unsupported_typography_claims",
      severity: "warning",
      fields: ["visualIdentity.typography.primary", "visualIdentity.typography.secondary"],
      message: "Typography names look more certain than the current website evidence supports. Prefer generic typography guidance unless fonts were reliably extracted.",
    }));
  }

  const toneSpecificityWeak =
    input?.businessTypePrimary === "service_agency" &&
    toneStyle.length > 0 &&
    toneStyle.every((entry) => GENERIC_TONE_STYLE_TERMS.has(normalizeForComparison(entry))) &&
    samplePhrases.filter((phrase) => isGenericSamplePhrase(phrase)).length >= 1;
  if (toneSpecificityWeak) {
    issueDetails.push(createIssue({
      category: "tone_specificity_weak",
      severity: "warning",
      fields: ["toneOfVoice.style", "toneOfVoice.samplePhrases"],
      message: "Tone guidance stays too generic for a social-first service brand and needs more brand-specific sharpness.",
    }));
  }

  const rubric = buildRubric(issueDetails);
  const outcome = deriveOutcome(issueDetails, rubric);
  return finalizeResult(issueDetails, outcome, rubric);
}

export function buildBusinessDnaRepairPromptInput(
  result: {
    ok?: boolean;
    status?: ValidationStatus;
    issues: string[];
    issueDetails?: BusinessDnaValidationIssue[];
  },
): string {
  const lines = buildBusinessDnaRepairInstructionLines(result);
  if (lines.length === 0) {
    return "No repair issues were identified.";
  }
  return [
    "Repair the Business DNA JSON using these rules:",
    "- Preserve valid fields unchanged.",
    "- Rewrite only the flagged fields.",
    "- Keep the exact JSON shape and nested keys.",
    "- Use approved inputs only and do not copy raw source text.",
    "- Do not weaken fields that already read specific and accurate.",
    "- Targeted repair instructions:",
    `- ${lines.join("\n- ")}`,
  ].join("\n");
}

export function buildBusinessDnaRepairInstructionLines(
  result: {
    ok?: boolean;
    status?: ValidationStatus;
    issues: string[];
    issueDetails?: BusinessDnaValidationIssue[];
  },
): string[] {
  const issueDetails = result.issueDetails ?? [];
  if (issueDetails.length === 0) {
    return result.issues;
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const issue of issueDetails) {
    const key = `${issue.category}|${issue.fields.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    switch (issue.category) {
      case "structure_missing_field":
        lines.push(`Fill the missing field(s) ${issue.fields.join(", ")} and keep all other fields unchanged.`);
        break;
      case "mission_similarity_launch":
      case "mission_similarity_scope":
        lines.push("Rewrite mission only: describe the audience transformation and brand role, not launch planning or scope text.");
        break;
      case "pain_source_leakage":
        lines.push("Rewrite targetAudience.pains only: convert brand offer or bio language into audience-frustration language.");
        break;
      case "pillar_caption_overlap":
        lines.push("Rewrite contentStrategy.contentPillars only: use strategic content buckets, not caption-like post lines.");
        break;
      case "theme_raw_dump":
      case "theme_genericness":
        lines.push("Rewrite contentStrategy.themes only: use short editorial lanes, not raw dumps or broad growth goals.");
        break;
      case "hook_formula":
      case "hook_blandness":
        lines.push("Rewrite contentStrategy.hooksThatFitBrand only: use publish-ready hooks, not formulas or bland starter questions.");
        break;
      case "audience_name_leakage_severe":
      case "audience_fallback_phrase":
        lines.push("Rewrite targetAudience.segments, targetAudience.pains, and targetAudience.desires only: refer to the real audience, not fallback phrasing or client/founder naming.");
        break;
      case "category_mismatch_severe":
        lines.push("Rewrite positioning.category and positioning.valueProposition only so the business framing matches the approved business type.");
        break;
      case "value_prop_genericness":
        lines.push("Rewrite positioning.valueProposition only: make the promise specific to this brand's angle, not interchangeable agency copy.");
        break;
      case "differentiator_genericness":
        lines.push("Rewrite positioning.differentiators only: replace adjective-only claims with methods, angles, or strategic stances.");
        break;
      case "sample_phrase_genericness":
        lines.push("Rewrite toneOfVoice.samplePhrases only: make them sound brand-specific, not generic agency encouragement.");
        break;
      case "trust_signal_genericness":
      case "proof_signal_mapping_missing":
        lines.push("Rewrite contentStrategy.trustSignalsToRepeat only: tie trust signals to approved proof cues instead of placeholders.");
        break;
      case "unsupported_geographies":
        lines.push("Rewrite targetAudience.geographies only: remove guessed regions and keep this field blank unless the approved inputs clearly support location coverage.");
        break;
      case "unsupported_pricing_signals":
        lines.push('Rewrite offers.pricingSignals only: remove guessed package, discount, or pricing claims and use blank or "Needs client confirmation" only when that is cleaner and truly necessary.');
        break;
      case "unsupported_urgency_claims":
        lines.push("Rewrite offers.urgencyStyle only: remove unsupported urgency or promo language unless the approved inputs explicitly support it.");
        break;
      case "unsupported_proof_claims":
        lines.push('Rewrite positioning.reasonToBelieve and contentStrategy.trustSignalsToRepeat only: remove unsupported testimonial, case-study, award, or recognition claims and use blank or explicit uncertainty only when justified.');
        break;
      case "unsupported_values_claims":
        lines.push('Rewrite coreValues, positioning.valueProposition, positioning.differentiators, and contentStrategy.trustSignalsToRepeat only: remove unsupported sustainability, inclusivity, vegan, cruelty-free, ethical sourcing, certification, or endorsement claims unless clearly present in approved inputs; use "Not available from current inputs" only for factual unknowns that should remain visible.');
        break;
      case "unsupported_wellness_claims":
        lines.push("Rewrite positioning.valueProposition, offers.transformationPromise, contentStrategy.trustSignalsToRepeat, and contentStrategy.topicsToAvoid only: frame wellness/cosmetic benefits as positioning, ritual, sensory, self-care, or perceived experience; remove medical guarantees, treatment, cure, clinical proof, expert endorsement, and therapeutic certainty unless explicitly supported.");
        break;
      case "unsupported_typography_claims":
        lines.push('Rewrite visualIdentity.typography only: remove unsupported named fonts and use generic typography guidance or "system / unknown" unless fonts were reliably extracted.');
        break;
      case "unsupported_differentiator_claims":
        lines.push('Rewrite positioning.differentiators only: replace unsupported factual claims with supported differentiators or label the idea as "Suggested angle — needs confirmation."');
        break;
      case "psychographics_genericness":
        lines.push("Rewrite targetAudience.psychographics only: make them sharper, more behavior-specific, and more grounded in the approved audience context.");
        break;
      case "tone_specificity_weak":
        lines.push("Rewrite toneOfVoice.style and toneOfVoice.samplePhrases only: make the voice sharper, more social-first, founder-friendly, and less generic.");
        break;
      case "generic_strategist_language":
        lines.push("Rewrite the flagged generic lines with sharper, brand-specific language while preserving any already-strong sections.");
        break;
      default:
        lines.push(issue.message);
        break;
    }
  }
  return lines.length > 0 ? lines : result.issues;
}
