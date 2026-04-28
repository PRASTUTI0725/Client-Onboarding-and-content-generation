import type { ChatCompletionParams, LLMProvider } from "./types.js";
import { classifyProviderError } from "./provider-errors.js";
import { checkOpenRouterCreditsAvailable, validateGeminiModel } from "./provider-health.js";

export class FallbackProvider implements LLMProvider {
  readonly id = "multi" as const;
  private readonly providers: LLMProvider[];
  private static readonly circuit = new Map<string, { untilMs: number; reason: string }>();

  constructor(providers: LLMProvider[]) {
    this.providers = providers;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<string> {
    const errors: string[] = [];
    const backoffMs = [500, 1500, 3000];
    const timeoutMs = Number(process.env.LLM_PROVIDER_TIMEOUT_MS ?? "30000");
    const transientRetries = Math.max(0, Number(process.env.LLM_TRANSIENT_RETRIES ?? "0"));
    const cooldownMs = Math.max(15000, Number(process.env.LLM_PROVIDER_COOLDOWN_MS ?? "120000"));
    const startedAt = Date.now();
    let attempts = 0;
    let retries = 0;
    let skippedByCircuit = 0;
    let wastedMs = 0;
    for (const provider of this.providers) {
      const info = provider.describe?.() ?? { provider: provider.id, model: params.model ?? "default" };
      const precheck = await shouldSkipProvider(info.provider, info.model);
      if (precheck.skip) {
        console.warn(
          `[llm] preflight-skip provider=${info.provider} model=${info.model} reason=${precheck.reason}`,
        );
        errors.push(`${info.provider}: preflight skip (${precheck.reason})`);
        continue;
      }
      const breakerKey = `${info.provider}:${info.model}`;
      const breaker = FallbackProvider.circuit.get(breakerKey);
      if (breaker && breaker.untilMs > Date.now()) {
        skippedByCircuit += 1;
        console.warn(
          `[llm] circuit-skip provider=${info.provider} model=${info.model} reason=${breaker.reason} ` +
            `cooldown_ms_remaining=${breaker.untilMs - Date.now()}`,
        );
        continue;
      }
      FallbackProvider.circuit.delete(breakerKey);

      let attempt = 0;
      while (attempt <= transientRetries) {
        attempts += 1;
        const attemptStarted = Date.now();
        try {
          console.info(
            `[llm] attempting provider=${info.provider} model=${info.model} attempt=${attempt + 1}`,
          );
          const out = await withTimeout(
            provider.chatCompletion(params),
            timeoutMs,
            `provider=${info.provider} model=${info.model}`,
          );
          console.info(
            `[llm] success provider=${info.provider} model=${info.model} attempts=${attempts} ` +
              `retries=${retries} skipped=${skippedByCircuit} wasted_ms=${wastedMs} total_ms=${Date.now() - startedAt}`,
          );
          return out;
        } catch (err) {
          wastedMs += Date.now() - attemptStarted;
          const classified = classifyProviderError(err);
          const message = classified.message;
          const isTransient = classified.kind === "transient";
          const canRetry = isTransient && attempt < transientRetries;
          console.warn(
            `[llm] provider failed provider=${info.provider} model=${info.model} ` +
              `error_type=${classified.reason} class=${classified.kind} http_status=${classified.httpStatus ?? "n/a"} ` +
              `error_code=${classified.errorCode ?? "n/a"} retry_count=${attempt} ` +
              `fallback_reason=${canRetry ? "retry_transient" : "switch_provider"} ` +
              `message=${message}`,
          );
          if (!isTransient) {
            FallbackProvider.circuit.set(breakerKey, {
              untilMs: Date.now() + cooldownMs,
              reason: classified.reason,
            });
            errors.push(`${info.provider}: ${message}`);
            break;
          }
          if (!canRetry) {
            errors.push(`${info.provider}: ${message}`);
            break;
          }
          retries += 1;
          const wait =
            backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? backoffMs[backoffMs.length - 1]!;
          await sleep(wait);
          attempt += 1;
        }
      }
    }
    throw new Error(`All configured providers failed: ${errors.join(" | ")}`);
  }

  describe() {
    const first = this.providers[0]?.describe?.();
    return { provider: this.id, model: first?.model ?? "fallback-chain" };
  }
}

async function shouldSkipProvider(
  provider: string,
  model: string,
): Promise<{ skip: boolean; reason: string }> {
  if (provider === "openrouter") {
    const credits = await checkOpenRouterCreditsAvailable();
    if (!credits.usable) return { skip: true, reason: credits.reason };
  }
  if (provider === "gemini") {
    const modelCheck = await validateGeminiModel(model);
    if (!modelCheck.valid) return { skip: true, reason: modelCheck.reason };
  }
  return { skip: false, reason: "ok" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms (${label})`)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
