import { openai } from "../openaiClient.js";
import { buildPillarMeta, type PillarMeta } from "./pillars.js";

export interface PlannerLayer {
  distribution: Record<string, number>;
  formats: Record<string, number>;
  angleBank: Record<string, string[]>;
  hookStyles: string[];
  weeklyFlow: Record<string, string>;
  pillars: PillarMeta[];
}

export interface CalendarPost {
  date: string;
  platform: string;
  pillar: string;
  angle: string;
  format: string;
  objective: string;
  hook: string;
  cta: string;
}

const PLANNER_SYSTEM = `You are a senior content strategist. You build the planner layer that drives a 30-day content calendar.

Return STRICT JSON. No prose outside JSON.

Schema:
{
  "distribution": { "<pillar_key>": <number>, ... }   // percentages summing to 100
  "formats":      { "<format>": <number>, ... }       // percentages summing to 100; use the platform's native formats
  "angleBank":    { "<pillar_key>": ["...", "...", "..."] }  // 3-5 sharp, brand-specific angles per pillar
  "hookStyles":   ["...", "..."]                      // 4-6 hook styles (curiosity, authority, contrarian, story, data, relatable, etc.)
  "weeklyFlow":   { "week_1": "...", "week_2": "...", "week_3": "...", "week_4": "..." }  // narrative arc theme for each week
}

Rules:
- pillar_key is a snake_case key matching one of the provided pillar names (lowercased, spaces→underscores).
- distribution must sum to 100 and reflect the brand's actual goal mix (a Personal Brand leans education-heavy; D2C Growth leans conversion-heavier than a brand-building play).
- formats reflect the primary platform's native formats. Instagram: reels/carousel/static (and "story" if relevant). LinkedIn: text/carousel/video. TikTok: reels (long/short)/carousel.
- angles must be specific to THIS brand and audience — not generic "tips & tricks". Reference the actual offer/audience where natural.
- weeklyFlow should reflect the strategy phases (e.g. week 1 awareness, week 2 trust-building, week 3 offer/conversion, week 4 community/proof).`;

export async function generatePlannerLayer(
  brandName: string,
  enriched: Record<string, unknown>,
  structured: Record<string, unknown>,
): Promise<PlannerLayer> {
  const pillars = buildPillarMeta(structured["content_strategy"] as Record<string, unknown>);
  const platform =
    String((structured["platform_strategy"] as Record<string, unknown>)?.["primary_channel"] ??
      enriched["platform"] ?? "Instagram");

  const userPrompt = `Brand: ${brandName}
Primary platform: ${platform}

Pillars (use the snake_case keys when populating distribution/angleBank):
${pillars.map((p) => `- ${p.name} (key: ${pillarKey(p.name)})${p.description ? ` — ${p.description}` : ""}`).join("\n")}

Audience: ${JSON.stringify(structured["audience"] ?? enriched["target_audience"] ?? "")}
Goal/positioning: ${JSON.stringify(structured["brand_philosophy"] ?? enriched["positioning"] ?? "")}
Phases: ${JSON.stringify(structured["phases"] ?? "")}
KPIs: ${JSON.stringify(structured["kpis"] ?? "")}

Return the planner layer JSON.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<PlannerLayer>;

  return {
    distribution: normalizePercents(parsed.distribution, pillars.map((p) => pillarKey(p.name))),
    formats: normalizePercents(parsed.formats, ["reels", "carousel", "static"]),
    angleBank: parsed.angleBank ?? {},
    hookStyles: Array.isArray(parsed.hookStyles) && parsed.hookStyles.length
      ? parsed.hookStyles
      : ["curiosity", "authority", "story", "contrarian"],
    weeklyFlow: parsed.weeklyFlow ?? {
      week_1: "awareness",
      week_2: "engagement",
      week_3: "conversion",
      week_4: "mix",
    },
    pillars,
  };
}

const CALENDAR_SYSTEM = `You are a senior content strategist generating a 30-day content calendar.

Return STRICT JSON: { "posts": [ ... ] }. No prose outside JSON.

Each post:
{
  "date": "YYYY-MM-DD",
  "platform": "Instagram" | "LinkedIn" | "TikTok" | ...,
  "pillar": "<exact pillar name from the pillars list>",
  "angle": "<one of the angles from angleBank for that pillar, OR a fresh specific angle if needed>",
  "format": "Reel" | "Carousel" | "Static" | "Story" | ... ,
  "objective": "<one short sentence: what this post is meant to do>",
  "hook": "<the actual opening line of the post — 6 to 14 words, written in brand voice, NOT generic>",
  "cta": "<one short specific CTA, e.g. 'Save this for your next launch', 'DM SETUP for the template', 'Tap the link to read the full breakdown'>"
}

Rules:
- 30 posts total, one per day for 30 consecutive days starting on the given start date.
- Pillar mix MUST roughly match the distribution percentages.
- Format mix MUST roughly match the formats percentages.
- Across the 30 days, follow the weeklyFlow: week 1 (days 1-7), week 2 (days 8-14), week 3 (days 15-21), week 4 (days 22-28), days 29-30 = mixed wrap.
- Hooks must be specific to THIS brand and audience. No "Did you know...", no "Tips for...", no generic listicles.
- Vary the hookStyles across the calendar so no week is monotonous.
- Each post must have a clear, distinct CTA — not the same CTA copy-pasted.
- Avoid back-to-back posts on the same pillar in the same format.`;

export async function generateCalendarPosts(
  brandName: string,
  planner: PlannerLayer,
  enriched: Record<string, unknown>,
  structured: Record<string, unknown>,
  startDateISO: string,
): Promise<CalendarPost[]> {
  const platform =
    String((structured["platform_strategy"] as Record<string, unknown>)?.["primary_channel"] ??
      enriched["platform"] ?? "Instagram");

  const userPrompt = `Brand: ${brandName}
Primary platform: ${platform}
Start date: ${startDateISO}

Planner layer:
${JSON.stringify(
  {
    distribution: planner.distribution,
    formats: planner.formats,
    angleBank: planner.angleBank,
    hookStyles: planner.hookStyles,
    weeklyFlow: planner.weeklyFlow,
    pillars: planner.pillars.map((p) => ({ name: p.name, description: p.description })),
  },
  null,
  2,
)}

Audience: ${JSON.stringify(structured["audience"] ?? enriched["target_audience"] ?? "")}
Brand tone: ${JSON.stringify(enriched["brand_tone"] ?? "")}
Positioning: ${JSON.stringify(enriched["positioning"] ?? "")}
Offer: ${JSON.stringify(enriched["offer"] ?? "")}

Return { "posts": [...] } with exactly 30 posts.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CALENDAR_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { posts?: CalendarPost[] };
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];

  // Defensive: ensure 30 dates ascending from startDateISO
  const start = new Date(startDateISO + "T00:00:00Z");
  return posts.slice(0, 30).map((p, i) => {
    const fallbackDate = new Date(start);
    fallbackDate.setUTCDate(fallbackDate.getUTCDate() + i);
    const fallback = fallbackDate.toISOString().slice(0, 10);
    return {
      date: typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : fallback,
      platform: p.platform || platform,
      pillar: p.pillar || planner.pillars[0]?.name || "Education",
      angle: p.angle || "",
      format: p.format || "Reel",
      objective: p.objective || "",
      hook: p.hook || "",
      cta: p.cta || "",
    };
  });
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

export { pillarKey };
