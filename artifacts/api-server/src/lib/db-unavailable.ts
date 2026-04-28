/**
 * Detects errors where Postgres is unreachable or unusable so API routes can fall back to in-memory mode.
 */
export function isDbUnavailableError(err: unknown): boolean {
  const candidate = err as {
    code?: string;
    cause?: { code?: string };
    message?: string;
  };
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "");
  const message = String(candidate?.message ?? "").toLowerCase();
  return (
    code === "28P01" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    message.includes("password authentication failed") ||
    message.includes("connect econnrefused") ||
    message.includes("connection refused") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("failed query")
  );
}
