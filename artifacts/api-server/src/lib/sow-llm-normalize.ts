import { getStrictJsonWithRetry } from "./llm/json-retry.js";
import { getLLMProvider, type LLMProvider } from "./llm/index.js";

const SYS = `You merge messy proposal PDF text into a fixed JSON shape for a product UI.
Rules:
- Return ONE JSON object only. No markdown.
- Never copy payment tables, retainers, INR/USD pricing, or "Costing" sections into product fields; put that only in "excludedCommercial" if present.
- Keys: industry (short string), targetAudience (short string), understandingOfRequirements (string), strategyLaunchPlanning (string), contentCreation (string, what gets produced), excludedCommercial (string or empty), notes (string, optional).
- Prefer the ruleBased hints when the PDF is ambiguous.`;

/**
 * Optional second pass when SOW_LLM_NORMALIZE=1. Merges raw PDF text + rule-based output.
 */
export async function normalizeSowWithLlm(
  provider: LLMProvider,
  extractedText: string,
  ruleBased: Record<string, unknown>,
): Promise<Record<string, string>> {
  const user = `RAW PDF TEXT (may include junk):\n${extractedText.slice(0, 24_000)}\n\nRULE-BASED OUTPUT (from server):\n${JSON.stringify(ruleBased, null, 2)}\n\nReturn JSON with: industry, targetAudience, understandingOfRequirements, strategyLaunchPlanning, contentCreation, excludedCommercial, notes.`;

  const out = await getStrictJsonWithRetry<Record<string, unknown>>(provider, {
    contextLabel: "sow llm normalize",
    maxOutputTokens: 4096,
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: user },
    ],
  });

  const s = (k: string) => (typeof out[k] === "string" ? (out[k] as string) : "");
  return {
    industry: s("industry"),
    targetAudience: s("targetAudience"),
    understandingOfRequirements: s("understandingOfRequirements"),
    strategyLaunchPlanning: s("strategyLaunchPlanning"),
    contentCreation: s("contentCreation"),
    excludedCommercial: s("excludedCommercial"),
  };
}

export function isSowLlmNormalizeEnabled(): boolean {
  const v = process.env.SOW_LLM_NORMALIZE ?? "";
  return v === "1" || v.toLowerCase() === "true";
}

export async function runOptionalSowLlmNormalize(
  extractedText: string,
  ruleBased: Record<string, unknown>,
): Promise<Record<string, string> | null> {
  if (!isSowLlmNormalizeEnabled()) return null;
  return normalizeSowWithLlm(getLLMProvider(), extractedText, ruleBased);
}
