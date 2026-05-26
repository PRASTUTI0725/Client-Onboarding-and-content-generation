import { estimateTokens, trimToTokenBudget } from "./llm/prompt-budget.js";

export interface SOWContextSection {
  key: string;
  title: string;
  summary: string;
  rawExcerpt: string;
  score: number;
  estimatedTokens: number;
}

export interface OptimizedSowContext {
  mergedContext: string;
  mergedContextTokens: number;
  rankedSections: SOWContextSection[];
  topSections: SOWContextSection[];
  summaries: string[];
  sourceTokens: number;
  reducedTokens: number;
  tokenReductionPct: number;
}

const cache = new Map<string, OptimizedSowContext>();

const SECTION_LABELS: Record<string, string> = {
  understandingOfRequirements: "Requirements",
  strategyLaunchPlanning: "Timeline",
  contentCreation: "Deliverables",
  scopeOfWork: "Scope",
  targetAudience: "Audience",
  industry: "Industry",
  brandPositioning: "Positioning",
  objectivesAndGoals: "Goals",
  contentCreationScope: "Content Scope",
  paidMediaAdsScope: "Ads Scope",
  reportingOptimizationScope: "Reporting",
  monthlyDeliverables: "Monthly Deliverables",
  clientResponsibilities: "Client Responsibilities",
  timelineMilestones: "Timeline",
  expectedOutcomes: "Expected Outcomes",
};

const PRIORITY_KEYWORDS: Record<string, string[]> = {
  understandingOfRequirements: ["goal", "objective", "requirement", "need", "kpi", "audience"],
  strategyLaunchPlanning: ["timeline", "launch", "phase", "approval", "outcome", "week", "month"],
  contentCreation: ["deliverable", "content", "post", "reel", "carousel", "story", "platform"],
  scopeOfWork: ["service", "scope", "management", "strategy", "optimization", "reporting"],
  targetAudience: ["audience", "persona", "customer", "buyer"],
  industry: ["industry", "category", "sector"],
  brandPositioning: ["positioning", "brand", "market", "category", "differentiator"],
  objectivesAndGoals: ["goal", "objective", "kpi", "outcome", "growth"],
  contentCreationScope: ["content", "reel", "carousel", "story", "creative", "calendar"],
  paidMediaAdsScope: ["ads", "media", "campaign", "performance", "retargeting", "roas"],
  reportingOptimizationScope: ["report", "optimization", "insight", "kpi", "analysis"],
  monthlyDeliverables: ["deliverable", "monthly", "post", "reel", "story", "report"],
  clientResponsibilities: ["client", "asset", "approval", "access", "feedback"],
  timelineMilestones: ["timeline", "milestone", "launch", "week", "month"],
  expectedOutcomes: ["outcome", "result", "roas", "growth", "conversion"],
};

export function buildOptimizedSowContext(input: {
  clientName?: string | null;
  clientNotes?: string | null;
  sourceText?: string | null;
  normalizedSections?: Record<string, string> | null;
  structuredSections?: Record<string, string> | null;
  understandingOfRequirements?: string | null;
  strategyLaunchPlanning?: string | null;
  contentCreation?: string | null;
  scopeOfWork?: string | null;
  targetAudience?: string | null;
  industry?: string | null;
  maxChunkTokens?: number;
  maxContextTokens?: number;
  topSectionCount?: number;
}): OptimizedSowContext {
  const maxChunkTokens = input.maxChunkTokens ?? 500;
  const maxContextTokens = input.maxContextTokens ?? 2000;
  const topSectionCount = input.topSectionCount ?? 3;
  const cacheKey = JSON.stringify({
    clientName: input.clientName ?? "",
    clientNotes: input.clientNotes ?? "",
    sourceText: input.sourceText ?? "",
    normalizedSections: input.normalizedSections ?? {},
    structuredSections: input.structuredSections ?? {},
    understandingOfRequirements: input.understandingOfRequirements ?? "",
    strategyLaunchPlanning: input.strategyLaunchPlanning ?? "",
    contentCreation: input.contentCreation ?? "",
    scopeOfWork: input.scopeOfWork ?? "",
    targetAudience: input.targetAudience ?? "",
    industry: input.industry ?? "",
    maxChunkTokens,
    maxContextTokens,
    topSectionCount,
  });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const canonicalSections = [
    ...Object.entries(input.normalizedSections ?? {}).map(([key, value]) => makeSection(key, value)),
    makeSection("understandingOfRequirements", input.understandingOfRequirements),
    makeSection("strategyLaunchPlanning", input.strategyLaunchPlanning),
    makeSection("contentCreation", input.contentCreation),
    makeSection("scopeOfWork", input.scopeOfWork),
    makeSection("targetAudience", input.targetAudience),
    makeSection("industry", input.industry),
    ...Object.entries(input.structuredSections ?? {}).map(([key, value]) => makeSection(key, value)),
  ].filter((section): section is { key: string; title: string; raw: string } => Boolean(section));

  const deduped = dedupeSections(canonicalSections);
  const sourceTokens = deduped.reduce((sum, section) => sum + estimateTokens(section.raw), 0);
  const rankedSections = deduped
    .flatMap((section) => summarizeSection(section, maxChunkTokens))
    .sort((a, b) => b.score - a.score);

  const topSections = rankedSections.slice(0, topSectionCount);
  const summaryBlocks = [
    input.clientName ? `Client: ${input.clientName}` : "",
    input.clientNotes ? `Client notes: ${trimToTokenBudget(input.clientNotes, 180)}` : "",
    ...rankedSections.map((section) => `${section.title}: ${section.summary}`),
  ].filter(Boolean);

  const mergedContext = trimToTokenBudget(summaryBlocks.join("\n\n"), maxContextTokens);
  const mergedContextTokens = estimateTokens(mergedContext);
  const reducedTokens = Math.max(sourceTokens - mergedContextTokens, 0);
  const result: OptimizedSowContext = {
    mergedContext,
    mergedContextTokens,
    rankedSections,
    topSections,
    summaries: rankedSections.map((section) => `${section.title}: ${section.summary}`),
    sourceTokens,
    reducedTokens,
    tokenReductionPct: sourceTokens > 0 ? Math.round((reducedTokens / sourceTokens) * 100) : 0,
  };
  cache.set(cacheKey, result);
  return result;
}

function makeSection(key: string, value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return {
    key,
    title: SECTION_LABELS[key] ?? key.replace(/[_-]+/g, " "),
    raw,
  };
}

function dedupeSections(sections: Array<{ key: string; title: string; raw: string }>) {
  const seen: string[] = [];
  const out: Array<{ key: string; title: string; raw: string }> = [];
  for (const section of sections) {
    const normalized = section.raw
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ");
    if (!normalized) continue;
    if (
      seen.some(
        (existing) =>
          existing === normalized ||
          (normalized.length > 48 && (existing.includes(normalized) || normalized.includes(existing))),
      )
    ) {
      continue;
    }
    seen.push(normalized);
    out.push(section);
  }
  return out;
}

function summarizeSection(
  section: { key: string; title: string; raw: string },
  maxChunkTokens: number,
): SOWContextSection[] {
  return chunkText(section.raw, maxChunkTokens).map((chunk, index) => {
    const summary = summarizeChunk(chunk);
    const score = rankSection(section.key, chunk);
    return {
      key: `${section.key}:${index}`,
      title: section.title,
      summary,
      rawExcerpt: trimToTokenBudget(chunk, 140),
      score,
      estimatedTokens: estimateTokens(summary),
    };
  });
}

function chunkText(text: string, maxChunkTokens: number): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [trimToTokenBudget(normalized, maxChunkTokens)];

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) <= maxChunkTokens) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = estimateTokens(paragraph) <= maxChunkTokens ? paragraph : trimToTokenBudget(paragraph, maxChunkTokens);
  }
  if (current) chunks.push(current);
  return chunks;
}

function summarizeChunk(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const top = sentences.slice(0, 3).join(" ");
  return trimToTokenBudget(top || normalized, 120);
}

function rankSection(key: string, text: string): number {
  const lower = text.toLowerCase();
  const keywords = PRIORITY_KEYWORDS[key] ?? [];
  return keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 10 : 0), 0) + Math.min(estimateTokens(text), 120);
}
