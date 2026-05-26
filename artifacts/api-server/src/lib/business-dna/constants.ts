/** Default max completion tokens for Business DNA strict-JSON generation. */
export const BUSINESS_DNA_MAX_OUTPUT_TOKENS = 2800;

/** Groq TPM guard: estimated input + reserved max_output should stay under this. */
export const BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS = 11_000;

/** Target estimated input tokens after compaction (system + user prompt). */
export const BUSINESS_DNA_TARGET_INPUT_TOKENS = 6500;

/** OpenRouter: skip when affordable completion budget falls below this. */
export const OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS = 1200;

/** Wall-clock budget for POST /onboarding/business-dna/rebuild (public signals + LLM retry chain). */
export const BUSINESS_DNA_REBUILD_TIMEOUT_MS = 90_000;
