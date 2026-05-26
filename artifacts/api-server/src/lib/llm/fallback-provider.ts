import type { ChatCompletionParams, LLMProvider } from "./types.js";
import { classifyProviderError } from "./provider-errors.js";
import {
  checkOpenRouterCreditsAvailable,
  getOpenRouterAffordableMaxTokens,
  validateGeminiModel,
} from "./provider-health.js";
import {
  estimateOpenRouterAffordableMaxTokens,
  resolveBusinessDnaMaxOutputTokens,
} from "../business-dna/provider-budget.js";
import { OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS } from "../business-dna/constants.js";
import { setLastFailureStage, setLatestProviderAttempts } from "../runtime-mode.js";

export type ProviderAttemptDiagnostic = {
  contextLabel?: string | null;
  provider: string;
  model: string;
  keySlot?: string | null;
  status: "success" | "failed" | "preflight_skip" | "circuit_skip";
  reason?: string;
  errorClass?: string;
  httpStatus?: number | null;
  errorCode?: string | null;
  attempt?: number;
  failoverDecision?: "retry_same_provider" | "next_provider" | "abort_chain";
  retryRan?: boolean;
  repairRan?: boolean;
  jsonFailureClass?: string | null;
  rawFailedGenerationHash?: string | null;
};

function mapAttemptToFailureStage(attempt: ProviderAttemptDiagnostic): string | null {
  if (attempt.status === "preflight_skip") {
    if (attempt.reason === "credits_exhausted") return "preflight_skip_credits_exhausted";
    if (attempt.reason === "model_not_found" || attempt.reason?.startsWith("model_check_")) {
      return "preflight_skip_model_invalid";
    }
  }
  if (attempt.status === "failed") return "provider_call_failed";
  return null;
}

function latestFailureStage(attempts: ProviderAttemptDiagnostic[]): string | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const stage = mapAttemptToFailureStage(attempts[index]!);
    if (stage) return stage;
  }
  return null;
}

export class FallbackProvider implements LLMProvider {
  readonly id = "multi" as const;
  private readonly providers: LLMProvider[];
  private lastResolvedProvider: { provider: string; model: string } | null = null;
  private lastAttemptDiagnostics: ProviderAttemptDiagnostic[] = [];
  private cumulativeAttemptDiagnostics: ProviderAttemptDiagnostic[] = [];
  private static readonly circuit = new Map<string, { untilMs: number; reason: string }>();
  private readonly forceReal: boolean;

  constructor(providers: LLMProvider[], options?: { forceReal?: boolean }) {
    this.providers = providers;
    this.forceReal = options?.forceReal === true;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<string> {
    this.lastResolvedProvider = null;
    this.lastAttemptDiagnostics = [];
    const contextLabel = params.contextLabel ?? null;
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
      const info = provider.describe?.() as { provider: string; model: string; keySlot?: string | null } | undefined
        ?? { provider: provider.id, model: params.model ?? "default" };
      const precheck = await shouldSkipProvider(info.provider, info.model, this.forceReal, contextLabel);
      if (precheck.skip) {
        this.lastAttemptDiagnostics.push({
          contextLabel,
          provider: info.provider,
          model: info.model,
          keySlot: info.keySlot ?? null,
          status: "preflight_skip",
          reason: precheck.reason,
        });
        this.cumulativeAttemptDiagnostics.push(this.lastAttemptDiagnostics[this.lastAttemptDiagnostics.length - 1]!);
        console.warn(
          `[llm] preflight-skip context=${contextLabel ?? "unknown"} provider=${info.provider} model=${info.model} key_slot=${info.keySlot ?? "default"} reason=${precheck.reason}`,
        );
        errors.push(`${info.provider}: preflight skip (${precheck.reason})`);
        continue;
      }
      const breakerKey = `${info.provider}:${info.model}`;
      const breaker = FallbackProvider.circuit.get(breakerKey);
      if (!this.forceReal && breaker && breaker.untilMs > Date.now()) {
        skippedByCircuit += 1;
        this.lastAttemptDiagnostics.push({
          contextLabel,
          provider: info.provider,
          model: info.model,
          keySlot: info.keySlot ?? null,
          status: "circuit_skip",
          reason: breaker.reason,
        });
        this.cumulativeAttemptDiagnostics.push(this.lastAttemptDiagnostics[this.lastAttemptDiagnostics.length - 1]!);
        console.warn(
          `[llm] circuit-skip context=${contextLabel ?? "unknown"} provider=${info.provider} model=${info.model} key_slot=${info.keySlot ?? "default"} reason=${breaker.reason} ` +
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
            `[llm] attempting context=${contextLabel ?? "unknown"} provider=${info.provider} model=${info.model} key_slot=${info.keySlot ?? "default"} attempt=${attempt + 1}`,
          );
          const providerParams =
            info.provider === "openrouter" && isBusinessDnaContext(contextLabel)
              ? await capBusinessDnaOpenRouterParams(params)
              : params;
          const out = await withTimeout(
            provider.chatCompletion(providerParams),
            timeoutMs,
            `provider=${info.provider} model=${info.model}`,
          );
          console.info(
            `[llm] success provider=${info.provider} model=${info.model} attempts=${attempts} ` +
              `retries=${retries} skipped=${skippedByCircuit} wasted_ms=${wastedMs} total_ms=${Date.now() - startedAt}`,
          );
          this.lastResolvedProvider = { provider: info.provider, model: info.model };
          this.lastAttemptDiagnostics.push({
            contextLabel,
            provider: info.provider,
            model: info.model,
            keySlot: info.keySlot ?? null,
            status: "success",
            attempt: attempt + 1,
          });
          this.cumulativeAttemptDiagnostics.push(this.lastAttemptDiagnostics[this.lastAttemptDiagnostics.length - 1]!);
          setLatestProviderAttempts(this.getCumulativeAttemptDiagnostics() as unknown as Record<string, unknown>[]);
          setLastFailureStage(latestFailureStage(this.lastAttemptDiagnostics));
          return out;
        } catch (err) {
          wastedMs += Date.now() - attemptStarted;
          const classified = classifyProviderError(err);
          const message = classified.message;
          const canRetry = classified.retrySameProvider && attempt < transientRetries;
          const failoverDecision = classified.terminalForChain
            ? "abort_chain"
            : canRetry
              ? "retry_same_provider"
              : "next_provider";
          console.warn(
            `[llm] provider failed context=${contextLabel ?? "unknown"} provider=${info.provider} model=${info.model} ` +
              `key_slot=${info.keySlot ?? "default"} ` +
              `error_type=${classified.reason} class=${classified.kind} http_status=${classified.httpStatus ?? "n/a"} ` +
              `error_code=${classified.errorCode ?? "n/a"} retry_count=${attempt} ` +
              `failover_decision=${failoverDecision} ` +
              `message=${message}`,
          );
          this.lastAttemptDiagnostics.push({
            contextLabel,
            provider: info.provider,
            model: info.model,
            keySlot: info.keySlot ?? null,
            status: "failed",
            reason: message,
            errorClass: classified.kind,
            httpStatus: classified.httpStatus ?? null,
            errorCode: classified.errorCode ?? null,
            attempt: attempt + 1,
            failoverDecision,
          });
          this.cumulativeAttemptDiagnostics.push(this.lastAttemptDiagnostics[this.lastAttemptDiagnostics.length - 1]!);
          if (classified.terminalForChain) {
            errors.push(`${info.provider}: ${message}`);
            setLatestProviderAttempts(this.getCumulativeAttemptDiagnostics() as unknown as Record<string, unknown>[]);
            setLastFailureStage(latestFailureStage(this.lastAttemptDiagnostics));
            throw err instanceof Error ? err : new Error(message);
          }
          if (!classified.retrySameProvider) {
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
    setLatestProviderAttempts(this.getCumulativeAttemptDiagnostics() as unknown as Record<string, unknown>[]);
    setLastFailureStage(latestFailureStage(this.lastAttemptDiagnostics));
    throw new Error(`All configured providers failed: ${errors.join(" | ")}`);
  }

  describe() {
    if (this.lastResolvedProvider) return this.lastResolvedProvider;
    const first = this.providers[0]?.describe?.();
    return { provider: this.id, model: first?.model ?? "fallback-chain" };
  }

  getConfiguredProviders(): Array<{ provider: string; model: string }> {
    return this.providers.map((provider) => provider.describe?.() ?? { provider: provider.id, model: "default" });
  }

  getLastAttemptDiagnostics(): ProviderAttemptDiagnostic[] {
    return [...this.lastAttemptDiagnostics];
  }

  getCumulativeAttemptDiagnostics(): ProviderAttemptDiagnostic[] {
    return [...this.cumulativeAttemptDiagnostics];
  }

  getProviderSlots(): LLMProvider[] {
    return [...this.providers];
  }

  getForceReal(): boolean {
    return this.forceReal;
  }

  appendExternalAttemptDiagnostics(attempts: ProviderAttemptDiagnostic[]): void {
    for (const attempt of attempts) {
      this.cumulativeAttemptDiagnostics.push({ ...attempt });
      this.lastAttemptDiagnostics.push({ ...attempt });
      if (attempt.status === "success") {
        this.lastResolvedProvider = { provider: attempt.provider, model: attempt.model };
      }
    }
    setLatestProviderAttempts(this.getCumulativeAttemptDiagnostics() as unknown as Record<string, unknown>[]);
    setLastFailureStage(latestFailureStage(this.lastAttemptDiagnostics));
  }
}

async function shouldSkipProvider(
  provider: string,
  model: string,
  forceReal = false,
  contextLabel?: string | null,
): Promise<{ skip: boolean; reason: string }> {
  if (provider === "openrouter") {
    const credits = await checkOpenRouterCreditsAvailable();
    if (isBusinessDnaContext(contextLabel)) {
      if (!credits.usable) return { skip: true, reason: credits.reason };
      const affordable = estimateOpenRouterAffordableMaxTokens(credits.remainingCredits);
      if (affordable < OPENROUTER_MIN_AFFORDABLE_MAX_TOKENS) {
        return { skip: true, reason: "credits_insufficient_for_business_dna" };
      }
      return { skip: false, reason: "ok" };
    }
    const useCreditsPreflight = (process.env.LLM_PREFLIGHT_OPENROUTER_CREDITS?.trim().toLowerCase() ?? "0");
    if (!forceReal && (useCreditsPreflight === "1" || useCreditsPreflight === "true" || useCreditsPreflight === "yes")) {
      if (!credits.usable) return { skip: true, reason: credits.reason };
    }
  }
  if (provider === "gemini") {
    const modelCheck = await validateGeminiModel(model);
    if (!modelCheck.valid) return { skip: true, reason: modelCheck.reason };
  }
  return { skip: false, reason: "ok" };
}

function isBusinessDnaContext(contextLabel: string | null | undefined): boolean {
  return Boolean(contextLabel?.toLowerCase().includes("business dna"));
}

async function capBusinessDnaOpenRouterParams(params: ChatCompletionParams): Promise<ChatCompletionParams> {
  const affordable = await getOpenRouterAffordableMaxTokens();
  const budget = resolveBusinessDnaMaxOutputTokens({
    providerId: "openrouter",
    openRouterAffordableMax: affordable,
  });
  const maxOutputTokens = Math.min(params.maxOutputTokens ?? budget.maxOutputTokens, budget.maxOutputTokens);
  return { ...params, maxOutputTokens };
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
