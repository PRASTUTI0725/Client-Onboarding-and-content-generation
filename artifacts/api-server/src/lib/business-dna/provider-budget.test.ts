import assert from "node:assert/strict";
import { test } from "node:test";
import { BUSINESS_DNA_MAX_OUTPUT_TOKENS, OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS } from "./constants.js";
import {
  estimateOpenRouterAffordableMaxTokens,
  isBusinessDnaRequestWithinGroqBudget,
  resolveBusinessDnaMaxOutputTokens,
} from "./provider-budget.js";

test("resolveBusinessDnaMaxOutputTokens returns default cap for Groq", () => {
  const budget = resolveBusinessDnaMaxOutputTokens({ providerId: "groq" });
  assert.equal(budget.maxOutputTokens, BUSINESS_DNA_MAX_OUTPUT_TOKENS);
  assert.equal(budget.maxOutputTokens, 2800);
  assert.equal(budget.skipOpenRouter, false);
});

test("resolveBusinessDnaMaxOutputTokens caps OpenRouter when credits are low", () => {
  const affordable = estimateOpenRouterAffordableMaxTokens(0.00018);
  assert.ok(affordable > 0);
  assert.ok(affordable < BUSINESS_DNA_MAX_OUTPUT_TOKENS);

  const budget = resolveBusinessDnaMaxOutputTokens({
    providerId: "openrouter",
    openRouterAffordableMax: affordable,
  });
  assert.equal(budget.maxOutputTokens, affordable);
  assert.equal(budget.skipOpenRouter, affordable < OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS);
});

test("isBusinessDnaRequestWithinGroqBudget enforces total request cap", () => {
  assert.equal(isBusinessDnaRequestWithinGroqBudget(8200, 2800), true);
  assert.equal(isBusinessDnaRequestWithinGroqBudget(8700, 4096), false);
});
