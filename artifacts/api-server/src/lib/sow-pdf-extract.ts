/**
 * Extract SOW from proposal text: (1) classic "Understanding" + "Scope" pair, or
 * (2) Svara-style Roman I–VIII sections.
 */
import type { SowParseMeta, SowSectionMapEntry } from "./sow-canonical.js";
import { buildLegacyScopeFromV2, SOW_VERSION_LATEST } from "./sow-canonical.js";
import {
  extractClassicUnderstandingBullets,
  extractRomanIndustryFromSectionI,
  extractRomanTargetAudience,
  isJunkAutofillIndustry,
} from "./sow-field-qualify.js";

const SCOPE_START =
  String.raw`(?:Scope of Work \(SOW\)|Strategy\s*[&\u0026]?\s*Launch Planning|Strategy and Launch Planning)`;
/** After "1. Understanding": SOW header or a commercial block if scope heading is missing. */
const RE_CLASSIC_AFTER_UNDERSTANDING = new RegExp(
  String.raw`\n\s*(?:(?:(?:\d+[.)]\s*)?` + SCOPE_START + String.raw`)|(?:(?:3[.)]\s*)?Pricing Options|3\.\s*Pricing|(?:4[.)]\s*)?Timeline|Payment Terms|Next Steps))`,
  "i",
);

/** Heading → alias group for UI badges and classifiers. */
export const SOW_HEADING_ALIASES: Record<string, string[]> = {
  understanding: [
    "Understanding of Requirements",
    "Understanding of requirements",
    "Background",
    "Objectives",
    "1.",
    "1)",
  ],
  scope: ["Scope of Work (SOW)", "Scope of Work", "2.", "III."],
  deliverables: ["Monthly Deliverables", "Content deliverables", "Content Creation", "II."],
  commercial: [
    "Costing & Payment",
    "Costing and Payment",
    "Pricing Options",
    "Payment Terms",
    "Investment",
    "Retainer",
    "VI.",
    "Commercial",
  ],
  timeline: ["Timeline & Process", "Timeline and Process", "Milestones", "V.", "Next Steps"],
};

const PAGE_MARKER = /--\s*\d+\s*of\s*\d+\s*--/gi;
const LOOSE_PRICING_BLOCK = new RegExp(
  String.raw`(?:\n\s*){1,2}(?:\d+[\.)]\s*)?(?:Pricing|Payment|Next\s*Steps|Terms\s*[&\u0026]\s*Conditions?|Invoice|GST)\b[\s\S]*$`,
  "i",
);

/** Split trailing commercial / pricing from scope-like text. */
export function splitTrailingCommercialFromScope(text: string): { main: string; commercial: string } {
  const t = text.trim();
  if (!t) return { main: "", commercial: "" };
  const m = t.match(LOOSE_PRICING_BLOCK);
  if (m?.index != null) {
    const head = t.slice(0, m.index).trim();
    const commercial = t.slice(m.index).trim();
    if (head.length > 40 && /(?:fee|retainer|lakh|INR|USD|₹|payment|invoice|\d{2,}\s*%\s*advance)/i.test(commercial)) {
      return { main: head, commercial };
    }
  }
  return { main: t, commercial: "" };
}

/** Normalize PDF quirks: newlines, dashes, page markers. */
export function normalizeSowPdfTextForExtraction(text: string): string {
  let t = text.replace(/\r\n?/g, "\n").replace(/[\u2013\u2014\u2212]/g, "-");
  t = t.replace(PAGE_MARKER, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function stripSowProposalHeader(text: string): string {
  let t = normalizeSowPdfTextForExtraction(text);
  // Remove leading title block before first real section heading (classic)
  t = t.replace(
    /^[\s\S]*?(?=(?:\n\s*)(?:Understanding of Requirements|Scope of Work \(SOW\)))/i,
    "\n",
  );
  // Title-only first line (e.g. "Scope of Work (SOW) - Svara (Social Media + Meta Ads)")
  t = t.replace(
    /^(?:Scope of Work \(SOW\)[^\n]*|SOCIAL MEDIA[ \S]*PROPOSAL|Client:\s*[^\n]+|Prepared by:\s*[^\n]+|Date:\s*[^\n]+)\s*\n?/gim,
    "",
  );
  t = t.replace(
    /^(?:SOCIAL MEDIA[ \S]*PROPOSAL|Client:\s*[^\n]+|Prepared by:\s*[^\n]+|Date:\s*[^\n]+)\s*/gim,
    "",
  );
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Roman section labels I.–VIII. (Svara and similar SOWs). */
const ROMAN_I_TO_VIII = String.raw`I{1,3}|IV|V|VI{1,2}|VIII?`;
const ROMAN_HEADING_RE = new RegExp(
  String.raw`(?:^|\n)\s*(${ROMAN_I_TO_VIII})\s*[\.\)]\s*([^\n]*)`,
  "gim",
);

export type RomanKey = "I" | "II" | "III" | "IV" | "V" | "VI" | "VII" | "VIII";

function normalizeRomanToken(raw: string): RomanKey | null {
  const u = raw.trim().toUpperCase();
  if (
    u === "I" ||
    u === "II" ||
    u === "III" ||
    u === "IV" ||
    u === "V" ||
    u === "VI" ||
    u === "VII" ||
    u === "VIII"
  ) {
    return u as RomanKey;
  }
  return null;
}

/**
 * Parse body text into I–VIII sections. Skips prologue before first I.
 */
export function parseRomanSectionsIThroughVIII(
  text: string,
): { sections: Partial<Record<RomanKey, string>>; firstHeadingLine: string } {
  const t = normalizeSowPdfTextForExtraction(text);
  const matches: { key: RomanKey; title: string; index: number; fullMatchLen: number }[] = [];
  ROMAN_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROMAN_HEADING_RE.exec(t)) !== null) {
    const key = normalizeRomanToken(m[1] ?? "");
    if (!key) continue;
    matches.push({
      key,
      title: (m[2] ?? "").trim(),
      index: m.index!,
      fullMatchLen: m[0].length,
    });
  }
  if (matches.length === 0) {
    return { sections: {}, firstHeadingLine: "" };
  }
  const sections: Partial<Record<RomanKey, string>> = {};
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]!;
    const start = cur.index + cur.fullMatchLen;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : t.length;
    const body = t.slice(start, end).replace(/^\s*\n+/, "").replace(/\n+\s*$/, "").trim();
    const sectionText = (cur.title ? `${cur.key}. ${cur.title}\n` : `${cur.key}.\n`) + body;
    if (!sections[cur.key] || (sections[cur.key]!.length < sectionText.length)) {
      sections[cur.key] = sectionText;
    }
  }
  const first = matches[0]!;
  const firstHeadingLine = `${first.key}. ${first.title}`.trim();
  return { sections, firstHeadingLine };
}

/** If boilerplate (cover, H1) precedes the first Roman section, drop it so I. is found reliably. */
function stripBoilerplateBeforeFirstRomanHeading(t: string): string {
  ROMAN_HEADING_RE.lastIndex = 0;
  const m = ROMAN_HEADING_RE.exec(t);
  if (!m || m.index == null) return t;
  if (m.index > 50) {
    return t.slice(m.index).replace(/^\s+/, "");
  }
  return t;
}

function hasRomanSowShape(text: string): boolean {
  const { sections } = parseRomanSectionsIThroughVIII(text);
  return Boolean(sections.I || sections.II) && Object.keys(sections).length >= 1;
}

export type ExtractSowWithParseResult = {
  understandingOfRequirements: string;
  /** Legacy: combined view for API routes; v2 also sets strategy + content split. */
  scopeOfWork: string;
  industry: string;
  targetAudience: string;
  sectionDeliverablesBlob: string;
  operationalBlob: string;
  parseWarnings: string[];
  mode: "roman" | "classic";
  /** Raw section bodies keyed by Roman numeral (Svara I–VIII) when `mode` is "roman". */
  structuredSections: Record<string, string>;
  /** Canonical v2 */
  strategyLaunchPlanning: string;
  contentCreation: string;
  excludedCommercial: string;
  normalizedSections: Record<string, string>;
  parseMeta: SowParseMeta;
  sowVersion: typeof SOW_VERSION_LATEST;
};

/**
 * Map Roman sections to app fields. VI (costing) is never merged into product copy.
 * Shared by onboard and POST /sow/pdf-parse.
 */
function romanSectionMap(sections: Partial<Record<RomanKey, string>>): Partial<Record<string, SowSectionMapEntry>> {
  const m: Partial<Record<string, SowSectionMapEntry>> = {};
  const partsUor = [sections.I && "I", sections.III && "III", sections.IV && "IV"].filter(Boolean);
  if (partsUor.length) {
    m.understandingOfRequirements = {
      sourceLabel: `Mapped from ${partsUor.join(", ")} (Objectives, Scope, Client deliverables)`,
      confidence: 0.88,
    };
  }
  if (sections.II || sections.IV) {
    m.contentCreation = {
      sourceLabel: `Mapped from ${[sections.II && "II", sections.IV && "IV"].filter(Boolean).join(", ")}`,
      confidence: 0.88,
    };
  }
  const strat = [sections.V && "V", sections.VII && "VII", sections.VIII && "VIII"].filter(Boolean);
  if (strat.length) {
    m.strategyLaunchPlanning = {
      sourceLabel: `Mapped from ${strat.join(", ")} (Timeline, Outcomes, Approval)`,
      confidence: 0.88,
    };
  }
  if (sections.VI) {
    m.excludedCommercial = { sourceLabel: "VI. Costing & Payment (stored separately)", confidence: 0.95 };
  }
  return m;
}

export function mapRomanSectionsToSowFields(sections: Partial<Record<RomanKey, string>>): {
  understandingOfRequirements: string;
  scopeOfWork: string;
  industry: string;
  targetAudience: string;
  sectionDeliverablesBlob: string;
  parseWarnings: string[];
  strategyLaunchPlanning: string;
  contentCreation: string;
  excludedCommercial: string;
  sectionMap: Partial<Record<string, SowSectionMapEntry>>;
} {
  const warnings: string[] = [];
  const get = (k: RomanKey) => (sections[k] ?? "").trim();
  if (!get("I") && !get("III")) {
    warnings.push("Missing section I and III; objectives/scope may be thin.");
  }
  if (!get("V") && !get("VII") && !get("VIII")) {
    warnings.push("No sections V, VII, or VIII found; strategy and launch block may be empty.");
  }
  if (!get("II")) {
    warnings.push("Section II (monthly deliverables) not found; content counts may be inferred only.");
  }

  const uorParts: string[] = [get("I"), get("III"), get("IV")].filter(Boolean);
  const uor = uorParts.join("\n\n").trim();
  const strategyParts: string[] = [get("V"), get("VII"), get("VIII")].filter(Boolean);
  const strategyLaunchPlanning = strategyParts.join("\n\n").trim();
  const sectionDeliverablesBlob = [get("II"), get("IV")].filter(Boolean).join("\n\n").trim();
  const contentCreation = sectionDeliverablesBlob;
  const excludedCommercial = get("VI");
  const scopeOfWork = buildLegacyScopeFromV2({ strategyLaunchPlanning, contentCreation });
  if (get("VI")) {
    warnings.push("Section VI (commercial/legal) was captured separately — not merged into strategy fields.");
  }

  const objText = get("I");
  const iiiText = get("III");
  const ivText = get("IV");
  const titleIndustry = objText.match(
    /(?:industry|sector|space|e-?commerce|D2C|B2B|retail|fashion|beauty|tech)(?:[:\s]+)([^\n.]{2,100})/i,
  );
  let industry = titleIndustry?.[1] ? titleIndustry[1]!.replace(/\s+/g, " ").trim() : "";
  if (industry && isJunkAutofillIndustry(industry)) industry = "";
  if (!industry) {
    industry = extractRomanIndustryFromSectionI(objText);
  }
  if (!industry) {
    warnings.push("Industry could not be derived from section I with confidence; left blank.");
  }

  let targetAudience = extractRomanTargetAudience(objText, iiiText, ivText);
  if (!targetAudience) {
    warnings.push("Target audience could not be derived with confidence; left blank.");
  }

  return {
    understandingOfRequirements: uor,
    scopeOfWork,
    industry,
    targetAudience,
    sectionDeliverablesBlob,
    parseWarnings: warnings,
    strategyLaunchPlanning,
    contentCreation,
    excludedCommercial,
    sectionMap: romanSectionMap(sections),
  };
}

/**
 * One entry point: classic headings or Roman I–VIII; always returns `parseWarnings` and merged blobs
 * for `inferOperationalDefaultsFromSowText`.
 */
function structuredSectionsFromRoman(
  sections: Partial<Record<RomanKey, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(sections) as RomanKey[]) {
    if (k === "VI" || k === "VIII") continue;
    const v = sections[k];
    if (v && String(v).trim()) out[k] = String(v).trim();
  }
  return out;
}

export function extractSowTextWithMetadata(rawText: string): ExtractSowWithParseResult {
  const normalizedRaw = normalizeSowPdfTextForExtraction(rawText);
  let norm = stripSowProposalHeader(normalizedRaw);
  norm = stripBoilerplateBeforeFirstRomanHeading(norm);
  if (hasRomanSowShape(norm) || hasRomanSowShape(normalizedRaw)) {
    const source = hasRomanSowShape(norm) ? norm : stripBoilerplateBeforeFirstRomanHeading(stripSowProposalHeader(normalizedRaw));
    const { sections, firstHeadingLine } = parseRomanSectionsIThroughVIII(source);
    const mapped = mapRomanSectionsToSowFields(sections);
    const operationalBlob = [
      mapped.understandingOfRequirements,
      sections.II,
      sections.III,
      sections.IV,
    ]
      .filter(Boolean)
      .join("\n\n");
    const w = [...mapped.parseWarnings];
    if (firstHeadingLine) {
      if (!/objectives?|goals?|monthly|deliverable/i.test(firstHeadingLine)) {
        w.push("Unexpected first section title; confirm PDF layout.");
      }
    }
    const sectionMap: Partial<Record<string, SowSectionMapEntry>> = { ...mapped.sectionMap };
    const parseMeta: SowParseMeta = {
      mode: "roman",
      warnings: w,
      sectionMap,
      parseConfidence: 0.85,
    };
    return {
      mode: "roman",
      understandingOfRequirements: mapped.understandingOfRequirements,
      scopeOfWork: mapped.scopeOfWork,
      industry: mapped.industry,
      targetAudience: mapped.targetAudience,
      sectionDeliverablesBlob: mapped.sectionDeliverablesBlob,
      operationalBlob: operationalBlob || source.slice(0, 4000),
      parseWarnings: w,
      structuredSections: structuredSectionsFromRoman(sections),
      strategyLaunchPlanning: mapped.strategyLaunchPlanning,
      contentCreation: mapped.contentCreation,
      excludedCommercial: mapped.excludedCommercial,
      normalizedSections: buildNormalizedRomanSections({
        sections,
        industry: mapped.industry,
        targetAudience: mapped.targetAudience,
      }),
      parseMeta,
      sowVersion: SOW_VERSION_LATEST,
    };
  }
  const {
    understandingOfRequirements,
    scopeOfWork: rawScope,
    usedFallbackSplit,
    extractedCommercial: numberedCommercial,
  } = extractSowSectionsOneAndTwo(normalizedRaw);
  const { main: scopeMain, commercial: excludedFromScope } = splitTrailingCommercialFromScope(rawScope);
  const { strategyLaunchPlanning: slBlock, contentCreation: ccBlock } = splitClassicScopeV2Blocks(scopeMain);
  const strategyLaunchPlanning = (slBlock || scopeMain).trim();
  const contentCreation = (ccBlock || "").trim();
  const scopeOfWork = buildLegacyScopeFromV2({ strategyLaunchPlanning, contentCreation }) || strategyLaunchPlanning;
  const bulletExtract = extractClassicUnderstandingBullets(understandingOfRequirements);
  const industry = bulletExtract.industry;
  const targetAudience = bulletExtract.targetAudience;
  const w: string[] = [];
  if (!industry) {
    w.push("Classic: industry not found on explicit “Industry:” / bullet lines; left blank.");
  }
  if (!targetAudience) {
    w.push("Classic: target audience not found on explicit “Target audience:” lines; left blank.");
  }
  const excludedCommercial = [numberedCommercial, excludedFromScope].filter(Boolean).join("\n\n").trim();
  const blob = [understandingOfRequirements, scopeMain || rawScope].join("\n\n");
  if (!understandingOfRequirements) w.push("No 'Understanding of Requirements' block found.");
  if (!rawScope) w.push("No 'Scope of Work' block found.");
  if (usedFallbackSplit) {
    w.push("Unverified split: headings were missing; text was split by length. Review and edit carefully.");
  }
  if (excludedCommercial) {
    w.push("Trailing pricing / payment block moved to the commercial (excluded) section.");
  }
  const mode: "classic" = "classic";
  const classicStructured: Record<string, string> = {};
  if (understandingOfRequirements.trim()) {
    classicStructured.understandingOfRequirements = understandingOfRequirements.trim();
  }
  if (rawScope.trim()) {
    classicStructured.scopeOfWork = (scopeMain || rawScope).trim();
  }
  const clMap: Partial<Record<string, SowSectionMapEntry>> = {
    understandingOfRequirements: { sourceLabel: "Understanding of Requirements", confidence: 0.72 },
    strategyLaunchPlanning: { sourceLabel: "Scope of Work (SOW) — narrative", confidence: 0.7 },
  };
  if (excludedCommercial) {
    clMap.excludedCommercial = { sourceLabel: "Trailing commercial / pricing (split)", confidence: 0.55 };
  }
  const parseMeta: SowParseMeta = {
    mode,
    warnings: w,
    sectionMap: clMap,
    parseConfidence: usedFallbackSplit ? 0.35 : excludedCommercial ? 0.62 : 0.7,
    usedFallbackSplit,
  };
  return {
    mode,
    understandingOfRequirements,
    scopeOfWork,
    industry,
    targetAudience,
    sectionDeliverablesBlob: scopeMain || rawScope,
    operationalBlob: blob,
    parseWarnings: w,
    structuredSections: classicStructured,
    strategyLaunchPlanning,
    contentCreation,
    excludedCommercial,
    normalizedSections: buildNormalizedClassicSections({
      industry,
      targetAudience,
      understandingOfRequirements,
      strategyLaunchPlanning,
      contentCreation,
      scopeOfWork: scopeMain || rawScope,
    }),
    parseMeta,
    sowVersion: SOW_VERSION_LATEST,
  };
}

function buildNormalizedRomanSections(input: {
  sections: Partial<Record<RomanKey, string>>;
  industry: string;
  targetAudience: string;
}): Record<string, string> {
  const i = (key: RomanKey) => String(input.sections[key] ?? "").trim();
  const ii = i("II");
  const iii = i("III");
  const iv = i("IV");
  const v = i("V");
  const vii = i("VII");
  return compactObject({
    industry: input.industry,
    brandPositioning: summarizeRelevantLines([i("I")], /(premium|brand|category|position|market|wellness|luxury|d2c|b2b)/i, 3),
    objectivesAndGoals: summarizeRelevantLines([i("I")], /(goal|objective|drive|build|establish|increase|strengthen|scale|sales|roas|awareness)/i, 5),
    targetAudience: input.targetAudience,
    scopeOfWork: summarizeRelevantLines([iii], /(scope|strategy|planning|management|content|report|optimization|calendar|creative)/i, 5),
    strategyLaunchPlanning: summarizeRelevantLines([iii, v], /(strategy|launch|planning|calendar|process|go live|onboarding|approval|week|timeline)/i, 5),
    contentCreationScope: summarizeRelevantLines([ii, iii], /(reel|carousel|static|story|content|creative|caption|video|ugc|copywriting)/i, 6),
    paidMediaAdsScope: summarizeRelevantLines([ii, iii], /(meta|ads?|campaign|retarget|pixel|audience targeting|lookalike|roas|cpa|aov|budget)/i, 5),
    reportingOptimizationScope: summarizeRelevantLines([ii, iii], /(report|optimization|performance|insights|analysis|review|roas|cpa|aov|monitoring)/i, 5),
    monthlyDeliverables: summarizeRelevantLines([ii], /(deliverable|reel|carousel|static|story|report|month|weekly)/i, 6),
    clientResponsibilities: summarizeRelevantLines([iv], /(provide|share|access|approval|feedback|asset|account|website|manager|coordination)/i, 6),
    timelineMilestones: summarizeRelevantLines([v], /(week|day|timeline|onboarding|go live|ongoing|review|approval)/i, 6),
    expectedOutcomes: summarizeRelevantLines([vii], /(outcome|roas|conversion|sales|growth|recall|purchase|ecosystem)/i, 5),
  });
}

function buildNormalizedClassicSections(input: {
  industry: string;
  targetAudience: string;
  understandingOfRequirements: string;
  strategyLaunchPlanning: string;
  contentCreation: string;
  scopeOfWork: string;
}): Record<string, string> {
  return compactObject({
    industry: input.industry,
    brandPositioning: summarizeRelevantLines([input.understandingOfRequirements], /(premium|brand|position|market|category|d2c|b2b)/i, 3),
    objectivesAndGoals: summarizeRelevantLines([input.understandingOfRequirements], /(goal|objective|drive|increase|build|launch|measure|success)/i, 5),
    targetAudience: input.targetAudience,
    scopeOfWork: summarizeRelevantLines([input.scopeOfWork], /(scope|strategy|planning|management|content|report|optimization|calendar)/i, 5),
    strategyLaunchPlanning: summarizeRelevantLines([input.strategyLaunchPlanning], /(strategy|launch|planning|process|timeline|week|approval)/i, 5),
    contentCreationScope: summarizeRelevantLines([input.contentCreation || input.scopeOfWork], /(reel|carousel|static|story|content|creative|caption|video|ugc)/i, 6),
    monthlyDeliverables: summarizeRelevantLines([input.contentCreation || input.scopeOfWork], /(deliverable|month|weekly|reel|carousel|story|post)/i, 6),
  });
}

function summarizeRelevantLines(inputs: string[], matcher: RegExp, maxLines: number): string {
  const lines = inputs
    .flatMap((value) => toMeaningfulLines(value))
    .filter((line) => matcher.test(line));
  const fallback = inputs.flatMap((value) => toMeaningfulLines(value));
  const picked = (lines.length > 0 ? lines : fallback).slice(0, maxLines);
  return dedupeAndJoin(picked);
}

function toMeaningfulLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.replace(/^[\s\-•*○]+/, "").trim())
    .filter((line) => line.length >= 4)
    .filter((line) => !/^(prepared by|date:|client:|approval|by,|founder)/i.test(line))
    .filter((line) => !/(pricing|payment|retainer|costing|quotation|gst|invoice)/i.test(line));
}

function dedupeAndJoin(lines: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(line);
  }
  return unique.join("\n");
}

function compactObject(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => String(value ?? "").trim().length > 0),
  );
}

function extractBetween(
  full: string,
  start: RegExp,
  until: RegExp,
): string {
  const m = full.match(start);
  if (!m) return "";
  const idx = m.index! + m[0].length;
  const rest = full.slice(idx);
  const end = rest.search(until);
  const body = end === -1 ? rest : rest.slice(0, end);
  return body.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "").trim();
}

/**
 * Numbered "1. Understanding" / "2. Scope" proposals (e.g. Reflkt) — UOR is strictly section 1,
 * scope is section 2; commercial blocks start at "3. Pricing" / Pricing Options / etc.
 */
function tryExtractClassNumberedUorAndScope(
  t: string,
): { uor: string; scope: string; commercial: string; kind: "numbered" } | null {
  const hUor = /(?:^|\n)\s*(?:1[\.\)]\s*)?Understanding of Requirements\s*(?:\n|:)?/i;
  const m1 = hUor.exec(t);
  if (!m1) return null;
  // No trailing \b: ")" and newline are both non-word chars, so \b would never match before \n.
  const reScopeH = /\n\s*(?:2[\.\)]\s*)?Scope of Work \(SOW\)(?=\s|:|\n|$)/i;
  const m2 = reScopeH.exec(t);
  if (!m2 || m2.index === undefined) return null;
  if (m2.index < m1.index! + m1[0].length - 1) return null;
  const uorBody = t.slice(m1.index! + m1[0].length, m2.index).trim();
  if (uorBody.length < 3) return null;
  const afterScopeLine = t.slice(m2.index! + m2[0].length);
  const mComm = afterScopeLine.search(
    /(?:\n|^)\s*(?:3[\.\)]\s*)?Pricing Options\b|(?:\n|^)\s*3\.\s*Pricing|(?:\n|^)\s*(?:4[\.\)]\s*)?Timeline\b|(?:\n|^)\s*(?:5[\.\)]\s*)?Payment Terms\b|(?:\n|^)\s*(?:6[\.\)]\s*)?Next Steps\b/i,
  );
  const scope = (mComm === -1 ? afterScopeLine : afterScopeLine.slice(0, mComm)).trim();
  const commercial = mComm === -1 ? "" : afterScopeLine.slice(mComm).trim();
  if (!scope) return null;
  return { uor: uorBody, scope, commercial, kind: "numbered" };
}

/** Split "2. Scope" body: A. Strategy & Launch → strategyLaunchPlanning; B. … through D. → contentCreation. */
function splitClassicScopeV2Blocks(scope: string): { strategyLaunchPlanning: string; contentCreation: string } {
  const t = scope.trim();
  if (!/\bA\.\s*Strategy/i.test(t) || !/\bB\.\s*Content Creation\b/i.test(t)) {
    return { strategyLaunchPlanning: t, contentCreation: "" };
  }
  const mA = t.match(
    /A\.\s*Strategy\s*(?:&|and)\s*Launch Planning\s*([\s\S]*?)(?=\n\s*B\.\s*Content Creation\b)/i,
  );
  if (mA?.[1]) {
    const rest = t.slice(t.search(/\bB\.\s*Content Creation\b/i));
    return {
      strategyLaunchPlanning: mA[1].trim(),
      contentCreation: rest.replace(/^\s*B\.\s*Content Creation\s*/i, "").trim(),
    };
  }
  const splitB = t.split(/\bB\.\s*Content Creation\b/i);
  return {
    strategyLaunchPlanning: (splitB[0] ?? "").replace(/\bA\.\s*Strategy\s*(?:&|and)\s*Launch Planning\s*/i, "").trim(),
    contentCreation: (splitB[1] ?? "").trim(),
  };
}

export function extractSowSectionsOneAndTwo(rawText: string): {
  understandingOfRequirements: string;
  scopeOfWork: string;
  usedFallbackSplit: boolean;
  extractedCommercial?: string;
} {
  const normalized = stripSowProposalHeader(rawText);
  const numbered = tryExtractClassNumberedUorAndScope(normalized);
  if (numbered) {
    return {
      understandingOfRequirements: numbered.uor,
      scopeOfWork: numbered.scope,
      usedFallbackSplit: false,
      extractedCommercial: numbered.commercial.trim() || undefined,
    };
  }
  let uor = extractBetween(
    normalized,
    /Understanding of Requirements\s*(?:\n|:)?/i,
    RE_CLASSIC_AFTER_UNDERSTANDING,
  );
  if (!uor) {
    uor = extractBetween(normalized, /Understanding of Requirements/i, RE_CLASSIC_AFTER_UNDERSTANDING);
  }
  const sow = extractBetween(
    normalized,
    new RegExp(`(?:^|\\n)\\s*(?:\\d+[\\.\\)]\\s*)?${SCOPE_START}\\s*(?:\\n|:)?`, "i"),
    new RegExp(
      `\\n\\s*(?:(?:3[\\.\\)]\\s*)?Pricing Options|3\\.\\s*Pricing|(?:4[\\.\\)]\\s*)?Timeline|Payment Terms|Next Steps)`,
      "i",
    ),
  );
  if (uor && sow) {
    return { understandingOfRequirements: uor, scopeOfWork: sow, usedFallbackSplit: false };
  }
  if (uor && !sow) {
    const parts = normalized.split(new RegExp(`(?:^|\\n)\\s*(?:\\d+[\\.\\)]\\s*)?${SCOPE_START}`, "i"));
    if (parts.length > 1) {
      const raw = (parts[1] ?? "").replace(/^\s*:\s*/i, "").trim();
      const scopeBody = raw.split(/\n+(?=Pricing|Timeline|Payment|Next)\b/i)[0] ?? raw;
      return { understandingOfRequirements: uor, scopeOfWork: scopeBody.trim(), usedFallbackSplit: false };
    }
  }
  return fallbackTwoPartExtraction(normalized);
}

/**
 * If headings are missing, split on length so we never return an empty SOW.
 */
function fallbackTwoPartExtraction(
  t: string,
): { understandingOfRequirements: string; scopeOfWork: string; usedFallbackSplit: boolean } {
  const s = t.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length < 120) {
    return { understandingOfRequirements: s, scopeOfWork: s, usedFallbackSplit: true };
  }
  const cut = Math.max(200, Math.floor(s.length * 0.45));
  return {
    understandingOfRequirements: s.slice(0, cut).trim(),
    scopeOfWork: s.slice(cut).trim() || s.slice(-Math.min(2000, s.length)).trim(),
    usedFallbackSplit: true,
  };
}

/**
 * Heuristic counts from SOW text for platforms / monthly / pillar counts (not from sections 3–6).
 */
export function inferOperationalDefaultsFromSowText(blob: string): {
  platforms: string[];
  monthlyPosts: Record<string, number>;
  contentMix: Record<string, number>;
  deliverables: string[];
  toneByPlatform: Record<string, string>;
} {
  const platforms: string[] = [];
  if (/\bInstagram\b/i.test(blob) && !platforms.includes("Instagram")) platforms.push("Instagram");
  if (/\bPinterest\b/i.test(blob) && !platforms.includes("Pinterest")) platforms.push("Pinterest");
  if (/\bLinkedIn\b/i.test(blob) && !platforms.includes("LinkedIn")) platforms.push("LinkedIn");
  if (/\bX\b|Twitter/i.test(blob) && !platforms.includes("X")) platforms.push("X");
  if (/\bYouTube\b/i.test(blob) && !platforms.includes("YouTube")) platforms.push("YouTube");
  if (platforms.length === 0) platforms.push("Instagram");

  const mPosts = blob.match(
    /(\d+)\s*[-–]\s*(\d+)\s*posts?\s*\/\s*month|(\d+)\s*posts?\s*\/\s*month|(\d+)\s*[-–]\s*(\d+)\s*posts?/i,
  );
  let total = 16;
  if (mPosts) {
    if (mPosts[1] && mPosts[2]) total = Math.round((Number(mPosts[1]) + Number(mPosts[2])) / 2);
    else if (mPosts[3]) total = Number(mPosts[3]);
    else if (mPosts[4] && mPosts[5]) total = Math.round((Number(mPosts[4]) + Number(mPosts[5])) / 2);
  }

  /** Calendar gating requires sum(contentMix) === sum(monthlyPosts). Assign the monthly total to the primary platform. */
  const primary = platforms[0] ?? "Instagram";
  const monthlyPosts: Record<string, number> = { [primary]: total };

  const reelM = blob.match(/(\d+)\s*[-–]\s*(\d+)\s*Reels?/i) ?? blob.match(/(\d+)\s*Reels?/i);
  const carM = blob.match(/(\d+)\s*[-–]\s*(\d+)\s*Carousels?/i) ?? blob.match(/(\d+)\s*Carousels?/i);
  const staticM = blob.match(/(\d+)\s*[-–]\s*(\d+)\s*Static/i) ?? blob.match(/(\d+)\s*Static/i);

  let reels = 0;
  let carousels = 0;
  let statics = 0;
  if (reelM) {
    if (reelM[1] && reelM[2]) reels = Math.round((Number(reelM[1]) + Number(reelM[2])) / 2);
    else if (reelM[1]) reels = Number(reelM[1]);
  }
  if (carM) {
    if (carM[1] && carM[2]) carousels = Math.round((Number(carM[1]) + Number(carM[2])) / 2);
    else if (carM[1]) carousels = Number(carM[1]);
  }
  if (staticM) {
    if (staticM[1] && staticM[2]) statics = Math.round((Number(staticM[1]) + Number(staticM[2])) / 2);
    else if (staticM[1]) statics = Number(staticM[1]);
  }

  if (reels + carousels + statics < total) {
    const r = 0.4;
    const c = 0.35;
    const s = 0.25;
    reels = Math.round(total * r);
    carousels = Math.max(1, Math.round(total * c));
    statics = Math.max(0, total - reels - carousels);
  } else {
    const scale = total / (reels + carousels + statics);
    reels = Math.round(reels * scale);
    carousels = Math.round(carousels * scale);
    statics = total - reels - carousels;
  }

  const contentMix: Record<string, number> = {
    education: reels,
    thought_leadership: carousels,
    social_proof: Math.max(0, statics),
    promotion: Math.max(0, total - reels - carousels - statics),
  };
  if (contentMix.promotion < 0) contentMix.promotion = 0;

  const deliverables: string[] = [];
  if (/\bReels?\b/i.test(blob)) deliverables.push("Reels and short-form video");
  if (/\bStor(y|ies)\b/i.test(blob)) deliverables.push("Weekly Stories cadence");
  if (/\bCarousels?\b/i.test(blob)) deliverables.push("Carousels / educational slides");

  const toneByPlatform: Record<string, string> = {};
  for (const p of platforms) {
    if (p === "Instagram") {
      toneByPlatform[p] = blob.match(/tone|voice|brand/i)
        ? "Match brand tone from scope (playful, aspirational, premium)."
        : "Conversational, brand-premium, audience-first.";
    } else {
      toneByPlatform[p] = "Professional, clear, aligned with SOW scope.";
    }
  }

  return { platforms, monthlyPosts, contentMix, deliverables, toneByPlatform };
}
