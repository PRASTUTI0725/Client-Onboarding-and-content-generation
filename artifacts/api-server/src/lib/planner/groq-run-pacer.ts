import {
  CALENDAR_GROQ_RUN_TPM_SOFT_LIMIT,
  resolveGroqWeekCallDelayMs,
} from "./provider-budget.js";

export type GroqPaceSnapshot = {
  cumulativeEstimatedTokens: number;
  providerCallsCompleted: number;
  delayMsApplied: number;
};

export class GroqRunTokenPacer {
  private cumulativeEstimatedTokens = 0;
  private providerCallsCompleted = 0;

  constructor(private readonly providerId: string) {}

  recordCall(inputTokens: number, outputTokens: number): void {
    this.cumulativeEstimatedTokens += inputTokens + outputTokens;
    this.providerCallsCompleted += 1;
  }

  getCumulativeEstimatedTokens(): number {
    return this.cumulativeEstimatedTokens;
  }

  getProviderCallsCompleted(): number {
    return this.providerCallsCompleted;
  }

  async waitBeforeNextCall(): Promise<GroqPaceSnapshot> {
    if (this.providerId !== "groq") {
      return {
        cumulativeEstimatedTokens: this.cumulativeEstimatedTokens,
        providerCallsCompleted: this.providerCallsCompleted,
        delayMsApplied: 0,
      };
    }

    const baseDelayMs = resolveGroqWeekCallDelayMs();
    let delayMs = 0;
    if (this.providerCallsCompleted >= 1) {
      delayMs = baseDelayMs;
    }
    if (this.providerCallsCompleted >= 2 && this.providerCallsCompleted % 2 === 0) {
      delayMs += baseDelayMs;
    }
    if (this.cumulativeEstimatedTokens >= CALENDAR_GROQ_RUN_TPM_SOFT_LIMIT) {
      delayMs += baseDelayMs;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    return {
      cumulativeEstimatedTokens: this.cumulativeEstimatedTokens,
      providerCallsCompleted: this.providerCallsCompleted,
      delayMsApplied: delayMs,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
