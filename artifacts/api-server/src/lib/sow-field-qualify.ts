/**
 * Reject low-signal SOW field strings (parser junk) for v2 industry / target audience
 * and for Business DNA handoff.
 */

const ROMAN_HEADING_LINE =
  /^(?:I{1,3}|IV|V|VI{0,2}|VII|VIII)\s*[\.\)]\s*.+|^I\.\s*Objectives\s*[&/]\s*Goals.*/i;

const LABEL_PATTERNS = [
  /^based on your inputs:?\s*$/i,
  /^understanding of requirements:?\s*$/i,
  /^1[\.\)]\s*understanding/i,
  /^scope of work \(sow\):?\s*$/i,
  /^2[\.\)]\s*scope/i,
];

const JUNK_TARGET_WORDS = new Set(
  (["optimization", "execution", "management", "scaling", "retargeting", "delivery", "setup", "onboarding", "compliance", "automation", "infrastructure", "refinement"] as const).map((s) => s.toLowerCase()),
);

export function isRomanOrSectionHeadingLine(s: string): boolean {
  const t = s.trim();
  if (t.length < 4) return true;
  if (ROMAN_HEADING_LINE.test(t) && t.length < 200) return true;
  if (LABEL_PATTERNS.some((p) => p.test(t))) return true;
  return false;
}

export function isJunkAutofillIndustry(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return true;
  if (ROMAN_HEADING_LINE.test(t)) return true;
  for (const p of LABEL_PATTERNS) {
    if (p.test(t)) return true;
  }
  if (/^based on your inputs:?\s*$/i.test(t)) return true;
  return false;
}

export function isJunkAutofillTargetAudience(s: string): boolean {
  const t = s.trim();
  if (t.length < 4) return true;
  const lower = t.toLowerCase();
  if (JUNK_TARGET_WORDS.has(lower)) return true;
  if (lower.split(/\s+/).length <= 1 && t.length < 20) {
    if (JUNK_TARGET_WORDS.has(lower)) return true;
  }
  if (/^optimization$|^scaling$|^execution$|^engagement$|^automation$|^compliance$|^infrastructure$|^onboarding$|^refinement$|^retargeting$/i.test(t)) {
    return true;
  }
  if (ROMAN_HEADING_LINE.test(t) && t.length < 100) return true;
  return false;
}

/** Use for Business DNA `purpose` / `vision` first-line candidates. */
/** Lines like "A. …" / "B. Meta Ads …" that are SOW sub-headings, not mission statements */
export function isSowSubsectionStubLine(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return true;
  if (!/^[A-Z]\.[\s\u2013\-]/.test(t) || t.length > 220) return false;
  if (/\b(we|our|because|through|serves?|inspire|help|empower|believe|exist to)\b/i.test(t)) {
    return false;
  }
  return true;
}

export function isUnusableDnaNarrativeLine(s: string): boolean {
  const t = s.trim();
  if (t.length < 20) return true;
  if (isSowSubsectionStubLine(t)) return true;
  if (/^based on your inputs:?\s*$/i.test(t) || /^based on your inputs:?\s*$/im.test(t.slice(0, 30))) {
    if (t.length < 50) return true;
  }
  if (isRomanOrSectionHeadingLine(t) && t.length < 90) return true;
  if (/^I\.\s*Objectives\s*&/i.test(t)) return true;
  return false;
}

/** First substantive line from a SOW block for purpose/vision — skips headings and label junk. */
export function pickFirstDnaNarrativeLineFromBlock(block: string, minLen = 16): string {
  for (const line of block.split(/\n+/)) {
    const t = line.trim();
    if (t.length < minLen) continue;
    if (isUnusableDnaNarrativeLine(t)) continue;
    if (isSowSubsectionStubLine(t)) continue;
    if (/^(?:I{1,3}|IV|V|VI{0,2}|VII|VIII)\s*[\.\)]\s*.+/i.test(t) && t.length < 120) continue;
    if (/^based on your inputs:?\s*/i.test(t) && t.length < 60) continue;
    return t.slice(0, 480);
  }
  return "";
}

/** First line in Understanding block that looks like an explicit “why / purpose / mission” (optional). */
export function pickLabeledPurposeLineFromUnderstanding(uor: string): string {
  for (const line of uor.split(/\n+/)) {
    const t = line.trim();
    if (t.length < 20) continue;
    if (isSowSubsectionStubLine(t) || isRomanOrSectionHeadingLine(t)) continue;
    if (
      /^(?:●|[\u2022\u25CF-])\s*/u.test(t) &&
      /\b(purpose|mission|vision|why we|brand purpose|our why)\b/i.test(t)
    ) {
      const rest = t.replace(/^(?:●|[\u2022\u25CF-])\s*/u, "").replace(/^.*?\b(?:purpose|mission|vision)\b:?\s*/i, "");
      if (rest.length > 20) return rest.replace(/\s+/g, " ").trim().slice(0, 480);
    }
    if (/\b(our purpose|our mission|brand purpose)\b:?\s+/i.test(t) && t.length > 30) {
      return t.replace(/\s+/g, " ").trim().slice(0, 480);
    }
  }
  return "";
}

/**
 * From classic "Understanding" block: `● Industry: …` and `● Target Audience: …`
 */
const BULLET_PREFIX = /^(?:[\u2022\u25CF\-\*○]\s*)?/u;

export function extractClassicUnderstandingBullets(uorBlock: string): { industry: string; targetAudience: string } {
  let industry = "";
  let targetAudience = "";
  const t = uorBlock.replace(/\r/g, "\n");
  for (const line of t.split(/\n/)) {
    const L = line.trim();
    const im = L.replace(BULLET_PREFIX, "").match(/^(?:industry|sector)(?:[:\s]+)(.+)$/i);
    if (im?.[1]) industry = im[1].replace(/\s+/g, " ").trim();
    const am = L.replace(BULLET_PREFIX, "").match(/^target\s+audience(?:[:\s]+)(.+)$/i);
    if (am?.[1]) targetAudience = am[1].replace(/\s+/g, " ").trim();
  }
  if (industry && isJunkAutofillIndustry(industry)) industry = "";
  if (targetAudience && isJunkAutofillTargetAudience(targetAudience)) targetAudience = "";
  return { industry, targetAudience };
}

/**
 * Heuristic: take first long substantive sentence from Roman section I (not the heading line).
 */
export function extractRomanIndustryFromSectionI(objText: string): string {
  const lines = objText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (const line of lines) {
    if (isRomanOrSectionHeadingLine(line) || /^I\.?\s*Objectives/i.test(line)) continue;
    if (line.length < 25) continue;
    if (/\b(fee|retainer|lakh|INR|USD|₹|payment|invoice|terms)\b/i.test(line)) continue;
    const m = line.match(
      /(?:luxury|wellness|fragrance|e-?commerce|D2C|B2B|retail|fashion|beauty|personal care|tech|software|brand)(?:[,\s]|\b)[^\n]{5,100}/i,
    );
    if (m) return m[0].replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const joined = lines.filter((l) => !isRomanOrSectionHeadingLine(l) && l.length > 30).join(" ");
  if (joined.length > 40) {
    const sentence = joined.replace(/\s+/g, " ").trim().slice(0, 180);
    if (!isJunkAutofillIndustry(sentence)) return sentence;
  }
  return "";
}

export function extractRomanTargetAudience(objText: string, iiiText: string, ivText: string): string {
  for (const block of [objText, iiiText, ivText]) {
    const m1 = block.match(
      /(?:target\s+audience|primary\s+audience|ICP|customers?|who\s+we\s+reach)(?:[:\s]+)([^\n]+)/i,
    );
    if (m1?.[1]) {
      const v = m1[1].replace(/\s+/g, " ").trim();
      if (!isJunkAutofillTargetAudience(v) && v.length > 4) return v.slice(0, 220);
    }
  }
  for (const block of [objText, iiiText, ivText]) {
    for (const line of block.split(/\n/)) {
      const L = line.trim();
      const m = L.match(
        /^(?:[•\-\*]\s*)?target(?:\s+audience)?(?:[:\s]+)(.+)$/i,
      );
      if (m?.[1] && m[1].length > 6) {
        const v = m[1].replace(/\s+/g, " ").trim();
        if (!isJunkAutofillTargetAudience(v) && /[a-zA-Z]{4,}/.test(v) && !/\b(retargeting|audience)\s+optimization\b/i.test(L)) {
          if (!/^optimization$/i.test(v)) return v.slice(0, 220);
        }
      }
    }
  }
  return "";
}
