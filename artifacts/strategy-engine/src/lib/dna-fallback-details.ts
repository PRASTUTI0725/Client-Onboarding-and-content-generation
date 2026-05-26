export type ProviderAttemptSummary = {
  provider?: string;
  model?: string;
  status?: string;
  reason?: string;
};

export type DnaFallbackDetails = {
  fallbackReason: string | null;
  failureStage: string | null;
  providerAttempts: ProviderAttemptSummary[];
  estimatedInputTokens?: number | null;
  maxOutputTokens?: number | null;
  estimatedTotalTokens?: number | null;
  compactionTier?: number | null;
};

export function formatProviderAttemptsSummary(attempts: ProviderAttemptSummary[]): string {
  if (!attempts.length) return "";
  return attempts
    .map((entry) => {
      const label = [entry.provider, entry.model].filter(Boolean).join("/") || "unknown";
      const status = entry.status ?? "unknown";
      const reason = entry.reason ? `: ${entry.reason}` : "";
      return `${label} (${status}${reason})`;
    })
    .join(" · ");
}

export function readDnaFallbackDetails(meta: {
  fallbackReason?: string | null;
  latestRun?: {
    validation?: { note?: string };
    diagnostics?: {
      fallbackReason?: string | null;
      failureStage?: string | null;
      providerAttempts?: ProviderAttemptSummary[];
    };
  };
} | null | undefined): DnaFallbackDetails {
  const diagnostics = meta?.latestRun?.diagnostics;
  return {
    fallbackReason:
      meta?.fallbackReason ??
      diagnostics?.fallbackReason ??
      meta?.latestRun?.validation?.note ??
      null,
    failureStage: diagnostics?.failureStage ?? null,
    providerAttempts: diagnostics?.providerAttempts ?? [],
    estimatedInputTokens:
      typeof diagnostics?.estimatedInputTokens === "number" ? diagnostics.estimatedInputTokens : null,
    maxOutputTokens: typeof diagnostics?.maxOutputTokens === "number" ? diagnostics.maxOutputTokens : null,
    estimatedTotalTokens:
      typeof diagnostics?.estimatedTotalTokens === "number" ? diagnostics.estimatedTotalTokens : null,
    compactionTier: typeof diagnostics?.compactionTier === "number" ? diagnostics.compactionTier : null,
  };
}
