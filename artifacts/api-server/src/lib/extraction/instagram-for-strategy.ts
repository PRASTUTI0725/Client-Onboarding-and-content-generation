import type { InstagramSummary } from "./summaries.js";

/**
 * Map Business DNA / MCP-filled platform Instagram slice into the same shape
 * the strategy LLM uses as `instagram_summary` (from public `fetchInstagramSummary`).
 */
export function instagramPlatformToSummary(
  platform:
    | {
        handle?: string;
        bioSignals?: string[];
        contentPatterns?: string[];
        engagementSignals?: string[];
      }
    | null
    | undefined,
): InstagramSummary | null {
  if (!platform) return null;
  const bio = (platform.bioSignals ?? []).map((s) => s.trim()).filter(Boolean).join("\n").trim();
  const followers = (platform.engagementSignals ?? []).map((s) => String(s).trim()).find(Boolean) ?? "";
  const snippets = (platform.contentPatterns ?? []).map((s) => s.trim()).filter(Boolean);
  if (!bio && !followers && snippets.length === 0) return null;
  return {
    bio,
    followers,
    last_n_caption_snippets: snippets,
    blocked: false,
  };
}

/**
 * Public HTML fetch often fails (login wall). MCP + DNA may still have profile lines.
 * Merge so strategy prompts get real Instagram context when any source is usable.
 */
export function mergeInstagramForStrategy(
  publicFetch: InstagramSummary | null,
  platform: Parameters<typeof instagramPlatformToSummary>[0],
): InstagramSummary | null {
  const fromDna = instagramPlatformToSummary(platform);
  if (!fromDna && !publicFetch) return null;
  if (!fromDna) return publicFetch;
  if (!publicFetch) return fromDna;

  const publicWeak =
    publicFetch.blocked || (!publicFetch.bio?.trim() && (publicFetch.last_n_caption_snippets?.length ?? 0) === 0);
  if (publicWeak) return fromDna;

  const seen = new Set<string>();
  const combinedSnippets: string[] = [];
  for (const s of [...publicFetch.last_n_caption_snippets, ...fromDna.last_n_caption_snippets]) {
    const k = s.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      combinedSnippets.push(k);
    }
  }
  return {
    bio: publicFetch.bio?.trim() || fromDna.bio,
    followers: publicFetch.followers || fromDna.followers,
    last_n_caption_snippets: combinedSnippets.slice(0, 12),
    blocked: false,
  };
}
