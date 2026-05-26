import { useQuery } from "@tanstack/react-query";
import { localApiFetch } from "@/lib/local-api";

type RuntimeHealth = {
  status: string;
  mode?: "db" | "fallback";
  persistence?: "persistent" | "temporary";
  fallbackUsed?: boolean;
  aiFallbackUsed?: boolean;
  useRealAI?: boolean;
  aiProvider?: string;
  aiProviderResolved?: string;
  aiProviderLabel?: string;
  aiDefaultModel?: string;
  envAiProvider?: string;
  openaiBaseIsLocal?: boolean;
  aiConfig?: {
    openrouterKeyPresent?: boolean;
    groqKeyPresent?: boolean;
    nvidiaKeyPresent?: boolean;
    geminiKeyPresent?: boolean;
    openaiKeyPresent?: boolean;
  };
  lastError?: {
    message?: string;
    code?: string;
    providerId?: string;
    failureClass?: string | null;
    failureStage?: string | null;
    failureOrigin?: string | null;
  };
  aiUsage?: {
    provider?: string;
    model?: string;
    requestStatus?: string;
    estimatedInputTokens?: number | string;
    estimatedOutputTokens?: number | string;
    totalTokens?: number | string;
    rateLimits?: {
      remainingRequests?: string | number;
      remainingTokens?: string | number;
      resetRequests?: string | number;
      resetTokens?: string | number;
    } | null;
  };
  openrouterCredits?: {
    status?: string;
    remainingCredits?: string | number;
    totalCredits?: string | number;
    totalUsage?: string | number;
    message?: string;
  };
};

async function getRuntimeHealth(): Promise<RuntimeHealth> {
  const res = await localApiFetch("/api/healthz");
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  return res.json();
}

function isExplicitDebugMode(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

export function RuntimeModeBanner({ suppressAiDiagnostics = false }: { suppressAiDiagnostics?: boolean } = {}) {
  const { data } = useQuery({
    queryKey: ["runtime-health-mode"],
    queryFn: getRuntimeHealth,
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const showDb = data?.mode === "fallback";
  const showTemplate = !suppressAiDiagnostics && (data?.useRealAI === false || data?.aiFallbackUsed);
  const showDebug =
    !suppressAiDiagnostics && isExplicitDebugMode() && (data?.aiConfig || data?.aiProvider);

  if (!showDb && !showTemplate && !showDebug) return null;

  const u = data?.aiUsage;
  const providerLine =
    u?.provider && u?.model
      ? `${u.provider} / ${u.model}${u.requestStatus && u.requestStatus !== "success" ? ` (${u.requestStatus})` : ""}`
      : u?.model
        ? `${data?.aiProviderLabel ?? data?.aiProviderResolved ?? "provider"} / ${u.model}`
        : data?.aiProviderLabel && data?.aiDefaultModel
          ? `${data.aiProviderLabel} (default: ${data.aiDefaultModel})`
          : [data?.aiProviderResolved, data?.aiDefaultModel].filter(Boolean).join(" / ") || "not configured";
  const statusLine =
    u?.requestStatus ??
    (data?.aiDefaultModel
      ? "—"
      : "No server calls recorded yet. Values below are defaults from the server environment.");

  const isValidationFailure =
    data?.lastError?.failureClass === "validation_failed" ||
    data?.lastError?.failureOrigin === "validation_failed / bucket_mismatch";

  return (
    <div className="space-y-2 mb-4">
      {showDb && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          data-testid="fallback-mode-banner"
        >
          Running in fallback mode. Data is temporary and resets when the server restarts.
        </div>
      )}
      {data?.useRealAI === false && (
        <div
          className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm text-violet-900"
          data-testid="demo-mode-banner"
        >
          You are viewing a <strong>template preview</strong>. Turn on real AI in settings (or set{" "}
          <code className="text-xs bg-violet-100 px-1 rounded">USE_REAL_AI</code> on the server) and add a
          provider key to generate live copy.
        </div>
      )}
      {data?.useRealAI !== false && data?.aiFallbackUsed && (
        <div
          className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm text-sky-900"
          data-testid="ai-fallback-banner"
        >
          {isValidationFailure ? (
            <>
              The AI produced a calendar, but it failed validation against the SOW bucket plan, so we are showing a{" "}
              <strong>safe template</strong> instead.
            </>
          ) : (
            <>
              We could not get a full response from the AI provider, so we are showing a <strong>safe template</strong>{" "}
              instead.
              {data?.lastError?.message ? (
                <span className="mt-1 block text-xs font-mono break-words">
                  {data.lastError.failureStage ? `${data.lastError.failureStage}: ` : ""}
                  {data.lastError.message.slice(0, 240)}
                </span>
              ) : (
                <span className="mt-1 block text-xs">Check provider keys/model in AI settings, then regenerate.</span>
              )}
            </>
          )}
        </div>
      )}
      {showDebug && (
        <div className="rounded-lg border border-border bg-card/50 px-4 py-3 text-xs" data-testid="ai-debug-widget">
          <p className="text-[11px] text-muted-foreground mb-2">
            <span className="font-medium text-foreground">AI routing:</span> env{" "}
            <code className="bg-muted/80 px-1 rounded">AI_PROVIDER</code> ={" "}
            <span className="text-foreground">{String(data?.envAiProvider ?? "—")}</span>
            {" → "}
            <span className="text-foreground font-medium">
              {providerLine}
            </span>
            {data?.openaiBaseIsLocal ? " · using a local / custom base URL" : ""}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-muted-foreground">
            <span>last call status {formatStat(statusLine)}</span>
            <span>in {formatStat(u?.estimatedInputTokens)}</span>
            <span>out {formatStat(u?.estimatedOutputTokens)}</span>
            <span>OpenRouter key {data?.aiConfig?.openrouterKeyPresent ? "yes" : "no"}</span>
            <span>Groq {data?.aiConfig?.groqKeyPresent ? "yes" : "no"}</span>
            <span>NVIDIA {data?.aiConfig?.nvidiaKeyPresent ? "yes" : "no"}</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <UsageCard
              label="OpenRouter credits"
              state={creditState(data?.openrouterCredits?.remainingCredits)}
              lines={[
                `remaining ${formatStat(data?.openrouterCredits?.remainingCredits)}`,
                `total ${formatStat(data?.openrouterCredits?.totalCredits)}`,
                data?.openrouterCredits?.message ? String(data.openrouterCredits.message) : "",
                typeof data?.openrouterCredits?.remainingCredits === "number" &&
                data.openrouterCredits.remainingCredits < 0
                  ? "OpenRouter can report net-negative remaining when usage exceeds the purchased balance. Top up to continue."
                  : "",
              ]}
            />
            <UsageCard
              label="Groq limits"
              state={limitState(data?.aiUsage?.rateLimits?.remainingTokens)}
              lines={[
                `req ${formatStat(data?.aiUsage?.rateLimits?.remainingRequests)}`,
                `tok ${formatStat(data?.aiUsage?.rateLimits?.remainingTokens)}`,
                `reset ${formatStat(data?.aiUsage?.rateLimits?.resetRequests ?? data?.aiUsage?.rateLimits?.resetTokens)}`,
              ]}
            />
          </div>
          {data?.lastError?.message ? (
            <p className="mt-2 font-mono text-muted-foreground">last: {data.lastError.message.slice(0, 160)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatStat(value: unknown) {
  if (value == null || value === "") return "—";
  return String(value);
}

function creditState(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "neutral";
  if (num < 0) return "warning";
  if (num < 5) return "critical";
  if (num < 20) return "warning";
  return "safe";
}

function limitState(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "neutral";
  if (num < 1000) return "critical";
  if (num < 5000) return "warning";
  return "safe";
}

function UsageCard({
  label,
  state,
  lines,
}: {
  label: string;
  state: "safe" | "warning" | "critical" | "neutral";
  lines: string[];
}) {
  const tone =
    state === "safe"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : state === "critical"
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : "border-border bg-background text-muted-foreground";
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <p className="font-medium">{label}</p>
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="font-mono">
          {line}
        </p>
      ))}
    </div>
  );
}
