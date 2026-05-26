export type BusinessTypePrimary =
  | "service_agency"
  | "saas"
  | "creator_personal_brand"
  | "local_business"
  | "d2c"
  | "coaching_education"
  | "hybrid"
  | "unknown";

export type BusinessTypeClassification = {
  primary: BusinessTypePrimary;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function collectText(values: unknown[]): string {
  return values
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

export function classifyBusinessType(input: {
  brandName?: unknown;
  clientName?: unknown;
  oneLineDescription?: unknown;
  industry?: unknown;
  targetAudience?: unknown;
  websiteText?: unknown;
  instagramBio?: unknown;
  offerSummary?: unknown;
}): BusinessTypeClassification {
  const haystack = collectText([
    input.brandName,
    input.clientName,
    input.oneLineDescription,
    input.industry,
    input.targetAudience,
    input.websiteText,
    input.instagramBio,
    input.offerSummary,
  ]);

  const reasons: string[] = [];
  const match = (pattern: RegExp) => pattern.test(haystack);

  const serviceAgency =
    match(/\bagency\b|\bstudio\b|\bservices?\b|\bconsult(?:ant|ing)?\b|\bmarketing\b|\bcontent strategy\b|\bsocial media\b/);
  const saas =
    match(/\bsaas\b|\bsoftware\b|\bplatform\b|\bapp\b|\bb2b\b|\bsubscription\b|\bcrm\b/);
  const creator =
    match(/\bcreator\b|\bpersonal brand\b|\binfluencer\b|\byoutuber\b|\bcoach\b|\bmentor\b|\bsolopreneur\b/);
  const local =
    match(/\blocal\b|\brestaurant\b|\bcafe\b|\bbakery\b|\bsalon\b|\bclinic\b|\bstudio location\b|\bnear me\b/);
  const d2c =
    match(/\bd2c\b|\be-?commerce\b|\bshop\b|\bstore\b|\bproduct\b|\bskincare\b|\bfashion\b|\bconsumer brand\b/);
  const coachingEducation =
    match(/\bcoaching\b|\bcourse\b|\btraining\b|\beducation\b|\bworkshop\b|\bprogram\b/);

  if (serviceAgency) reasons.push("service/agency signals");
  if (saas) reasons.push("saas/software signals");
  if (creator) reasons.push("creator/personal-brand signals");
  if (local) reasons.push("local-business signals");
  if (d2c) reasons.push("d2c/product signals");
  if (coachingEducation) reasons.push("coaching/education signals");

  if (serviceAgency && !saas) {
    return { primary: "service_agency", confidence: "high", reasons };
  }
  if (saas && !serviceAgency) {
    return { primary: "saas", confidence: "high", reasons };
  }
  if (creator && !serviceAgency && !saas) {
    return { primary: "creator_personal_brand", confidence: "medium", reasons };
  }
  if (local && !serviceAgency && !saas) {
    return { primary: "local_business", confidence: "medium", reasons };
  }
  if (coachingEducation && !serviceAgency && !saas) {
    return { primary: "coaching_education", confidence: "medium", reasons };
  }
  if (d2c && !serviceAgency && !saas) {
    return { primary: "d2c", confidence: "medium", reasons };
  }
  if (reasons.length > 1) {
    return { primary: "hybrid", confidence: "low", reasons };
  }
  return { primary: "unknown", confidence: "low", reasons };
}
