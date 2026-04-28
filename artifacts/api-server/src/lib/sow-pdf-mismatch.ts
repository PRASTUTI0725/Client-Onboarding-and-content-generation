/**
 * Heuristic: when SOW PDF text doesn't match the client website/Instagram identity,
 * flag a mismatch and optionally keep only sections that look aligned to the brand.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@]+/g, " ")
    .trim();
}

function hostKeyword(url: string): string {
  try {
    const h = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    const [first] = h.split(".");
    return first && first.length > 2 ? first : "";
  } catch {
    return "";
  }
}

function handleKeyword(handle: string): string {
  return norm(handle.replace(/^@/, "").replace(/_.*$/, "")).split(/\s+/).filter(Boolean)[0] ?? "";
}

export function brandMatchTokens(name: string, websiteUrl: string, instagramHandle: string): string[] {
  const base = [norm(name), hostKeyword(websiteUrl), handleKeyword(instagramHandle)]
    .filter(Boolean)
    .filter((s) => s.length >= 3);
  const n = norm(name);
  if (n.includes("svara") && !base.includes("svara")) base.push("svara");
  if (n.includes("swara") && !base.includes("swara")) base.push("swara");
  return unique(base);
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

const GENERIC_SOW = [
  "content",
  "deliverable",
  "scope",
  "milestone",
  "approval",
  "post",
  "platform",
  "monthly",
  "strategy",
  "calendar",
  "engagement",
  "reporting",
  "kpi",
];

export type MismatchCheck = {
  code: "client_name" | "website_domain" | "instagram_handle" | "pdf_mentions";
  /** Human-readable, safe to show in UI */
  label: string;
  passed: boolean;
};

export type SowPdfMismatchAssessment = {
  detected: boolean;
  message: string;
  details: string[];
  checks: MismatchCheck[];
  alignedUnderstanding: string;
  alignedScope: string;
  /** Client asked to "extract only matching sections" from mismatched PDFs */
  usedFilteredSections: boolean;
};

function paragraphFilter(text: string, tokens: string[], generic: string[]): string[] {
  const chunks = text.split(/\n{2,}/g).map((c) => c.trim()).filter(Boolean);
  if (chunks.length === 0) return [text.trim()].filter(Boolean);
  const tlow = (s: string) => norm(s);
  return chunks.filter((p) => {
    const l = tlow(p);
    if (tokens.some((t) => l.includes(t) || t.length >= 4 && p.toLowerCase().includes(t))) return true;
    if (generic.some((g) => l.includes(g))) return true;
    if (p.length < 100) return true;
    return false;
  });
}

export function filterSowByBrandAlignment(
  understandingOfRequirements: string,
  scopeOfWork: string,
  brandTokens: string[],
): { understanding: string; scope: string; usedFilter: boolean } {
  if (brandTokens.length === 0) {
    return { understanding: understandingOfRequirements, scope: scopeOfWork, usedFilter: false };
  }
  const uP = paragraphFilter(understandingOfRequirements, brandTokens, GENERIC_SOW);
  const sP = paragraphFilter(scopeOfWork, brandTokens, GENERIC_SOW);
  const u = (uP.length > 0 ? uP.join("\n\n") : understandingOfRequirements).trim();
  const s = (sP.length > 0 ? sP.join("\n\n") : scopeOfWork).trim();
  const usedFilter = u.length < understandingOfRequirements.length * 0.8 || s.length < scopeOfWork.length * 0.8;
  return { understanding: u || understandingOfRequirements, scope: s || scopeOfWork, usedFilter: usedFilter || u !== understandingOfRequirements || s !== scopeOfWork };
}

/**
 * If few brand tokens from onboarding appear in the raw PDF, treat as mismatch (e.g. wrong client PDF).
 */
export function assessSowPdfMismatch(params: {
  name: string;
  websiteUrl: string;
  instagramHandle: string;
  extractedText: string;
  understandingOfRequirements: string;
  scopeOfWork: string;
}): SowPdfMismatchAssessment {
  const tokens = brandMatchTokens(params.name, params.websiteUrl, params.instagramHandle);
  const hay = params.extractedText.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (t.length >= 3 && hay.includes(t)) hits += 1;
  }
  const shortClientName = norm(params.name).split(/\s+/).filter((w) => w.length > 2)[0];
  if (shortClientName && hay.includes(shortClientName)) hits += 1;

  const bigEnough = params.extractedText.length > 120;
  const looksWrong = bigEnough && tokens.length > 0 && hits === 0;
  const maybeWrong = bigEnough && tokens.length > 0 && hits === 1 && params.extractedText.length > 2000;
  const detected = looksWrong || maybeWrong;

  const host = (() => {
    try {
      return hostKeyword(params.websiteUrl);
    } catch {
      return "";
    }
  })();
  const ig = params.instagramHandle.replace(/^@/, "").trim();
  const nameHit = !shortClientName || hay.includes(shortClientName);
  const domainHit = !host || host.length < 3 || hay.includes(host);
  const igHit = !ig || hay.includes(ig.toLowerCase()) || hay.includes(ig.split("_")[0] ?? "");
  const checks: MismatchCheck[] = [
    {
      code: "client_name",
      passed: nameHit,
      label: `PDF mentions client name / brand (“${params.name}”): ${nameHit ? "yes" : "no"}`,
    },
    {
      code: "website_domain",
      passed: !params.websiteUrl?.trim() ? true : domainHit,
      label: `PDF mentions website/brand from domain (${host || "n/a"}): ${
        !params.websiteUrl?.trim() ? "skipped (no site)" : domainHit ? "yes" : "no"
      }`,
    },
    {
      code: "instagram_handle",
      passed: !ig ? true : igHit,
      label: `PDF mentions @handle or handle stem: ${!ig ? "skipped (no handle)" : igHit ? "yes" : "no"}`,
    },
    {
      code: "pdf_mentions",
      passed: !detected,
      label: `Overall: expected brand strings appear in the PDF: ${!detected ? "yes" : "no"}`,
    },
  ];

  const filtered = filterSowByBrandAlignment(
    params.understandingOfRequirements,
    params.scopeOfWork,
    tokens,
  );
  const usedFilteredSections = detected && (filtered.usedFilter || filtered.understanding !== params.understandingOfRequirements);

  return {
    detected,
    usedFilteredSections,
    message: detected
      ? "This PDF may not be for the same business as the client you entered. Review the checks below, replace the file if needed, or continue only if you’re sure it’s the right SOW."
      : "SOW text appears aligned to this client’s public identity.",
    details: detected
      ? [
          "Few or no brand keywords from the client name, website, or @handle were found in the PDF text.",
          "We still saved aligned paragraphs where possible. Replace the PDF if this was the wrong proposal.",
        ]
      : [],
    checks,
    alignedUnderstanding: detected ? filtered.understanding : params.understandingOfRequirements,
    alignedScope: detected ? filtered.scope : params.scopeOfWork,
  };
}
