import { createHash } from "node:crypto";
import { getStrictJsonWithRetry } from "../llm/json-retry.js";
import { buildPromptBudgetStats } from "../llm/prompt-budget.js";
import type { PromptBudgetStats } from "../llm/prompt-budget.js";
import type { LLMProvider } from "../llm/types.js";
import type { BusinessDna } from "../business-dna.js";
import {
  BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS,
  BUSINESS_DNA_MAX_OUTPUT_TOKENS,
  BUSINESS_DNA_TARGET_INPUT_TOKENS,
} from "./constants.js";
import { compactBusinessDnaGeneratorInput, type CompactionTier } from "./compact-input.js";
import { isBusinessDnaRequestWithinGroqBudget, resolveBusinessDnaMaxOutputTokens } from "./provider-budget.js";
import { logBusinessDnaJsonFailure } from "./json-log.js";

export type BusinessDnaGeneratorInput = {
  client: {
    brandName: string;
    clientName: string;
    websiteUrl: string;
    instagramHandle: string;
    oneLineDescription: string;
  };
  businessType: {
    primary: string;
    confidence: string;
  };
  sow: {
    industry: string;
    targetAudience: string;
    understandingOfRequirements: string;
    strategyLaunchPlanning: string;
    contentCreation: string;
    scopeOfWork: string;
    platforms: string[];
    monthlyPosts: Record<string, number>;
    contentMix: Record<string, number>;
    deliverables: string[];
    toneByPlatform: Record<string, string>;
  };
  instagram: {
    handle: string;
    bio: string;
    offerSummary: string;
    recentCaptionSnippets: string[];
    recurringTopics: string[];
    additionalInstagramNotes?: string;
    ctaPatterns?: string[];
    proofSignals?: string[];
    followerCount?: string;
    category?: string;
    visualStyleNotes?: string;
    instagramSummaryNotes?: string;
  } | null;
  website?: {
    title?: string;
    metaDescription?: string;
    heroExcerpt?: string;
    messagingPatterns?: string[];
    trustElements?: string[];
    conversionElements?: string[];
    colors?: string[];
  } | null;
  importedResearch?: Record<string, unknown> | null;
};

type GeneratedBusinessDnaDraft = {
  purpose?: string;
  mission?: string;
  vision?: string;
  coreValues?: string[];
  brandArchetype?: string;
  personalityTraits?: string[];
  toneOfVoice?: {
    style?: string[];
    dos?: string[];
    donts?: string[];
    samplePhrases?: string[];
  };
  languageStyle?: {
    readingLevel?: string;
    primaryLanguagePatterns?: string[];
    tabooWords?: string[];
    ctaStyle?: string;
  };
  targetAudience?: {
    segments?: string[];
    demographics?: string[];
    psychographics?: string[];
    geographies?: string[];
    pains?: string[];
    desires?: string[];
    objections?: string[];
  };
  positioning?: {
    category?: string;
    valueProposition?: string;
    differentiators?: string[];
    competitorReferences?: string[];
    marketAngle?: string;
    reasonToBelieve?: string[];
  };
  offers?: {
    primaryOffers?: string[];
    pricingSignals?: string[];
    transformationPromise?: string;
    urgencyStyle?: string;
  };
  contentStrategy?: {
    contentPillars?: string[];
    themes?: string[];
    hooksThatFitBrand?: string[];
    topicsToAvoid?: string[];
    trustSignalsToRepeat?: string[];
  };
  visualIdentity?: {
    typography?: {
      primary?: string;
      secondary?: string;
      styleNotes?: string[];
    };
    imageryStyle?: string[];
    designMotifs?: string[];
    logoStyle?: string;
    layoutStyle?: string;
  };
};

export type BusinessDnaGenerationResult = {
  businessDna: BusinessDna;
  provider?: string;
  model?: string;
  validationStatus: "not_run";
  validationIssues: string[];
  promptBudget?: PromptBudgetStats & {
    compactionTier: CompactionTier;
    groqBudgetOk: boolean;
    maxOutputTokens: number;
  };
};

export class BusinessDnaPromptBudgetError extends Error {
  readonly promptBudget: PromptBudgetStats & { compactionTier: CompactionTier };

  constructor(message: string, promptBudget: PromptBudgetStats & { compactionTier: CompactionTier }) {
    super(message);
    this.name = "BusinessDnaPromptBudgetError";
    this.promptBudget = promptBudget;
  }
}

function hashPreview(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

const BUSINESS_DNA_SYSTEM = `You are a senior brand strategist producing STRICT JSON for a Business DNA artifact.

Return ONE valid JSON object only. No markdown, no commentary.

Rules:
- Synthesize from the approved inputs. Do not dump raw source text.
- Never copy launch-planning or scope text verbatim into mission.
- Never use raw caption snippets as final content pillars.
- Do not use Instagram bio or offer copy as customer pain unless it clearly describes an audience problem.
- Hooks must be real example hooks, not formulas like "Start from pain:" or "Lead with differentiator:".
- Do not use ecommerce/product language unless the evidence clearly supports it.
- Do not invent unsupported geographies, pricing models, packages, discounts, urgency, promotions, testimonials, case studies, awards, or proof claims.
- Do not state unsupported differentiators, process claims, team credentials, or proof-style trust language as fact.
- Do not state sustainability, inclusivity, expert endorsement, clinical backing, certifications, dermatologist approval, or medical/wellness claims as facts unless they are explicitly present in the approved inputs.
- If reviews, testimonials, case studies, success stories, or metrics are not present in the approved inputs, frame them as conditional proof mechanisms, suggested proof assets, or assets to collect instead of existing evidence.
- When evidence is missing, prefer blank optional fields. For unknown factual fields, use "Not available from current inputs" when explicit absence is more useful than blank. For strategic inference only, use "Likely but needs client confirmation"; never use inference phrasing for factual claims.
- For wellness, beauty, fragrance, skincare, fitness, or health-adjacent brands, frame benefits as positioning, ritual, sensory experience, self-care context, or perceived audience experience unless the approved inputs provide claim-level proof. Do not imply medical guarantees, treatment, cures, clinical proof, expert endorsement, or therapeutic certainty.
- With thin inputs, degrade safely: avoid invented demographics, geographies, values, certifications, proof assets, platforms, health claims, or performance claims.
- For social/content-led service brands, favor voice that feels young, playful, witty, founder-friendly, social-first, and strategic when the approved inputs support that tone.
- When importedResearch is present, treat it as imported research brief context — not confirmed client truth. Prefer approved SOW and structured Instagram for operational facts.
- Use importedResearch.claimSafetyNotes.claimsToAvoid as hard constraints. Never contradict them.
- importedResearch.missingInformation is a checklist only — never synthesize those items as confirmed facts.
- Do not invent testimonials, metrics, or proof from importedResearch unless the same proof is also in approved SOW/Instagram/website inputs.
- Use brandName for narrative outputs unless this is clearly a personal-brand/creator business.
- Keep arrays concise, useful, and human-readable.
- Every field should read like strategist synthesis, not notes.
`;

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

const UNSUPPORTED_GEOGRAPHY_TERMS = [
  "united states",
  "usa",
  "europe",
  "asia",
  "australia",
  "global",
  "worldwide",
  "english speaking countries",
];

const UNSUPPORTED_PRICING_PATTERNS = [
  /\bcustom(?:ized)? pricing\b/i,
  /\bpackage deals?\b/i,
  /\bdiscounts?\b/i,
  /\blong term discounts?\b/i,
];

const UNSUPPORTED_URGENCY_PATTERNS = [
  /\blimited spots?\b/i,
  /\blimited availability\b/i,
  /\blimited time\b/i,
  /\bexclusive promotions?\b/i,
  /\bpromo(?:tion)?\b/i,
  /\bdiscount\b/i,
];

const UNSUPPORTED_PROOF_PATTERNS = [
  /\btestimonials?\b/i,
  /\bcase studies?\b/i,
  /\bawards?\b/i,
  /\baward winning\b/i,
  /\brecognized\b/i,
  /\bfeatured in\b/i,
];

function containsUnsupportedTerm(text: string, terms: readonly string[]): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function containsUnsupportedPattern(text: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => pattern.test(normalized));
}

function cloneBusinessDna(base: BusinessDna): BusinessDna {
  return JSON.parse(JSON.stringify(base)) as BusinessDna;
}

function buildObservedBusinessDnaBase(base: BusinessDna): BusinessDna {
  const next = cloneBusinessDna(base);
  next.purpose = "";
  next.mission = "";
  next.vision = "";
  next.coreValues = [];
  next.brandArchetype = "";
  next.personalityTraits = [];
  next.toneOfVoice = {
    style: [],
    dos: [],
    donts: [],
    samplePhrases: [],
  };
  next.languageStyle = {
    readingLevel: "",
    primaryLanguagePatterns: [],
    tabooWords: [],
    ctaStyle: "",
  };
  next.targetAudience = {
    segments: [],
    demographics: [],
    psychographics: [],
    geographies: [],
    pains: [],
    desires: [],
    objections: [],
  };
  next.positioning = {
    category: "",
    valueProposition: "",
    differentiators: [],
    competitorReferences: [],
    marketAngle: "",
    reasonToBelieve: [],
  };
  next.offers = {
    primaryOffers: [],
    pricingSignals: [],
    transformationPromise: "",
    urgencyStyle: "",
  };
  next.contentStrategy = {
    contentPillars: [],
    themes: [],
    hooksThatFitBrand: [],
    topicsToAvoid: [],
    trustSignalsToRepeat: [],
  };
  next.visualIdentity = {
    ...next.visualIdentity,
    typography: {
      primary: "",
      secondary: "",
      styleNotes: [],
    },
    imageryStyle: [],
    designMotifs: [],
    logoStyle: "",
    layoutStyle: "",
  };
  next.voice_tone = "";
  next.content_patterns = [];
  next.competitor_insights = [];
  next.visual_identity = {
    colors: next.visualIdentity.colors.map((entry) => entry.hex),
    fonts: [],
    style: "",
  };
  return next;
}

function trimExistingDraftForRepair(draft: BusinessDna | null | undefined): Record<string, unknown> {
  if (!draft) return {};
  const capList = (items: string[] | undefined, max = 4) =>
    (items ?? []).map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120)).filter(Boolean).slice(0, max);

  return {
    purpose: draft.purpose?.slice(0, 200),
    mission: draft.mission?.slice(0, 240),
    vision: draft.vision?.slice(0, 200),
    coreValues: capList(draft.coreValues),
    brandArchetype: draft.brandArchetype?.slice(0, 120),
    personalityTraits: capList(draft.personalityTraits),
    toneOfVoice: {
      style: capList(draft.toneOfVoice?.style),
      dos: capList(draft.toneOfVoice?.dos, 3),
      donts: capList(draft.toneOfVoice?.donts, 3),
      samplePhrases: capList(draft.toneOfVoice?.samplePhrases, 3),
    },
    positioning: {
      category: draft.positioning?.category?.slice(0, 120),
      valueProposition: draft.positioning?.valueProposition?.slice(0, 200),
      differentiators: capList(draft.positioning?.differentiators, 3),
    },
    contentStrategy: {
      contentPillars: capList(draft.contentStrategy?.contentPillars, 4),
      themes: capList(draft.contentStrategy?.themes, 4),
    },
  };
}

function buildUserPrompt(input: BusinessDnaGeneratorInput, repairIssues?: string[], existingDraft?: BusinessDna | null): string {
  const compactContext = {
    client: input.client,
    businessType: input.businessType,
    sow: input.sow,
    instagram: input.instagram,
    website: input.website ?? null,
    importedResearch: input.importedResearch ?? null,
  };

  const repairBlock =
    repairIssues && repairIssues.length > 0
      ? `\nREPAIR MODE:\n- Preserve valid fields unchanged.\n- Rewrite only the flagged fields.\n- Keep the exact JSON shape and nested keys.\n- Use approved inputs only. Do not copy raw source text.\n- Do not weaken fields that already read specific and accurate.\nTARGETED REPAIR INSTRUCTIONS:\n- ${repairIssues.join("\n- ")}\n\nPREVIOUS DRAFT JSON:\n${JSON.stringify(trimExistingDraftForRepair(existingDraft))}\n`
      : "";

  return `APPROVED BUSINESS DNA INPUT:
${JSON.stringify(compactContext)}
${repairBlock}
Return a JSON object with these exact top-level keys:
- purpose
- mission
- vision
- coreValues
- brandArchetype
- personalityTraits
- toneOfVoice
- languageStyle
- targetAudience
- positioning
- offers
- contentStrategy
- visualIdentity

Expected nested structure:
- toneOfVoice: { style, dos, donts, samplePhrases }
- languageStyle: { readingLevel, primaryLanguagePatterns, tabooWords, ctaStyle }
- targetAudience: { segments, demographics, psychographics, geographies, pains, desires, objections }
- positioning: { category, valueProposition, differentiators, competitorReferences, marketAngle, reasonToBelieve }
- offers: { primaryOffers, pricingSignals, transformationPromise, urgencyStyle }
- contentStrategy: { contentPillars, themes, hooksThatFitBrand, topicsToAvoid, trustSignalsToRepeat }
- visualIdentity: { typography: { primary, secondary, styleNotes }, imageryStyle, designMotifs, logoStyle, layoutStyle }

Quality rules:
- Good mission = audience transformation + brand role, not a service activity list.
- Good pains/desires = lived audience friction and aspiration, not business offer language.
- Good pillars/themes = strategic content categories and recurring editorial lanes, not captions or note dumps.
- Good hooks = publish-ready lines this brand could actually post, not formulas or generic starter questions.
- Good differentiators/sample phrases = brand-specific methods, stance, and voice, not adjective stacks or generic agency encouragement.
- Ground pillars, themes, and sample language in recurring topics/content buckets whenever the approved inputs provide them.
- When the approved inputs support a social-first agency voice, tone guidance should feel young, witty, playful, founder-friendly, clear, and strategic rather than generic expert filler.
- mission must not read like a launch checklist or scope of work
- audience should fit the business type and approved audience context
- content pillars must be strategic categories, not copied captions
- themes must be short synthesized themes, not raw dumps
- hooks must be actual lines this brand could publish
- trust signals should use any available proof signals
- if website color evidence exists, do not invent a fake palette narrative; keep visual guidance compatible with the evidence

Specificity rules:
- mission must express the audience transformation and brand role, not service activity
- pains must describe audience friction, not business offer language
- differentiators must state a method, stance, or strategic angle, not adjectives alone
- sample phrases must sound like this brand, not generic agency encouragement
- themes must read like recurring editorial lanes
- do not guess geographies, pricing/packages/discounts, urgency/promotions, values such as sustainability or inclusivity, expert endorsements, clinical backing, certifications, dermatologist approval, medical/wellness claims, or proof claims unless the approved inputs clearly support them
- do not name fonts or typefaces unless they were reliably extracted from real website evidence for this run
- if a differentiator or trust angle is strategically plausible but not confirmed, phrase it as "Suggested angle — needs confirmation" instead of stating it as a fact
- if proof assets are not confirmed, use phrasing like "if available", "assets to collect", or "suggested proof mechanisms" instead of implying those assets already exist
- if a strategic inference is useful but not confirmed, phrase it as "Likely but needs client confirmation"; do not present inferred demographics, values, certifications, proof, or claims as facts
- if a field is optional and the evidence is weak, prefer blank over invented certainty
- use "Not available from current inputs" for factual unknowns when explicit absence is more helpful than blank
- for wellness/cosmetic products, discuss calm, sleep, stress, ingredients, skin safety, or wellbeing as brand positioning and self-care ritual unless the approved inputs contain verified claim support
- for optional pricing, urgency, and proof fields, blank is better than generic filler
- if a field could fit almost any agency, rewrite it to be more specific

Tiny negatives:
- bad mission: "help brands grow through strategy and content creation"
- bad pain: "not your regular agency"
- bad pillar: "your brand deserves more than just posts"
- bad hook: "Ready to take your social media presence to the next level?"

Tiny positives:
- good mission: "turn founder-led storytelling into trusted inbound leads for service agencies"
- good pillar: "founder-led storytelling systems for service agencies"
- good differentiator: "we build strategy from recurring audience questions and real content patterns, not trend chasing alone"
`;
}

function prepareBusinessDnaPrompt(params: {
  input: BusinessDnaGeneratorInput;
  repairIssues?: string[];
  existingDraft?: BusinessDna | null;
}): {
  compactedInput: BusinessDnaGeneratorInput;
  prompt: string;
  compactionTier: CompactionTier;
  promptBudget: PromptBudgetStats & {
    compactionTier: CompactionTier;
    groqBudgetOk: boolean;
    maxOutputTokens: number;
  };
} {
  let compactionTier: CompactionTier = 0;
  let compactedInput = compactBusinessDnaGeneratorInput(params.input, compactionTier);
  let prompt = buildUserPrompt(compactedInput, params.repairIssues, params.existingDraft ?? null);

  const maxOutputTokens = BUSINESS_DNA_MAX_OUTPUT_TOKENS;
  let promptBudget = buildBusinessDnaPromptBudget(compactedInput, prompt, compactionTier, maxOutputTokens);

  while (
    (promptBudget.estimatedInputTokens > BUSINESS_DNA_TARGET_INPUT_TOKENS ||
      !isBusinessDnaRequestWithinGroqBudget(promptBudget.estimatedInputTokens, maxOutputTokens)) &&
    compactionTier < 3
  ) {
    compactionTier = (compactionTier + 1) as CompactionTier;
    compactedInput = compactBusinessDnaGeneratorInput(params.input, compactionTier);
    prompt = buildUserPrompt(compactedInput, params.repairIssues, params.existingDraft ?? null);
    promptBudget = buildBusinessDnaPromptBudget(compactedInput, prompt, compactionTier, maxOutputTokens);
  }

  const groqBudgetOk = isBusinessDnaRequestWithinGroqBudget(
    promptBudget.estimatedInputTokens,
    maxOutputTokens,
  );

  if (!groqBudgetOk) {
    console.warn(
      `[business_dna] prompt_budget_exceeded tier=${compactionTier} estimated_input=${promptBudget.estimatedInputTokens} max_output=${maxOutputTokens} segments=${JSON.stringify(promptBudget.segments)}`,
    );
    throw new BusinessDnaPromptBudgetError(
      `Business DNA prompt exceeds Groq token budget after compaction (estimated ${promptBudget.estimatedInputTokens} input + ${maxOutputTokens} output > ${BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS}).`,
      promptBudget,
    );
  }

  return { compactedInput, prompt, compactionTier, promptBudget: { ...promptBudget, groqBudgetOk, maxOutputTokens } };
}

function buildBusinessDnaPromptBudget(
  input: BusinessDnaGeneratorInput,
  prompt: string,
  compactionTier: CompactionTier,
  maxOutputTokens: number,
): PromptBudgetStats & { compactionTier: CompactionTier } {
  const instructionsStart = prompt.indexOf("Return a JSON object");
  const instructions = instructionsStart > 0 ? prompt.slice(instructionsStart) : "";

  const stats = buildPromptBudgetStats(
    "business dna",
    [
      { label: "system", value: BUSINESS_DNA_SYSTEM },
      { label: "user", value: prompt },
    ],
    BUSINESS_DNA_TARGET_INPUT_TOKENS,
    maxOutputTokens,
  );

  const breakdown = buildPromptBudgetStats(
    "business dna segments",
    [
      { label: "sow", value: input.sow },
      { label: "instagram", value: input.instagram },
      { label: "website", value: input.website },
      { label: "importedResearch", value: input.importedResearch },
      { label: "instructions", value: instructions },
    ],
    Number.MAX_SAFE_INTEGER,
    0,
  ).segments;

  return { ...stats, segments: breakdown, compactionTier };
}

function mergeGeneratedDraft(base: BusinessDna, generated: GeneratedBusinessDnaDraft): BusinessDna {
  const next = cloneBusinessDna(base);

  next.purpose = normalizeText(generated.purpose) || next.purpose;
  next.mission = normalizeText(generated.mission) || next.mission;
  next.vision = normalizeText(generated.vision) || next.vision;
  next.coreValues = normalizeStringArray(generated.coreValues, 6).length > 0
    ? normalizeStringArray(generated.coreValues, 6)
    : next.coreValues;
  next.brandArchetype = normalizeText(generated.brandArchetype) || next.brandArchetype;
  next.personalityTraits = normalizeStringArray(generated.personalityTraits, 6).length > 0
    ? normalizeStringArray(generated.personalityTraits, 6)
    : next.personalityTraits;

  if (generated.toneOfVoice) {
    next.toneOfVoice = {
      style: normalizeStringArray(generated.toneOfVoice.style, 6).length > 0
        ? normalizeStringArray(generated.toneOfVoice.style, 6)
        : next.toneOfVoice.style,
      dos: normalizeStringArray(generated.toneOfVoice.dos, 6).length > 0
        ? normalizeStringArray(generated.toneOfVoice.dos, 6)
        : next.toneOfVoice.dos,
      donts: normalizeStringArray(generated.toneOfVoice.donts, 6).length > 0
        ? normalizeStringArray(generated.toneOfVoice.donts, 6)
        : next.toneOfVoice.donts,
      samplePhrases: normalizeStringArray(generated.toneOfVoice.samplePhrases, 6).length > 0
        ? normalizeStringArray(generated.toneOfVoice.samplePhrases, 6)
        : next.toneOfVoice.samplePhrases,
    };
  }

  if (generated.languageStyle) {
    next.languageStyle = {
      readingLevel: normalizeText(generated.languageStyle.readingLevel) || next.languageStyle.readingLevel,
      primaryLanguagePatterns: normalizeStringArray(generated.languageStyle.primaryLanguagePatterns, 6).length > 0
        ? normalizeStringArray(generated.languageStyle.primaryLanguagePatterns, 6)
        : next.languageStyle.primaryLanguagePatterns,
      tabooWords: normalizeStringArray(generated.languageStyle.tabooWords, 6).length > 0
        ? normalizeStringArray(generated.languageStyle.tabooWords, 6)
        : next.languageStyle.tabooWords,
      ctaStyle: normalizeText(generated.languageStyle.ctaStyle) || next.languageStyle.ctaStyle,
    };
  }

  if (generated.targetAudience) {
    const generatedGeographies = normalizeStringArray(generated.targetAudience.geographies, 6).filter(
      (entry) => !containsUnsupportedTerm(entry, UNSUPPORTED_GEOGRAPHY_TERMS),
    );
    next.targetAudience = {
      segments: normalizeStringArray(generated.targetAudience.segments, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.segments, 6)
        : next.targetAudience.segments,
      demographics: normalizeStringArray(generated.targetAudience.demographics, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.demographics, 6)
        : next.targetAudience.demographics,
      psychographics: normalizeStringArray(generated.targetAudience.psychographics, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.psychographics, 6)
        : next.targetAudience.psychographics,
      geographies: generatedGeographies.length > 0
        ? generatedGeographies
        : next.targetAudience.geographies,
      pains: normalizeStringArray(generated.targetAudience.pains, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.pains, 6)
        : next.targetAudience.pains,
      desires: normalizeStringArray(generated.targetAudience.desires, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.desires, 6)
        : next.targetAudience.desires,
      objections: normalizeStringArray(generated.targetAudience.objections, 6).length > 0
        ? normalizeStringArray(generated.targetAudience.objections, 6)
        : next.targetAudience.objections,
    };
  }

  if (generated.positioning) {
    const generatedReasonToBelieve = normalizeStringArray(generated.positioning.reasonToBelieve, 6).filter(
      (entry) => !containsUnsupportedPattern(entry, UNSUPPORTED_PROOF_PATTERNS),
    );
    next.positioning = {
      category: normalizeText(generated.positioning.category) || next.positioning.category,
      valueProposition: normalizeText(generated.positioning.valueProposition) || next.positioning.valueProposition,
      differentiators: normalizeStringArray(generated.positioning.differentiators, 6).length > 0
        ? normalizeStringArray(generated.positioning.differentiators, 6)
        : next.positioning.differentiators,
      competitorReferences: normalizeStringArray(generated.positioning.competitorReferences, 6).length > 0
        ? normalizeStringArray(generated.positioning.competitorReferences, 6)
        : next.positioning.competitorReferences,
      marketAngle: normalizeText(generated.positioning.marketAngle) || next.positioning.marketAngle,
      reasonToBelieve: generatedReasonToBelieve.length > 0
        ? generatedReasonToBelieve
        : next.positioning.reasonToBelieve,
    };
  }

  if (generated.offers) {
    const generatedPricingSignals = normalizeStringArray(generated.offers.pricingSignals, 6).filter(
      (entry) => !containsUnsupportedPattern(entry, UNSUPPORTED_PRICING_PATTERNS),
    );
    const generatedUrgencyStyle = normalizeText(generated.offers.urgencyStyle);
    next.offers = {
      primaryOffers: normalizeStringArray(generated.offers.primaryOffers, 6).length > 0
        ? normalizeStringArray(generated.offers.primaryOffers, 6)
        : next.offers.primaryOffers,
      pricingSignals: generatedPricingSignals.length > 0
        ? generatedPricingSignals
        : next.offers.pricingSignals,
      transformationPromise: normalizeText(generated.offers.transformationPromise) || next.offers.transformationPromise,
      urgencyStyle:
        generatedUrgencyStyle && !containsUnsupportedPattern(generatedUrgencyStyle, UNSUPPORTED_URGENCY_PATTERNS)
          ? generatedUrgencyStyle
          : next.offers.urgencyStyle,
    };
  }

  if (generated.contentStrategy) {
    const generatedTrustSignals = normalizeStringArray(generated.contentStrategy.trustSignalsToRepeat, 6).filter(
      (entry) => !containsUnsupportedPattern(entry, UNSUPPORTED_PROOF_PATTERNS),
    );
    next.contentStrategy = {
      contentPillars: normalizeStringArray(generated.contentStrategy.contentPillars, 6).length > 0
        ? normalizeStringArray(generated.contentStrategy.contentPillars, 6)
        : next.contentStrategy.contentPillars,
      themes: normalizeStringArray(generated.contentStrategy.themes, 6).length > 0
        ? normalizeStringArray(generated.contentStrategy.themes, 6)
        : next.contentStrategy.themes,
      hooksThatFitBrand: normalizeStringArray(generated.contentStrategy.hooksThatFitBrand, 8).length > 0
        ? normalizeStringArray(generated.contentStrategy.hooksThatFitBrand, 8)
        : next.contentStrategy.hooksThatFitBrand,
      topicsToAvoid: normalizeStringArray(generated.contentStrategy.topicsToAvoid, 6).length > 0
        ? normalizeStringArray(generated.contentStrategy.topicsToAvoid, 6)
        : next.contentStrategy.topicsToAvoid,
      trustSignalsToRepeat: generatedTrustSignals.length > 0
        ? generatedTrustSignals
        : next.contentStrategy.trustSignalsToRepeat,
    };
  }

  if (generated.visualIdentity) {
    next.visualIdentity = {
      ...next.visualIdentity,
      typography: {
        primary: normalizeText(generated.visualIdentity.typography?.primary) || next.visualIdentity.typography.primary,
        secondary: normalizeText(generated.visualIdentity.typography?.secondary) || next.visualIdentity.typography.secondary,
        styleNotes: normalizeStringArray(generated.visualIdentity.typography?.styleNotes, 6).length > 0
          ? normalizeStringArray(generated.visualIdentity.typography?.styleNotes, 6)
          : next.visualIdentity.typography.styleNotes,
      },
      imageryStyle: normalizeStringArray(generated.visualIdentity.imageryStyle, 6).length > 0
        ? normalizeStringArray(generated.visualIdentity.imageryStyle, 6)
        : next.visualIdentity.imageryStyle,
      designMotifs: normalizeStringArray(generated.visualIdentity.designMotifs, 6).length > 0
        ? normalizeStringArray(generated.visualIdentity.designMotifs, 6)
        : next.visualIdentity.designMotifs,
      logoStyle: normalizeText(generated.visualIdentity.logoStyle) || next.visualIdentity.logoStyle,
      layoutStyle: normalizeText(generated.visualIdentity.layoutStyle) || next.visualIdentity.layoutStyle,
    };
  }

  next.voice_tone = next.toneOfVoice.style.join(", ");
  next.visual_identity = {
    colors: next.visualIdentity.colors.map((entry) => entry.hex),
    fonts: [next.visualIdentity.typography.primary, next.visualIdentity.typography.secondary].filter(Boolean),
    style: normalizeText(
      [next.visualIdentity.imageryStyle[0], next.visualIdentity.designMotifs[0], next.visualIdentity.layoutStyle]
        .filter(Boolean)
        .join("; "),
    ),
  };
  next.content_patterns = next.contentStrategy.contentPillars;
  next.competitor_insights = next.positioning.competitorReferences;
  next.updatedAt = new Date().toISOString();

  return next;
}

export function toBusinessDnaPromptBudgetDiagnostics(
  budget?: (PromptBudgetStats & { compactionTier?: CompactionTier; maxOutputTokens?: number }) | null,
): Record<string, unknown> {
  if (!budget) return {};
  return {
    estimatedInputTokens: budget.estimatedInputTokens,
    maxOutputTokens: budget.maxOutputTokens ?? BUSINESS_DNA_MAX_OUTPUT_TOKENS,
    estimatedTotalTokens:
      budget.estimatedTotalTokens ??
      budget.estimatedInputTokens + (budget.maxOutputTokens ?? BUSINESS_DNA_MAX_OUTPUT_TOKENS),
    compactionTier: budget.compactionTier ?? null,
    promptBudgetSegments: budget.segments,
  };
}

export async function generateBusinessDnaWithLlm(params: {
  provider: LLMProvider;
  input: BusinessDnaGeneratorInput;
  baseBusinessDna: BusinessDna;
  repairIssues?: string[];
  existingDraft?: BusinessDna | null;
}): Promise<BusinessDnaGenerationResult> {
  const prepared = prepareBusinessDnaPrompt({
    input: params.input,
    repairIssues: params.repairIssues,
    existingDraft: params.existingDraft ?? null,
  });
  const prompt = prepared.prompt;
  const providerInfo = params.provider.describe?.() ?? { provider: params.provider.id, model: "default" };
  const resolvedOutput = resolveBusinessDnaMaxOutputTokens({ providerId: providerInfo.provider });
  const maxOutputTokens = Math.min(prepared.promptBudget.maxOutputTokens, resolvedOutput.maxOutputTokens);

  let rawResponse = "";
  console.info(
    `[llm-observe] business_dna.prompt hash=${hashPreview(prompt)} compaction_tier=${prepared.compactionTier} estimated_input=${prepared.promptBudget.estimatedInputTokens} max_output=${maxOutputTokens} preview=${prompt.replace(/\s+/g, " ").trim().slice(0, 500)}`,
  );
  const parsed = await getStrictJsonWithRetry<GeneratedBusinessDnaDraft>(params.provider, {
    contextLabel: params.repairIssues?.length ? "business dna repair" : "business dna",
    maxOutputTokens,
    onRawResponse: (raw, attempt) => {
      rawResponse = raw;
      console.info(
        `[llm-observe] business_dna.raw attempt=${attempt} hash=${hashPreview(raw)} preview=${raw.replace(/\s+/g, " ").trim().slice(0, 1000)}`,
      );
    },
    messages: [
      { role: "system", content: BUSINESS_DNA_SYSTEM },
      {
        role: "user",
        content: prompt,
      },
    ],
  });
  const info = params.provider.describe?.() ?? { provider: params.provider.id, model: "default" };
  const businessDna = mergeGeneratedDraft(buildObservedBusinessDnaBase(params.baseBusinessDna), parsed);
  console.info(
    `[llm-observe] business_dna.final hash=${hashPreview(JSON.stringify(businessDna))} raw_hash=${hashPreview(rawResponse || JSON.stringify(parsed))} helper_modified_content_fields=no`,
  );

  return {
    businessDna,
    provider: info.provider,
    model: info.model,
    validationStatus: "not_run",
    validationIssues: [],
    promptBudget: {
      ...prepared.promptBudget,
      maxOutputTokens,
      estimatedTotalTokens: prepared.promptBudget.estimatedInputTokens + maxOutputTokens,
    },
  };
}
