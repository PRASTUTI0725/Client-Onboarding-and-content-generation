import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PromptTemplateName = "strategy/v1-full" | "strategy/v1-patch";

export type PromptVariableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | unknown[];

export interface InjectPromptOptions {
  /** Placeholders allowed to be missing. Missing optional values become empty strings. */
  optionalKeys?: string[];
  /** If provided, these placeholders must be present and non-empty in variables. */
  requiredKeys?: string[];
}

export const STRATEGY_V1_FULL_PLACEHOLDERS = [
  "client_name",
  "industry_category",
  "website_summary",
  "instagram_handle",
  "one_line_description",
  "business_dna",
  "sow_scope",
  "platforms_list",
  "monthly_post_counts",
  "content_mix_breakdown",
  "tone_by_platform",
  "budget_resources",
  "pillar_priorities",
  "monthly_goals",
  "target_audience_definition",
  "key_business_objectives",
] as const;

export const STRATEGY_V1_REQUIRED_PLACEHOLDERS = [
  "client_name",
  "industry_category",
  "one_line_description",
  "business_dna",
  "sow_scope",
  "platforms_list",
  "target_audience_definition",
  "key_business_objectives",
] as const;

export const STRATEGY_V1_OPTIONAL_PLACEHOLDERS = STRATEGY_V1_FULL_PLACEHOLDERS.filter(
  (k) => !STRATEGY_V1_REQUIRED_PLACEHOLDERS.includes(k as (typeof STRATEGY_V1_REQUIRED_PLACEHOLDERS)[number]),
);

const TEMPLATE_PATHS: Record<PromptTemplateName, string> = {
  "strategy/v1-full": "../../prompts/strategy/v1-full.md",
  "strategy/v1-patch": "../../prompts/strategy/v1-patch.md",
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const templateCache = new Map<PromptTemplateName, string>();

function toText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function toCsv(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => toText(v)).filter(Boolean).join(", ");
  return toText(value);
}

function truncateText(value: string, maxChars: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function compactBusinessDna(
  businessDna: Record<string, unknown> | null | undefined,
  enriched: Record<string, unknown>,
): string {
  if (businessDna && typeof businessDna === "object" && Object.keys(businessDna).length > 0) {
    const keyPriority = [
      "brand_name",
      "offer",
      "positioning",
      "brand_tone",
      "target_audience",
      "value_proposition",
      "audience_pain_points",
      "differentiators",
      "proof_points",
    ];
    const picked = keyPriority
      .map((key) => {
        const value = toText((businessDna as Record<string, unknown>)[key]);
        if (!value) return "";
        return `${key}: ${truncateText(value, 240)}`;
      })
      .filter(Boolean)
      .join(" | ");
    if (picked) return truncateText(picked, 1200);
  }

  return truncateText(
    [
      toText(enriched.brand_name),
      toText(enriched.offer),
      toText(enriched.positioning),
      toText(enriched.brand_tone),
      toText(enriched.target_audience),
    ]
      .filter(Boolean)
      .join(" | "),
    1200,
  );
}

function compactSowScope(sow: Record<string, unknown>): string {
  const scopeParts = [
    toText(sow.scopeOfWork),
    toText(sow.understandingOfRequirements),
    toText(sow.strategyLaunchPlanning),
    toText(sow.contentCreation),
  ]
    .filter(Boolean)
    .map((part) => truncateText(part, 700));

  const normalized = (sow.normalizedSections as Record<string, unknown> | null | undefined) ?? {};
  const normalizedParts = Object.entries(normalized)
    .filter(([key]) => !/pricing|payment|retainer|cost|quotation|commercial|approval/i.test(key))
    .map(([key, value]) => `${key}: ${truncateText(toText(value), 220)}`)
    .filter((line) => !/:\s*$/.test(line))
    .slice(0, 6);

  return truncateText([...scopeParts, ...normalizedParts].join(" "), 1800);
}

export interface StrategyPromptVariableInput {
  client?: {
    name?: string | null;
    website?: string | null;
    instagramHandle?: string | null;
    oneLineDescription?: string | null;
    sow?: Record<string, unknown> | null;
  } | null;
  onboarding?: {
    rawInput?: Record<string, unknown> | null;
    enrichedData?: Record<string, unknown> | null;
  } | null;
  strategy?: {
    structuredStrategy?: Record<string, unknown> | null;
  } | null;
}

function readSowGoalsObjectivesText(sow: Record<string, unknown>): string {
  const normalized = (sow.normalizedSections as Record<string, unknown> | null | undefined) ?? {};
  const fromNormalized = Object.entries(normalized)
    .filter(([k]) => /goal|objective|outcome|kpi|target/i.test(k))
    .map(([, v]) => toText(v))
    .filter(Boolean)
    .join(" ");
  if (fromNormalized) return fromNormalized;
  const directCandidates = [sow.keyBusinessObjectives, sow.businessObjectives, sow.goals, sow.objectives]
    .map((v) => toText(v))
    .filter(Boolean);
  return directCandidates.join(" ");
}

/**
 * Maps backend client/onboarding/strategy entities to v1-full placeholder keys.
 *
 * key_business_objectives source priority:
 * 1) normalized SOW goals/objectives
 * 2) onboarding/business inputs
 * 3) existing strategy summary
 */
export function mapStrategyV1PromptVariables(input: StrategyPromptVariableInput): Record<string, string> {
  const client = input.client ?? {};
  const sow = (client.sow as Record<string, unknown> | null | undefined) ?? {};
  const onboarding = input.onboarding ?? {};
  const enriched = (onboarding.enrichedData as Record<string, unknown> | null | undefined) ?? {};
  const rawInput = (onboarding.rawInput as Record<string, unknown> | null | undefined) ?? {};
  const structured = (input.strategy?.structuredStrategy as Record<string, unknown> | null | undefined) ?? {};
  const summary = (structured.__summary as Record<string, unknown> | null | undefined) ?? {};
  const businessDna = (enriched.businessDna as Record<string, unknown> | null | undefined) ?? {};

  const objectiveFromSow = readSowGoalsObjectivesText(sow);
  const objectiveFromOnboarding =
    toText(enriched.keyBusinessObjectives) ||
    toText(enriched.businessObjectives) ||
    toText(rawInput.keyBusinessObjectives) ||
    toText(rawInput.businessObjectives) ||
    toText(rawInput.goal) ||
    toText(client.oneLineDescription);
  const objectiveFromStrategy = toText(summary.strategy);
  const keyBusinessObjectives = objectiveFromSow || objectiveFromOnboarding || objectiveFromStrategy;

  const sowScope = compactSowScope(sow);

  const websiteSummary =
    toText(enriched.websiteSummary) || toText(enriched.websiteSignalSummary) || toText(client.website);

  const businessDnaText = compactBusinessDna(businessDna, enriched);

  return {
    client_name: toText(client.name),
    industry_category: toText(sow.industry),
    website_summary: websiteSummary,
    instagram_handle: toText(client.instagramHandle),
    one_line_description: toText(client.oneLineDescription),
    business_dna: businessDnaText,
    sow_scope: sowScope,
    platforms_list: toCsv(sow.platforms),
    monthly_post_counts: toText(sow.monthlyPosts),
    content_mix_breakdown: toText(sow.contentMix),
    tone_by_platform: toText(sow.toneByPlatform),
    budget_resources: toCsv(sow.deliverables),
    pillar_priorities: toCsv(summary.pillarPriorities),
    monthly_goals: toCsv(summary.monthlyGoals),
    target_audience_definition: toText(sow.targetAudience),
    key_business_objectives: keyBusinessObjectives,
  };
}

function templateAbsolutePath(name: PromptTemplateName): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const primary = resolve(currentDir, TEMPLATE_PATHS[name]);
  if (existsSync(primary)) return primary;

  // Dist/runtime fallback: bundled files execute from api-server/dist.
  const distFallback = resolve(currentDir, "../src/prompts", name.replace("strategy/", "strategy/") + ".md");
  if (existsSync(distFallback)) return distFallback;

  const cwdFallback = resolve(process.cwd(), "src/prompts", name.replace("strategy/", "strategy/") + ".md");
  if (existsSync(cwdFallback)) return cwdFallback;

  return primary;
}

/**
 * Loads a versioned prompt template from src/prompts.
 */
export async function loadPromptTemplate(name: PromptTemplateName): Promise<string> {
  const cached = templateCache.get(name);
  if (cached != null) return cached;
  const path = templateAbsolutePath(name);
  const content = await readFile(path, "utf8");
  templateCache.set(name, content);
  return content;
}

function valueToString(key: string, value: PromptVariableValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch (err) {
    throw new Error(
      `Failed to serialize placeholder "${key}" value: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Injects {{placeholders}} into a prompt template.
 * - Missing required placeholder values throw a clear error.
 * - Missing optional placeholder values become empty strings.
 */
export function injectPromptVariables(
  template: string,
  variables: Record<string, PromptVariableValue>,
  options: InjectPromptOptions = {},
): string {
  const optional = new Set(options.optionalKeys ?? []);
  const required = new Set(options.requiredKeys ?? []);

  // Required keys are validated even if not present in template, to fail fast for caller mistakes.
  for (const key of required) {
    const raw = variables[key];
    if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
      throw new Error(`Missing required prompt variable "${key}"`);
    }
  }

  return template.replace(PLACEHOLDER_RE, (_whole, keyRaw: string) => {
    const key = String(keyRaw);
    const raw = variables[key];
    const isMissing = raw == null || (typeof raw === "string" && raw.trim().length === 0);
    if (isMissing) {
      if (optional.has(key)) return "";
      throw new Error(`Missing required placeholder value for "{{${key}}}"`);
    }
    return valueToString(key, raw);
  });
}
