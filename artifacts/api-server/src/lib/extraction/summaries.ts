const UA = "Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 10 * 60 * 1000;
const websiteCache = new Map<string, { expiresAt: number; value: WebsiteSummary | null }>();
const instagramCache = new Map<string, { expiresAt: number; value: InstagramSummary | null }>();

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Decode common HTML entities from scraped meta/title (so UI does not show `&#39;`). */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function unescapeJsonish(s: string): string {
  return decodeHtmlEntities(s);
}

export interface WebsiteSummary {
  title: string;
  meta_description: string;
  main_text_excerpt: string;
}

export interface InstagramSummary {
  bio: string;
  followers: string;
  last_n_caption_snippets: string[];
  /** True when Instagram served a login wall; treat as no public content. */
  blocked?: boolean;
}

export async function fetchWebsiteSummary(url: string): Promise<WebsiteSummary | null> {
  const u = url.trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  const cached = getCached(websiteCache, u);
  if (cached !== undefined) return cached;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(u, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = decodeHtmlEntities((titleMatch?.[1] ?? "").trim());
    const meta = decodeHtmlEntities((descMatch?.[1] ?? ogDescMatch?.[1] ?? "").trim());
    const hero = h1Match ? decodeHtmlEntities(stripTags(h1Match[1]).slice(0, 500)) : "";
    const main = hero || meta.slice(0, 500);
    if (!title && !meta && !main) {
      setCached(websiteCache, u, null);
      return null;
    }
    const value = { title, meta_description: meta, main_text_excerpt: main };
    setCached(websiteCache, u, value);
    return value;
  } catch {
    setCached(websiteCache, u, null);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Public HTML fetch of an Instagram profile (no auth). May return partial data on login walls.
 */
async function tryInstagramOembed(profileUrl: string): Promise<Pick<InstagramSummary, "bio" | "followers" | "last_n_caption_snippets"> | null> {
  const oembed = `https://api.instagram.com/oembed?url=${encodeURIComponent(profileUrl)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const r = await fetch(oembed, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!r.ok) {
      console.warn(`[instagram-fetch] oembed_failed url=${profileUrl} status=${r.status}`);
      return null;
    }
    const contentType = r.headers.get("content-type") ?? "";
    if (!/application\/json/i.test(contentType)) {
      console.warn(`[instagram-fetch] oembed_non_json url=${profileUrl} contentType=${contentType}`);
      return null;
    }
    const j = (await r.json()) as { title?: string; author_name?: string };
    const line = (j.title || j.author_name || "").trim();
    if (line.length < 3) {
      console.warn(`[instagram-fetch] oembed_empty url=${profileUrl}`);
      return null;
    }
    return { bio: line, followers: "", last_n_caption_snippets: [] };
  } catch (error) {
    console.warn(
      `[instagram-fetch] oembed_error url=${profileUrl} reason=${
        error instanceof Error ? `${error.name}:${error.message}` : String(error)
      }`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicInstagramByHandle(handleRaw: string): Promise<InstagramSummary | null> {
  const handle = handleRaw.replace(/^@/, "").split(/[/?#]/)[0]?.trim();
  if (!handle) return null;
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) {
      console.warn(`[instagram-fetch] public_profile_failed handle=${handle} status=${response.status}`);
      const o = await tryInstagramOembed(url);
      return o ? { ...o, blocked: false } : null;
    }
    const html = await response.text();

    const bio = extractInstagramBio(html);

    const followersM = html.match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/i);
    const followers = followersM
      ? `${Number(followersM[1]).toLocaleString("en-US")} followers (public page)`
      : extractFollowersFromBio(bio);

    const captionSnippets: string[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/"text":"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      if (captionSnippets.length >= 5) break;
      const raw = m[1] ?? "";
      if (raw.length < 24) continue;
      const line = unescapeJsonish(raw).replace(/\s+/g, " ").trim().slice(0, 200);
      if (line.toLowerCase().includes("log in to instagram")) continue;
      if (line.toLowerCase().includes("see more on instagram")) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      captionSnippets.push(line);
    }
    if (!bio && captionSnippets.length === 0 && !followers) {
      if (/log\s*in/i.test(html) && html.length < 30_000) {
        const o = await tryInstagramOembed(url);
        if (o?.bio) {
          console.warn(`[instagram-fetch] login_wall_oembed_recovered handle=${handle}`);
          return { ...o, blocked: true };
        }
        console.warn(`[instagram-fetch] login_wall_no_oembed handle=${handle}`);
        return { bio: "", followers: "", last_n_caption_snippets: [], blocked: true };
      }
      const o = await tryInstagramOembed(url);
      if (!o) console.warn(`[instagram-fetch] no_extractable_public_data handle=${handle}`);
      return o ? { ...o, blocked: false } : null;
    }
    return { bio, followers, last_n_caption_snippets: captionSnippets };
  } catch (error) {
    console.warn(
      `[instagram-fetch] public_profile_error handle=${handle} reason=${
        error instanceof Error ? `${error.name}:${error.message}` : String(error)
      }`,
    );
    const o = await tryInstagramOembed(url);
    return o ? { ...o, blocked: false } : null;
  } finally {
    clearTimeout(t);
  }
}

function extractInstagramBio(html: string): string {
  const metaContent = findMetaContent(html, "og:description") || findMetaContent(html, "description");
  const metaTitle = findMetaContent(html, "og:title") || findTitle(html);
  const ldJsonBio = extractFromJsonScript(html, /"description"\s*:\s*"([^"]+)"/i);
  const fallbackBio = metaContent || ldJsonBio || metaTitle || extractProfileHeader(html) || "";
  return unescapeJsonish(fallbackBio.trim());
}

function findMetaContent(html: string, key: string): string {
  const metaRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]+content=(["'])([\\s\\S]*?)\\1[^>]*>`,
    "i",
  );
  const reversedRegex = new RegExp(
    `<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]*>`,
    "i",
  );
  return decodeHtmlEntities((html.match(metaRegex)?.[2] ?? html.match(reversedRegex)?.[2] ?? "").trim());
}

function findTitle(html: string): string {
  return decodeHtmlEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
}

function extractFromJsonScript(html: string, pattern: RegExp): string {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = match[1] ?? "";
    const found = block.match(pattern)?.[1];
    if (found?.trim()) return decodeHtmlEntities(found.trim());
  }
  return "";
}

function extractProfileHeader(html: string): string {
  const match =
    html.match(/(\d[\d.,]*\s+Followers[\s\S]{0,180}?Instagram\s*\([^)]*\))/i) ||
    html.match(/(\d[\d.,]*\s+Followers[\s\S]{0,180}?See Instagram photos and videos[^<]+)/i);
  return decodeHtmlEntities((match?.[1] ?? "").trim());
}

function extractFollowersFromBio(bio: string): string {
  const match = bio.match(/([\d.,]+[MK]?)\s+Followers/i);
  return match ? `${match[1]} followers (public meta)` : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param urlOrHandle Full `https://instagram.com/user` or `@user` or `user`
 */
export async function fetchInstagramSummary(urlOrHandle: string): Promise<InstagramSummary | null> {
  const s = urlOrHandle.trim();
  if (!s) return null;
  const cached = getCached(instagramCache, s);
  if (cached !== undefined) return cached;
  if (/instagram\.com/i.test(s)) {
    const m = s.match(/instagram\.com\/([^/?#]+)/i);
    const value = m ? await fetchPublicInstagramByHandle(m[1]!) : null;
    setCached(instagramCache, s, value);
    return value;
  }
  const value = await fetchPublicInstagramByHandle(s);
  setCached(instagramCache, s, value);
  return value;
}

function getCached<T>(map: Map<string, { expiresAt: number; value: T }>, key: string): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached<T>(map: Map<string, { expiresAt: number; value: T }>, key: string, value: T) {
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}
