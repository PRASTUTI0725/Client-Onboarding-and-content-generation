import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALENDAR_GROQ_MAX_TOTAL_TOKENS,
  CALENDAR_WEEK_MAX_OUTPUT_DEFAULT,
  CALENDAR_WEEK_MAX_OUTPUT_GROQ,
  calendarWeekStaggerMs,
  isCalendarRequestWithinGroqBudget,
  resolveCalendarMaxOutputTokens,
  resolveCalendarTargetInputTokens,
  resolveCalendarWeekConcurrency,
  resolveGroqWeekCallDelayMs,
} from "./provider-budget.js";

test("resolveCalendarMaxOutputTokens scales week output by batch size on Groq", () => {
  assert.equal(
    resolveCalendarMaxOutputTokens({ providerId: "groq", stage: "week", postsInBatch: 4 }),
    CALENDAR_WEEK_MAX_OUTPUT_GROQ,
  );
  assert.equal(
    resolveCalendarMaxOutputTokens({ providerId: "groq", stage: "week", postsInBatch: 2 }),
    240,
  );
  assert.equal(resolveCalendarMaxOutputTokens({ providerId: "groq", stage: "planner" }), 450);
});

test("resolveCalendarMaxOutputTokens uses higher default cap for non-Groq providers", () => {
  assert.equal(
    resolveCalendarMaxOutputTokens({ providerId: "openrouter", stage: "week", postsInBatch: 4 }),
    CALENDAR_WEEK_MAX_OUTPUT_DEFAULT,
  );
});

test("isCalendarRequestWithinGroqBudget enforces total token ceiling", () => {
  assert.equal(isCalendarRequestWithinGroqBudget(5000, 900), true);
  assert.equal(isCalendarRequestWithinGroqBudget(5500, 900), false);
  assert.equal(CALENDAR_GROQ_MAX_TOTAL_TOKENS, 6000);
});

test("resolveCalendarWeekConcurrency serializes Groq week calls", () => {
  assert.equal(resolveCalendarWeekConcurrency("groq"), 1);
  assert.equal(resolveCalendarWeekConcurrency("openrouter"), 2);
  assert.ok(calendarWeekStaggerMs("groq") >= 8000);
  assert.equal(calendarWeekStaggerMs("groq"), resolveGroqWeekCallDelayMs());
  assert.equal(calendarWeekStaggerMs("openrouter"), 0);
});

test("resolveCalendarTargetInputTokens uses planner and week targets", () => {
  assert.equal(resolveCalendarTargetInputTokens("groq", "planner"), 1200);
  assert.equal(resolveCalendarTargetInputTokens("groq", "week"), 1000);
  assert.equal(resolveCalendarTargetInputTokens("openrouter", "week"), 1550);
});
