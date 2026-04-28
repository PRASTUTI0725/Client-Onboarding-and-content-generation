import { getLLMProvider, type LLMProvider } from "../llm/index.js";
import { getStrictJsonWithRetry } from "../llm/json-retry.js";
import {
  assertPromptWithinBudget,
  trimToTokenBudget,
} from "../llm/prompt-budget.js";
import { TEMPLATES, type TemplateType } from "./templates.js";
import type { EnrichedData, RawInput } from "./enrich.js";
import type {
  InstagramSummary,
  WebsiteSummary,
} from "../extraction/summaries.js";
import type { SOWContextSection } from "../sow-context.js";

export interface StructuredStrategy {
  market_narrative: Record<string, unknown>;
  problem_gap_solution: Record<string, unknown>;
  brand_foundation: Record<string, unknown>;
  brand_philosophy: Record<string, unknown>;
  audience: Record<string, unknown>;
  emotional_drivers: string[];
  platform_strategy: Record<string, unknown>;
  content_strategy: Record<string, unknown>;
  kpis: Record<string, unknown>;
  tracking_plan: Record<string, unknown>;
  phases: Array<Record<string, unknown>>;
  asset_requirements: Array<Record<string, unknown>>;
}

export interface StrategyOutput {
  structured_strategy: StructuredStrategy;
  strategy_document: string;
}

export type StrategyDetailLevel = "core" | "full";

const STRUCTURED_SYSTEM = `You are a senior brand strategist producing the structured machine-readable layer of a concise brand strategy.

You must return STRICT JSON matching the requested schema. No prose outside JSON.

Rules:
- Be concise and specific; no filler.
- emotional_drivers: 3-4 short phrases.
- phases: 2-3 entries with compact fields.
- asset_requirements: 4-6 entries.
- Keep arrays short and practical; this is a fast core draft.`;

export async function generateStructuredStrategy(
  raw: RawInput,
  enriched: EnrichedData,
  templateType: TemplateType,
  provider?: LLMProvider,
  extraction?: {
    websiteSummary?: WebsiteSummary | null;
    instagramSummary?: InstagramSummary | null;
    sowContext?: {
      compactContext: string;
      topSections: SOWContextSection[];
    } | null;
  },
  options?: { detailLevel?: StrategyDetailLevel },
): Promise<StructuredStrategy> {
  const detailLevel = options?.detailLevel ?? "full";
  const tpl = TEMPLATES[templateType];
  const compactEnriched = {
    brand_name: String(enriched.brand_name ?? ""),
    offer: String(enriched.offer ?? ""),
    positioning: String(enriched.positioning ?? ""),
    platform: String(enriched.platform ?? ""),
    target_audience: enriched.target_audience ?? {},
    competitors: Array.isArray(enriched.competitors) ? enriched.competitors.slice(0, 5) : [],
  };
  const compactExtraction = {
    website: extraction?.websiteSummary
      ? {
          title: extraction.websiteSummary.title?.slice(0, 200) ?? "",
          meta: extraction.websiteSummary.meta_description?.slice(0, 400) ?? "",
          excerpt: extraction.websiteSummary.main_text_excerpt?.slice(0, 500) ?? "",
        }
      : null,
    instagram: extraction?.instagramSummary
      ? {
          bio: extraction.instagramSummary.bio?.slice(0, 400) ?? "",
          followers: extraction.instagramSummary.followers ?? "",
          snippets: (extraction.instagramSummary.last_n_caption_snippets ?? []).slice(0, 4),
        }
      : null,
    sow: extraction?.sowContext
      ? {
          context: trimToTokenBudget(extraction.sowContext.compactContext, detailLevel === "core" ? 700 : 1200),
          top_sections: extraction.sowContext.topSections.slice(0, detailLevel === "core" ? 2 : 3).map((section) => ({
            title: section.title,
            summary: trimToTokenBudget(section.summary, detailLevel === "core" ? 110 : 160),
          })),
        }
      : null,
  };

  const userPrompt = `BRAND PROFILE (compact):
${JSON.stringify(compactEnriched, null, 2)}

ORIGINAL ONBOARDING INPUT:
${JSON.stringify(raw, null, 2)}

STRATEGY TEMPLATE: ${tpl.name}
- Tone guidance: ${tpl.toneGuidance}
- Strategic emphasis: ${tpl.emphasis}
- KPI focus: ${tpl.kpiFocus}
- Content style: ${tpl.contentStyle}

OPTIONAL EXTRACTION CONTEXT:
${JSON.stringify(
  compactExtraction,
  null,
  2,
)}

Generate the full structured_strategy JSON object with these exact top-level keys: market_narrative, problem_gap_solution, brand_foundation, brand_philosophy, audience, emotional_drivers, platform_strategy, content_strategy, kpis, tracking_plan, phases, asset_requirements.

Every section must logically build on the previous one. Keep outputs compact for fast first paint.
If detail level is "core", keep each section to high-signal bullets/phrases only.
Detail level: ${detailLevel}.`;

  assertPromptWithinBudget(
    "structured strategy",
    [STRUCTURED_SYSTEM, userPrompt],
    detailLevel === "core" ? 2400 : 3000,
    detailLevel === "core" ? 650 : 1200,
  );

  const llmStartedAt = Date.now();
  const parsed = await getStrictJsonWithRetry<Partial<StructuredStrategy>>(
    provider ?? getLLMProvider(),
    {
      contextLabel: "structured strategy",
      maxOutputTokens: detailLevel === "core" ? 650 : 1200,
      messages: [
      { role: "system", content: STRUCTURED_SYSTEM },
      { role: "user", content: userPrompt },
      ],
    },
  );
  console.info(
    `[llm-observe] strategy.structured detail=${detailLevel} ttft_ms=unavailable total_ms=${Date.now() - llmStartedAt}`,
  );

  return {
    market_narrative: parsed.market_narrative ?? {},
    problem_gap_solution: parsed.problem_gap_solution ?? {},
    brand_foundation: parsed.brand_foundation ?? {},
    brand_philosophy: parsed.brand_philosophy ?? {},
    audience: parsed.audience ?? {},
    emotional_drivers: Array.isArray(parsed.emotional_drivers) ? parsed.emotional_drivers : [],
    platform_strategy: parsed.platform_strategy ?? {},
    content_strategy: parsed.content_strategy ?? {},
    kpis: parsed.kpis ?? {},
    tracking_plan: parsed.tracking_plan ?? {},
    phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    asset_requirements: Array.isArray(parsed.asset_requirements) ? parsed.asset_requirements : [],
  };
}

const DOC_SYSTEM = `You are a senior brand strategist writing a real strategy document — the kind a client reads and says "they GET us".

Output: ONE concise Markdown document. No JSON. No filler.

Structure (use these exact H2 headings, in order):
## 1. Market Context
## 2. Problem & Opportunity
## 3. Brand Positioning
## 4. Audience Understanding
## 5. Strategic Direction
## 6. Platform Approach
## 7. Content Strategy
## 8. KPIs & Measurement Logic
## 9. Execution Phases
## 10. Asset Requirements

Begin the document with an H1 — the brand name — followed by a single italicized strapline (one sentence, the strategic one-liner). Then a short opening paragraph (2-3 sentences) that frames the document.

Writing rules:
- Keep sections concise. Prefer short paragraphs or bullets.
- Each section must connect to the previous one — pick up the thread, don't restart.
- Write in the voice the strategy template prescribes.
- Be specific about THIS brand. Use the brand name. Reference the actual offer, the actual audience, the actual platform. Never write something generic that could apply to any brand.
- No "engage your audience", "leverage", "drive growth", or other consultant-speak. Write like a sharp human.
- Target 500-900 words.`;

export async function generateStrategyDocument(
  raw: RawInput,
  enriched: EnrichedData,
  structured: StructuredStrategy,
  templateType: TemplateType,
  provider?: LLMProvider,
  extraction?: {
    websiteSummary?: WebsiteSummary | null;
    instagramSummary?: InstagramSummary | null;
    sowContext?: {
      compactContext: string;
      topSections: SOWContextSection[];
    } | null;
  },
): Promise<string> {
  const tpl = TEMPLATES[templateType];
  const compactEnriched = {
    brand_name: String(enriched.brand_name ?? ""),
    offer: String(enriched.offer ?? ""),
    positioning: String(enriched.positioning ?? ""),
    platform: String(enriched.platform ?? ""),
    target_audience: enriched.target_audience ?? {},
  };
  const compactStructured = {
    market_narrative: structured.market_narrative,
    audience: structured.audience,
    platform_strategy: structured.platform_strategy,
    content_strategy: structured.content_strategy,
    kpis: structured.kpis,
    phases: structured.phases,
  };
  const compactExtraction = {
    website: extraction?.websiteSummary
      ? {
          title: extraction.websiteSummary.title?.slice(0, 180) ?? "",
          meta: extraction.websiteSummary.meta_description?.slice(0, 300) ?? "",
        }
      : null,
    instagram: extraction?.instagramSummary
      ? {
          bio: extraction.instagramSummary.bio?.slice(0, 300) ?? "",
          followers: extraction.instagramSummary.followers ?? "",
        }
      : null,
    sow: extraction?.sowContext
      ? {
          context: trimToTokenBudget(extraction.sowContext.compactContext, 900),
          top_sections: extraction.sowContext.topSections.slice(0, 3).map((section) => ({
            title: section.title,
            summary: trimToTokenBudget(section.summary, 120),
          })),
        }
      : null,
  };

  const userPrompt = `Write the full strategy document for this brand.

BRAND: ${enriched.brand_name}
ENRICHED PROFILE:
${JSON.stringify(compactEnriched, null, 2)}

STRUCTURED STRATEGY (use this as your source of truth — translate it into prose):
${JSON.stringify(compactStructured, null, 2)}

OPTIONAL EXTRACTION CONTEXT:
${JSON.stringify(
  compactExtraction,
  null,
  2,
)}

TEMPLATE VOICE: ${tpl.name}
- ${tpl.toneGuidance}

Return only the Markdown document. Begin with the H1 brand name.`;

  assertPromptWithinBudget(
    "strategy document",
    [DOC_SYSTEM, userPrompt],
    3000,
    700,
  );

  const llmStartedAt = Date.now();
  const result = await (provider ?? getLLMProvider()).chatCompletion({
    maxOutputTokens: 700,
    responseFormat: "text",
    messages: [
      { role: "system", content: DOC_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });
  console.info(`[llm-observe] strategy.document ttft_ms=unavailable total_ms=${Date.now() - llmStartedAt}`);
  return result;
}

export function buildStrategySummary(
  brandName: string,
  structured: Partial<StructuredStrategy> | Record<string, unknown>,
): string {
  const strategy = structured as Record<string, unknown>;
  const audience = stringifySection(strategy["audience"]);
  const platform = stringifySection(strategy["platform_strategy"]);
  const content = stringifySection(strategy["content_strategy"]);
  const kpis = stringifySection(strategy["kpis"]);
  return trimToTokenBudget(
    `${brandName}: ${audience} ${platform} ${content} ${kpis}`.replace(/\s+/g, " ").trim(),
    200,
  );
}

function stringifySection(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
