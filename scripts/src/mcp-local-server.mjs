import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const host = (process.env.MCP_LOCAL_HOST || "127.0.0.1").trim();
const port = Number((process.env.MCP_LOCAL_PORT || "3015").trim());
const pathName = (process.env.MCP_LOCAL_PATH || "/mcp").trim();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const tools = [
  { name: "instagram.profile", description: "Fetch public Instagram profile signals for enrichment." },
  { name: "website.lookup", description: "Fetch lightweight website summary signals for enrichment." },
];
const execFileAsync = promisify(execFile);

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== pathName) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const rpc = await readJson(req);
  try {
    if (rpc.method === "tools/list") {
      log({ kind: "tools/list", tools: tools.map((tool) => tool.name) });
      writeJson(res, rpc.id ?? null, { tools });
      return;
    }

    if (rpc.method === "tools/call") {
      const toolName = String(rpc.params?.name ?? "");
      const args = asRecord(rpc.params?.arguments);
      log({ kind: "tools/call", name: toolName, arguments: args });

      if (toolName === "instagram.profile") {
        writeJson(res, rpc.id ?? null, await handleInstagramProfile(args));
        return;
      }

      if (toolName === "website.lookup") {
        writeJson(res, rpc.id ?? null, await handleWebsiteLookup(args));
        return;
      }

      writeError(res, rpc.id ?? null, -32601, `Unknown tool: ${toolName}`);
      return;
    }

    writeError(res, rpc.id ?? null, -32601, `Unknown method: ${String(rpc.method ?? "")}`);
  } catch (error) {
    log({
      kind: "tool/error",
      error: error instanceof Error ? `${error.name}:${error.message}` : String(error),
    });
    writeError(res, rpc.id ?? null, -32000, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  log({ kind: "server/listening", host, port, path: pathName });
});

async function handleInstagramProfile(args) {
  const handle = String(args.instagramHandle ?? "").trim();
  log({ kind: "instagram.profile/start", handle });
  const pack = await fetchInstagramProfileSignals(handle);
  log({
    kind: "instagram.profile/result",
    handle,
    hasPack: !!pack,
    summary: pack
      ? {
          bio: pack.bio ? pack.bio.slice(0, 180) : "",
          followers: pack.followers || "",
          captions: pack.last_n_caption_snippets?.length ?? 0,
        }
      : null,
  });
  if (!pack) {
    return {
      handle: normalizeHandle(handle),
      bioSignals: [],
      contentPatterns: [],
      visualPatterns: [],
      engagementSignals: [],
      source: "public-profile-fetch",
      ok: false,
      note: "Instagram profile returned no extractable public signals.",
    };
  }

  return {
    handle: normalizeHandle(handle),
    bioSignals: pack.bio ? [pack.bio] : [],
    contentPatterns: pack.last_n_caption_snippets ?? [],
    visualPatterns: [],
    engagementSignals: pack.followers ? [pack.followers] : [],
    source: pack.blocked ? "oembed-embed" : "public-profile-fetch",
    ok: true,
    blocked: !!pack.blocked,
  };
}

async function handleWebsiteLookup(args) {
  const websiteUrl = String(args.websiteUrl ?? "").trim();
  const summary = await fetchWebsiteSummary(websiteUrl);
  if (!summary) {
    return {
      websiteUrl,
      title: "",
      metaDescription: "",
      heroExcerpt: "",
      pagesAnalyzed: [],
      messagingPatterns: [],
      trustElements: [],
      conversionElements: [],
      ok: false,
    };
  }
  return {
    websiteUrl,
    title: summary.title,
    metaDescription: summary.meta_description,
    heroExcerpt: summary.main_text_excerpt,
    pagesAnalyzed: [websiteUrl],
    messagingPatterns: summary.main_text_excerpt ? [summary.main_text_excerpt] : [],
    trustElements: [],
    conversionElements: [],
    ok: true,
  };
}

async function fetchWebsiteSummary(url) {
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(trimmed, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    const html = await response.text();
    const title = decodeHtmlEntities((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "").trim());
    const meta = decodeHtmlEntities(
      (
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        ""
      ).trim(),
    );
    const hero = decodeHtmlEntities(
      stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").trim()).slice(0, 500),
    );
    if (!title && !meta && !hero) return null;
    return { title, meta_description: meta, main_text_excerpt: hero || meta.slice(0, 500) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPublicInstagramByHandle(handleRaw) {
  const handle = handleRaw.replace(/^@/, "").split(/[/?#]/)[0]?.trim();
  if (!handle) return null;
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
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
      const oembed = await tryInstagramOembed(url);
      return oembed ? { ...oembed, blocked: false } : null;
    }
    const html = await response.text();
    const bio = extractInstagramBio(html);
    const followerMatch = html.match(/"edge_followed_by":\s*\{\s*"count":\s*(\d+)/i);
    const followers = followerMatch
      ? `${Number(followerMatch[1]).toLocaleString("en-US")} followers (public page)`
      : extractFollowersFromBio(bio);
    const captionSnippets = [];
    const seen = new Set();
    for (const match of html.matchAll(/"text":"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      if (captionSnippets.length >= 5) break;
      const raw = match[1] ?? "";
      if (raw.length < 24) continue;
      const line = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim().slice(0, 200);
      if (line.toLowerCase().includes("log in to instagram")) continue;
      if (line.toLowerCase().includes("see more on instagram")) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      captionSnippets.push(line);
    }
    if (!bio && captionSnippets.length === 0 && !followers) {
      const oembed = await tryInstagramOembed(url);
      return oembed ? { ...oembed, blocked: false } : null;
    }
    return { bio, followers, last_n_caption_snippets: captionSnippets };
  } catch {
    const oembed = await tryInstagramOembed(url);
    return oembed ? { ...oembed, blocked: false } : null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchInstagramProfileSignals(handleRaw) {
  const handle = handleRaw.replace(/^@/, "").split(/[/?#]/)[0]?.trim();
  if (!handle) return null;
  try {
    const startedAt = Date.now();
    const script = `
const handle = process.argv[1];
const UA = ${JSON.stringify(UA)};
function decodeHtmlEntities(value) {
  return value
    .replace(/\\\\n/g, ' ')
    .replace(/\\\\\"/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}
` +
      "function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }\n" +
      `function findMetaContent(html, key) {
  const forward = new RegExp('<meta[^>]+(?:property|name)=["\\']' + escapeRegExp(key) + '["\\'][^>]+content=(["\\'])([\\\\s\\\\S]*?)\\\\1[^>]*>', 'i');
  const reverse = new RegExp('<meta[^>]+content=(["\\'])([\\\\s\\\\S]*?)\\\\1[^>]+(?:property|name)=["\\']' + escapeRegExp(key) + '["\\'][^>]*>', 'i');
  return decodeHtmlEntities((html.match(forward)?.[2] ?? html.match(reverse)?.[2] ?? '').trim());
}
function findTitle(html) { return decodeHtmlEntities((html.match(/<title[^>]*>([\\s\\S]*?)<\\\\/title>/i)?.[1] ?? '').trim()); }
function extractFromJsonScript(html, pattern) {
  for (const match of html.matchAll(/<script[^>]+type=["\\']application\\\\/ld\\\\+json["\\'][^>]*>([\\s\\S]*?)<\\\\/script>/gi)) {
    const found = (match[1] ?? '').match(pattern)?.[1];
    if (found?.trim()) return decodeHtmlEntities(found.trim());
  }
  return '';
}
function extractProfileHeader(html) {
  const match = html.match(/(\\d[\\d.,]*\\s+Followers[\\s\\S]{0,180}?Instagram\\s*\\([^)]*\\))/i) || html.match(/(\\d[\\d.,]*\\s+Followers[\\s\\S]{0,180}?See Instagram photos and videos[^<]+)/i);
  return decodeHtmlEntities((match?.[1] ?? '').trim());
}
function extractFollowersFromBio(bio) {
  const match = bio.match(/([\\d.,]+[MK]?)\\s+Followers/i);
  return match ? match[1] + ' followers (public meta)' : '';
}
function extractInstagramBio(html) {
  const metaContent = findMetaContent(html, 'og:description') || findMetaContent(html, 'description');
  const metaTitle = findMetaContent(html, 'og:title') || findTitle(html);
  const ldJsonBio = extractFromJsonScript(html, /"description"\\s*:\\s*"([^"]+)"/i);
  const fallbackBio = metaContent || ldJsonBio || metaTitle || extractProfileHeader(html) || '';
  return decodeHtmlEntities(fallbackBio.trim());
}
(async () => {
  const url = 'https://www.instagram.com/' + encodeURIComponent(handle) + '/';
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });
  const html = await response.text();
  const bio = extractInstagramBio(html);
  const followers = extractFollowersFromBio(bio);
  console.log(JSON.stringify({ status: response.status, bio, followers, last_n_caption_snippets: [] }));
})().catch((error) => {
  console.error(JSON.stringify({ error: String(error), name: error?.name, message: error?.message }));
  process.exit(1);
});
`;
    const { stdout } = await execFileAsync(process.execPath, ["-e", script, handle], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout.trim());
    log({ kind: "instagram.profile/fetch", handle, status: parsed.status ?? null, ms: Date.now() - startedAt });
    const bio = typeof parsed.bio === "string" ? parsed.bio : "";
    const followers = typeof parsed.followers === "string" ? parsed.followers : "";
    log({
      kind: "instagram.profile/extracted",
      handle,
      hasBio: !!bio,
      hasFollowers: !!followers,
      bioSnippet: bio.slice(0, 180),
    });
    return {
      bio,
      followers,
      last_n_caption_snippets: [],
    };
  } catch {
    log({ kind: "instagram.profile/error", handle, source: "public-fetch" });
    return null;
  }
}

async function tryInstagramOembed(profileUrl) {
  const url = `https://api.instagram.com/oembed?url=${encodeURIComponent(profileUrl)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/application\/json/i.test(contentType)) return null;
    const json = await response.json();
    const line = String(json.title || json.author_name || "").trim();
    log({ kind: "instagram.profile/oembed", contentType, hasLine: !!line });
    if (!line) return null;
    return { bio: line, followers: "", last_n_caption_snippets: [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractInstagramBio(html) {
  const metaContent = findMetaContent(html, "og:description") || findMetaContent(html, "description");
  const metaTitle = findMetaContent(html, "og:title") || findTitle(html);
  const ldJsonBio = extractFromJsonScript(html, /"description"\s*:\s*"([^"]+)"/i);
  const fallbackBio = metaContent || ldJsonBio || metaTitle || extractProfileHeader(html) || "";
  return decodeHtmlEntities(fallbackBio.trim());
}

function findMetaContent(html, key) {
  const forward = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]+content=(["'])([\\s\\S]*?)\\1[^>]*>`,
    "i",
  );
  const reverse = new RegExp(
    `<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+(?:property|name)=["']${escapeRegExp(key)}["'][^>]*>`,
    "i",
  );
  return decodeHtmlEntities((html.match(forward)?.[2] ?? html.match(reverse)?.[2] ?? "").trim());
}

function findTitle(html) {
  return decodeHtmlEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
}

function extractFromJsonScript(html, pattern) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const found = (match[1] ?? "").match(pattern)?.[1];
    if (found?.trim()) return decodeHtmlEntities(found.trim());
  }
  return "";
}

function extractProfileHeader(html) {
  const match =
    html.match(/(\d[\d.,]*\s+Followers[\s\S]{0,180}?Instagram\s*\([^)]*\))/i) ||
    html.match(/(\d[\d.,]*\s+Followers[\s\S]{0,180}?See Instagram photos and videos[^<]+)/i);
  return decodeHtmlEntities((match?.[1] ?? "").trim());
}

function extractFollowersFromBio(bio) {
  const match = bio.match(/([\d.,]+[MK]?)\s+Followers/i);
  return match ? `${match[1]} followers (public meta)` : "";
}

function stripTags(input) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeHandle(handle) {
  return handle.replace(/^@/, "").trim();
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function writeJson(res, id, result) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function writeError(res, id, code, message) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
}

function log(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
