import type { CanonicalFieldDef } from "./types.js";
import { fieldHeadingMatchKeys, normalizeHeading } from "./normalize-heading.js";

export type SectionDef = {
  id: string;
  aliases: string[];
  preserveOnly?: boolean;
};

export const SECTION_DEFS: SectionDef[] = [
  { id: "basic_client_info", aliases: ["basic client info", "client info", "1 basic client info", "client basics"] },
  { id: "sow_summary", aliases: ["sow summary", "sow details", "2 sow summary", "sow details"] },
  { id: "website_context", aliases: ["website context", "3 website context", "5 website context", "website signals"] },
  { id: "instagram_context", aliases: ["instagram context", "4 instagram context", "instagram"] },
  { id: "audience_inputs", aliases: ["audience inputs", "5 audience inputs", "6 audience inputs", "target audience inputs"] },
  { id: "positioning_inputs", aliases: ["positioning inputs", "6 positioning inputs", "7 positioning inputs"] },
  { id: "offer_inputs", aliases: ["offer inputs", "7 offer inputs", "8 offer inputs"] },
  { id: "tone_of_voice_inputs", aliases: ["tone of voice inputs", "8 tone of voice inputs", "9 tone of voice inputs", "tone and voice inputs"] },
  { id: "visual_identity_inputs", aliases: ["visual identity inputs", "9 visual identity inputs", "10 visual identity inputs"] },
  { id: "content_strategy_inputs", aliases: ["content strategy inputs", "10 content strategy inputs", "11 content strategy inputs"] },
  { id: "claim_and_safety_notes", aliases: ["claim and safety notes", "11 claim and safety notes", "12 claim and safety notes", "claims and safety"] },
  { id: "source_and_provenance_map", aliases: ["source and provenance map", "12 source and provenance map", "13 source and provenance map", "provenance map"] },
  { id: "missing_information", aliases: ["missing information needed from client", "13 missing information needed from client", "missing information", "gaps and missing info"] },
  { id: "platform_management", aliases: ["platform management", "3 platform management"] },
];

const FIELD_ALIASES: Array<{ aliases: string[]; def: Omit<CanonicalFieldDef, "skip"> & { skipAliases?: string[] } }> = [
  // Basic client info
  { aliases: ["client name", "brand name", "name"], def: { id: "client.name", label: "Client name", sectionId: "basic_client_info", valueType: "string", targetPath: "client.name" } },
  { aliases: ["website url", "website", "site url", "url"], def: { id: "client.website", label: "Website URL", sectionId: "basic_client_info", valueType: "string", targetPath: "client.website" } },
  { aliases: ["instagram url", "instagram handle", "instagram", "ig handle"], def: { id: "client.instagramHandle", label: "Instagram handle", sectionId: "basic_client_info", valueType: "string", targetPath: "client.instagramHandle" } },
  { aliases: ["one-line business description", "one line description", "one-line description", "business description", "one line business summary"], def: { id: "client.oneLineDescription", label: "One-line description", sectionId: "basic_client_info", valueType: "string", targetPath: "client.oneLineDescription" } },
  { aliases: ["business type", "business type/category", "business category", "category"], def: { id: "client.businessType", label: "Business type", sectionId: "basic_client_info", valueType: "string", targetPath: "client.businessType" } },

  // SOW summary
  { aliases: ["client industry", "industry"], def: { id: "sow.industry", label: "Client industry", sectionId: "sow_summary", valueType: "string", targetPath: "sow.industry" } },
  { aliases: ["target audience", "target audience signals from sow", "audience from sow"], def: { id: "sow.targetAudience", label: "Target audience", sectionId: "sow_summary", valueType: "string", targetPath: "sow.targetAudience" } },
  { aliases: ["goals and requirements", "goals & requirements", "objectives and goals", "goals and requirements from sow"], def: { id: "sow.understandingOfRequirements", label: "Goals and requirements", sectionId: "sow_summary", valueType: "string", targetPath: "sow.understandingOfRequirements" } },
  { aliases: ["strategy and launch plan", "launch plan", "strategy launch plan", "strategy and launch plan from sow"], def: { id: "sow.strategyLaunchPlanning", label: "Strategy and launch plan", sectionId: "sow_summary", valueType: "string", targetPath: "sow.strategyLaunchPlanning" } },
  { aliases: ["content deliverables", "content deliverables / full sow notes", "full sow notes", "deliverables notes", "content deliverables from sow", "full sow notes from sow"], def: { id: "sow.contentCreation", label: "Content deliverables", sectionId: "sow_summary", valueType: "string", targetPath: "sow.contentCreation" } },
  { aliases: ["deliverables summary", "deliverables list", "monthly deliverables", "deliverables summary from sow"], def: { id: "sow.deliverables", label: "Deliverables summary", sectionId: "sow_summary", valueType: "string[]", targetPath: "sow.deliverables" } },
  { aliases: ["useful strategy notes", "strategy notes", "additional sow notes", "useful strategy notes from sow"], def: { id: "sow.strategyNotes", label: "Useful strategy notes", sectionId: "sow_summary", valueType: "string", targetPath: "sow.strategyNotes" } },
  { aliases: ["ignore", "not needed for tool", "ignore/not needed"], def: { id: "sow.ignore", label: "Ignore", sectionId: "sow_summary", valueType: "string", targetPath: "sow.ignore", skipAliases: ["ignore", "not needed"] } },

  // Website context
  { aliases: ["homepage summary", "homepage"], def: { id: "website.homepageSummary", label: "Homepage summary", sectionId: "website_context", valueType: "string", targetPath: "website.homepageSummary" } },
  { aliases: ["brand positioning from website", "brand positioning"], def: { id: "website.brandPositioning", label: "Brand positioning", sectionId: "website_context", valueType: "string", targetPath: "website.brandPositioning" } },
  { aliases: ["products/services/offers", "products services offers", "products and services"], def: { id: "website.productsServicesOffers", label: "Products/services/offers", sectionId: "website_context", valueType: "string", targetPath: "website.productsServicesOffers" } },
  { aliases: ["product categories", "product categories or collections", "collections"], def: { id: "website.productCategories", label: "Product categories", sectionId: "website_context", valueType: "string", targetPath: "website.productCategories" } },
  { aliases: ["main ctas", "ctas", "calls to action"], def: { id: "website.mainCtas", label: "Main CTAs", sectionId: "website_context", valueType: "string", targetPath: "website.mainCtas" } },
  { aliases: ["website proof/trust signals", "proof/trust signals", "trust signals from website"], def: { id: "website.proofTrustSignals", label: "Website proof/trust", sectionId: "website_context", valueType: "string", targetPath: "website.proofTrustSignals" } },
  { aliases: ["faqs/objections", "faqs", "objections"], def: { id: "website.faqsObjections", label: "FAQs/objections", sectionId: "website_context", valueType: "string", targetPath: "website.faqsObjections" } },
  { aliases: ["claims used on website", "website claims"], def: { id: "website.claimsUsed", label: "Claims on website", sectionId: "website_context", valueType: "string", targetPath: "website.claimsUsed" } },
  { aliases: ["tone and messaging patterns", "messaging patterns"], def: { id: "website.toneMessagingPatterns", label: "Tone/messaging patterns", sectionId: "website_context", valueType: "string", targetPath: "website.toneMessagingPatterns" } },
  { aliases: ["important website pages/links", "important website pages / links", "important pages", "key pages"], def: { id: "website.importantPages", label: "Important pages/links", sectionId: "website_context", valueType: "string", targetPath: "website.importantPages" } },
  { aliases: ["website gaps/missing info", "website gaps"], def: { id: "website.gaps", label: "Website gaps", sectionId: "website_context", valueType: "string", targetPath: "website.gaps" } },

  // Instagram context
  { aliases: ["instagram handle"], def: { id: "instagram.handle", label: "Instagram handle", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.handle" } },
  { aliases: ["profile bio", "bio"], def: { id: "instagram.bio", label: "Profile bio", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.bio" } },
  { aliases: ["profile category", "category"], def: { id: "instagram.category", label: "Profile category", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.category" } },
  { aliases: ["follower count", "followers"], def: { id: "instagram.followerCount", label: "Follower count", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.followerCount" } },
  { aliases: ["what they sell/offer", "what they sell", "offer from instagram", "what they sell / offer from instagram", "what they sell/offer from instagram"], def: { id: "instagram.offerSummary", label: "What they sell/offer", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.offerSummary" } },
  { aliases: ["recent post themes", "recent post captions", "recent post captions or post themes", "post themes"], def: { id: "instagram.recentCaptionSnippets", label: "Recent post themes", sectionId: "instagram_context", valueType: "string[]", targetPath: "instagram.recentCaptionSnippets" } },
  { aliases: ["recurring content topics", "recurring topics"], def: { id: "instagram.recurringTopics", label: "Recurring topics", sectionId: "instagram_context", valueType: "string[]", targetPath: "instagram.recurringTopics" } },
  { aliases: ["cta patterns"], def: { id: "instagram.ctaPatterns", label: "CTA patterns", sectionId: "instagram_context", valueType: "string[]", targetPath: "instagram.ctaPatterns" } },
  { aliases: ["proof/trust signals from instagram", "proof / trust signals from instagram", "proof signals from instagram"], def: { id: "instagram.proofSignals", label: "Instagram proof signals", sectionId: "instagram_context", valueType: "string[]", targetPath: "instagram.proofSignals" } },
  { aliases: ["visual style notes", "visual style"], def: { id: "instagram.visualStyleNotes", label: "Visual style notes", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.visualStyleNotes" } },
  { aliases: ["content format patterns", "format patterns"], def: { id: "instagram.contentFormatPatterns", label: "Content format patterns", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.contentFormatPatterns" } },
  { aliases: ["instagram gaps/missing info", "instagram gaps"], def: { id: "instagram.gaps", label: "Instagram gaps", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.gaps" } },
  { aliases: ["additional instagram notes"], def: { id: "instagram.additionalInstagramNotes", label: "Additional Instagram notes", sectionId: "instagram_context", valueType: "string", targetPath: "instagram.additionalInstagramNotes" } },

  // Audience inputs
  { aliases: ["primary audience"], def: { id: "research.audience.primary", label: "Primary audience", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.primary" } },
  { aliases: ["secondary audience"], def: { id: "research.audience.secondary", label: "Secondary audience", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.secondary" } },
  { aliases: ["demographics"], def: { id: "research.audience.demographics", label: "Demographics", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.demographics" } },
  { aliases: ["psychographics"], def: { id: "research.audience.psychographics", label: "Psychographics", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.psychographics" } },
  { aliases: ["geographies"], def: { id: "research.audience.geographies", label: "Geographies", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.geographies" } },
  { aliases: ["pain points", "pains"], def: { id: "research.audience.painPoints", label: "Pain points", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.painPoints" } },
  { aliases: ["desires"], def: { id: "research.audience.desires", label: "Desires", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.desires" } },
  { aliases: ["objections"], def: { id: "research.audience.objections", label: "Objections", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.objections" } },
  { aliases: ["buying triggers"], def: { id: "research.audience.buyingTriggers", label: "Buying triggers", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.buyingTriggers" } },
  { aliases: ["repeat purchase triggers"], def: { id: "research.audience.repeatPurchaseTriggers", label: "Repeat purchase triggers", sectionId: "audience_inputs", valueType: "string", targetPath: "research.audience.repeatPurchaseTriggers" } },

  // Positioning
  { aliases: ["value proposition"], def: { id: "research.positioning.valueProposition", label: "Value proposition", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.valueProposition" } },
  { aliases: ["differentiators"], def: { id: "research.positioning.differentiators", label: "Differentiators", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.differentiators" } },
  { aliases: ["market angle"], def: { id: "research.positioning.marketAngle", label: "Market angle", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.marketAngle" } },
  { aliases: ["reasons to believe"], def: { id: "research.positioning.reasonsToBelieve", label: "Reasons to believe", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.reasonsToBelieve" } },
  { aliases: ["competitor references", "competitors"], def: { id: "research.positioning.competitorReferences", label: "Competitor references", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.competitorReferences" } },
  { aliases: ["positioning risks"], def: { id: "research.positioning.positioningRisks", label: "Positioning risks", sectionId: "positioning_inputs", valueType: "string", targetPath: "research.positioning.positioningRisks" } },

  // Offer
  { aliases: ["primary offers"], def: { id: "research.offer.primaryOffers", label: "Primary offers", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.primaryOffers" } },
  { aliases: ["product/service details", "product details"], def: { id: "research.offer.productServiceDetails", label: "Product/service details", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.productServiceDetails" } },
  { aliases: ["pricing signals", "pricing"], def: { id: "research.offer.pricingSignals", label: "Pricing signals", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.pricingSignals" } },
  { aliases: ["transformation promise"], def: { id: "research.offer.transformationPromise", label: "Transformation promise", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.transformationPromise" } },
  { aliases: ["urgency style"], def: { id: "research.offer.urgencyStyle", label: "Urgency style", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.urgencyStyle" } },
  { aliases: ["offer gaps"], def: { id: "research.offer.offerGaps", label: "Offer gaps", sectionId: "offer_inputs", valueType: "string", targetPath: "research.offer.offerGaps" } },

  // Tone
  { aliases: ["tone keywords"], def: { id: "research.tone.toneKeywords", label: "Tone keywords", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.toneKeywords" } },
  { aliases: ["language patterns"], def: { id: "research.tone.languagePatterns", label: "Language patterns", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.languagePatterns" } },
  { aliases: ["words/phrases the brand uses", "brand phrases"], def: { id: "research.tone.brandPhrases", label: "Brand phrases", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.brandPhrases" } },
  { aliases: ["words/claims to avoid", "words to avoid"], def: { id: "research.tone.wordsToAvoid", label: "Words to avoid", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.wordsToAvoid" } },
  { aliases: ["cta style"], def: { id: "research.tone.ctaStyle", label: "CTA style", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.ctaStyle" } },
  { aliases: ["sample brand-safe phrases", "sample phrases"], def: { id: "research.tone.samplePhrases", label: "Sample brand-safe phrases", sectionId: "tone_of_voice_inputs", valueType: "string", targetPath: "research.tone.samplePhrases" } },

  // Visual identity
  { aliases: ["main visual vibe", "visual vibe"], def: { id: "research.visual.mainVisualVibe", label: "Main visual vibe", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.mainVisualVibe" } },
  { aliases: ["layout style"], def: { id: "research.visual.layoutStyle", label: "Layout style", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.layoutStyle" } },
  { aliases: ["typography style"], def: { id: "research.visual.typographyStyle", label: "Typography style", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.typographyStyle" } },
  { aliases: ["logo style"], def: { id: "research.visual.logoStyle", label: "Logo style", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.logoStyle" } },
  { aliases: ["imagery style"], def: { id: "research.visual.imageryStyle", label: "Imagery style", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.imageryStyle" } },
  { aliases: ["design motifs"], def: { id: "research.visual.designMotifs", label: "Design motifs", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.designMotifs" } },
  { aliases: ["color palette candidates", "color palette"], def: { id: "research.visual.colorPaletteCandidates", label: "Color palette candidates", sectionId: "visual_identity_inputs", valueType: "string", targetPath: "research.visual.colorPaletteCandidates" } },

  // Content strategy
  { aliases: ["possible content pillars", "content pillars"], def: { id: "research.content.contentPillars", label: "Content pillars", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.contentPillars" } },
  { aliases: ["themes that fit the brand", "themes"], def: { id: "research.content.themes", label: "Themes", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.themes" } },
  { aliases: ["hooks that fit the brand", "hooks"], def: { id: "research.content.hooks", label: "Hooks", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.hooks" } },
  { aliases: ["topics to avoid"], def: { id: "research.content.topicsToAvoid", label: "Topics to avoid", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.topicsToAvoid" } },
  { aliases: ["trust signals to repeat"], def: { id: "research.content.trustSignalsToRepeat", label: "Trust signals to repeat", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.trustSignalsToRepeat" } },
  { aliases: ["product storytelling angles"], def: { id: "research.content.productStorytellingAngles", label: "Product storytelling angles", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.productStorytellingAngles" } },
  { aliases: ["educational angles"], def: { id: "research.content.educationalAngles", label: "Educational angles", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.educationalAngles" } },
  { aliases: ["social proof angles"], def: { id: "research.content.socialProofAngles", label: "Social proof angles", sectionId: "content_strategy_inputs", valueType: "string", targetPath: "research.content.socialProofAngles" } },

  // Claim safety
  { aliases: ["claims allowed/visible", "claims allowed"], def: { id: "claim.claimsAllowed", label: "Claims allowed", sectionId: "claim_and_safety_notes", valueType: "string", targetPath: "claim.claimsAllowed" } },
  { aliases: ["claims to avoid"], def: { id: "claim.claimsToAvoid", label: "Claims to avoid", sectionId: "claim_and_safety_notes", valueType: "string", targetPath: "claim.claimsToAvoid" } },
  { aliases: ["proof limitations"], def: { id: "claim.proofLimitations", label: "Proof limitations", sectionId: "claim_and_safety_notes", valueType: "string", targetPath: "claim.proofLimitations" } },
  { aliases: ["sensitive category notes", "wellness/health claim caution", "health claim caution"], def: { id: "claim.sensitiveCategoryNotes", label: "Sensitive category notes", sectionId: "claim_and_safety_notes", valueType: "string", targetPath: "claim.sensitiveCategoryNotes" } },
];

const sectionAliasMap = new Map<string, string>();
for (const section of SECTION_DEFS) {
  for (const alias of section.aliases) {
    for (const key of fieldHeadingMatchKeys(alias)) {
      sectionAliasMap.set(key, section.id);
    }
  }
}

const fieldAliasMap = new Map<string, CanonicalFieldDef>();
for (const entry of FIELD_ALIASES) {
  const def: CanonicalFieldDef = {
    ...entry.def,
    skip: Boolean(entry.def.skipAliases?.length),
  };
  for (const alias of entry.aliases) {
    for (const key of fieldHeadingMatchKeys(alias)) {
      fieldAliasMap.set(key, def);
    }
  }
}

function headingsMatch(heading: string, alias: string): boolean {
  const headingKeys = fieldHeadingMatchKeys(heading);
  const aliasKeys = fieldHeadingMatchKeys(alias);
  return headingKeys.some((key) => aliasKeys.includes(key));
}

export function matchSectionId(heading: string): string | null {
  for (const key of fieldHeadingMatchKeys(heading)) {
    const id = sectionAliasMap.get(key);
    if (id) return id;
  }
  return null;
}

export function matchFieldDef(heading: string, sectionId: string | null): CanonicalFieldDef | null {
  if (sectionId) {
    for (const entry of FIELD_ALIASES) {
      if (entry.def.sectionId !== sectionId) continue;
      if (entry.aliases.some((alias) => headingsMatch(heading, alias))) {
        return { ...entry.def, skip: Boolean(entry.def.skipAliases?.length) };
      }
    }
  }

  for (const key of fieldHeadingMatchKeys(heading)) {
    const direct = fieldAliasMap.get(key);
    if (direct) return direct;
  }

  for (const entry of FIELD_ALIASES) {
    if (entry.aliases.some((alias) => headingsMatch(heading, alias))) {
      return { ...entry.def, skip: Boolean(entry.def.skipAliases?.length) };
    }
  }
  return null;
}

export function getFieldDefById(id: string): CanonicalFieldDef | null {
  for (const entry of FIELD_ALIASES) {
    if (entry.def.id === id) {
      return { ...entry.def, skip: Boolean(entry.def.skipAliases?.length) };
    }
  }
  return null;
}

export function getFieldLabel(targetPath: string): string {
  for (const entry of FIELD_ALIASES) {
    if (entry.def.targetPath === targetPath) return entry.def.label;
  }
  return targetPath;
}

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_HEADINGS = 200;
