import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTokens } from "../llm/prompt-budget.js";
import {
  buildCompactCalendarContext,
  buildCompactCalendarWeekContext,
  buildPlannerPromptFromCompactContext,
  expandWeeklyBucketSequence,
} from "./compact-calendar-context.js";
import type { CalendarBrief, PlannerLayer } from "./generate.js";
import { CALENDAR_PLANNER_TARGET_INPUT, CALENDAR_WEEK_TARGET_INPUT_GROQ } from "./provider-budget.js";

function buildFixtureBrief(): CalendarBrief {
  const repeated = "Ritual-led wellness education for modern self-care routines.";
  return {
    client: {
      name: "Acme Brand",
      businessType: "D2C wellness",
      strategyType: "brand_building",
      oneLinePositioning: repeated,
      offer: "Daily ritual mist",
      productTruths: [repeated, "Alcohol-free botanical formula", "Evening wind-down ritual"],
      differentiators: [repeated, "Founder-led education"],
      specificReferences: ["Magnesium-forward positioning", repeated],
      paidScopeExplicit: false,
    },
    requirements: {
      month: "June 2026",
      startDate: "2026-06-01",
      totalPosts: 16,
      platforms: ["Instagram"],
      platformCounts: { Instagram: 16 },
      contentBuckets: { Education: 8, Promotion: 4, "Social proof": 2, "Thought leadership": 2 },
      deliverables: ["Reels", "Carousels"],
      hardConstraints: ["No medical claims", "No paid ads language"],
    },
    audience: {
      primarySegments: ["Wellness-curious professionals", "Evening ritual builders"],
      stage: "consideration",
      pains: ["Overstimulation before bed", repeated],
      desires: ["Calmer evenings", "Sensory rituals"],
      objections: ["Skeptical of wellness claims"],
    },
    brandVoice: {
      tone: "Warm, educational",
      personality: "Grounded, premium",
      avoidList: ["Cure", "Treatment"],
    },
    contentPillars: [
      { name: "Education", angle: "How rituals work" },
      { name: "Promotion", angle: "Discovery moments" },
    ],
    platformStrategy: [
      {
        platform: "Instagram",
        role: "Discovery",
        objective: "Build trust",
        contentBehavior: `${repeated} Strategy note: ${repeated}`,
      },
    ],
    strategicContext: {
      jtaContentStrategySummary: repeated.repeat(3),
      jtaPlatformStrategySummary: "Instagram for education and soft discovery.",
    },
    weeklyFlow: ["Awareness", "Education", "Offer support", "Proof-building"],
    ctaStyleByPlatform: { Instagram: "Save for your ritual" },
    kpis: ["Saves", "Shares"],
    trustSignals: [repeated],
    proofContract: {
      proofAssetsAvailable: false,
      availableProofTypes: ["faq"],
      testimonialStyleAllowed: false,
    },
    safety: {
      forbiddenTerms: ["testimonials", "clinical proof"],
      healthClaimSafetyMode: "wellness_beauty_softened",
      paidAllowed: false,
    },
    planningContext: {
      monthlyGoal: "Grow ritual education saves",
      normalizedNotes: ["Keep claims soft", "Build proof over time"],
    },
  };
}

function buildFixturePlanner(): PlannerLayer {
  return {
    distribution: { education: 50, promotion: 25, social_proof: 12, thought_leadership: 13 },
    formats: { reel: 50, carousel: 50 },
    platformSplit: { Instagram: 16 },
    angleBank: { education: ["Ingredient education", "Ritual how-to"] },
    hookStyles: ["curiosity"],
    weeklyFlow: {
      week_1: "Awareness",
      week_2: "Education",
      week_3: "Offer support",
      week_4: "Proof-building",
    },
    pillars: [{ name: "Education", description: "Explain rituals", color: "#B05B47" }],
    kpis: { saves: "Track weekly" },
    phases: [
      { name: "Week 1", focus: "Awareness" },
      { name: "Week 2", focus: "Education" },
      { name: "Week 3", focus: "Offer support" },
      { name: "Week 4", focus: "Proof-building" },
    ],
  };
}

test("buildCompactCalendarContext dedupes overlapping DNA/JTA strings", () => {
  const compact = buildCompactCalendarContext(buildFixtureBrief(), 0);
  const anchors = compact.productAnchors.join(" ").toLowerCase();
  assert.ok(!anchors.includes(repeatedSnippet(3)), "should not repeat the same positioning blob many times");
  assert.equal(compact.proofConstraints.testimonialStyleAllowed, false);
  assert.equal(compact.contentBuckets.Education, 8);
});

test("buildCompactCalendarContext planner payload stays within target input budget", () => {
  const brief = buildFixtureBrief();
  const compact = buildCompactCalendarContext(brief, 0);
  const prompt = buildPlannerPromptFromCompactContext(
    compact,
    "- Education (key: education) — How rituals work",
  );
  const tokens = estimateTokens(prompt);
  assert.ok(tokens <= CALENDAR_PLANNER_TARGET_INPUT, `planner prompt too large: ${tokens}`);
});

test("buildCompactCalendarWeekContext stays within Groq week input target", () => {
  const brief = buildFixtureBrief();
  const planner = buildFixturePlanner();
  const week = buildCompactCalendarWeekContext({
    brief,
    planner,
    weekIndex: 0,
    weekStartDate: "2026-06-01",
    targetPosts: 4,
    priorWeekThemes: [],
    tier: 0,
  });
  const tokens = estimateTokens(JSON.stringify(week));
  assert.ok(tokens <= CALENDAR_WEEK_TARGET_INPUT_GROQ, `week brief too large: ${tokens}`);
  assert.deepEqual(week.requiredBuckets.length, 4);
});

test("expandWeeklyBucketSequence preserves bucket totals for 16 posts", () => {
  const sequence = expandWeeklyBucketSequence(
    { Education: 2, Promotion: 1, "Social proof": 1 },
    4,
  );
  assert.equal(sequence.length, 4);
  assert.equal(sequence.filter((bucket) => bucket === "Education").length, 2);
  assert.equal(sequence.filter((bucket) => bucket === "Promotion").length, 1);
  assert.equal(sequence.filter((bucket) => bucket === "Social proof").length, 1);
});

function repeatedSnippet(repeats: number): string {
  return "Ritual-led wellness education for modern self-care routines.".repeat(repeats).toLowerCase();
}
