import { openai } from "../openaiClient.js";
import { buildPillarMeta, type PillarMeta } from "./pillars.js";

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

const SYSTEM = `You are a senior social media strategist + operator running an agency's content engine.

You receive: brand strategy, SOW (platforms + monthly post counts + content mix + deliverables + tone-per-platform), and a monthly brief (month + goal + notes). You output ONE complete JSON object containing the planner layer and a fully-resolved calendar — every post specific, intentional, and ready to execute.

Return STRICT JSON only. No prose.

Schema:
{
  "planner": {
    "distribution":   { "<pillar_key>": <number> },         // pillar mix percentages summing to 100; respect SOW.contentMix as the source of truth
    "formats":        { "<format_key>": <number> },         // format mix percentages summing to 100, derived from how the platforms breakdown
    "platformSplit":  { "<platform>": <number> },           // post counts per platform (NOT percent) — must equal SOW.monthlyPosts
    "angleBank":      { "<pillar_key>": ["...", "..."] },   // 4-6 sharp brand-specific angles per pillar
    "hookStyles":     ["...", "..."],                       // 5-7 hook archetypes
    "weeklyFlow":     { "week_1": "...", "week_2": "...", "week_3": "...", "week_4": "..." },
    "kpis":           { "<metric>": "<target/definition>" },// 3-5 KPIs aligned to the monthly goal
    "phases":         [ { "name": "Week 1: Awareness", "focus": "..." } ]
  },
  "posts": [
    {
      "date": "YYYY-MM-DD",
      "platform": "Instagram" | "LinkedIn" | "TikTok" | "X" | "YouTube",
      "pillar": "<exact pillar name>",
      "angle": "<one specific brand angle>",
      "format": "<format native to this platform — see Format Intelligence below>",
      "objective": "<one sentence>",
      "hook": "<6-14 word opening line, brand voice, NEVER generic>",
      "caption": "<1-3 short paragraphs of caption copy in this platform's tone>",
      "hashtags": ["#tag", "#tag"],
      "cta": "<one specific CTA>",
      "strategicIntent": "<WHY this post exists and what role it plays in the month's flow>",
      "expectedMetric": "<reach | saves | shares | comments | profile visits | link clicks | replies | DMs | watch_time>",
      "expectedReason": "<one sentence: WHY we expect that metric to move>",
      "priority": "high" | "medium" | "low",
      "execution": <FORMAT-SPECIFIC OBJECT — see below>
    }
  ]
}

CRITICAL RULES:

1. SOW IS LAW.
   - Total post count = sum of SOW.monthlyPosts. Do NOT default to 30. Do NOT add or remove posts.
   - Per-platform counts = exactly SOW.monthlyPosts. Reflect that in "platformSplit".
   - Pillar mix percentages = SOW.contentMix (you may round to integers if needed but they must sum to 100).
   - Honor SOW.deliverables as recurring slots (e.g. "weekly story takeover" = one Story per week on a consistent day).

2. PLATFORM DIFFERENTIATION IS MANDATORY.
   - Instagram ≠ LinkedIn ≠ TikTok. Tone, hook style, caption length, format, and CTA must change.
   - Use the SOW.toneByPlatform mapping verbatim — if LinkedIn says "operator-to-operator, no fluff", that voice MUST appear in those posts.
   - Do not put a LinkedIn-style essay on Instagram, and do not put an Instagram Reel hook on LinkedIn.

3. EVERY POST MUST FEEL INTENTIONAL.
   - "strategicIntent" must explain why THIS post in THIS slot — no boilerplate.
   - "expectedMetric" + "expectedReason" must be honest (not every post is a viral reel — some are nurture, some are conversion).
   - "priority" — roughly 20-30% high, 50-60% medium, rest low. High = anchor posts (launches, hero pieces, big stories). Low = utility posts (UGC repost, story poll, simple repurpose).

4. FOLLOW THE WEEKLY FLOW.
   - Spread posts across the month so each week reflects its phase (e.g. week 1 awareness/baseline, week 4 conversion/proof). Use the chosen month's actual dates.
   - Avoid clumping the same pillar or format on consecutive days.

5. CONTENT QUALITY.
   - No "Did you know...", no "5 tips for...", no generic listicle hooks.
   - Hooks reference the actual offer/audience/pain.
   - CTAs are SPECIFIC (e.g. "DM 'AUDIT' for the checklist", not "Comment below").
   - Captions feel native to the platform (LinkedIn = first-person operator, IG = punchy + scannable, TikTok = casual + spoken cadence).

6. FORMAT INTELLIGENCE — "execution" SHAPE BY FORMAT:

   CAROUSEL:
   {
     "slides": [
       { "n": 1, "role": "hook",       "headline": "...", "body": "..." },
       { "n": 2, "role": "value",      "headline": "...", "body": "..." },
       { "n": 3, "role": "value",      "headline": "...", "body": "..." },
       { "n": 4, "role": "value",      "headline": "...", "body": "..." },
       { "n": 5, "role": "insight",    "headline": "...", "body": "..." },
       { "n": 6, "role": "cta",        "headline": "...", "body": "..." }
     ],
     "design_direction": "<typography/imagery cue>"
   }

   REEL (or short-form video on TikTok/YouTube Shorts):
   {
     "hook_2s": "<the literal first 2 seconds — spoken + visual>",
     "pattern_interrupt": "<what changes at ~3-5s to keep them>",
     "beats": ["<beat 1>", "<beat 2>", "<beat 3>", "<beat 4>"],
     "cta_on_screen": "<final on-screen CTA>",
     "visual_direction": "<shot list / b-roll / setting>",
     "audio": "<music/sound direction or 'spoken-only'>"
   }

   STATIC (single image/post):
   {
     "visual_idea": "<the one strong image>",
     "headline": "<short on-image headline if any>",
     "caption_depth": "<what the caption uniquely carries that the image doesn't>"
   }

   STORIES:
   {
     "frames": [
       { "n": 1, "role": "hook",  "copy": "...", "interaction": "poll | question | slider | quiz" },
       { "n": 2, "role": "value", "copy": "...", "interaction": "none" },
       { "n": 3, "role": "value", "copy": "...", "interaction": "none" },
       { "n": 4, "role": "cta",   "copy": "...", "interaction": "link sticker | DM keyword" }
     ]
   }

   TEXT (LinkedIn text post / X thread):
   {
     "opening_line": "<scroll-stopper>",
     "body": "<the full post copy>",
     "close": "<line that earns the comment/DM>"
   }

   VIDEO (long-form, e.g. LinkedIn video, YouTube):
   {
     "hook_5s": "...",
     "structure": ["intro", "point 1", "point 2", "point 3", "cta"],
     "visual_direction": "..."
   }

7. NEVER use placeholders. Every string must be real, usable copy. The strategist should be able to hand the JSON to a designer/editor without thinking.`;

export async function generateMonthlyPlan(
  brandName: string,
  enriched: Record<string, unknown>,
  structured: Record<string, unknown>,
  sow: SowInput,
  brief: MonthlyBrief,
): Promise<GenerationResult> {
  const pillars = buildPillarMeta(structured["content_strategy"] as Record<string, unknown>);
  const totalPosts = Object.values(sow.monthlyPosts).reduce((a, b) => a + (Number(b) || 0), 0);

  const userPrompt = `BRAND: ${brandName}

ENRICHED PROFILE:
${JSON.stringify(enriched, null, 2)}

STRUCTURED STRATEGY (pillars, audience, positioning, phases):
${JSON.stringify(
  {
    audience: structured["audience"],
    brand_philosophy: structured["brand_philosophy"],
    platform_strategy: structured["platform_strategy"],
    content_strategy: structured["content_strategy"],
    phases: structured["phases"],
    kpis: structured["kpis"],
  },
  null,
  2,
)}

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
Spread these posts across the month starting from ${brief.startDate}, following the weekly flow.

Return ONE JSON object: { "planner": {...}, "posts": [...] }.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 16384,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as {
    planner?: Partial<PlannerLayer>;
    posts?: Array<Partial<CalendarPost>>;
  };

  const pillarKeys = pillars.map((p) => pillarKey(p.name));
  const formatKeys = inferFormatKeys(sow);

  const planner: PlannerLayer = {
    distribution: normalizePercents(
      parsed.planner?.distribution ?? toPillarKeyMap(sow.contentMix, pillars),
      pillarKeys,
    ),
    formats: normalizePercents(parsed.planner?.formats, formatKeys),
    platformSplit: normalizeCounts(parsed.planner?.platformSplit, sow.monthlyPosts),
    angleBank: parsed.planner?.angleBank ?? {},
    hookStyles:
      Array.isArray(parsed.planner?.hookStyles) && parsed.planner!.hookStyles!.length
        ? (parsed.planner!.hookStyles as string[])
        : ["curiosity", "authority", "story", "contrarian", "data"],
    weeklyFlow:
      parsed.planner?.weeklyFlow ?? {
        week_1: "Awareness + baseline",
        week_2: "Trust + repeatability",
        week_3: "Conversion / offer",
        week_4: "Proof + community",
      },
    pillars,
    kpis: parsed.planner?.kpis ?? {},
    phases: Array.isArray(parsed.planner?.phases)
      ? (parsed.planner!.phases as Array<{ name: string; focus: string }>)
      : [],
  };

  const start = new Date(brief.startDate + "T00:00:00Z");
  const fallbackPlatform = sow.platforms[0] ?? "Instagram";
  const fallbackPillar = pillars[0]?.name ?? "Education";

  const rawPosts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const posts: CalendarPost[] = rawPosts.slice(0, totalPosts).map((p, i) => {
    const fallback = new Date(start);
    fallback.setUTCDate(fallback.getUTCDate() + i);
    const fallbackIso = fallback.toISOString().slice(0, 10);
    return {
      date:
        typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
          ? p.date
          : fallbackIso,
      platform: p.platform || fallbackPlatform,
      pillar: p.pillar || fallbackPillar,
      angle: p.angle || "",
      format: p.format || "Reel",
      objective: p.objective || "",
      hook: p.hook || "",
      caption: p.caption ?? null,
      hashtags: Array.isArray(p.hashtags) ? p.hashtags : null,
      cta: p.cta || "",
      strategicIntent: p.strategicIntent || "",
      expectedMetric: p.expectedMetric || "reach",
      expectedReason: p.expectedReason || "",
      priority: normalizePriority(p.priority),
      execution: (p.execution && typeof p.execution === "object" ? p.execution : {}) as Record<
        string,
        unknown
      >,
    };
  });

  return { planner, posts };
}

function inferFormatKeys(sow: SowInput): string[] {
  const set = new Set<string>();
  for (const p of sow.platforms) {
    const lower = p.toLowerCase();
    if (lower.includes("instagram")) {
      ["reel", "carousel", "static", "story"].forEach((f) => set.add(f));
    } else if (lower.includes("linkedin")) {
      ["text", "carousel", "video"].forEach((f) => set.add(f));
    } else if (lower.includes("tiktok") || lower.includes("youtube")) {
      ["reel", "video"].forEach((f) => set.add(f));
    } else if (lower.includes("twitter") || lower === "x") {
      ["text", "thread"].forEach((f) => set.add(f));
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
