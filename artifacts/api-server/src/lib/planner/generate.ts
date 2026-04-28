import { getLLMProvider, type LLMProvider } from "../llm/index.js";
import { getStrictJsonWithRetry } from "../llm/json-retry.js";
import { assertPromptWithinBudget, trimToTokenBudget } from "../llm/prompt-budget.js";
import { buildPillarMeta, type PillarMeta } from "./pillars.js";
import { buildPostDetailPayload } from "./post-detail.js";
import type {
  InstagramSummary,
  WebsiteSummary,
} from "../extraction/summaries.js";

export interface SowInput {
  platforms: string[];
  monthlyPosts: Record<string, number>;
  contentMix: Record<string, number>;
  deliverables: string[];
  toneByPlatform: Record<string, string>;
}

export interface MonthlyBrief {
  month: string;
  startDate: string;
  goal: string;
  notes: string;
}

export interface PlannerLayer {
  distribution: Record<string, number>;
  formats: Record<string, number>;
  platformSplit: Record<string, number>;
  angleBank: Record<string, string[]>;
  hookStyles: string[];
  weeklyFlow: Record<string, string>;
  pillars: PillarMeta[];
  kpis: Record<string, string>;
  phases: Array<{ name: string; focus: string }>;
}

export type Priority = "high" | "medium" | "low";

export interface CalendarPost {
  date: string;
  platform: string;
  pillar: string;
  angle: string;
  format: string;
  repurposeTargets?: string[];
  objective: string;
  hook: string;
  cta: string;
  caption?: string | null;
  hashtags?: string[] | null;
  strategicIntent: string;
  expectedMetric: string;
  expectedReason: string;
  priority: Priority;
  execution: Record<string, unknown>;
}

export interface GenerationResult {
  planner: PlannerLayer;
  posts: CalendarPost[];
}

const PLANNER_SYSTEM = `You are a senior social strategist. Return STRICT compact JSON only.
Output:
{
  "planner": {
    "distribution": { "<pillar_key>": <number> },
    "formats": { "<format_key>": <number> },
    "platformSplit": { "<platform>": <number> },
    "angleBank": { "<pillar_key>": ["...", "..."] },
    "hookStyles": ["...", "..."],
    "weeklyFlow": { "week_1": "...", "week_2": "...", "week_3": "...", "week_4": "..." },
    "kpis": { "<metric>": "<target/definition>" },
    "phases": [{ "name": "Week 1", "focus": "..." }]
  }
}
Rules: concise values only.`;

const WEEK_POSTS_SYSTEM = `You are a social strategist. Return STRICT JSON only:
{
  "posts": [
    {
      "date": "YYYY-MM-DD",
      "platform": "Instagram" | "LinkedIn" | "Pinterest" | "X" | "YouTube",
      "pillar": "<pillar>",
      "angle": "<short angle>",
      "format": "carousel" | "reel" | "story" | "static" | "text post" | "thread" | "image post" | "static pin" | "video pin" | "short video" | "long video" | "community post" | "pdf carousel",
      "repurposeTargets": ["<platform> - <format>", "<platform> - <format>"],
      "objective": "<short objective>",
      "hook": "<short hook>",
      "caption": "<short caption>",
      "cta": "<cta>",
      "priority": "high" | "medium" | "low"
    }
  ]
}
Rules:
- Match platform and format correctly. Do not default everything to Instagram or Stories.
- Instagram: carousel, reel, story, static.
- LinkedIn: text post, carousel, pdf carousel, short video.
- X: text post, thread, image post.
- Pinterest: static pin, video pin.
- YouTube: short video, long video, community post.
- Educational or how-to content should prefer carousel on Instagram or LinkedIn where it fits.
- CTA must fit the platform. Examples: Instagram "DM/comment/save/share", LinkedIn "comment/follow/connect", X "reply/repost/bookmark", Pinterest "save/click", YouTube "comment/subscribe/watch".
- Add 0-2 repurposeTargets only when the post is a good candidate for reuse across platforms.
- Concise output, no commentary.`;

export async function generateMonthlyPlan(
  brandName: string,
  enriched: Record<string, unknown>,
  structured: Record<string, unknown>,
  sow: SowInput,
  brief: MonthlyBrief,
  provider?: LLMProvider,
  extraction?: {
    websiteSummary?: WebsiteSummary | null;
    instagramSummary?: InstagramSummary | null;
    strategySummary?: string | null;
    pillarPriorities?: string[] | null;
    monthlyGoals?: string[] | null;
  },
): Promise<GenerationResult> {
  const pillars = buildPillarMeta(structured["content_strategy"] as Record<string, unknown>);
  const targetPlatformCounts = normalizePlatformTargets(sow.monthlyPosts, sow.platforms);
  const totalPosts = Object.values(targetPlatformCounts).reduce((a, b) => a + (Number(b) || 0), 0);

  const compactEnriched = pickCompactEnriched(enriched);
  const compactStructured = pickCompactStructured(structured);
  const compactExtraction = {
    strategy_summary: trimToTokenBudget(
      extraction?.strategySummary || buildDefaultStrategySummary(brandName, compactStructured),
      220,
    ),
    pillar_priorities: (extraction?.pillarPriorities ?? pillars.map((p) => p.name)).slice(0, 5),
    monthly_goals: (extraction?.monthlyGoals ?? [brief.goal || "Support the approved strategy goals"]).slice(0, 4),
  };

  const userPrompt = `BRAND: ${brandName}

ENRICHED PROFILE (compact):
${JSON.stringify(compactEnriched, null, 2)}

CALENDAR INPUT (compact):
${JSON.stringify(compactExtraction, null, 2)}

PILLARS (use snake_case keys for distribution/angleBank):
${pillars.map((p) => `- ${p.name} (key: ${pillarKey(p.name)})${p.description ? ` — ${p.description}` : ""}`).join("\n")}

SOW (Statement of Work — THE LAW):
${JSON.stringify(sow, null, 2)}

MONTHLY BRIEF:
- Month: ${brief.month}
- Start date: ${brief.startDate}
- Goal: ${brief.goal || "(none specified — derive from strategy)"}
- Notes: ${brief.notes || "(none)"}

TOTAL POSTS REQUIRED: ${totalPosts} (sum of SOW.monthlyPosts).
Return ONLY the planner JSON object.`;

  assertPromptWithinBudget("calendar planner", [PLANNER_SYSTEM, userPrompt], 2000, 450);
  const llmProvider = provider ?? getLLMProvider();
  const plannerStartedAt = Date.now();
  const parsedPlanner = await getStrictJsonWithRetry<{
    planner?: Partial<PlannerLayer>;
  }>(llmProvider, {
    contextLabel: "calendar planner",
    maxOutputTokens: 450,
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });
  console.info(
    `[llm-observe] calendar.planner ttft_ms=unavailable total_ms=${Date.now() - plannerStartedAt}`,
  );

  const pillarKeys = pillars.map((p) => pillarKey(p.name));
  const formatKeys = inferFormatKeys(sow);

  const planner: PlannerLayer = {
    distribution: normalizePercents(
      parsedPlanner.planner?.distribution ?? toPillarKeyMap(sow.contentMix, pillars),
      pillarKeys,
    ),
    formats: normalizePercents(parsedPlanner.planner?.formats, formatKeys),
    platformSplit: targetPlatformCounts,
    angleBank: parsedPlanner.planner?.angleBank ?? {},
    hookStyles:
      Array.isArray(parsedPlanner.planner?.hookStyles) && parsedPlanner.planner!.hookStyles!.length
        ? (parsedPlanner.planner!.hookStyles as string[])
        : ["curiosity", "authority", "story", "contrarian", "data"],
    weeklyFlow:
      parsedPlanner.planner?.weeklyFlow ?? {
        week_1: "Awareness + baseline",
        week_2: "Trust + repeatability",
        week_3: "Conversion / offer",
        week_4: "Proof + community",
      },
    pillars,
    kpis: parsedPlanner.planner?.kpis ?? {},
    phases: Array.isArray(parsedPlanner.planner?.phases)
      ? (parsedPlanner.planner!.phases as Array<{ name: string; focus: string }>)
      : [],
  };

  const start = new Date(brief.startDate + "T00:00:00Z");
  const fallbackPlatform = preferredFallbackPlatform(sow.platforms);
  const fallbackPillar = pillars[0]?.name ?? "Education";
  const weeklyTargets = splitAcrossWeeks(totalPosts, 4);
  const weekTasks: Array<{
    weekIndex: number;
    targetCount: number;
    prompt: string;
  }> = [];
  for (let week = 0; week < weeklyTargets.length; week += 1) {
    const targetCount = weeklyTargets[week]!;
    if (targetCount <= 0) continue;
    const weekStart = new Date(start);
    weekStart.setUTCDate(weekStart.getUTCDate() + week * 7);
    const weekPrompt = `BRAND: ${brandName}
MONTH: ${brief.month}
WEEK: ${week + 1}
START_DATE: ${weekStart.toISOString().slice(0, 10)}
TARGET_POSTS: ${targetCount}
PLATFORMS: ${JSON.stringify(sow.platforms)}
PILLARS: ${JSON.stringify(pillars.map((p) => p.name))}
WEEKLY_FLOW: ${JSON.stringify(planner.weeklyFlow)}
GOAL: ${brief.goal || "Support strategy goals"}
NOTES: ${brief.notes || ""}
Return exactly ${targetCount} posts in JSON.
Use platform-specific formats and CTAs, and add repurposeTargets only when reuse is obvious.`;
    weekTasks.push({ weekIndex: week, targetCount, prompt: weekPrompt });
  }

  const rawPostsByWeek = await runWithConcurrency(
    weekTasks,
    2,
    async (task) => {
      assertPromptWithinBudget(`calendar week ${task.weekIndex + 1}`, [WEEK_POSTS_SYSTEM, task.prompt], 1200, 320);
      const weekStartedAt = Date.now();
      const parsedWeek = await getStrictJsonWithRetry<{ posts?: Array<Partial<CalendarPost>> }>(
        llmProvider,
        {
          contextLabel: `calendar week ${task.weekIndex + 1}`,
          maxOutputTokens: 320,
          messages: [
            { role: "system", content: WEEK_POSTS_SYSTEM },
            { role: "user", content: task.prompt },
          ],
        },
      );
      const postsForWeek = Array.isArray(parsedWeek.posts)
        ? parsedWeek.posts.slice(0, task.targetCount)
        : [];
      console.info(
        `[llm-observe] calendar.week${task.weekIndex + 1} ttft_ms=unavailable total_ms=${Date.now() - weekStartedAt} posts=${postsForWeek.length}`,
      );
      return { weekIndex: task.weekIndex, posts: postsForWeek };
    },
  );

  const rawPosts: Array<Partial<CalendarPost>> = rawPostsByWeek
    .sort((a, b) => a.weekIndex - b.weekIndex)
    .flatMap((entry) => entry.posts);
  const assignedPlatforms = assignPlatformsByQuota(rawPosts, targetPlatformCounts, fallbackPlatform);
  const sourcePosts = Array.from({ length: totalPosts }, (_, index) => rawPosts[index] ?? {});

  const normalizeStartedAt = Date.now();
  const posts: CalendarPost[] = sourcePosts.map((p, i) => {
    const fallback = new Date(start);
    fallback.setUTCDate(fallback.getUTCDate() + i);
    const fallbackIso = fallback.toISOString().slice(0, 10);
    const normalizedPlatform = assignedPlatforms[i] ?? fallbackPlatform;
    const normalizedFormat = normalizeFormatForPlatform(
      typeof p.format === "string" ? p.format : "",
      normalizedPlatform,
    );
    const repurposeTargets = normalizeRepurposeTargets(p.repurposeTargets);
    const cta = p.cta || defaultCtaForPlatform(normalizedPlatform, normalizedFormat);
    const normalizedDetail = buildPostDetailPayload({
      format: normalizedFormat,
      platform: normalizedPlatform,
      pillar: p.pillar || fallbackPillar,
      objective: p.objective || "",
      hook: p.hook || "",
      cta,
      caption: p.caption ?? null,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : null,
      strategicIntent: p.strategicIntent || "",
      expectedMetric: p.expectedMetric || "reach",
      expectedReason: p.expectedReason || "",
      priority: normalizePriority(p.priority),
      execution: {
        ...((p.execution && typeof p.execution === "object" ? p.execution : {}) as Record<string, unknown>),
        ...(repurposeTargets.length > 0 ? { repurpose_targets: repurposeTargets } : {}),
      },
    });
    return {
      date:
        typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
          ? p.date
          : fallbackIso,
      platform: normalizedPlatform,
      pillar: p.pillar || fallbackPillar,
      angle: p.angle || "",
      format: normalizedFormat,
      ...(repurposeTargets.length > 0 ? { repurposeTargets } : {}),
      objective: p.objective || "",
      hook: p.hook || "",
      caption: normalizedDetail.caption,
      hashtags: normalizedDetail.hashtags,
      cta,
      strategicIntent: p.strategicIntent || "",
      expectedMetric: p.expectedMetric || "reach",
      expectedReason: "",
      priority: normalizePriority(p.priority),
      execution: normalizedDetail.execution,
    };
  });
  const normalizedPosts = ensureCreativeFormatCoverage(posts);
  console.info(
    `[llm-observe] calendar.postprocess normalize_ms=${Date.now() - normalizeStartedAt} posts=${normalizedPosts.length}`,
  );
  return { planner, posts: normalizedPosts };
}

function pickCompactEnriched(enriched: Record<string, unknown>) {
  const audience = (enriched.target_audience as Record<string, unknown> | undefined) ?? {};
  return {
    brand_name: String(enriched.brand_name ?? ""),
    offer: String(enriched.offer ?? ""),
    positioning: String(enriched.positioning ?? ""),
    platform: String(enriched.platform ?? ""),
    content_preference: String(enriched.content_preference ?? ""),
    target_audience: {
      who: String(audience.who ?? ""),
      stage: String(audience.stage ?? ""),
      pains: String(audience.pains ?? ""),
    },
    competitors: Array.isArray(enriched.competitors)
      ? (enriched.competitors as unknown[]).slice(0, 5)
      : [],
  };
}

function pickCompactStructured(structured: Record<string, unknown>) {
  return {
    audience: trimToTokenBudget(stringifyValue(structured["audience"]), 140),
    platform_strategy: trimToTokenBudget(stringifyValue(structured["platform_strategy"]), 140),
    content_strategy: trimToTokenBudget(stringifyValue(structured["content_strategy"]), 180),
    phases: trimToTokenBudget(stringifyValue(structured["phases"]), 100),
    kpis: trimToTokenBudget(stringifyValue(structured["kpis"]), 100),
  };
}

function inferFormatKeys(sow: SowInput): string[] {
  const set = new Set<string>();
  for (const p of sow.platforms) {
    const lower = p.toLowerCase();
    if (lower.includes("instagram")) {
      ["reel", "carousel", "static", "story"].forEach((f) => set.add(f));
    } else if (lower.includes("linkedin")) {
      ["text post", "carousel", "pdf carousel", "short video"].forEach((f) => set.add(f));
    } else if (lower.includes("twitter") || lower === "x") {
      ["text post", "thread", "image post"].forEach((f) => set.add(f));
    } else if (lower.includes("pinterest")) {
      ["static pin", "video pin"].forEach((f) => set.add(f));
    } else if (lower.includes("youtube")) {
      ["short video", "long video", "community post"].forEach((f) => set.add(f));
    }
  }
  if (set.size === 0) ["reel", "carousel", "static"].forEach((f) => set.add(f));
  return Array.from(set);
}

function toPillarKeyMap(
  contentMix: Record<string, number>,
  pillars: PillarMeta[],
): Record<string, number> {
  const out: Record<string, number> = {};
  const pillarNames = pillars.map((p) => p.name.toLowerCase());
  for (const [k, v] of Object.entries(contentMix)) {
    const lower = k.toLowerCase();
    const matched = pillarNames.find((n) => lower.includes(n) || n.includes(lower));
    const key = matched ? pillarKey(matched) : pillarKey(k);
    out[key] = (out[key] ?? 0) + Number(v);
  }
  return out;
}

function normalizePriority(p: unknown): Priority {
  if (p === "high" || p === "medium" || p === "low") return p;
  return "medium";
}

function pillarKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function normalizePercents(
  input: Record<string, number> | undefined,
  expectedKeys: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "number" && !Number.isNaN(v)) out[k] = v;
    }
  }
  if (Object.keys(out).length === 0 && expectedKeys.length > 0) {
    const each = Math.floor(100 / expectedKeys.length);
    for (const k of expectedKeys) out[k] = each;
    out[expectedKeys[0]!] = 100 - each * (expectedKeys.length - 1);
  }
  return out;
}

function normalizeCounts(
  input: Record<string, number> | undefined,
  fallback: Record<string, number>,
): Record<string, number> {
  if (input && typeof input === "object") {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input)) {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k] = n;
    }
    if (Object.keys(out).length > 0) return out;
  }
  return { ...fallback };
}

export { pillarKey };

function normalizePlatformTargets(
  monthlyPosts: Record<string, number>,
  platforms: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const platform of platforms) {
    const normalized = normalizePlatformName(platform, platform);
    out[normalized] = Number(monthlyPosts[platform] ?? monthlyPosts[normalized] ?? 0) || 0;
  }
  for (const [platform, count] of Object.entries(monthlyPosts)) {
    const normalized = normalizePlatformName(platform, platform);
    out[normalized] = Math.max(out[normalized] ?? 0, Number(count) || 0);
  }
  return Object.fromEntries(Object.entries(out).filter(([, count]) => count > 0));
}

function assignPlatformsByQuota(
  rawPosts: Array<Partial<CalendarPost>>,
  targetCounts: Record<string, number>,
  fallbackPlatform: string,
): string[] {
  const remaining = new Map<string, number>(Object.entries(targetCounts));
  const preferredOrder = Object.keys(targetCounts);
  const assigned: string[] = [];
  for (const post of rawPosts.slice(0, preferredOrder.reduce((sum, key) => sum + (targetCounts[key] ?? 0), 0))) {
    const preferred = normalizePlatformName(post.platform, fallbackPlatform);
    const preferredRemaining = remaining.get(preferred) ?? 0;
    if (preferredRemaining > 0) {
      assigned.push(preferred);
      remaining.set(preferred, preferredRemaining - 1);
      continue;
    }
    const nextPlatform =
      preferredOrder.find((platform) => (remaining.get(platform) ?? 0) > 0) ?? fallbackPlatform;
    assigned.push(nextPlatform);
    remaining.set(nextPlatform, Math.max(0, (remaining.get(nextPlatform) ?? 0) - 1));
  }
  for (const platform of preferredOrder) {
    let left = remaining.get(platform) ?? 0;
    while (left > 0) {
      assigned.push(platform);
      left -= 1;
    }
  }
  return assigned;
}

function ensureCreativeFormatCoverage(posts: CalendarPost[]): CalendarPost[] {
  const next = posts.map((post) => ({ ...post }));
  const byPlatform = new Map<string, number[]>();
  next.forEach((post, idx) => {
    const key = post.platform.trim().toLowerCase();
    const bucket = byPlatform.get(key) ?? [];
    bucket.push(idx);
    byPlatform.set(key, bucket);
  });
  for (const [platform, indices] of byPlatform.entries()) {
    const required = requiredFormatsForPlatform(platform, indices.length);
    if (required.length === 0) continue;
    const present = new Set(indices.map((i) => next[i]!.format.trim().toLowerCase()));
    let writePtr = 0;
    for (const requiredFormat of required) {
      if (present.has(requiredFormat)) continue;
      const targetIdx = indices[writePtr % indices.length]!;
      next[targetIdx] = {
        ...next[targetIdx]!,
        format: requiredFormat,
      };
      const execution = next[targetIdx]!.execution;
      if (execution && typeof execution === "object") {
        next[targetIdx]!.execution = {
          ...execution,
          format_style: requiredFormat,
        };
      }
      writePtr += 1;
    }
  }
  return next;
}

function preferredFallbackPlatform(platforms: string[]): string {
  const ordered = ["Instagram", "LinkedIn", "X", "Pinterest", "YouTube"];
  for (const platform of ordered) {
    const match = platforms.find((value) => normalizePlatformName(value, platform) === platform);
    if (match) return normalizePlatformName(match, platform);
  }
  return normalizePlatformName(platforms[0], "Instagram");
}

function normalizePlatformName(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "x" || raw.includes("twitter")) return "X";
  if (raw.includes("linkedin")) return "LinkedIn";
  if (raw.includes("pinterest")) return "Pinterest";
  if (raw.includes("youtube")) return "YouTube";
  if (raw.includes("instagram")) return "Instagram";
  return fallback;
}

function normalizeFormatForPlatform(format: string, platform: string): string {
  const lower = format.trim().toLowerCase();
  if (platform === "Instagram") {
    if (lower.includes("story")) return "story";
    if (lower.includes("carousel")) return "carousel";
    if (lower.includes("static") || lower.includes("image")) return "static";
    if (lower.includes("reel") || lower.includes("short") || lower.includes("video")) return "reel";
    return "carousel";
  }
  if (platform === "LinkedIn") {
    if (lower.includes("pdf")) return "pdf carousel";
    if (lower.includes("carousel")) return "carousel";
    if (lower.includes("video") || lower.includes("short")) return "short video";
    if (lower.includes("text") || lower.includes("post")) return "text post";
    return "text post";
  }
  if (platform === "X") {
    if (lower.includes("thread")) return "thread";
    if (lower.includes("image") || lower.includes("static")) return "image post";
    if (lower.includes("text") || lower.includes("post")) return "text post";
    return "text post";
  }
  if (platform === "Pinterest") {
    if (lower.includes("video")) return "video pin";
    if (lower.includes("pin") || lower.includes("static") || lower.includes("image")) return "static pin";
    return "static pin";
  }
  if (platform === "YouTube") {
    if (lower.includes("community")) return "community post";
    if (lower.includes("long")) return "long video";
    if (lower.includes("short") || lower.includes("reel") || lower.includes("video")) return "short video";
    return "short video";
  }
  return lower || "carousel";
}

function defaultCtaForPlatform(platform: string, format: string): string {
  if (platform === "Instagram") {
    if (format === "story") return "Reply to this story or DM START for the next step.";
    return "Comment START or DM START if you want the full breakdown.";
  }
  if (platform === "LinkedIn") {
    return "Comment with your biggest takeaway and follow for the next part.";
  }
  if (platform === "X") {
    return "Reply with your take and repost if this matches your experience.";
  }
  if (platform === "Pinterest") {
    return "Save this pin for later and click through for the full guide.";
  }
  if (platform === "YouTube") {
    return format === "community post"
      ? "Comment with the next question you want covered and subscribe for more."
      : "Comment with your question and subscribe for the next breakdown.";
  }
  return "Comment for the next step.";
}

function normalizeRepurposeTargets(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, 2)
    : [];
}

function requiredFormatsForPlatform(platform: string, count: number): string[] {
  if (count < 2) return [];
  if (platform.includes("instagram")) return count >= 4 ? ["carousel", "reel", "story"] : ["carousel", "reel"];
  if (platform.includes("linkedin")) return ["text post", "carousel"];
  if (platform === "x") return ["text post", "thread"];
  if (platform.includes("pinterest")) return ["static pin", "video pin"];
  if (platform.includes("youtube")) return ["short video", "community post"];
  return [];
}

function buildDefaultStrategySummary(brandName: string, compactStructured: Record<string, unknown>) {
  return `${brandName}: ${Object.values(compactStructured).join(" ")}`.replace(/\s+/g, " ").trim();
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function splitAcrossWeeks(total: number, weeks: number): number[] {
  if (weeks <= 0) return [];
  const base = Math.floor(total / weeks);
  const remainder = total % weeks;
  return Array.from({ length: weeks }, (_, idx) => base + (idx < remainder ? 1 : 0));
}

async function runWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const out: TResult[] = [];
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      out.push(await worker(next));
    }
  });
  await Promise.all(workers);
  return out;
}
