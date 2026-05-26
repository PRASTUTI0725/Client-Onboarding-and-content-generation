import assert from "node:assert/strict";
import { test } from "node:test";
import { PromptBudgetError } from "../llm/prompt-budget.js";
import {
  buildCompactCalendarContext,
  buildCompactCalendarWeekContext,
} from "./compact-calendar-context.js";
import type { CalendarBrief, PlannerLayer } from "./generate.js";
import { GroqRunTokenPacer } from "./groq-run-pacer.js";
import {
  CALENDAR_WEEK_MAX_OUTPUT_GROQ,
  CALENDAR_WEEK_TARGET_INPUT_GROQ,
  calendarWeekStaggerMs,
  resolveCalendarMaxOutputTokens,
  resolveGroqWeekCallDelayMs,
} from "./provider-budget.js";
import {
  compactWeeklyBriefForProvider,
  enforceWeeklyInputBeforeProviderCall,
  isGroqRateLimitError,
} from "./weekly-generation-budget.js";
import {
  estimateWeeklyPromptOverheadTokens,
  resolveWeekPostsSystemPrompt,
  WEEK_POSTS_SYSTEM,
  WEEK_POSTS_SYSTEM_GROQ,
} from "./weekly-prompt.js";

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
      specificReferences: ["Botanical-forward positioning", repeated],
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
    pillars: [{ name: "Education", color: "#B05B47", description: "Explain rituals" }],
    kpis: { saves: "Track weekly" },
    phases: [
      { name: "Week 1", focus: "Awareness" },
      { name: "Week 2", focus: "Education" },
      { name: "Week 3", focus: "Offer support" },
      { name: "Week 4", focus: "Proof-building" },
    ],
  };
}

test("Groq weekly system + instruction overhead is under 450 tokens", () => {
  const overhead = estimateWeeklyPromptOverheadTokens("groq", 4);
  assert.ok(overhead.totalFixedTokens <= 450, `fixed overhead too large: ${overhead.totalFixedTokens}`);
  assert.ok(overhead.systemTokens < estimateWeeklyPromptOverheadTokens("openrouter", 4).systemTokens);
});

test("compact weekly prompt for 16-post fixture stays within Groq week target", () => {
  const brief = buildFixtureBrief();
  const planner = buildFixturePlanner();
  const base = buildCompactCalendarContext(brief, 0);
  let maxAfter = 0;
  for (let weekIndex = 0; weekIndex < 4; weekIndex += 1) {
    const week = buildCompactCalendarWeekContext({
      brief,
      planner,
      baseContext: base,
      weekIndex,
      weekStartDate: `2026-06-${String(1 + weekIndex * 7).padStart(2, "0")}`,
      targetPosts: 4,
      priorWeekThemes: weekIndex > 0 ? ["Prior theme summary"] : [],
    });
    const compacted = compactWeeklyBriefForProvider({
      brief: week,
      targetCount: 4,
      providerId: "groq",
    });
    maxAfter = Math.max(maxAfter, compacted.afterTokens);
    assert.equal(compacted.overBudget, false, `week ${weekIndex + 1} still over budget: ${compacted.afterTokens}`);
    assert.ok(
      compacted.afterTokens <= CALENDAR_WEEK_TARGET_INPUT_GROQ,
      `week ${weekIndex + 1} tokens ${compacted.afterTokens}`,
    );
  }
  assert.ok(maxAfter < 1526, `expected lower than old 1526 baseline, got ${maxAfter}`);
});

test("enforceWeeklyInputBeforeProviderCall rejects Groq week prompts over target", () => {
  assert.throws(
    () =>
      enforceWeeklyInputBeforeProviderCall({
        providerId: "groq",
        stageLabel: "calendar week 1",
        systemPrompt: WEEK_POSTS_SYSTEM,
        promptParts: [{ label: "brief_json", value: "x".repeat(8000) }],
        maxOutputTokens: CALENDAR_WEEK_MAX_OUTPUT_GROQ,
        compactionTier: 2,
        budgetGuardEnabled: false,
      }),
    (err: unknown) => err instanceof PromptBudgetError,
  );
});

test("Groq week delay defaults to at least 8 seconds and calendarWeekStaggerMs uses it", () => {
  const delay = resolveGroqWeekCallDelayMs();
  assert.ok(delay >= 8000, `expected conservative default delay, got ${delay}`);
  assert.equal(calendarWeekStaggerMs("groq"), delay);
  assert.equal(calendarWeekStaggerMs("openrouter"), 0);
});

test("GroqRunTokenPacer applies delay after planner call completes", async () => {
  const pacer = new GroqRunTokenPacer("groq");
  pacer.recordCall(1100, 450);
  const started = Date.now();
  const snapshot = await pacer.waitBeforeNextCall();
  assert.ok(snapshot.delayMsApplied >= resolveGroqWeekCallDelayMs());
  assert.ok(Date.now() - started >= resolveGroqWeekCallDelayMs() - 50);
  assert.equal(snapshot.cumulativeEstimatedTokens, 1550);
});

test("isGroqRateLimitError detects 429 and TPM messages", () => {
  assert.equal(isGroqRateLimitError(new Error("HTTP 429 rate limit exceeded")), true);
  assert.equal(isGroqRateLimitError({ httpStatus: 429, message: "Too many requests" }), true);
  assert.equal(isGroqRateLimitError(new Error("invalid json")), false);
});

test("resolveWeekPostsSystemPrompt uses compact Groq system prompt", () => {
  assert.equal(resolveWeekPostsSystemPrompt("groq"), WEEK_POSTS_SYSTEM_GROQ);
  assert.equal(resolveWeekPostsSystemPrompt("openrouter"), WEEK_POSTS_SYSTEM);
});

test("Groq week max output cap lowered to 420 for 4-post batch", () => {
  assert.equal(
    resolveCalendarMaxOutputTokens({ providerId: "groq", stage: "week", postsInBatch: 4 }),
    420,
  );
});
