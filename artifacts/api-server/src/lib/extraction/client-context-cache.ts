import { fetchInstagramSummary, fetchWebsiteSummary, type InstagramSummary, type WebsiteSummary } from "./summaries.js";

type CacheEntry = {
  expiresAt: number;
  websiteSummary: WebsiteSummary | null;
  instagramSummary: InstagramSummary | null;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const contextCache = new Map<string, CacheEntry>();

export async function getClientContextWithCache(input: {
  clientId: string;
  websiteUrl?: string | null;
  instagramUrlOrHandle?: string | null;
  forceRefresh?: boolean;
  timeoutMs?: number;
}): Promise<{
  websiteSummary: WebsiteSummary | null;
  instagramSummary: InstagramSummary | null;
  cacheHit: boolean;
  websiteMs: number;
  instagramMs: number;
}> {
  const timeoutMs = Math.max(1500, input.timeoutMs ?? 6000);
  const cached = contextCache.get(input.clientId);
  if (!input.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return {
      websiteSummary: cached.websiteSummary,
      instagramSummary: cached.instagramSummary,
      cacheHit: true,
      websiteMs: 0,
      instagramMs: 0,
    };
  }

  const websiteTask = timed(
    () => withTimeout(fetchWebsiteSummary(input.websiteUrl ?? ""), timeoutMs, null),
  );
  const instagramTask = timed(
    () => withTimeout(fetchInstagramSummary(input.instagramUrlOrHandle ?? ""), timeoutMs, null),
  );

  const [websiteResult, instagramResult] = await Promise.all([websiteTask, instagramTask]);
  const value: CacheEntry = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    websiteSummary: websiteResult.value,
    instagramSummary: instagramResult.value,
  };
  contextCache.set(input.clientId, value);

  return {
    websiteSummary: websiteResult.value,
    instagramSummary: instagramResult.value,
    cacheHit: false,
    websiteMs: websiteResult.elapsedMs,
    instagramMs: instagramResult.elapsedMs,
  };
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = Date.now();
  const value = await work();
  return { value, elapsedMs: Date.now() - startedAt };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
