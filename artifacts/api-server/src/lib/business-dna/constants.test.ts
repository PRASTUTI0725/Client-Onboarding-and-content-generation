import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS,
  BUSINESS_DNA_MAX_OUTPUT_TOKENS,
  BUSINESS_DNA_REBUILD_TIMEOUT_MS,
  BUSINESS_DNA_TARGET_INPUT_TOKENS,
} from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("Business DNA max output tokens fits Groq TPM budget", () => {
  assert.equal(BUSINESS_DNA_MAX_OUTPUT_TOKENS, 2800);
  assert.ok(BUSINESS_DNA_MAX_OUTPUT_TOKENS <= 3000);
});

test("Business DNA token budget constants align with Groq guard", () => {
  assert.equal(BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS, 11_000);
  assert.equal(BUSINESS_DNA_TARGET_INPUT_TOKENS, 6500);
  assert.ok(BUSINESS_DNA_TARGET_INPUT_TOKENS + BUSINESS_DNA_MAX_OUTPUT_TOKENS <= BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS);
});

test("Business DNA rebuild timeout allows provider retry chain", () => {
  assert.equal(BUSINESS_DNA_REBUILD_TIMEOUT_MS, 90_000);
  assert.ok(BUSINESS_DNA_REBUILD_TIMEOUT_MS >= 90_000);
});

test("generateBusinessDnaWithLlm uses compaction and provider budget helpers", () => {
  const src = readFileSync(join(__dirname, "generate.ts"), "utf8");
  assert.match(src, /compactBusinessDnaGeneratorInput/);
  assert.match(src, /resolveBusinessDnaMaxOutputTokens/);
  assert.match(src, /prepareBusinessDnaPrompt/);
  assert.doesNotMatch(src, /maxOutputTokens:\s*4096/);
});
