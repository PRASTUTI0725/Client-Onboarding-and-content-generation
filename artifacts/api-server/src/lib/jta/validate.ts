export type JtaValidationStatus = "passed" | "warning" | "failed";
export type JtaValidationOutcome = "clean_pass" | "repair_required" | "blocker_fail";
export type JtaValidationSeverity = "warning" | "blocker";

export type JtaValidationIssueCategory =
  | "structure_missing_section"
  | "section_duplication"
  | "service_framing_drift"
  | "platform_mix_mismatch"
  | "dna_alignment_drift"
  | "content_strategy_restatement"
  | "generic_market_language"
  | "generic_audience_language"
  | "kpi_vagueness"
  | "tracking_vagueness"
  | "execution_phase_vagueness"
  | "platform_role_weakness"
  | "generic_consulting_language"
  | "audience_fallback_phrase"
  | "unsupported_tool_mentions"
  | "tracking_certainty_unconfirmed"
  | "content_strategy_grounding_weak"
  | "meta_strategy_language"
  | "weak_hook_language"
  | "brand_foundation_claim_drift"
  | "unsupported_platform_assumption"
  | "unsupported_proof_asset_assumption"
  | "unsupported_paid_ads_scope"
  | "unsupported_wellness_claims"
  | "punctuation_polish";

export type JtaValidationIssue = {
  category: JtaValidationIssueCategory;
  severity: JtaValidationSeverity;
  fields: string[];
  message: string;
  evidence?: {
    comparedSection?: string;
    sourceSection?: string;
    similarity?: Partial<Record<"containment" | "jaccard" | "bigramOverlap" | "tokenOverlap", number>>;
  };
};

type RubricDimensionName =
  | "strategicSpecificity"
  | "dnaAlignment"
  | "sectionDistinctness"
  | "operationalUsefulness"
  | "platformFit";

type RubricDimension = {
  score: 0 | 1 | 2;
  weight: number;
  weightedScore: number;
  reasons: string[];
};

export type JtaValidationRubric = Record<RubricDimensionName, RubricDimension> & {
  totalWeightedScore: number;
  maxWeightedScore: number;
};

export type JtaValidationResult = {
  ok: boolean;
  status: JtaValidationStatus;
  outcome: JtaValidationOutcome;
  issues: string[];
  issueDetails: JtaValidationIssue[];
  blockerCount: number;
  warningCount: number;
  rubric?: JtaValidationRubric;
};

const REQUIRED_JTA_SECTION_KEYS = [
  "marketNarrative",
  "problemGapSolution",
  "brandFoundation",
  "brandPhilosophy",
  "audience",
  "emotionalDrivers",
  "platformStrategy",
  "contentStrategy",
  "kpis",
  "trackingPlan",
  "executionPhases",
  "assetRequirements",
] as const;

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

const JTA_GENERIC_PHRASES = [
  "build awareness engagement and growth",
  "create meaningful connections",
  "drive results",
  "improve visibility",
  "optimize performance",
  "consistent value driven content",
  "tailored strategic approach",
  "long term success",
];

const MEASURABLE_KPI_TOKENS = [
  "saves",
  "shares",
  "dms",
  "reach",
  "replies",
  "profile",
  "clicks",
  "leads",
  "enquiries",
  "retention",
  "ctr",
];

const TRACKING_TOKENS = ["weekly", "monthly", "platform", "content", "funnel", "cadence", "breakdown"];
const KNOWN_PLATFORM_TOKENS = ["instagram", "pinterest", "linkedin", "facebook", "youtube", "tiktok", "twitter"];
const UNSUPPORTED_PLATFORM_ASSUMPTION_PATTERNS = [/\bfounder-led inbound\b/, /\bclient calls?\b/, /\bwebinars?\b/, /\bblog posts?\b/];
const PROOF_ASSET_PATTERNS = [
  /\breviews?\b/,
  /\btestimonials?\b/,
  /\bcase studies?\b/,
  /\bclient success stories?\b/,
  /\bugc\b/,
  /user-generated content/,
  /\binfluencer proof\b/,
  /\binfluencer partnerships?\b/,
  /\binfluencers?\b/,
  /\bpress coverage\b/,
  /\bpress\b/,
  /\bcertifications?\b/,
  /\bclinical proof\b/,
  /social proof from customers/,
  /customer testimonials/,
];
const PROOF_DEFINITIVE_USAGE_PATTERNS = [
  /\bshare customer testimonials\b/,
  /\bshowcase customer testimonials\b/,
  /\butilize user-generated content\b/,
  /\butilize ugc\b/,
  /\bleverage ugc\b/,
  /\buse testimonials\b/,
  /\bshowcase ugc\b/,
  /\b(showcase|share|utilize|leverage|display|highlight|feature|promote|present|use)\b[^.;]{0,80}\b(testimonials?|ugc|user-generated content|reviews?|influencer(?:s| partnerships?| proof)?|press(?: coverage)?|certifications?|clinical proof)\b/i,
  /\b(testimonials?|ugc|user-generated content|reviews?|influencer partnerships?|influencer proof|press coverage|certifications?|clinical proof)\b[^.;]{0,40}\b(as (?:social )?proof|across (?:reels|carousels|platforms)|in content)\b/i,
];
const PROOF_BUILD_PATTERNS = [
  /\bif available\b/,
  /\bif they exist\b/,
  /\bif provided\b/,
  /\bassets? to collect\b/,
  /\bcollect\b/,
  /\bgather\b/,
  /\bsource\b/,
  /\brequest\b/,
  /\bbuild proof\b/,
  /\bproof-building\b/,
  /\bproof building\b/,
  /\bestablish proof\b/,
  /\bdevelop proof\b/,
  /\bdevelop a pipeline\b/,
  /\bcreate a pipeline\b/,
  /\bplan to gather\b/,
  /\bbuild a pipeline\b/,
  /\bover time\b/,
];

function sectionHasUnsupportedProofUsage(sectionText: string): boolean {
  if (!sectionText.trim()) return false;
  if (PROOF_DEFINITIVE_USAGE_PATTERNS.some((pattern) => pattern.test(sectionText))) {
    return true;
  }
  const hasAsset = PROOF_ASSET_PATTERNS.some((pattern) => pattern.test(sectionText));
  if (!hasAsset) return false;
  return !PROOF_BUILD_PATTERNS.some((pattern) => pattern.test(sectionText));
}
const PAID_AD_PATTERNS = [
  /\bpaid advertising\b/,
  /\bpaid ads?\b/,
  /\bpaid social\b/,
  /\bad spend\b/,
  /\bcac\b/,
  /\bcustomer acquisition cost\b/,
  /\bcampaign setup\b/,
  /\btargeting setup\b/,
  /\baudience targeting\b/,
  /\bpixels?\b/,
  /\bretargeting\b/,
];
function mentionsPlatform(text: string, platform: string): boolean {
  return new RegExp(`\\b${platform}\\b`).test(text);
}

const ANALYTICS_TOOL_PATTERNS = [
  /\bga4\b/,
  /\bgoogle analytics\b/,
  /\bmeta business suite\b/,
  /\blooker studio\b/,
  /\btag manager\b/,
  /\butm\b/,
  /\bpixel\b/,
  /\bhubspot\b/,
  /\bsprout social\b/,
  /\bhootsuite\b/,
  /\bbuffer\b/,
  /\bdashboard\b/,
];

const CONDITIONAL_TRACKING_PATTERNS = [/\bif available\b/, /\bif set up\b/, /\bwhere available\b/, /\bif access exists\b/, /\bif connected\b/];

const CONTENT_GROUNDING_TOKENS = [
  "topic",
  "series",
  "bucket",
  "pillar",
  "theme",
  "founder",
  "proof",
  "education",
  "behind the scenes",
  "faq",
  "myth",
];

const REPEATED_PUNCTUATION_PATTERNS = [/\.\.+/, /!!+/, /\?\?+/];

const META_STRATEGY_PATTERNS = [
  /\btranslat(?:e|ing)\b.*\bbrand dna\b.*\bexecution logic\b/,
  /\bbrand dna\b.*\bexecution\b/,
  /\bexecution logic\b/,
  /\bstrategy architecture\b/,
  /\bsystem logic\b/,
  /\bcontent architecture\b/,
  /\binternal system\b/,
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

const GENERIC_HOOK_PATTERNS = [/\bready to\b/, /\bwant to\b/, /\bdid you know\b/];

const JTA_RUBRIC_WEIGHTS = {
  strategicSpecificity: 3,
  dnaAlignment: 3,
  sectionDistinctness: 2,
  operationalUsefulness: 3,
  platformFit: 2,
} as const;

function normalizeForComparison(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[_/\\|]+/g, " ")
    .replace(/[-–—]+/g, " ")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string, options?: { removeStopwords?: boolean }): string[] {
  const normalized = normalizeForComparison(text);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !(options?.removeStopwords && STOPWORDS.has(token)));
}

function buildNgrams(tokens: string[], n: number): string[] {
  if (n <= 1 || tokens.length < n) return [];
  const grams: string[] = [];
  for (let index = 0; index <= tokens.length - n; index += 1) {
    grams.push(tokens.slice(index, index + n).join(" "));
  }
  return grams;
}

function tokenOverlapRatio(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  let intersection = 0;
  for (const token of union) {
    if (leftSet.has(token) && rightSet.has(token)) intersection += 1;
  }
  return union.size === 0 ? 0 : intersection / union.size;
}

function containmentRatio(source: string[], candidate: string[]): number {
  if (source.length === 0 || candidate.length === 0) return 0;
  const sourceSet = new Set(source);
  const candidateSet = new Set(candidate);
  let overlap = 0;
  for (const token of candidateSet) {
    if (sourceSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, candidateSet.size);
}

function ngramOverlapRatio(left: string[], right: string[]): number {
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

function compareSections(left: string, right: string): SimilarityDiagnostics {
  const leftTokens = tokenize(left, { removeStopwords: true });
  const rightTokens = tokenize(right, { removeStopwords: true });
  return {
    tokenOverlap: tokenOverlapRatio(leftTokens, rightTokens),
    jaccard: jaccardSimilarity(leftTokens, rightTokens),
    containment: containmentRatio(rightTokens, leftTokens),
    bigramOverlap: ngramOverlapRatio(buildNgrams(leftTokens, 2), buildNgrams(rightTokens, 2)),
  };
}

function toValidationStatus(outcome: JtaValidationOutcome): JtaValidationStatus {
  if (outcome === "blocker_fail") return "failed";
  if (outcome === "repair_required") return "warning";
  return "passed";
}

function createIssue(params: JtaValidationIssue): JtaValidationIssue {
  return params;
}

function finalizeResult(
  issueDetails: JtaValidationIssue[],
  outcome: JtaValidationOutcome,
  rubric?: JtaValidationRubric,
): JtaValidationResult {
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

function buildRubric(issueDetails: JtaValidationIssue[]): JtaValidationRubric {
  const categories = new Set(issueDetails.map((issue) => issue.category));

  const strategicSpecificityScore: 0 | 1 | 2 =
    categories.has("generic_market_language") || categories.has("generic_consulting_language") || categories.has("meta_strategy_language")
      ? categories.has("generic_market_language") &&
          (categories.has("generic_consulting_language") || categories.has("content_strategy_grounding_weak") || categories.has("meta_strategy_language"))
        ? 0
        : 1
      : 2;

  const dnaAlignmentScore: 0 | 1 | 2 =
    categories.has("dna_alignment_drift") || categories.has("service_framing_drift")
      ? 0
      : categories.has("generic_audience_language")
        ? 1
        : 2;

  const sectionDistinctnessScore: 0 | 1 | 2 =
    categories.has("section_duplication")
      ? 0
      : categories.has("content_strategy_restatement")
        ? 1
        : 2;

  const operationalUsefulnessScore: 0 | 1 | 2 =
    categories.has("kpi_vagueness") && categories.has("tracking_vagueness")
      ? 0
      : categories.has("kpi_vagueness") ||
          categories.has("tracking_vagueness") ||
          categories.has("execution_phase_vagueness") ||
          categories.has("tracking_certainty_unconfirmed") ||
          categories.has("unsupported_tool_mentions") ||
          categories.has("unsupported_paid_ads_scope") ||
          categories.has("unsupported_wellness_claims") ||
          categories.has("weak_hook_language")
        ? 1
        : 2;

  const platformFitScore: 0 | 1 | 2 =
    categories.has("platform_mix_mismatch")
      ? 0
      : categories.has("platform_role_weakness")
        ? 1
        : 2;

  const rubricBase = {
    strategicSpecificity: {
      score: strategicSpecificityScore,
      weight: JTA_RUBRIC_WEIGHTS.strategicSpecificity,
      weightedScore: strategicSpecificityScore * JTA_RUBRIC_WEIGHTS.strategicSpecificity,
      reasons: issueDetails
        .filter((issue) => ["generic_market_language", "generic_consulting_language", "content_strategy_grounding_weak", "meta_strategy_language"].includes(issue.category))
        .map((issue) => issue.message),
    },
    dnaAlignment: {
      score: dnaAlignmentScore,
      weight: JTA_RUBRIC_WEIGHTS.dnaAlignment,
      weightedScore: dnaAlignmentScore * JTA_RUBRIC_WEIGHTS.dnaAlignment,
      reasons: issueDetails
        .filter((issue) => ["dna_alignment_drift", "service_framing_drift", "generic_audience_language"].includes(issue.category))
        .map((issue) => issue.message),
    },
    sectionDistinctness: {
      score: sectionDistinctnessScore,
      weight: JTA_RUBRIC_WEIGHTS.sectionDistinctness,
      weightedScore: sectionDistinctnessScore * JTA_RUBRIC_WEIGHTS.sectionDistinctness,
      reasons: issueDetails
        .filter((issue) => ["section_duplication", "content_strategy_restatement"].includes(issue.category))
        .map((issue) => issue.message),
    },
    operationalUsefulness: {
      score: operationalUsefulnessScore,
      weight: JTA_RUBRIC_WEIGHTS.operationalUsefulness,
      weightedScore: operationalUsefulnessScore * JTA_RUBRIC_WEIGHTS.operationalUsefulness,
      reasons: issueDetails
        .filter((issue) =>
          [
            "kpi_vagueness",
            "tracking_vagueness",
            "execution_phase_vagueness",
            "tracking_certainty_unconfirmed",
            "unsupported_tool_mentions",
            "unsupported_paid_ads_scope",
            "unsupported_wellness_claims",
            "weak_hook_language",
          ].includes(issue.category),
        )
        .map((issue) => issue.message),
    },
    platformFit: {
      score: platformFitScore,
      weight: JTA_RUBRIC_WEIGHTS.platformFit,
      weightedScore: platformFitScore * JTA_RUBRIC_WEIGHTS.platformFit,
      reasons: issueDetails
        .filter((issue) => ["platform_mix_mismatch", "platform_role_weakness"].includes(issue.category))
        .map((issue) => issue.message),
    },
  };

  const totalWeightedScore = Object.values(rubricBase).reduce((sum, item) => sum + item.weightedScore, 0);
  const maxWeightedScore = Object.values(JTA_RUBRIC_WEIGHTS).reduce((sum, weight) => sum + weight * 2, 0);
  return {
    ...rubricBase,
    totalWeightedScore,
    maxWeightedScore,
  };
}

function deriveOutcome(issueDetails: JtaValidationIssue[], rubric?: JtaValidationRubric): JtaValidationOutcome {
  const blockerCount = issueDetails.filter((issue) => issue.severity === "blocker").length;
  if (blockerCount > 0) return "blocker_fail";
  if (!rubric) return issueDetails.length === 0 ? "clean_pass" : "repair_required";

  const warningCategories = new Set(issueDetails.filter((issue) => issue.severity === "warning").map((issue) => issue.category));
  const dimensionsBelowStrong = [
    rubric.strategicSpecificity.score,
    rubric.dnaAlignment.score,
    rubric.sectionDistinctness.score,
    rubric.operationalUsefulness.score,
    rubric.platformFit.score,
  ].filter((score) => score < 2).length;

  if (rubric.sectionDistinctness.score === 0) return "blocker_fail";
  if (rubric.operationalUsefulness.score === 0 && rubric.strategicSpecificity.score === 0) return "blocker_fail";
  if (warningCategories.size >= 6 && rubric.totalWeightedScore <= 16) return "blocker_fail";
  if (rubric.totalWeightedScore <= 13) return "blocker_fail";
  if (warningCategories.size >= 3 && dimensionsBelowStrong >= 2) return "repair_required";
  if (rubric.totalWeightedScore <= 19) return "repair_required";
  return "clean_pass";
}

export function validateJtaStructure(input: {
  canonicalSections?: Record<string, unknown> | null | undefined;
}): JtaValidationResult {
  const sections = input.canonicalSections ?? {};
  const issueDetails = REQUIRED_JTA_SECTION_KEYS.filter((key) => normalizeForComparison(sections[key]).length === 0).map(
    (key) =>
      createIssue({
        category: "structure_missing_section",
        severity: "blocker",
        fields: [`canonicalSections.${key}`],
        message: `Missing canonical section: ${key}.`,
      }),
  );
  return finalizeResult(issueDetails, issueDetails.length === 0 ? "clean_pass" : "blocker_fail");
}

export type JtaProofConstraintsInput = {
  limitations?: string;
  unconfirmedProofTypes?: string[];
};

export function validateJtaSemantics(input: {
  canonicalSections?: Record<string, unknown> | null | undefined;
  businessTypePrimary?: string | null | undefined;
  platforms?: string[] | null | undefined;
  approvedBusinessDnaCategory?: string | null | undefined;
  approvedBusinessDnaAudience?: string[] | null | undefined;
  approvedBusinessDnaPains?: string[] | null | undefined;
  approvedBusinessDnaThemes?: string[] | null | undefined;
  approvedBusinessDnaDifferentiators?: string[] | null | undefined;
  proofConstraints?: JtaProofConstraintsInput | null;
  proofGaps?: string[] | null;
}): JtaValidationResult {
  const sections = input.canonicalSections ?? {};
  const issueDetails: JtaValidationIssue[] = [];

  const marketNarrative = normalizeForComparison(sections.marketNarrative);
  const problemGapSolution = normalizeForComparison(sections.problemGapSolution);
  const brandFoundation = normalizeForComparison(sections.brandFoundation);
  const audience = normalizeForComparison(sections.audience);
  const emotionalDrivers = normalizeForComparison(sections.emotionalDrivers);
  const platformStrategy = normalizeForComparison(sections.platformStrategy);
  const contentStrategy = normalizeForComparison(sections.contentStrategy);
  const kpis = normalizeForComparison(sections.kpis);
  const trackingPlan = normalizeForComparison(sections.trackingPlan);
  const executionPhases = normalizeForComparison(sections.executionPhases);
  const assetRequirements = normalizeForComparison(sections.assetRequirements);
  const rawMarketNarrative = String(sections.marketNarrative ?? "");
  const rawProblemGapSolution = String(sections.problemGapSolution ?? "");
  const rawBrandFoundation = String(sections.brandFoundation ?? "");
  const rawContentStrategy = String(sections.contentStrategy ?? "");

  const sectionPairs: Array<[string, string, string, string]> = [
    ["marketNarrative", marketNarrative, "brandFoundation", brandFoundation],
    ["audience", audience, "emotionalDrivers", emotionalDrivers],
    ["platformStrategy", platformStrategy, "contentStrategy", contentStrategy],
    ["kpis", kpis, "trackingPlan", trackingPlan],
  ];

  let duplicationPairsOverModerate = 0;
  for (const [leftName, left, rightName, right] of sectionPairs) {
    const leftTokens = tokenize(left, { removeStopwords: true });
    const rightTokens = tokenize(right, { removeStopwords: true });
    if (leftTokens.length < 8 || rightTokens.length < 8) continue;
    const similarity = compareSections(left, right);
    if (
      similarity.containment >= 0.75 &&
      (similarity.jaccard >= 0.7 || similarity.bigramOverlap >= 0.55)
    ) {
      issueDetails.push(createIssue({
        category: "section_duplication",
        severity: "blocker",
        fields: [`canonicalSections.${leftName}`, `canonicalSections.${rightName}`],
        message: `Sections ${leftName} and ${rightName} substantially restate each other.`,
        evidence: { comparedSection: leftName, sourceSection: rightName, similarity },
      }));
    } else if (similarity.containment >= 0.55 || similarity.jaccard >= 0.55) {
      duplicationPairsOverModerate += 1;
    }
  }
  if (duplicationPairsOverModerate >= 2) {
    issueDetails.push(createIssue({
      category: "section_duplication",
      severity: "warning",
      fields: ["canonicalSections"],
      message: "Multiple JTA sections appear too similar to each other.",
    }));
  }

  if (
    (input.businessTypePrimary === "service_agency" || input.businessTypePrimary === "saas") &&
    /\bsku\b|\bproduct page\b|\bshopping cart\b|\bstorefront\b|\bcheckout\b/.test(
      `${marketNarrative} ${problemGapSolution} ${contentStrategy}`,
    )
  ) {
    issueDetails.push(createIssue({
      category: "service_framing_drift",
      severity: "blocker",
      fields: ["canonicalSections.marketNarrative", "canonicalSections.problemGapSolution", "canonicalSections.contentStrategy"],
      message: "JTA uses product/ecommerce language for a non-product business type.",
    }));
  }

  const platforms = (input.platforms ?? []).map((platform) => normalizeForComparison(platform)).filter(Boolean);
  if (platforms.length > 0) {
    const mentionedPlatforms = platforms.filter((platform) => mentionsPlatform(platformStrategy, platform));
    const mentionedKnownPlatforms = KNOWN_PLATFORM_TOKENS.filter((platform) => mentionsPlatform(platformStrategy, platform));
    const unapprovedMentions = mentionedKnownPlatforms.filter((platform) => !platforms.includes(platform));
    if (mentionedPlatforms.length === 0) {
      issueDetails.push(createIssue({
        category: "platform_mix_mismatch",
        severity: "blocker",
        fields: ["canonicalSections.platformStrategy"],
        message: "Platform strategy does not reflect the approved platform mix.",
      }));
    } else if (mentionedPlatforms.length < platforms.length || unapprovedMentions.length > 0) {
      issueDetails.push(createIssue({
        category: "platform_mix_mismatch",
        severity: "warning",
        fields: ["canonicalSections.platformStrategy"],
        message: "Platform strategy should stay inside the approved platform mix and cover each approved platform explicitly.",
      }));
    } else if (mentionedPlatforms.some((platform) => !new RegExp(`${platform}.*(?:role|job|used|for|where|because)`).test(platformStrategy))) {
      issueDetails.push(createIssue({
        category: "platform_role_weakness",
        severity: "warning",
        fields: ["canonicalSections.platformStrategy"],
        message: "Platform strategy names approved platforms but does not clearly explain each platform role.",
      }));
    }
  }

  if (
    input.approvedBusinessDnaCategory &&
    normalizeForComparison(input.approvedBusinessDnaCategory).length > 0 &&
    marketNarrative.length > 0 &&
    brandFoundation.length > 0
  ) {
    const categoryTokens = tokenize(normalizeForComparison(input.approvedBusinessDnaCategory), { removeStopwords: true });
    const narrativeTokens = tokenize(`${marketNarrative} ${brandFoundation} ${problemGapSolution}`, { removeStopwords: true });
    const categoryOverlap = tokenOverlapRatio(categoryTokens, narrativeTokens);
    if (categoryTokens.length >= 2 && categoryOverlap < 0.2) {
      issueDetails.push(createIssue({
        category: "dna_alignment_drift",
        severity: "warning",
        fields: ["canonicalSections.marketNarrative", "canonicalSections.brandFoundation"],
        message: "JTA does not clearly reflect the approved Business DNA category in its narrative framing.",
      }));
    }
  }

  if (contentStrategy.includes("caption:") || platformStrategy.includes("caption:")) {
    issueDetails.push(createIssue({
      category: "content_strategy_restatement",
      severity: "blocker",
      fields: ["canonicalSections.contentStrategy", "canonicalSections.platformStrategy"],
      message: "JTA appears to dump raw content/caption text instead of synthesizing strategy.",
    }));
  }

  const genericLanguageHits =
    JTA_GENERIC_PHRASES.filter((phrase) => marketNarrative.includes(phrase) || audience.includes(phrase) || brandFoundation.includes(phrase) || contentStrategy.includes(phrase)).length;
  if (genericLanguageHits >= 2) {
    issueDetails.push(createIssue({
      category: "generic_consulting_language",
      severity: "warning",
      fields: [
        "canonicalSections.marketNarrative",
        "canonicalSections.brandFoundation",
        "canonicalSections.audience",
        "canonicalSections.contentStrategy",
      ],
      message: "JTA uses repeated generic consulting language across core sections.",
    }));
  }

  if (/aligned with/.test(audience) && /shoppers and fans/.test(audience)) {
    issueDetails.push(createIssue({
      category: "audience_fallback_phrase",
      severity: "warning",
      fields: ["canonicalSections.audience"],
      message: "JTA audience appears copied from low-quality fallback phrasing.",
    }));
  }

  const measurableKpiHits = MEASURABLE_KPI_TOKENS.filter((token) => kpis.includes(token)).length;
  if (kpis.length > 0 && measurableKpiHits === 0) {
    issueDetails.push(createIssue({
      category: "kpi_vagueness",
      severity: "warning",
      fields: ["canonicalSections.kpis"],
      message: "KPI section lacks concrete measurable signals.",
    }));
  }

  const trackingHits = TRACKING_TOKENS.filter((token) => trackingPlan.includes(token)).length;
  if (trackingPlan.length > 0 && trackingHits < 2) {
    issueDetails.push(createIssue({
      category: "tracking_vagueness",
      severity: "warning",
      fields: ["canonicalSections.trackingPlan"],
      message: "Tracking plan lacks clear cadence or monitoring logic.",
    }));
  }

  if (executionPhases.length > 0 && !/(phase|month|week|sequence|first|then|next)/.test(executionPhases)) {
    issueDetails.push(createIssue({
      category: "execution_phase_vagueness",
      severity: "warning",
      fields: ["canonicalSections.executionPhases"],
      message: "Execution phases feel too generic and do not show sequencing.",
    }));
  }

  if (
    input.approvedBusinessDnaThemes?.length &&
    input.approvedBusinessDnaThemes.every((theme) => contentStrategy.includes(normalizeForComparison(theme))) &&
    !/(framework|series|programming|cadence|mix|arc|format)/.test(contentStrategy)
  ) {
    issueDetails.push(createIssue({
      category: "content_strategy_restatement",
      severity: "warning",
      fields: ["canonicalSections.contentStrategy"],
      message: "Content strategy appears to restate approved DNA themes without translating them into execution logic.",
    }));
  }

  const mentionsAnalyticsTools = ANALYTICS_TOOL_PATTERNS.some((pattern) => pattern.test(trackingPlan) || pattern.test(kpis));
  if (mentionsAnalyticsTools) {
    issueDetails.push(createIssue({
      category: "unsupported_tool_mentions",
      severity: "warning",
      fields: ["canonicalSections.kpis", "canonicalSections.trackingPlan"],
      message: "KPI or tracking language names analytics tools or instrumentation with more certainty than the approved inputs may support.",
    }));
  }

  if (
    mentionsAnalyticsTools &&
    !CONDITIONAL_TRACKING_PATTERNS.some((pattern) => pattern.test(trackingPlan))
  ) {
    issueDetails.push(createIssue({
      category: "tracking_certainty_unconfirmed",
      severity: "warning",
      fields: ["canonicalSections.trackingPlan"],
      message: 'Tracking plan should use conditional language such as "if available" when tooling or instrumentation is unconfirmed.',
    }));
  }

  if (
    platforms.includes("pinterest") &&
    UNSUPPORTED_PLATFORM_ASSUMPTION_PATTERNS.some((pattern) => pattern.test(platformStrategy))
  ) {
    issueDetails.push(createIssue({
      category: "unsupported_platform_assumption",
      severity: "warning",
      fields: ["canonicalSections.platformStrategy"],
      message: "Platform strategy makes unsupported Pinterest assumptions such as blogs, webinars, inbound calls, or similar long-form engines that are not confirmed by approved inputs.",
    }));
  }

  const proofSectionChecks: Array<[string, string]> = [
    ["canonicalSections.contentStrategy", contentStrategy],
    ["canonicalSections.executionPhases", executionPhases],
    ["canonicalSections.assetRequirements", assetRequirements],
  ];
  const flaggedProofFields = proofSectionChecks
    .filter(([, text]) => sectionHasUnsupportedProofUsage(text))
    .map(([field]) => field);
  const hasDocumentedProofLimits = Boolean(
    input.proofConstraints?.limitations?.trim() ||
      (input.proofConstraints?.unconfirmedProofTypes?.length ?? 0) > 0 ||
      (input.proofGaps?.length ?? 0) > 0,
  );
  if (flaggedProofFields.length > 0) {
    issueDetails.push(createIssue({
      category: "unsupported_proof_asset_assumption",
      severity: hasDocumentedProofLimits ? "blocker" : "warning",
      fields: flaggedProofFields,
      message: hasDocumentedProofLimits
        ? "Proof assets such as testimonials, UGC, reviews, influencer proof, press, certifications, or clinical proof are presented as existing despite documented proof limitations in approved research. Use build/collect/source/request/develop/plan-to-gather framing instead."
        : "Proof assets such as testimonials, case studies, or client success stories are presented too definitively instead of being framed as conditional or assets to collect.",
    }));
  }

  const paidAdsText = [contentStrategy, executionPhases].join(" ");
  if (PAID_AD_PATTERNS.some((pattern) => pattern.test(paidAdsText))) {
    issueDetails.push(createIssue({
      category: "unsupported_paid_ads_scope",
      severity: "warning",
      fields: ["canonicalSections.contentStrategy", "canonicalSections.executionPhases"],
      message: "Paid or performance language appears in the strategy without explicit paid-media scope support.",
    }));
  }

  const wellnessClaimText = [
    problemGapSolution,
    brandFoundation,
    emotionalDrivers,
    contentStrategy,
    executionPhases,
    assetRequirements,
  ].join(" ");
  if (UNSUPPORTED_WELLNESS_CLAIM_PATTERNS.some((pattern) => pattern.test(wellnessClaimText))) {
    issueDetails.push(createIssue({
      category: "unsupported_wellness_claims",
      severity: "warning",
      fields: [
        "canonicalSections.problemGapSolution",
        "canonicalSections.brandFoundation",
        "canonicalSections.emotionalDrivers",
        "canonicalSections.contentStrategy",
      ],
      message: "Wellness, beauty, or health-adjacent language reads like a therapeutic, medical, clinical, or guaranteed claim.",
    }));
  }

  const groundingHits = CONTENT_GROUNDING_TOKENS.filter((token) => contentStrategy.includes(token)).length;
  const platformMentionsInContent = platforms.filter((platform) => contentStrategy.includes(platform)).length;
  const approvedThemeHits =
    input.approvedBusinessDnaThemes?.filter((theme) => contentStrategy.includes(normalizeForComparison(theme))).length ?? 0;
  if (
    contentStrategy.length > 0 &&
    groundingHits < 2 &&
    platformMentionsInContent === 0 &&
    approvedThemeHits === 0
  ) {
    issueDetails.push(createIssue({
      category: "content_strategy_grounding_weak",
      severity: "warning",
      fields: ["canonicalSections.contentStrategy"],
      message: "Content strategy feels too abstract and not clearly grounded in recurring topics, approved DNA themes, or the platform mix.",
    }));
  }
  if (META_STRATEGY_PATTERNS.some((pattern) => pattern.test(contentStrategy))) {
    issueDetails.push(createIssue({
      category: "meta_strategy_language",
      severity: "warning",
      fields: ["canonicalSections.contentStrategy"],
      message: "Content strategy uses internal/meta planning language instead of audience-facing execution guidance.",
    }));
  }
  const genericHookHits = GENERIC_HOOK_PATTERNS.filter((pattern) => pattern.test(contentStrategy)).length;
  if (genericHookHits >= 2) {
    issueDetails.push(createIssue({
      category: "weak_hook_language",
      severity: "warning",
      fields: ["canonicalSections.contentStrategy"],
      message: "Content strategy leans on weak generic hook starters instead of sharper usable hook angles.",
    }));
  }

  if (
    input.approvedBusinessDnaAudience?.length &&
    !input.approvedBusinessDnaAudience.some((segment) => audience.includes(normalizeForComparison(segment).split(" ")[0] ?? ""))
  ) {
    issueDetails.push(createIssue({
      category: "generic_audience_language",
      severity: "warning",
      fields: ["canonicalSections.audience"],
      message: "Audience section feels generic and not clearly grounded in approved DNA audience segments.",
    }));
  }

  if (
    input.approvedBusinessDnaDifferentiators?.length &&
    !input.approvedBusinessDnaDifferentiators.some((entry) => brandFoundation.includes(normalizeForComparison(entry).split(" ")[0] ?? ""))
  ) {
    issueDetails.push(createIssue({
      category: "generic_market_language",
      severity: "warning",
      fields: ["canonicalSections.brandFoundation", "canonicalSections.marketNarrative"],
      message: "Core strategy sections feel generic and do not clearly reflect approved differentiators.",
    }));
  }
  if (
    /\b12 months of real content\b|\baudit(?:ing)?\s+\d+\s+(?:months?|years?)\b|\bproven track record\b|\bindustry recognition\b/.test(brandFoundation) &&
    !(input.approvedBusinessDnaDifferentiators ?? []).some((entry) => brandFoundation.includes(normalizeForComparison(entry)))
  ) {
    issueDetails.push(createIssue({
      category: "brand_foundation_claim_drift",
      severity: "warning",
      fields: ["canonicalSections.brandFoundation"],
      message: "Brand foundation repeats differentiator or proof language that may be stronger than the approved DNA supports.",
    }));
  }

  if (
    marketNarrative.length > 0 &&
    !/\bwhitespace\b|\bfounder\b|\bproof\b|\bpov\b|\bcontent system\b|\bauthority\b|\binbound\b|\bsocial first\b/.test(marketNarrative) &&
    /brand|audience|visibility|growth|presence/.test(marketNarrative)
  ) {
    issueDetails.push(createIssue({
      category: "generic_market_language",
      severity: "warning",
      fields: ["canonicalSections.marketNarrative"],
      message: "Market narrative stays broad and polished but does not yet feel grounded in this brand's actual strategic angle.",
    }));
  }
  if ([rawMarketNarrative, rawProblemGapSolution, rawBrandFoundation, rawContentStrategy].some((value) =>
    REPEATED_PUNCTUATION_PATTERNS.some((pattern) => pattern.test(value)),
  )) {
    issueDetails.push(createIssue({
      category: "punctuation_polish",
      severity: "warning",
      fields: [
        "canonicalSections.marketNarrative",
        "canonicalSections.problemGapSolution",
        "canonicalSections.brandFoundation",
        "canonicalSections.contentStrategy",
      ],
      message: "One or more strategy sections contain repeated punctuation and need a light copy-polish pass.",
    }));
  }

  const rubric = buildRubric(issueDetails);
  const outcome = deriveOutcome(issueDetails, rubric);
  return finalizeResult(issueDetails, outcome, rubric);
}

export function buildJtaRepairPromptInput(
  result: {
    ok?: boolean;
    status?: JtaValidationStatus;
    issues: string[];
    issueDetails?: JtaValidationIssue[];
  },
): string {
  const lines = buildJtaRepairInstructionLines(result);
  if (lines.length === 0) {
    return "No repair issues were identified.";
  }
  return [
    "Repair the Jump-to-Action JSON using these rules:",
    "- Preserve valid sections unchanged.",
    "- Rewrite only the flagged sections.",
    "- Keep the exact canonicalSections keys and strict JSON shape.",
    "- Use approved Business DNA and approved SOW inputs only.",
    "- Do not copy raw source text or weaken already-strong sections.",
    "- Targeted repair instructions:",
    `- ${lines.join("\n- ")}`,
  ].join("\n");
}

export function buildJtaRepairInstructionLines(
  result: {
    ok?: boolean;
    status?: JtaValidationStatus;
    issues: string[];
    issueDetails?: JtaValidationIssue[];
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
      case "structure_missing_section":
        lines.push(`Fill the missing section(s) ${issue.fields.join(", ")} and preserve all valid sections unchanged.`);
        break;
      case "section_duplication":
        lines.push("Rewrite only the overlapping canonical sections so each section has a distinct job and does not restate another.");
        break;
      case "generic_market_language":
        lines.push("Rewrite marketNarrative and brandFoundation only: add market-specific logic and approved differentiator framing.");
        break;
      case "generic_audience_language":
      case "audience_fallback_phrase":
        lines.push("Rewrite audience and emotionalDrivers only: ground them in approved DNA pains, desires, and objections.");
        break;
      case "platform_role_weakness":
      case "platform_mix_mismatch":
        lines.push("Rewrite platformStrategy only: cover approved platforms only and give each platform a distinct role and reason.");
        break;
      case "content_strategy_restatement":
        lines.push("Rewrite contentStrategy only: translate approved DNA into audience-facing content moves instead of repeating themes, captions, or lists.");
        break;
      case "content_strategy_grounding_weak":
        lines.push("Rewrite contentStrategy only: ground it more clearly in recurring topics, approved DNA themes, and the approved platform mix.");
        break;
      case "meta_strategy_language":
        lines.push("Rewrite contentStrategy only: remove internal planning language and use audience-facing, platform-specific execution guidance.");
        break;
      case "weak_hook_language":
        lines.push("Rewrite contentStrategy only: add sharper, usable hook angles tied to recurring topics and the brand stance instead of generic starters.");
        break;
      case "brand_foundation_claim_drift":
        lines.push("Rewrite brandFoundation only: remove unsupported differentiator or proof claims and keep the framing aligned to approved DNA evidence.");
        break;
      case "unsupported_platform_assumption":
        lines.push("Rewrite platformStrategy only: remove unsupported assumptions such as blogs, webinars, inbound calls, or similar platform jobs unless the approved inputs explicitly support them.");
        break;
      case "unsupported_proof_asset_assumption":
        lines.push("Rewrite contentStrategy, executionPhases, and assetRequirements only: frame proof assets like testimonials, case studies, or success stories as conditional or assets to collect unless the approved inputs confirm them.");
        break;
      case "unsupported_paid_ads_scope":
        lines.push("Rewrite contentStrategy and executionPhases only: remove CAC, customer acquisition cost, campaign setup, targeting, pixels, retargeting, paid advertising, or paid optimization unless approved inputs explicitly put paid media in scope.");
        break;
      case "unsupported_wellness_claims":
        lines.push("Rewrite problemGapSolution, brandFoundation, emotionalDrivers, and contentStrategy only: frame wellness, beauty, skincare, fragrance, or health-adjacent benefits as positioning, ritual, sensory, self-care, or perceived experience; remove therapeutic certainty, medical guarantees, treatment, cure, clinical proof, or expert endorsement unless explicitly supported.");
        break;
      case "punctuation_polish":
        lines.push("Rewrite only the flagged section copy with clean punctuation while preserving the strategy and section structure.");
        break;
      case "kpi_vagueness":
        lines.push("Rewrite kpis only: add measurable signals and outcomes instead of generic growth language.");
        break;
      case "tracking_vagueness":
        lines.push("Rewrite trackingPlan only: add cadence, breakdown, and monitoring logic.");
        break;
      case "unsupported_tool_mentions":
        lines.push("Rewrite kpis and trackingPlan only: remove unsupported tool certainty unless the approved inputs explicitly confirm the tooling.");
        break;
      case "tracking_certainty_unconfirmed":
        lines.push('Rewrite trackingPlan only: use conditional wording such as "if available" where tooling or instrumentation is unconfirmed.');
        break;
      case "execution_phase_vagueness":
        lines.push("Rewrite executionPhases only: tie phases to real sequencing, scope, and deliverables.");
        break;
      case "dna_alignment_drift":
        lines.push("Rewrite the flagged narrative sections only so they clearly reflect the approved DNA category, audience, and differentiation.");
        break;
      case "service_framing_drift":
        lines.push("Rewrite the flagged sections only: remove product or ecommerce framing and use service-appropriate language.");
        break;
      case "generic_consulting_language":
        lines.push("Rewrite the flagged generic sections with sharper, client-specific strategy language while preserving any strong sections.");
        break;
      default:
        lines.push(issue.message);
        break;
    }
  }
  return lines.length > 0 ? lines : result.issues;
}
