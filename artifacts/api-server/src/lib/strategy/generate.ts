import { openai } from "../openaiClient.js";
import { TEMPLATES, type TemplateType } from "./templates.js";
import type { EnrichedData, RawInput } from "./enrich.js";

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

const STRUCTURED_SYSTEM = `You are a senior brand strategist producing the structured machine-readable layer of a complete brand strategy.

You must return STRICT JSON matching the requested schema. No prose outside JSON.

Rules:
- Every section must be specific, opinionated, and tightly connected to the enriched brand profile.
- No filler. No generic marketing language. No "engage your audience". Be concrete.
- emotional_drivers is a flat array of 4-6 short phrases (e.g. "the quiet pride of buying something built to last").
- phases must be 3-4 entries, each with: name, duration, objective, key_initiatives (array of 3-5 strings), success_signal.
- asset_requirements: 6-12 entries, each with: name, format, priority ("must-have"/"nice-to-have"), purpose.
- kpis: object with primary (array of 3-5 KPI names with target framing), secondary (array), and measurement_cadence.
- tracking_plan: object with events (array of event names with what they capture), tools (array), reporting_cadence.
- platform_strategy: object with primary_channel, secondary_channels (array), why_this_mix, posting_cadence.
- content_strategy: object with pillars (array of 3-5 with name + description + example_post_idea), formats (array), tone_examples (array of 2-3 short sample lines in brand voice).
- audience: object with primary_persona (with name, snapshot, what_they_want, what_they_fear, where_they_are), secondary_personas (array of 1-2), buying_triggers (array).
- brand_foundation: object with mission, vision, values (array of 4-6).
- brand_philosophy: object with core_belief, what_we_reject, what_we_champion.
- problem_gap_solution: object with problem, market_gap, our_solution.
- market_narrative: object with category_state, the_shift_happening, where_this_brand_fits.`;

export async function generateStructuredStrategy(
  raw: RawInput,
  enriched: EnrichedData,
  templateType: TemplateType,
): Promise<StructuredStrategy> {
  const tpl = TEMPLATES[templateType];

  const userPrompt = `BRAND PROFILE (enriched):
${JSON.stringify(enriched, null, 2)}

ORIGINAL ONBOARDING INPUT:
${JSON.stringify(raw, null, 2)}

STRATEGY TEMPLATE: ${tpl.name}
- Tone guidance: ${tpl.toneGuidance}
- Strategic emphasis: ${tpl.emphasis}
- KPI focus: ${tpl.kpiFocus}
- Content style: ${tpl.contentStyle}

Generate the full structured_strategy JSON object with these exact top-level keys: market_narrative, problem_gap_solution, brand_foundation, brand_philosophy, audience, emotional_drivers, platform_strategy, content_strategy, kpis, tracking_plan, phases, asset_requirements.

Every section must logically build on the previous one. The audience must inform the platform_strategy. The platform_strategy must inform the content_strategy. The kpis must reflect the template's KPI focus. The phases must be a believable 6-12 month rollout for THIS specific brand.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: STRUCTURED_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as Partial<StructuredStrategy>;

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

Output: ONE continuous Markdown document. No JSON. No bullet salad. No empty marketing platitudes.

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
- Paragraph-led prose. Every section is at least two real paragraphs. Use bullets sparingly — only where a list is genuinely the right form (e.g. listing the 3-4 phases, the asset requirements, the KPIs).
- Each section must connect to the previous one — pick up the thread, don't restart.
- Write in the voice the strategy template prescribes.
- Be specific about THIS brand. Use the brand name. Reference the actual offer, the actual audience, the actual platform. Never write something generic that could apply to any brand.
- No "engage your audience", "leverage", "drive growth", or other consultant-speak. Write like a sharp human.
- Length: long enough to feel substantive (a real strategy doc), short enough that every line earns its place. Aim for 1200-2000 words total.`;

export async function generateStrategyDocument(
  raw: RawInput,
  enriched: EnrichedData,
  structured: StructuredStrategy,
  templateType: TemplateType,
): Promise<string> {
  const tpl = TEMPLATES[templateType];

  const userPrompt = `Write the full strategy document for this brand.

BRAND: ${enriched.brand_name}
ENRICHED PROFILE:
${JSON.stringify(enriched, null, 2)}

STRUCTURED STRATEGY (use this as your source of truth — translate it into prose):
${JSON.stringify(structured, null, 2)}

TEMPLATE VOICE: ${tpl.name}
- ${tpl.toneGuidance}

Return only the Markdown document. Begin with the H1 brand name.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: DOC_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}
