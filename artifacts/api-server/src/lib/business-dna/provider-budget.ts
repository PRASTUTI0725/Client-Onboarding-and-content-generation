import {
  BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS,
  BUSINESS_DNA_MAX_OUTPUT_TOKENS,
  OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS,
} from "./constants.js";

export type BusinessDnaProviderBudget = {
  maxOutputTokens: number;
  skipOpenRouter: boolean;
  openRouterAffordableMax: number | null;
};

/** Conservative max_output from remaining OpenRouter credit balance (USD). */
export function estimateOpenRouterAffordableMaxTokens(remainingCredits: number | null): number {
  if (remainingCredits == null || !Number.isFinite(remainingCredits) || remainingCredits <= 0) {
    return 0;
  }
  // Rough heuristic: ~$0.00025 per 1k output tokens on small models → credits * 4000 tokens
  const estimated = Math.floor(remainingCredits * 4000);
  return Math.min(BUSINESS_DNA_MAX_OUTPUT_TOKENS, Math.max(0, estimated));
}

export function resolveBusinessDnaMaxOutputTokens(params: {
  providerId: string;
  openRouterAffordableMax?: number | null;
}): BusinessDnaProviderBudget {
  const openRouterAffordableMax =
    params.openRouterAffordableMax != null && Number.isFinite(params.openRouterAffordableMax)
      ? Math.max(0, Math.floor(params.openRouterAffordableMax))
      : null;

  if (params.providerId === "openrouter") {
    const capped =
      openRouterAffordableMax != null
        ? Math.min(BUSINESS_DNA_MAX_OUTPUT_TOKENS, openRouterAffordableMax)
        : BUSINESS_DNA_MAX_OUTPUT_TOKENS;
    return {
      maxOutputTokens: capped,
      skipOpenRouter: capped < OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS,
      openRouterAffordableMax,
    };
  }

  return {
    maxOutputTokens: BUSINESS_DNA_MAX_OUTPUT_TOKENS,
    skipOpenRouter: false,
    openRouterAffordableMax,
  };
}

export function isBusinessDnaRequestWithinGroqBudget(
  estimatedInputTokens: number,
  maxOutputTokens: number,
): boolean {
  return estimatedInputTokens + maxOutputTokens <= BUSINESS_DNA_GROQ_MAX_TOTAL_TOKENS;
}
