const CHARS_PER_TOKEN = 4;

export function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateBytes(value: unknown): number {
  if (value == null) return 0;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return new TextEncoder().encode(text).length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function confirmPreflightLimit(input: {
  estimatedTokens: number;
  estimatedBytes: number;
  tokenThreshold: number;
  byteThreshold: number;
  context: string;
}): boolean {
  const overTokens = input.estimatedTokens > input.tokenThreshold;
  const overBytes = input.estimatedBytes > input.byteThreshold;
  if (!overTokens && !overBytes) return true;
  const reasons: string[] = [];
  if (overTokens) {
    reasons.push(
      `estimated prompt ~${input.estimatedTokens} tokens (safe threshold ${input.tokenThreshold})`,
    );
  }
  if (overBytes) {
    reasons.push(
      `payload ~${formatBytes(input.estimatedBytes)} (safe threshold ${formatBytes(input.byteThreshold)})`,
    );
  }
  return window.confirm(
    `This request may exceed free-tier limits; continue anyway?\n\n${input.context}\n- ${reasons.join("\n- ")}`,
  );
}
