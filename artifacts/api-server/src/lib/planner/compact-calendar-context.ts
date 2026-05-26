import { createHash } from "node:crypto";
import { estimateTokens, trimToTokenBudget } from "../llm/prompt-budget.js";
import type { CalendarBrief, PlannerLayer } from "./generate.js";

export type CalendarCompactionTier = 0 | 1 | 2 | 3;

export type CompactCalendarContext = {
  monthlyGoal: string | null;
  month: string;
  startDate: string;
  totalPosts: number;
  strategyType: string;
  activePlatforms: string[];
  platformCounts: Record<string, number>;
  contentBuckets: Record<string, number>;
  deliverables: string[];
  brand: {
    name: string;
    positioning: string;
    offer: string;
    tone: string;
    personality: string;
  };
  audience: {
    segments: string[];
    pains: string[];
    desires: string[];
  };
  pillars: Array<{ name: string; angle?: string }>;
  hooksAndCtas: {
    ctaStyleByPlatform: Record<string, string>;
    allowedAngles: string[];
  };
  proofConstraints: {
    proofAssetsAvailable: boolean;
    availableProofTypes: string[];
    testimonialStyleAllowed: boolean;
    forbiddenTerms: string[];
    healthClaimSafetyMode: string;
    paidAllowed: boolean;
  };
  strategySummaries: {
    contentMoves: string;
    platformRoles: string;
    weeklyFlowHint: string[];
  };
  productAnchors: string[];
  hardConstraints: string[];
  planningNotes: string[];
};

export type CompactCalendarWeekContext = CompactCalendarContext & {
  weekStartDate: string;
  weekLabel: string;
  weeklyTotalPosts: number;
  weeklyPlatformTargets: Record<string, number>;
  bucketTargets: Record<string, number>;
  requiredBuckets: string[];
  weeklyFocus: string | null;
  executionPhase: string | null;
  calendarPlanHash: string;
  priorWeekThemes: string[];
  weekAngleBank: Record<string, string[]>;
};

function normalizeForOverlap(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function capText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function capList(items: string[], maxItems: number, maxItemChars: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = capText(item, maxItemChars);
    if (!text) continue;
    const key = normalizeForOverlap(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isRedundantWithKnown(value: string, knownBlob: string): boolean {
  const normalized = normalizeForOverlap(value);
  if (!normalized || normalized.length < 20) return false;
  return knownBlob.includes(normalized);
}

function collectKnownText(brief: CalendarBrief): string {
  return normalizeForOverlap(
    [
      brief.client.name,
      brief.client.oneLinePositioning ?? "",
      brief.client.offer ?? "",
      brief.client.businessType ?? "",
      brief.planningContext.monthlyGoal ?? "",
      ...brief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function buildPlatformRolesSummary(brief: CalendarBrief, maxChars = 280): string {
  const lines = brief.platformStrategy
    .filter((entry) => brief.requirements.platforms.includes(entry.platform))
    .map((entry) => {
      const role = capText(entry.role, 48);
      const objective = capText(entry.objective, 48);
      return `${entry.platform}: ${role}${objective ? ` — ${objective}` : ""}`;
    });
  return capText(lines.join(" | "), maxChars);
}

function buildAllowedAngles(brief: CalendarBrief, knownBlob: string, maxItems: number): string[] {
  const candidates = [
    ...brief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
    brief.strategicContext.jtaContentStrategySummary ?? "",
    brief.strategicContext.jtaPlatformStrategySummary ?? "",
    ...brief.client.differentiators,
    ...brief.client.specificReferences,
  ].filter(Boolean);
  return capList(
    candidates.filter((item) => !isRedundantWithKnown(item, knownBlob)),
    maxItems,
    120,
  );
}

function buildProductAnchors(brief: CalendarBrief, knownBlob: string, maxItems: number): string[] {
  const candidates = [
    ...brief.client.productTruths,
    ...brief.client.specificReferences,
    ...brief.client.differentiators,
    ...brief.contentPillars.map((pillar) => pillar.angle ?? pillar.name),
  ].filter(Boolean);
  return capList(
    candidates.filter((item) => !isRedundantWithKnown(item, knownBlob)),
    maxItems,
    140,
  );
}

function splitAcrossWeeks(total: number, weeks: number): number[] {
  if (weeks <= 0) return [];
  const base = Math.floor(total / weeks);
  const remainder = total % weeks;
  return Array.from({ length: weeks }, (_, idx) => base + (idx < remainder ? 1 : 0));
}

function splitRecordAcrossWeeks(source: Record<string, number>, weekIndex: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, total] of Object.entries(source)) {
    const split = splitAcrossWeeks(Number(total) || 0, 4);
    const count = split[weekIndex] ?? 0;
    if (count > 0) out[key] = count;
  }
  return out;
}

export function expandWeeklyBucketSequence(bucketTargets: Record<string, number>, totalPosts: number): string[] {
  const entries = Object.entries(bucketTargets)
    .filter(([, count]) => (Number(count) || 0) > 0)
    .map(([bucket, count]) => ({ bucket, remaining: Math.max(0, Math.round(Number(count) || 0)) }));
  const ordered: string[] = [];
  while (ordered.length < totalPosts && entries.some((entry) => entry.remaining > 0)) {
    for (const entry of entries) {
      if (entry.remaining <= 0) continue;
      ordered.push(entry.bucket);
      entry.remaining -= 1;
      if (ordered.length >= totalPosts) break;
    }
  }
  return ordered.slice(0, totalPosts);
}

function filterCtaStyleByPlatform(
  ctaStyleByPlatform: Record<string, string>,
  activePlatforms: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const platform of activePlatforms) {
    const match = Object.entries(ctaStyleByPlatform).find(
      ([key]) => key.toLowerCase() === platform.toLowerCase(),
    );
    if (match?.[1]) out[platform] = capText(match[1], 60);
  }
  return out;
}

export function buildCompactCalendarContext(
  brief: CalendarBrief,
  tier: CalendarCompactionTier = 0,
): CompactCalendarContext {
  const knownBlob = collectKnownText(brief);
  const maxAnchors = tier >= 2 ? 3 : 5;
  const maxAngles = tier >= 2 ? 3 : 5;
  const maxPillars = tier >= 1 ? 4 : 5;

  return {
    monthlyGoal: brief.planningContext.monthlyGoal
      ? capText(brief.planningContext.monthlyGoal, tier >= 1 ? 100 : 140)
      : null,
    month: brief.requirements.month,
    startDate: brief.requirements.startDate,
    totalPosts: brief.requirements.totalPosts,
    strategyType: brief.client.strategyType,
    activePlatforms: brief.requirements.platforms,
    platformCounts: brief.requirements.platformCounts,
    contentBuckets: brief.requirements.contentBuckets,
    deliverables: capList(brief.requirements.deliverables, tier >= 1 ? 3 : 4, 72),
    brand: {
      name: brief.client.name,
      positioning: capText(brief.client.oneLinePositioning ?? "", tier >= 1 ? 120 : 160),
      offer: capText(brief.client.offer ?? "", tier >= 1 ? 72 : 96),
      tone: capText(brief.brandVoice.tone ?? "", 72),
      personality: capText(brief.brandVoice.personality ?? "", 72),
    },
    audience: {
      segments: capList(brief.audience.primarySegments, tier >= 1 ? 2 : 3, 72),
      pains: capList(brief.audience.pains, tier >= 1 ? 2 : 3, 72),
      desires: capList(brief.audience.desires, tier >= 2 ? 1 : 2, 72),
    },
    pillars: brief.contentPillars.slice(0, maxPillars).map((pillar) => ({
      name: pillar.name,
      ...(pillar.angle ? { angle: capText(pillar.angle, 80) } : {}),
    })),
    hooksAndCtas: {
      ctaStyleByPlatform: filterCtaStyleByPlatform(brief.ctaStyleByPlatform, brief.requirements.platforms),
      allowedAngles: buildAllowedAngles(brief, knownBlob, maxAngles),
    },
    proofConstraints: {
      proofAssetsAvailable: brief.proofContract.proofAssetsAvailable,
      availableProofTypes: capList(brief.proofContract.availableProofTypes, 4, 32),
      testimonialStyleAllowed: brief.proofContract.testimonialStyleAllowed,
      forbiddenTerms: capList(brief.safety.forbiddenTerms, tier >= 1 ? 3 : 4, 40),
      healthClaimSafetyMode: brief.safety.healthClaimSafetyMode,
      paidAllowed: brief.safety.paidAllowed,
    },
    strategySummaries: {
      contentMoves: capText(brief.strategicContext.jtaContentStrategySummary ?? "", tier >= 1 ? 160 : 240),
      platformRoles: buildPlatformRolesSummary(brief, tier >= 1 ? 180 : 280),
      weeklyFlowHint: capList(brief.weeklyFlow, 4, 72),
    },
    productAnchors: buildProductAnchors(brief, knownBlob, maxAnchors),
    hardConstraints: capList(brief.requirements.hardConstraints, tier >= 1 ? 3 : 4, 96),
    planningNotes: capList(brief.planningContext.normalizedNotes, tier >= 1 ? 2 : 3, 96),
  };
}

export function buildCompactCalendarWeekContext(input: {
  brief: CalendarBrief;
  planner: PlannerLayer;
  baseContext?: CompactCalendarContext;
  weekIndex: number;
  weekStartDate: string;
  targetPosts: number;
  priorWeekThemes?: string[];
  tier?: CalendarCompactionTier;
}): CompactCalendarWeekContext {
  const tier = input.tier ?? 0;
  const base = input.baseContext ?? buildCompactCalendarContext(input.brief, tier);
  const weekLabel = `week_${input.weekIndex + 1}`;
  const weeklyPlatformTargets = splitRecordAcrossWeeks(input.brief.requirements.platformCounts, input.weekIndex);
  const bucketTargets = splitRecordAcrossWeeks(input.brief.requirements.contentBuckets, input.weekIndex);
  const requiredBuckets = expandWeeklyBucketSequence(bucketTargets, input.targetPosts);
  const weekAngleBank: Record<string, string[]> = {};
  for (const [key, angles] of Object.entries(input.planner.angleBank ?? {})) {
    weekAngleBank[key] = capList(Array.isArray(angles) ? angles : [], 3, 48);
  }

  return {
    ...base,
    weekStartDate: input.weekStartDate,
    weekLabel,
    weeklyTotalPosts: input.targetPosts,
    weeklyPlatformTargets,
    bucketTargets,
    requiredBuckets,
    weeklyFocus: capText(
      input.planner.weeklyFlow[weekLabel] ?? input.brief.weeklyFlow[input.weekIndex] ?? "",
      72,
    ) || null,
    executionPhase: capText(
      input.planner.phases[input.weekIndex]?.focus ??
        input.planner.weeklyFlow[weekLabel] ??
        "",
      72,
    ) || null,
    calendarPlanHash: hashCalendarPlan(input.planner),
    priorWeekThemes: capList(input.priorWeekThemes ?? [], 4, 64),
    weekAngleBank,
  };
}

export function applyWeekCompactionTier(
  context: CompactCalendarWeekContext,
  tier: CalendarCompactionTier,
): CompactCalendarWeekContext {
  if (tier <= 0) return context;
  const next: CompactCalendarWeekContext = JSON.parse(JSON.stringify(context)) as CompactCalendarWeekContext;
  if (tier >= 1) {
    next.strategySummaries.contentMoves = capText(next.strategySummaries.contentMoves, 120);
    next.strategySummaries.platformRoles = capText(next.strategySummaries.platformRoles, 120);
    next.planningNotes = next.planningNotes.slice(0, 2);
    next.productAnchors = next.productAnchors.slice(0, 4);
  }
  if (tier >= 2) {
    next.hooksAndCtas.allowedAngles = [];
    next.productAnchors = next.productAnchors.slice(0, 2);
    next.priorWeekThemes = next.priorWeekThemes.slice(0, 2);
    next.weekAngleBank = Object.fromEntries(
      Object.entries(next.weekAngleBank).slice(0, 2).map(([key, values]) => [key, values.slice(0, 2)]),
    );
  }
  if (tier >= 3) {
    next.monthlyGoal = next.monthlyGoal ? capText(next.monthlyGoal, 48) : null;
    next.deliverables = [];
    next.planningNotes = [];
    next.hardConstraints = next.hardConstraints.slice(0, 2).map((item) => capText(item, 48));
    next.productAnchors = [];
    next.audience = {
      segments: next.audience.segments.slice(0, 1),
      pains: [],
      desires: [],
    };
    next.pillars = next.pillars.slice(0, 2).map((pillar) => ({
      name: pillar.name,
      ...(pillar.angle ? { angle: capText(pillar.angle, 40) } : {}),
    }));
    next.hooksAndCtas = {
      ctaStyleByPlatform: Object.fromEntries(
        Object.entries(next.hooksAndCtas.ctaStyleByPlatform).slice(0, 1).map(([key, value]) => [
          key,
          capText(value, 32),
        ]),
      ),
      allowedAngles: [],
    };
    next.strategySummaries = {
      contentMoves: capText(next.strategySummaries.contentMoves, 64),
      platformRoles: "",
      weeklyFlowHint: [],
    };
    next.brand = {
      name: next.brand.name,
      positioning: capText(next.brand.positioning, 80),
      offer: capText(next.brand.offer, 48),
      tone: capText(next.brand.tone, 24),
      personality: "",
    };
    next.priorWeekThemes = next.priorWeekThemes.slice(0, 1);
    next.weekAngleBank = {};
    next.executionPhase = null;
    next.weeklyFocus = next.weeklyFocus ? capText(next.weeklyFocus, 48) : null;
    next.proofConstraints = {
      ...next.proofConstraints,
      availableProofTypes: next.proofConstraints.availableProofTypes.slice(0, 2),
      forbiddenTerms: next.proofConstraints.forbiddenTerms.slice(0, 2),
    };
    next.platformCounts = next.weeklyPlatformTargets;
    next.contentBuckets = next.bucketTargets;
  }
  return next;
}

export function estimateCompactContextTokens(value: unknown): number {
  return estimateTokens(value);
}

export function hashCalendarPlan(planner: PlannerLayer): string {
  const payload = JSON.stringify({
    distribution: planner.distribution,
    weeklyFlow: planner.weeklyFlow,
    phases: planner.phases,
    angleBank: planner.angleBank,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

export function buildPlannerPromptFromCompactContext(
  compact: CompactCalendarContext,
  pillarLines: string,
): string {
  return `COMPACT CALENDAR CONTEXT:
${JSON.stringify(compact)}

PILLARS (use snake_case keys for distribution/angleBank):
${pillarLines}

STRATEGY TYPE RULES:
- Brand Building: prioritize awareness, trust, education, ritual storytelling, and soft conversion. Avoid paid-performance language unless proofConstraints.paidAllowed is true.
- Performance Marketing: prioritize offer clarity, conversion intent, and action-taking.
- Personal Brand: emphasize founder voice, lived experience, story, and strong POV.
- D2C Growth: emphasize product use cases, objections, proof-building, repeat purchase, and retention.
- Use only canonical pillar labels from contentBuckets. Put specificity into angleBank and weeklyFlow, not pillar renames.
- Respect proofConstraints: do not plan testimonial or UGC showcase when testimonialStyleAllowed is false.
- Do not invent unsupported clinical, sustainability, certification, or endorsement claims.
Return ONLY the planner JSON object.`;
}

export function buildWeeklyPromptPartsFromCompact(
  brief: CompactCalendarWeekContext,
  targetCount: number,
  instructionBlock: string,
): Array<{ label: string; value: string }> {
  return [
    { label: "brief_header", value: "WEEKLY CALENDAR BRIEF:\n" },
    { label: "brief_json", value: JSON.stringify(brief) },
    { label: "instruction_header", value: "\n\n" },
    { label: "instruction_block", value: instructionBlock },
  ];
}

export function trimCompactTextField(value: string | null | undefined, maxTokens: number): string | null {
  if (!value) return null;
  const trimmed = trimToTokenBudget(value, maxTokens).trim();
  return trimmed || null;
}
