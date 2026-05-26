import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens } from "../llm/prompt-budget.js";
import {
  BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS,
  BUSINESS_DNA_MAX_OUTPUT_TOKENS,
  BUSINESS_DNA_TARGET_INPUT_TOKENS,
} from "./constants.js";
import { compactBusinessDnaGeneratorInput } from "./compact-input.js";
import type { BusinessDnaGeneratorInput } from "./generate.js";
import { isBusinessDnaRequestWithinGroqBudget } from "./provider-budget.js";

function baseInput(): BusinessDnaGeneratorInput {
  return {
    client: {
      brandName: "Svara",
      clientName: "Svara",
      websiteUrl: "https://svara.example",
      instagramHandle: "@svara",
      oneLineDescription: "Social-first agency for founder-led brands",
    },
    businessType: { primary: "agency", confidence: "high" },
    sow: {
      industry: "Marketing agency",
      targetAudience: "Founder-led service businesses",
      understandingOfRequirements: "Launch social strategy and monthly content",
      strategyLaunchPlanning: "Audit channels, define pillars, launch calendar",
      contentCreation: "12 posts per month across Instagram and LinkedIn",
      scopeOfWork: "Strategy launch planning plus content creation deliverables",
      platforms: ["instagram", "linkedin"],
      monthlyPosts: { instagram: 8, linkedin: 4 },
      contentMix: { educational: 40, promotional: 30, social_proof: 30 },
      deliverables: Array.from({ length: 12 }, (_, index) => `Deliverable ${index + 1}`),
      toneByPlatform: { instagram: "playful", linkedin: "professional" },
    },
    instagram: {
      handle: "@svara",
      bio: "Not your regular agency. We build social systems for founders.",
      offerSummary: "Done-for-you social strategy and content",
      recentCaptionSnippets: Array.from({ length: 10 }, (_, index) => `Caption snippet ${index + 1} `.repeat(20)),
      recurringTopics: Array.from({ length: 10 }, (_, index) => `Topic ${index + 1}`),
      ctaPatterns: ["DM us", "Book a call", "Link in bio"],
      proofSignals: ["500+ posts shipped", "Founder testimonials"],
      visualStyleNotes: "Bold typography, founder-led reels",
      instagramSummaryNotes:
        "Bio repeats offer and captions summarize founder storytelling and CTA patterns for social-first agencies.",
    },
    website: {
      title: "Svara Social",
      heroExcerpt: "Social systems for founder-led brands",
      colors: ["#111111", "#ffffff"],
    },
    importedResearch: {
      sourceProvenance: "x".repeat(900),
      missingInformation: Array.from({ length: 20 }, (_, index) => `Missing ${index + 1}`),
      additionalNotes: "y".repeat(900),
      claimSafetyNotes: { claimsToAvoid: "Do not claim clinical outcomes" },
      websiteContext: {
        homepageSummary: "Social systems for founder-led brands",
        brandPositioning: "Founder-friendly social agency",
      },
      researchInputs: {
        positioning: { valueProposition: "Founder-friendly social agency" },
        audience: { primary: "Founder-led service businesses" },
        offer: { primaryOffers: "Done-for-you social strategy and content" },
        tone: { toneKeywords: "playful, strategic, founder-friendly" },
        content: { contentPillars: "founder storytelling, social proof, education" },
      },
    },
  };
}

test("compactBusinessDnaGeneratorInput removes instagramSummaryNotes when structured IG exists", () => {
  const compact = compactBusinessDnaGeneratorInput(baseInput(), 0);
  assert.equal(compact.instagram?.instagramSummaryNotes, undefined);
});

test("compactBusinessDnaGeneratorInput omits redundant scopeOfWork when v2 SOW fields populated", () => {
  const compact = compactBusinessDnaGeneratorInput(baseInput(), 0);
  assert.equal(compact.sow.scopeOfWork, "");
});

test("compactBusinessDnaGeneratorInput strips sourceProvenance and caps missingInformation", () => {
  const compact = compactBusinessDnaGeneratorInput(baseInput(), 2);
  assert.equal(compact.importedResearch?.sourceProvenance, undefined);
  assert.ok(Array.isArray(compact.importedResearch?.missingInformation));
  assert.ok((compact.importedResearch?.missingInformation as string[]).length <= 5);
});

test("estimated input + maxOutput stays within Groq target after tier-2 compact", () => {
  const compact = compactBusinessDnaGeneratorInput(baseInput(), 2);
  const estimatedInput = estimateTokens(JSON.stringify(compact));
  assert.ok(estimatedInput <= BUSINESS_DNA_TARGET_INPUT_TOKENS + 1500);
  assert.ok(isBusinessDnaRequestWithinGroqBudget(estimatedInput, BUSINESS_DNA_MAX_OUTPUT_TOKENS));
  assert.ok(estimatedInput + BUSINESS_DNA_MAX_OUTPUT_TOKENS <= BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS + 500);
});
