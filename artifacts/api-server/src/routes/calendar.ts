import { Router, type IRouter } from "express";
import {
  db,
  clientsTable,
  onboardingProfilesTable,
  strategiesTable,
  plannersTable,
  postsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { GenerateCalendarBody, UpdatePostBody } from "@workspace/api-zod";
import { generateMonthlyPlan, type SowInput } from "../lib/planner/generate.js";
import { randomUUID } from "node:crypto";
import { markAIFallbackUsed, markFallbackUsed } from "../lib/runtime-mode.js";
import { isDbUnavailableError } from "../lib/db-unavailable.js";
import {
  getRequestLLMProvider,
  getNoUsableAiProviderUserMessage,
  isNoUsableAiProviderError,
  shouldUseRealAI,
} from "../lib/llm/request-provider.js";
import type { LLMProvider } from "../lib/llm/types.js";
import {
  fetchInstagramSummary,
  fetchWebsiteSummary,
} from "../lib/extraction/summaries.js";
import { getClientContextWithCache } from "../lib/extraction/client-context-cache.js";
import { mergeInstagramForStrategy } from "../lib/extraction/instagram-for-strategy.js";
import {
  toPublicAiFailure,
  realAiDisabledFailure,
  emptyModelOutputFailure,
  type PublicAiFailure,
} from "../lib/ai-failure.js";
import { buildPromptBudgetStats } from "../lib/llm/prompt-budget.js";
import { getMemoryClientForWorkflow, getMemoryStrategyForWorkflow } from "./clients.js";
import { isSowComplete } from "../lib/sow-completion.js";
import { effectiveScopeOfWork } from "../lib/sow-canonical.js";
import { buildBusinessDnaFromPublicSignals, type BusinessDna } from "../lib/business-dna.js";
import {
  getMcpConfigFromEnv,
  isMcpAvailable,
  orchestrateCalendarEnrichment,
  type CalendarMcpResult,
} from "../lib/mcp/orchestrate.js";
import { buildPostDetailPayload } from "../lib/planner/post-detail.js";

const router: IRouter = Router();
type MemoryPlanner = {
  id: string;
  clientId: string;
  distribution: Record<string, number>;
  formats: Record<string, number>;
  platformSplit: Record<string, number>;
  angleBank: Record<string, string[]>;
  hookStyles: string[];
  weeklyFlow: Record<string, string>;
  pillars: unknown[];
  kpis: Record<string, string>;
  phases: Array<{ name: string; focus: string }>;
  metadata?: Record<string, unknown> | null;
  month: string | null;
  goal: string | null;
  notes: string | null;
  createdAt: string;
};

type MemoryPost = {
  id: string;
  clientId: string;
  plannerId: string;
  date: string;
  platform: string;
  pillar: string;
  angle: string;
  format: string;
  objective: string;
  hook: string;
  caption: string | null;
  hashtags: string[] | null;
  cta: string;
  strategicIntent: string;
  expectedMetric: string;
  expectedReason: string;
  priority: string;
  execution: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  status: string;
  comments: unknown[];
  createdAt: string;
  updatedAt: string;
};

const memoryPlanners = new Map<string, MemoryPlanner>();
const memoryPosts = new Map<string, MemoryPost[]>();
function estimateRequestBytes(value: unknown): number {
  if (value == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

const REQUIRED_SECTIONS = [
  "marketNarrative",
  "problemGapSolution",
  "brandFoundation",
  "brandPhilosophy",
  "audience",
  "emotionalDrivers",
  "platformStrategy",
  "contentStrategy",
  "kpis",
  "trackingPlan",
  "executionPhases",
  "assetRequirements",
] as const;

function buildMcpProvenance(meta: {
  toolName?: string | null;
  status: string;
  timestamp: string;
}) {
  return {
    toolName: meta.toolName ?? null,
    status: meta.status,
    timestamp: meta.timestamp,
  };
}

router.get("/clients/:clientId/calendar", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  try {
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    const [planner] = await db
      .select()
      .from(plannersTable)
      .where(eq(plannersTable.clientId, clientId))
      .orderBy(desc(plannersTable.createdAt))
      .limit(1);

    const diagnostics = buildCalendarDiagnostics({
      strategySource: getStrategySourceFromStructured(
        (strategy?.structuredStrategy as Record<string, unknown> | undefined) ?? null,
      ),
      strategyUpdatedAt:
        strategy?.updatedAt instanceof Date
          ? strategy.updatedAt.toISOString()
          : strategy?.updatedAt
            ? String(strategy.updatedAt)
            : null,
      plannerSource: planner
        ? getPlannerSourceFromMetadata((planner.metadata as Record<string, unknown> | null | undefined) ?? null)
        : null,
      plannerCreatedAt:
        planner?.createdAt instanceof Date
          ? planner.createdAt.toISOString()
          : planner?.createdAt
            ? String(planner.createdAt)
            : null,
    });

    if (!planner) {
      res.json({ planner: null, posts: [], diagnostics });
      return;
    }

    const posts = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.plannerId, planner.id))
      .orderBy(asc(postsTable.date));

    res.json({
      planner: serializePlanner(planner),
      posts: posts.map(serializePost),
      diagnostics,
    });
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    const planner = memoryPlanners.get(clientId) ?? null;
    const strategy = getMemoryStrategyForWorkflow(clientId);
    const posts = (memoryPosts.get(clientId) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const diagnostics = buildCalendarDiagnostics({
      strategySource: getStrategySourceFromStructured(
        (strategy?.structuredStrategy as Record<string, unknown> | undefined) ?? null,
      ),
      strategyUpdatedAt: strategy?.updatedAt ?? null,
      plannerSource: planner
        ? getPlannerSourceFromMetadata((planner.metadata as Record<string, unknown> | null | undefined) ?? null)
        : null,
      plannerCreatedAt: planner?.createdAt ?? null,
    });
    res.json({ planner, posts, diagnostics });
  }
});

router.post("/clients/:clientId/calendar/generate", async (req, res) => {
  const startedAt = Date.now();
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = GenerateCalendarBody.parse(req.body ?? {});
  const requestSizeBytes = estimateRequestBytes(body);

  try {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    if (!isSowComplete(client.sow as Record<string, unknown> | null | undefined)) {
      res.status(400).json({
        error:
          "SOW must be completed and approved before generating content. Complete all required sections first.",
      });
      return;
    }
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);
    if (!strategy) {
      res.status(400).json({ error: "Generate a strategy before the calendar." });
      return;
    }
    const pendingSections = getPendingStrategySections(
      strategy.structuredStrategy as Record<string, unknown>,
    );
    if (pendingSections.length > 0) {
      res.status(400).json({
        error: "Approve all strategy sections before generating the content calendar.",
        pendingSections,
      });
      return;
    }

    const structuredForSource = strategy.structuredStrategy as Record<string, unknown>;
    const strategySource = String(
      ((structuredForSource.__meta as Record<string, unknown> | undefined)?.strategySource ?? ""),
    ).trim();
    if (strategySource === "chatgpt_import") {
      const imported = generateCalendarFromImportedStrategy(
        clientId,
        monthAnchorFromBody(body),
        body,
        structuredForSource,
        (client.sow as Record<string, unknown> | null | undefined) ?? null,
      );
      const posts = imported.posts.map((post) => enrichPostForExecution(post));
      await db.delete(plannersTable).where(eq(plannersTable.clientId, clientId));
      const [savedPlanner] = await db
        .insert(plannersTable)
        .values({
          clientId,
          distribution: imported.planner.distribution,
          formats: imported.planner.formats,
          platformSplit: imported.planner.platformSplit,
          angleBank: imported.planner.angleBank,
          hookStyles: imported.planner.hookStyles,
          weeklyFlow: imported.planner.weeklyFlow,
          pillars: imported.planner.pillars,
          kpis: imported.planner.kpis,
          phases: imported.planner.phases,
          metadata: {
            ...((imported.planner.metadata as Record<string, unknown> | null) ?? {}),
            calendarSource: "chatgpt_import",
            generationMode: "imported_deterministic",
            providerAttempted: false,
            calendarGeneratedAt: new Date().toISOString(),
          },
          month: imported.planner.month,
          goal: imported.planner.goal,
          notes: imported.planner.notes,
        })
        .returning();
      if (!savedPlanner) {
        res.status(500).json({ error: "Failed to save planner" });
        return;
      }
      const inserted = await db
        .insert(postsTable)
        .values(
          posts.map((p) => ({
            clientId,
            plannerId: savedPlanner.id,
            date: p.date,
            platform: p.platform,
            pillar: p.pillar,
            angle: p.angle,
            format: p.format,
            objective: p.objective,
            hook: p.hook,
            caption: p.caption ?? null,
            hashtags: p.hashtags ?? null,
            cta: p.cta,
            strategicIntent: p.strategicIntent,
            expectedMetric: p.expectedMetric,
            expectedReason: p.expectedReason,
            priority: p.priority,
            execution: p.execution,
            metadata: (p as Record<string, unknown>).metadata ?? null,
            status: "draft",
          })),
        )
        .returning();
      req.log.info(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), source: "chatgpt_import" },
        "Calendar generation source selected",
      );
      res.setHeader("x-calendar-source", "chatgpt_import");
      res.json({
        planner: serializePlanner(savedPlanner),
        posts: inserted.map(serializePost),
        calendarSource: "chatgpt_import",
      });
      return;
    }

    const useRealAICal = shouldUseRealAI(req);
    let resolvedCalendarLlm: LLMProvider | null = null;
    if (useRealAICal) {
      try {
        resolvedCalendarLlm = getRequestLLMProvider(req);
        const d = resolvedCalendarLlm.describe?.() ?? { provider: resolvedCalendarLlm.id, model: "default" };
        req.log.info(
          { provider: d.provider, model: d.model },
          "Calendar generate: LLM provider resolved (fail-fast before enrichment)",
        );
      } catch (e) {
        if (isNoUsableAiProviderError(e)) {
          res.status(503).json({ error: getNoUsableAiProviderUserMessage(), code: "NO_USABLE_AI_PROVIDER" });
          return;
        }
        throw e;
      }
    }

    const [profile] = await db
      .select()
      .from(onboardingProfilesTable)
      .where(eq(onboardingProfilesTable.clientId, clientId))
      .orderBy(desc(onboardingProfilesTable.createdAt))
      .limit(1);

    let enriched = (profile?.enrichedData ?? {}) as Record<string, unknown>;
    let structured = strategy.structuredStrategy as Record<string, unknown>;
    const sow = client.sow as SowInput;

    const today = new Date();
    const monthAnchor = body.startDate
      ? new Date(body.startDate + "T00:00:00Z")
      : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const startDate = monthAnchor.toISOString().slice(0, 10);
    const monthLabel =
      body.month ||
      monthAnchor.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(plannersTable)
      .where(
        and(
          eq(plannersTable.clientId, clientId),
          eq(plannersTable.month, monthLabel),
        ),
      );
    if (count >= 2) {
      res.status(429).json({
        error: "Calendar generation limit reached for this month.",
        maxAttempts: 2,
      });
      return;
    }
    const mcpConfig = getMcpConfigFromEnv();
    const mcpAvailable = isMcpAvailable(mcpConfig);
    const mcpInstagramHandle =
      typeof enriched.instagram_url === "string"
        ? enriched.instagram_url
        : typeof (profile?.rawInput as { instagramHandle?: string } | undefined)?.instagramHandle === "string"
          ? (profile?.rawInput as { instagramHandle?: string }).instagramHandle!
          : null;
    let mcpCalendar: CalendarMcpResult = {
      used: false,
      status: "disabled",
      toolName: null,
      timestamp: new Date().toISOString(),
      toolResultSummary: null,
      enriched: {
        clientId,
        month: monthLabel,
        goal: body.goal ?? null,
        notes: body.notes ?? null,
        instagramHandle: mcpInstagramHandle,
        enriched,
        structuredStrategy: structured,
      },
    };
    if (mcpAvailable) {
      mcpCalendar = await orchestrateCalendarEnrichment(mcpCalendar.enriched, mcpConfig);
    }
    req.log.info(
      {
        available: mcpAvailable,
        enabled: mcpConfig.enabled,
        status: mcpCalendar.status,
        used: mcpCalendar.used,
      },
      "MCP calendar orchestration status",
    );
    enriched = mcpCalendar.enriched.enriched;
    structured = mcpCalendar.enriched.structuredStrategy;
    const rawIn = profile?.rawInput as
      | {
          websiteUrl?: string;
          instagramHandle?: string;
          oneLineDescription?: string;
          instagramSummaryNotes?: string;
        }
      | undefined;
    const currentBusinessDna = await buildBusinessDnaFromPublicSignals({
      name: client.name,
      websiteUrl:
        typeof rawIn?.websiteUrl === "string" ? rawIn.websiteUrl : client.website ?? "",
      instagramHandle:
        typeof rawIn?.instagramHandle === "string" ? rawIn.instagramHandle : client.instagramHandle ?? "",
      oneLineDescription:
        typeof rawIn?.oneLineDescription === "string" ? rawIn.oneLineDescription : client.oneLineDescription ?? null,
      instagramSummaryNotes:
        typeof rawIn?.instagramSummaryNotes === "string" ? rawIn.instagramSummaryNotes : null,
      existing:
        ((profile?.enrichedData as { businessDna?: BusinessDna } | null | undefined)?.businessDna as
          | Partial<BusinessDna>
          | null
          | undefined) ?? null,
      enrichedProfile: enriched,
      mcpData: (enriched.mcp as Record<string, unknown> | null | undefined) ?? null,
      sowSections: {
        understandingOfRequirements: String(
          (client.sow as Record<string, unknown> | undefined)?.understandingOfRequirements ?? "",
        ),
        scopeOfWork:
          effectiveScopeOfWork(client.sow as Record<string, unknown> | null) ||
          String((client.sow as Record<string, unknown> | undefined)?.scopeOfWork ?? ""),
      },
    });
    enriched = {
      ...enriched,
      businessDna: currentBusinessDna,
    };

    let generation: { planner: MemoryPlanner; posts: MemoryPost[] } | null = null;
    let calendarSource: "real" | "fallback" = "real";
    let calendarAiFailure: PublicAiFailure | null = null;
    if (useRealAICal) {
      try {
        const provider = resolvedCalendarLlm!;
        const providerInfo = provider.describe?.() ?? { provider: provider.id, model: "default" };
        req.log.info(
          { provider: providerInfo.provider, model: providerInfo.model },
          "Calendar generation: using real LLM provider",
        );
        const igRaw =
          typeof enriched.instagram_url === "string"
            ? enriched.instagram_url
            : typeof (profile?.rawInput as { instagramHandle?: string } | undefined)?.instagramHandle ===
                "string"
              ? (profile?.rawInput as { instagramHandle?: string }).instagramHandle!
              : "";
        const instagramUrl = igRaw
          ? igRaw.startsWith("http")
            ? igRaw
            : `https://instagram.com/${igRaw.replace(/^@/, "")}`
          : "";
        const websiteUrl =
          typeof enriched.website_url === "string"
            ? enriched.website_url
            : typeof (profile?.rawInput as { websiteUrl?: string } | undefined)?.websiteUrl === "string"
              ? (profile?.rawInput as { websiteUrl?: string }).websiteUrl!
              : "";
        const contextStartedAt = Date.now();
        const context = await getClientContextWithCache({
          clientId,
          websiteUrl,
          instagramUrlOrHandle: instagramUrl,
          forceRefresh: req.query.refreshContext === "1",
          timeoutMs: 6000,
        });
        const websiteSummary = context.websiteSummary;
        const instagramFromFetch = context.instagramSummary;
        req.log.info(
          {
            cacheHit: context.cacheHit,
            websiteFetchMs: context.websiteMs,
            instagramFetchMs: context.instagramMs,
            contextTotalMs: Date.now() - contextStartedAt,
          },
          "Calendar context enrichment stage timings",
        );
        const igCalPlatform = (
          currentBusinessDna.platformSignals?.instagram as
            | {
                handle?: string;
                bioSignals?: string[];
                contentPatterns?: string[];
                engagementSignals?: string[];
              }
            | undefined
        ) ?? undefined;
        const instagramSummary = mergeInstagramForStrategy(instagramFromFetch, igCalPlatform);
        const strategySummaryBlock =
          ((structured.__summary ?? {}) as {
            strategy?: string;
            pillarPriorities?: string[];
            monthlyGoals?: string[];
          }) ?? {};
        req.log.info(
          {
            calendarInstagramPublic: instagramFromFetch
              ? { snippets: instagramFromFetch.last_n_caption_snippets?.length ?? 0 }
              : null,
            calendarInstagramMerged: instagramSummary
              ? { snippets: instagramSummary.last_n_caption_snippets?.length ?? 0 }
              : null,
          },
          "Calendar: Instagram public + DNA/MCP merge for planner",
        );
        req.log.info(
          buildPromptBudgetStats(
            "calendar generation",
            [
              client.name,
              enriched,
              strategySummaryBlock.strategy ?? "",
              strategySummaryBlock.pillarPriorities ?? [],
              strategySummaryBlock.monthlyGoals ?? [],
              sow,
              body,
            ],
            2000,
            1200,
          ),
          "Calendar prompt budget",
        );
        req.log.info({ requestSizeBytes }, "Calendar request payload telemetry");
        const result = await generateMonthlyPlan(
          client.name,
          enriched,
          structured,
          sow,
          {
            month: monthLabel,
            startDate,
            goal: body.goal ?? "",
            notes: body.notes ?? "",
          },
          provider,
          {
            websiteSummary,
            instagramSummary,
            strategySummary: strategySummaryBlock.strategy ?? null,
            pillarPriorities: strategySummaryBlock.pillarPriorities ?? null,
            monthlyGoals: strategySummaryBlock.monthlyGoals ?? null,
          },
        );
        generation = {
          planner: {
            id: "",
            clientId,
            distribution: result.planner.distribution,
            formats: result.planner.formats,
            platformSplit: result.planner.platformSplit,
            angleBank: result.planner.angleBank,
            hookStyles: result.planner.hookStyles,
            weeklyFlow: result.planner.weeklyFlow,
            pillars: result.planner.pillars,
            kpis: result.planner.kpis,
            phases: result.planner.phases,
            month: monthLabel,
            goal: body.goal ?? null,
            notes: body.notes ?? null,
            metadata: {
              mcp: buildMcpProvenance(mcpCalendar),
            },
            createdAt: new Date().toISOString(),
          },
          posts: result.posts.map((p) => ({
            id: "",
            clientId,
            plannerId: "",
            date: p.date,
            platform: p.platform,
            pillar: p.pillar,
            angle: p.angle,
            format: p.format,
            objective: p.objective,
            hook: p.hook,
            caption: p.caption ?? null,
            hashtags: p.hashtags ?? null,
            cta: p.cta,
            strategicIntent: p.strategicIntent,
            expectedMetric: p.expectedMetric,
            expectedReason: p.expectedReason,
            priority: p.priority,
            execution: p.execution,
            metadata: {
              mcp: buildMcpProvenance(mcpCalendar),
            },
            status: "draft",
            comments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        };
        req.log.info(
          {
            provider: providerInfo.provider,
            model: providerInfo.model,
            responseTimeMs: elapsedMs(startedAt),
          },
          "Calendar generation completed from real LLM output",
        );
      } catch (err) {
        req.log.warn({ err }, "Real AI calendar generation failed, using demo planner");
        const d = resolvedCalendarLlm?.describe?.() ?? { provider: "unknown", model: "default" };
        calendarAiFailure = toPublicAiFailure(err, { providerId: d.provider, model: d.model });
        calendarAiFailure.message = humanizeCalendarFailure(calendarAiFailure.message);
        markAIFallbackUsed();
        calendarSource = "fallback";
        req.log.warn(
          { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "provider_or_output_failure" },
          "Calendar fallback telemetry",
        );
      }
    } else {
      req.log.info("Calendar generation using deterministic demo fallback (real AI disabled)");
      calendarAiFailure = realAiDisabledFailure({ providerId: "demo", model: "deterministic" });
      markAIFallbackUsed();
      calendarSource = "fallback";
      req.log.info(
        { requestSizeBytes, responseTimeMs: elapsedMs(startedAt), fallbackReason: "real_ai_disabled" },
        "Calendar fallback telemetry",
      );
    }
    const fallbackGenerated = generateDemoCalendarPayload(clientId, monthAnchor, monthLabel, body);
    fallbackGenerated.planner = {
      ...fallbackGenerated.planner,
      metadata: {
        mcp: buildMcpProvenance(mcpCalendar),
      },
    };
    fallbackGenerated.posts = fallbackGenerated.posts.map((post) => ({
      ...post,
      metadata: {
        mcp: buildMcpProvenance(mcpCalendar),
      },
    }));
    if (!generation?.posts.length) {
      if (useRealAICal && !calendarAiFailure) {
        const d = resolvedCalendarLlm?.describe?.() ?? { provider: "unknown", model: "default" };
        calendarAiFailure = emptyModelOutputFailure({ providerId: d.provider, model: d.model });
      }
      markAIFallbackUsed();
      calendarSource = "fallback";
    }
    const planner = generation?.planner ?? fallbackGenerated.planner;
    const posts = (generation?.posts.length ? generation.posts : fallbackGenerated.posts).map((post) =>
      enrichPostForExecution(post),
    );

    if (posts.length === 0) {
      res.status(500).json({ error: "Generation returned no posts." });
      return;
    }

    // Replace any prior planner/posts for this client.
    await db.delete(plannersTable).where(eq(plannersTable.clientId, clientId));

    const baseMeta = ((planner as Record<string, unknown>).metadata ?? null) as Record<string, unknown> | null;
    const metaOut: Record<string, unknown> = { ...(baseMeta ?? {}) };
    metaOut.calendarSource = calendarSource;
    metaOut.calendarGeneratedAt = new Date().toISOString();
    if (calendarSource === "fallback" && calendarAiFailure) {
      metaOut.calendarAiFailure = calendarAiFailure;
    }

    const [savedPlanner] = await db
      .insert(plannersTable)
      .values({
        clientId,
        distribution: planner.distribution,
        formats: planner.formats,
        platformSplit: planner.platformSplit,
        angleBank: planner.angleBank,
        hookStyles: planner.hookStyles,
        weeklyFlow: planner.weeklyFlow,
        pillars: planner.pillars,
        kpis: planner.kpis,
        phases: planner.phases,
        metadata: metaOut,
        month: planner.month,
        goal: planner.goal,
        notes: planner.notes,
      })
      .returning();

    if (!savedPlanner) {
      res.status(500).json({ error: "Failed to save planner" });
      return;
    }

    const inserted = await db
      .insert(postsTable)
      .values(
        posts.map((p) => ({
          clientId,
          plannerId: savedPlanner.id,
          date: p.date,
          platform: p.platform,
          pillar: p.pillar,
          angle: p.angle,
          format: p.format,
          objective: p.objective,
          hook: p.hook,
          caption: p.caption ?? null,
          hashtags: p.hashtags ?? null,
          cta: p.cta,
          strategicIntent: p.strategicIntent,
          expectedMetric: p.expectedMetric,
          expectedReason: p.expectedReason,
          priority: p.priority,
          execution: p.execution,
          metadata: (p as Record<string, unknown>).metadata ?? null,
          status: "draft",
        })),
      )
      .returning();

    req.log.info({ source: calendarSource }, "Calendar generation source selected");
    res.setHeader("x-calendar-source", calendarSource);
    if (resolvedCalendarLlm) {
      const info = resolvedCalendarLlm.describe?.() ?? { provider: "unknown", model: "default" };
      res.setHeader("x-ai-provider", info.provider);
      res.setHeader("x-ai-model", info.model);
      // NOTE: These headers reflect the ENTRY provider in the fallback chain,
      // not necessarily the provider that won. Exact provider tracing requires
      // propagating the winning provider from FallbackProvider.chatCompletion().
    }
    res.json({
      planner: serializePlanner(savedPlanner),
      posts: inserted.map(serializePost),
      calendarSource,
      aiFailure: calendarSource === "fallback" ? calendarAiFailure : undefined,
    });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      markFallbackUsed();
      const memoryClient = getMemoryClientForWorkflow(clientId);
      const memoryStrategy = getMemoryStrategyForWorkflow(clientId);
      if (!memoryClient) {
        res.status(404).json({ error: "Client not found" });
        return;
      }
      if (!isSowComplete(memoryClient.sow as Record<string, unknown> | null | undefined)) {
        res.status(400).json({
          error:
            "SOW must be completed and approved before generating content. Complete all required sections first.",
        });
        return;
      }
      if (!memoryStrategy) {
        res.status(400).json({ error: "Generate a strategy before the calendar." });
        return;
      }
      const pendingSections = getPendingStrategySections(
        memoryStrategy.structuredStrategy as Record<string, unknown>,
      );
      if (pendingSections.length > 0) {
        res.status(400).json({
          error: "Approve all strategy sections before generating the content calendar.",
          pendingSections,
        });
        return;
      }
      const memoryStructured = memoryStrategy.structuredStrategy as Record<string, unknown>;
      const memoryStrategySource = String(
        ((memoryStructured.__meta as Record<string, unknown> | undefined)?.strategySource ?? ""),
      ).trim();
      if (memoryStrategySource === "chatgpt_import") {
        const imported = generateCalendarFromImportedStrategy(
          clientId,
          monthAnchorFromBody(body),
          body,
          memoryStructured,
        );
        imported.posts = imported.posts.map((post) => enrichPostForExecution(post));
        const plannerOut: MemoryPlanner = {
          ...imported.planner,
          metadata: {
            ...((imported.planner.metadata as Record<string, unknown> | null) ?? {}),
            calendarSource: "chatgpt_import",
            generationMode: "imported_deterministic",
            providerAttempted: false,
            calendarGeneratedAt: new Date().toISOString(),
          },
        };
        memoryPlanners.set(clientId, plannerOut);
        memoryPosts.set(clientId, imported.posts);
        res.setHeader("x-calendar-source", "chatgpt_import");
        res.json({
          planner: plannerOut,
          posts: imported.posts,
          calendarSource: "chatgpt_import" as const,
        });
        return;
      }
      const now = new Date();
      const monthAnchor = body.startDate
        ? new Date(body.startDate + "T00:00:00Z")
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthLabel =
        body.month ||
        monthAnchor.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
      const generated = generateDemoCalendarPayload(clientId, monthAnchor, monthLabel, body);
      generated.posts = generated.posts.map((post) => enrichPostForExecution(post));
      let memD = { provider: "demo", model: "deterministic" };
      if (shouldUseRealAI(req)) {
        try {
          const memProvider = getRequestLLMProvider(req);
          memD = memProvider.describe?.() ?? { provider: memProvider.id, model: "default" };
        } catch {
          memD = { provider: "unconfigured", model: "n/a" };
        }
      }
      const memFailure = shouldUseRealAI(req)
        ? toPublicAiFailure(new Error("DB unavailable; calendar used safe template path."), {
            providerId: memD.provider,
            model: memD.model,
          })
        : realAiDisabledFailure({ providerId: "demo", model: "deterministic" });
      markAIFallbackUsed();
      const plannerOut: MemoryPlanner = {
        ...generated.planner,
        metadata: {
          ...((generated.planner.metadata as Record<string, unknown> | null) ?? {}),
          calendarSource: "fallback",
          calendarGeneratedAt: new Date().toISOString(),
          calendarAiFailure: memFailure,
        },
      };
      memoryPlanners.set(clientId, plannerOut);
      memoryPosts.set(clientId, generated.posts);
      res.setHeader("x-calendar-source", "fallback");
      res.json({
        planner: plannerOut,
        posts: generated.posts,
        calendarSource: "fallback" as const,
        aiFailure: memFailure,
      });
      return;
    }
    req.log.error({ err }, "Calendar generation failed");
    res.status(500).json({ error: "Calendar generation failed", detail: String(err) });
  }
});

router.patch("/posts/:postId", async (req, res) => {
  const { postId } = req.params;
  if (!postId) {
    res.status(400).json({ error: "postId required" });
    return;
  }
  const body = UpdatePostBody.parse(req.body);

  try {
    const [existing] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
    if (!existing) {
      res.status(404).json({ error: "Post not found" });
      return;
    }

    const updates: Partial<typeof postsTable.$inferInsert> = { updatedAt: new Date() };
    if (body.date !== undefined) updates.date = body.date;
    if (body.status !== undefined) updates.status = body.status;
    if (body.hook !== undefined) updates.hook = body.hook;
    if (body.caption !== undefined) updates.caption = body.caption;
    if (body.hashtags !== undefined) updates.hashtags = body.hashtags;
    if (body.cta !== undefined) updates.cta = body.cta;
    if (body.priority !== undefined) updates.priority = body.priority;

    if (body.addComment) {
      const prior = Array.isArray(existing.comments) ? (existing.comments as unknown[]) : [];
      updates.comments = [
        ...prior,
        {
          author: body.addComment.author ?? "Strategist",
          text: body.addComment.text,
          createdAt: new Date().toISOString(),
        },
      ];
    }

    const [updated] = await db
      .update(postsTable)
      .set(updates)
      .where(eq(postsTable.id, postId))
      .returning();

    if (!updated) {
      res.status(500).json({ error: "Failed to update post" });
      return;
    }

    res.json(serializePost(updated));
  } catch (err) {
    if (!isDbUnavailableError(err)) {
      throw err;
    }
    markFallbackUsed();
    for (const [clientId, posts] of memoryPosts.entries()) {
      const idx = posts.findIndex((p) => p.id === postId);
      if (idx === -1) continue;
      const existing = posts[idx]!;
      const updated: MemoryPost = {
        ...existing,
        date: body.date ?? existing.date,
        status: body.status ?? existing.status,
        hook: body.hook ?? existing.hook,
        caption: body.caption ?? existing.caption,
        hashtags: body.hashtags ?? existing.hashtags,
        cta: body.cta ?? existing.cta,
        priority: body.priority ?? existing.priority,
        comments: body.addComment
          ? [
              ...(Array.isArray(existing.comments) ? existing.comments : []),
              {
                author: body.addComment.author ?? "Strategist",
                text: body.addComment.text,
                createdAt: new Date().toISOString(),
              },
            ]
          : existing.comments,
        updatedAt: new Date().toISOString(),
      };
      const nextPosts = posts.slice();
      nextPosts[idx] = updated;
      memoryPosts.set(clientId, nextPosts);
      res.json(updated);
      return;
    }
    res.status(404).json({ error: "Post not found" });
  }
});

function serializePlanner(p: typeof plannersTable.$inferSelect) {
  return {
    id: p.id,
    clientId: p.clientId,
    distribution: p.distribution,
    formats: p.formats,
    platformSplit: p.platformSplit,
    angleBank: p.angleBank,
    hookStyles: p.hookStyles,
    weeklyFlow: p.weeklyFlow,
    pillars: p.pillars,
    kpis: p.kpis,
    phases: p.phases,
    metadata: p.metadata,
    month: p.month,
    goal: p.goal,
    notes: p.notes,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
  };
}

function getPendingStrategySections(structured: Record<string, unknown>): string[] {
  const approvals = ((structured.__meta ?? {}) as { sectionApprovals?: Record<string, boolean> })
    .sectionApprovals;
  return REQUIRED_SECTIONS.filter((sectionKey) => !approvals?.[sectionKey]).map(String);
}

function serializePost(p: typeof postsTable.$inferSelect) {
  return {
    id: p.id,
    clientId: p.clientId,
    plannerId: p.plannerId,
    date: typeof p.date === "string" ? p.date : String(p.date),
    platform: p.platform,
    pillar: p.pillar,
    angle: p.angle,
    format: p.format,
    objective: p.objective,
    hook: p.hook,
    caption: p.caption,
    hashtags: p.hashtags,
    cta: p.cta,
    strategicIntent: p.strategicIntent,
    expectedMetric: p.expectedMetric,
    expectedReason: p.expectedReason,
    priority: p.priority,
    execution: p.execution,
    metadata: p.metadata,
    status: p.status,
    comments: p.comments ?? [],
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
  };
}

export default router;

function humanizeCalendarFailure(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("402") || m.includes("credits") || m.includes("can only afford")) {
    return "Prompt too large for current OpenRouter credits. Using template fallback. Upgrade credits or lower generation size.";
  }
  if (m.includes("413") || m.includes("request too large") || m.includes("tpm")) {
    return "Prompt too large for current provider limits. Using template fallback. Reduce prompt size or switch to a higher-limit model.";
  }
  return message;
}

function monthAnchorFromBody(body: { startDate?: string; month?: string }): Date {
  const now = new Date();
  return body.startDate
    ? new Date(body.startDate + "T00:00:00Z")
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function generateCalendarFromImportedStrategy(
  clientId: string,
  monthAnchor: Date,
  body: { goal?: string; notes?: string; month?: string },
  structured: Record<string, unknown>,
  sow: Record<string, unknown> | null,
): { planner: MemoryPlanner; posts: MemoryPost[] } {
  const monthLabel =
    body.month ||
    monthAnchor.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  const summary =
    ((structured.__summary as Record<string, unknown> | undefined) ?? {}) as {
      strategy?: string;
      pillarPriorities?: string[];
      monthlyGoals?: string[];
    };
  const pillarsRaw = Array.isArray(summary.pillarPriorities) ? summary.pillarPriorities : [];
  const pillars = pillarsRaw.map((p) => String(p).trim()).filter(Boolean);
  const monthlyGoalsRaw = Array.isArray(summary.monthlyGoals) ? summary.monthlyGoals : [];
  const monthlyGoals = monthlyGoalsRaw.map((g) => String(g).trim()).filter(Boolean);
  const canonical = ((structured.canonicalSections as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;
  const platformSection = String(canonical.platformStrategy ?? "").toLowerCase();
  const fallbackPlatform =
    platformSection.includes("linkedin")
      ? "LinkedIn"
      : platformSection.includes("youtube")
        ? "YouTube"
        : "Instagram";
  const targetPlatformCounts = normalizeCalendarPlatformCounts(sow, fallbackPlatform);
  const totalPosts = Object.values(targetPlatformCounts).reduce((sum, count) => sum + count, 0);
  const assignedPlatforms = expandPlatformAssignments(targetPlatformCounts);
  const base = generateDemoCalendarPayload(
    clientId,
    monthAnchor,
    monthLabel,
    body,
    Math.max(totalPosts, 1),
    assignedPlatforms[0] ?? fallbackPlatform,
    targetPlatformCounts,
  );
  const seed = hashDeterministicSeed(`${clientId}:${monthLabel}`);
  const pillarPool = pillars.length > 0 ? pillars : ["Education", "Trust", "Proof", "Offer"];
  const objectivePool =
    monthlyGoals.length > 0
      ? monthlyGoals
      : [
          "Increase awareness and saves",
          "Strengthen trust and consideration",
          "Drive qualified DMs and clicks",
          "Support conversion intent",
        ];
  const formatPool: Array<"Reel" | "Carousel" | "Stories" | "Static"> = [
    "Reel",
    "Carousel",
    "Stories",
    "Static",
  ];
  const hookStylePool = ["curiosity", "contrarian", "how_to", "myth_vs_fact", "proof_led"] as const;
  const funnelPool = ["awareness", "consideration", "conversion", "retention"] as const;
  const ctaPool = [
    "Save this for your next planning session",
    "Comment 'PLAN' and we will send the framework",
    "DM 'START' for the execution checklist",
    "Share this with your team lead",
    "Tap the link in bio for the next step",
    "Reply with your biggest blocker this week",
  ];
  const signatureSeen = new Set<string>();
  const plannerPillars =
    pillars.length > 0
      ? pillars.slice(0, 5).map((name, idx) => ({
          name,
          color: ["#2563EB", "#7C3AED", "#16A34A", "#EA580C", "#DC2626"][idx % 5] ?? "#2563EB",
        }))
      : base.planner.pillars;
  const planner: MemoryPlanner = {
    ...base.planner,
    platformSplit: targetPlatformCounts,
    pillars: plannerPillars,
    phases: objectivePool.slice(0, 4).map((goal, i) => ({ name: `Week ${i + 1}`, focus: goal })),
    hookStyles: [...hookStylePool],
    goal: body.goal ?? monthlyGoals[0] ?? null,
    notes: body.notes ?? (String(summary.strategy ?? "").trim() || null),
    month: monthLabel,
    metadata: {
      ...(base.planner.metadata ?? {}),
      generationMode: "imported_deterministic",
      providerAttempted: false,
    },
  };

  const posts = base.posts.map((post, idx) => {
    let selected:
      | {
          pillar: string;
          goal: string;
          format: "Reel" | "Carousel" | "Stories" | "Static";
          hookStyle: (typeof hookStylePool)[number];
          funnelStage: (typeof funnelPool)[number];
          cta: string;
          hook: string;
          angle: string;
          signature: string;
        }
      | null = null;

    const previousFormat = idx > 0 ? String(base.posts[idx - 1]?.format ?? "") : "";
    const attemptLimit = Math.max(8, pillarPool.length * formatPool.length);
    for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
      const pillar = pillarPool[(seed + idx + attempt) % pillarPool.length] ?? pillarPool[0]!;
      const goal = objectivePool[(seed * 3 + idx + attempt) % objectivePool.length] ?? objectivePool[0]!;
      const hookStyle =
        hookStylePool[(seed + idx * 2 + attempt) % hookStylePool.length] ?? hookStylePool[0];
      const funnelStage = funnelPool[(seed + idx + attempt) % funnelPool.length] ?? funnelPool[0];
      let format =
        formatPool[(seed + idx * 3 + attempt) % formatPool.length] ?? formatPool[0];
      if (previousFormat && format.toLowerCase() === previousFormat.toLowerCase()) {
        format = formatPool[(seed + idx * 3 + attempt + 1) % formatPool.length] ?? formatPool[0];
      }
      const cta = ctaPool[(seed + idx + attempt) % ctaPool.length] ?? ctaPool[0]!;
      const hook = buildDeterministicHook({
        hookStyle,
        pillar,
        goal,
        funnelStage,
        index: idx,
      });
      const angle = `${prettifyFunnelStage(funnelStage)} / ${prettifyHookStyle(hookStyle)} focus: ${pillar}`;
      const signature = buildPostSignature({
        pillar,
        goal,
        format,
        hookStyle,
        funnelStage,
        hook,
      });
      if (signatureSeen.has(signature)) continue;
      signatureSeen.add(signature);
      selected = { pillar, goal, format, hookStyle, funnelStage, cta, hook, angle, signature };
      break;
    }

    const fallbackPillar = pillarPool[idx % pillarPool.length] ?? "Education";
    const fallbackGoal =
      objectivePool[idx % objectivePool.length] ?? "Move audience from awareness to conversion.";
    const fallbackHookStyle = hookStylePool[idx % hookStylePool.length] ?? hookStylePool[0];
    const fallbackFunnelStage = funnelPool[idx % funnelPool.length] ?? funnelPool[0];
    const fallbackFormat = formatPool[idx % formatPool.length] ?? formatPool[0];
    const fallbackHook = buildDeterministicHook({
      hookStyle: fallbackHookStyle,
      pillar: fallbackPillar,
      goal: fallbackGoal,
      funnelStage: fallbackFunnelStage,
      index: idx,
    });
    const fallbackAngle = `${prettifyFunnelStage(fallbackFunnelStage)} / ${prettifyHookStyle(
      fallbackHookStyle,
    )} focus: ${fallbackPillar}`;

    const pillar = selected?.pillar ?? fallbackPillar;
    const goal = selected?.goal ?? fallbackGoal;
    const format = selected?.format ?? fallbackFormat;
    const hookStyle = selected?.hookStyle ?? fallbackHookStyle;
    const funnelStage = selected?.funnelStage ?? fallbackFunnelStage;
    const cta = selected?.cta ?? ctaPool[idx % ctaPool.length] ?? ctaPool[0]!;
    const hook = selected?.hook ?? fallbackHook;
    const angle = selected?.angle ?? fallbackAngle;
    const platform = assignedPlatforms[idx] ?? fallbackPlatform;
    return {
      ...post,
      platform,
      format: normalizeImportedFormatForPlatform(format, platform),
      pillar,
      objective: goal,
      angle,
      hook,
      cta: defaultImportedCtaForPlatform(platform, cta),
      caption: null,
      strategicIntent: String(summary.strategy ?? post.strategicIntent),
      expectedReason: `Aligned with ${prettifyFunnelStage(funnelStage)} goal: ${goal}`,
      metadata: {
        importedStrategy: true,
        generationMode: "imported_deterministic",
        hookStyle,
        funnelStage,
      },
    };
  });
  return { planner, posts };
}

function generateDemoCalendarPayload(
  clientId: string,
  monthAnchor: Date,
  monthLabel: string,
  body: { goal?: string; notes?: string },
  totalPosts = 16,
  defaultPlatform = "Instagram",
  platformSplit: Record<string, number> = { Instagram: totalPosts },
): { planner: MemoryPlanner; posts: MemoryPost[] } {
  const plannerId = randomUUID();
  const planner: MemoryPlanner = {
    id: plannerId,
    clientId,
    distribution: { education: 40, thought_leadership: 30, social_proof: 20, promotion: 10 },
    formats: { reel: 35, carousel: 30, static: 20, story: 15 },
    platformSplit,
    angleBank: {
      education: ["How it works breakdown", "Before/after process insight"],
      thought_leadership: ["Operator POV on market trend"],
      social_proof: ["Client result story"],
      promotion: ["Offer clarity post"],
    },
    hookStyles: ["curiosity", "operator POV", "data-backed"],
    weeklyFlow: {
      week_1: "Awareness + positioning",
      week_2: "Education + trust",
      week_3: "Proof + conversion",
      week_4: "Offer + follow-up",
    },
    pillars: [
      { name: "education", color: "#2563EB" },
      { name: "thought_leadership", color: "#7C3AED" },
      { name: "social_proof", color: "#16A34A" },
      { name: "promotion", color: "#EA580C" },
    ],
    kpis: { reach: "baseline growth", saves: "educational resonance", leads: "qualified DMs" },
    phases: [
      { name: "Week 1", focus: "Establish context" },
      { name: "Week 2", focus: "Deepen trust" },
      { name: "Week 3", focus: "Push conversion intent" },
      { name: "Week 4", focus: "Proof and close" },
    ],
    month: monthLabel,
    goal: body.goal ?? null,
    notes: body.notes ?? null,
    createdAt: new Date().toISOString(),
  };
  const posts: MemoryPost[] = Array.from({ length: totalPosts }).map((_, i) => {
    const d = new Date(monthAnchor);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    const createdAt = new Date().toISOString();
    return {
      id: randomUUID(),
      clientId,
      plannerId,
      date,
      platform: defaultPlatform,
      pillar: ["education", "thought_leadership", "social_proof", "promotion"][i % 4] ?? "education",
      angle: "Operator insight",
      format: ["Reel", "Carousel", "Static", "Stories"][i % 4] ?? "Reel",
      objective: "Drive qualified engagement",
      hook: `Post ${i + 1}: Concrete insight for ideal customers`,
      caption:
        "Template-based preview. Turn on real AI in settings and add provider keys (e.g. USE_REAL_AI) to generate live copy when the model is available.",
      hashtags: ["#strategy", "#content", "#growth"],
      cta: "DM 'PLAN' for the checklist",
      strategicIntent: "Support monthly progression from awareness to conversion.",
      expectedMetric: "saves",
      expectedReason: "Educational framing increases save intent.",
      priority: i % 5 === 0 ? "high" : "medium",
      execution: { notes: "Fallback-generated post structure" },
      status: "draft",
      comments: [],
      createdAt,
      updatedAt: createdAt,
    };
  });
  return { planner, posts };
}

function normalizeCalendarPlatformCounts(
  sow: Record<string, unknown> | null,
  fallbackPlatform: string,
): Record<string, number> {
  const rawMonthlyPosts =
    sow && typeof sow.monthlyPosts === "object" && sow.monthlyPosts
      ? (sow.monthlyPosts as Record<string, unknown>)
      : {};
  const out: Record<string, number> = {};
  for (const [platform, count] of Object.entries(rawMonthlyPosts)) {
    const normalized = normalizeCalendarPlatformName(platform || fallbackPlatform);
    const value = Number(count) || 0;
    if (value > 0) out[normalized] = value;
  }
  if (Object.keys(out).length > 0) return out;
  return { [fallbackPlatform]: 16 };
}

function normalizeCalendarPlatformName(value: string): string {
  const raw = value.trim().toLowerCase();
  if (raw === "x" || raw.includes("twitter")) return "X";
  if (raw.includes("linkedin")) return "LinkedIn";
  if (raw.includes("pinterest")) return "Pinterest";
  if (raw.includes("youtube")) return "YouTube";
  if (raw.includes("instagram")) return "Instagram";
  return value.trim() || "Instagram";
}

function expandPlatformAssignments(platformSplit: Record<string, number>): string[] {
  return Object.entries(platformSplit).flatMap(([platform, count]) =>
    Array.from({ length: Math.max(0, count) }, () => platform),
  );
}

function normalizeImportedFormatForPlatform(format: string, platform: string): string {
  const lower = format.toLowerCase();
  if (platform === "Instagram") {
    if (lower.includes("story")) return "Stories";
    if (lower.includes("carousel")) return "Carousel";
    if (lower.includes("static")) return "Static";
    return "Reel";
  }
  if (platform === "LinkedIn") {
    if (lower.includes("carousel")) return "Carousel";
    if (lower.includes("video")) return "Short video";
    return "Text post";
  }
  if (platform === "X") {
    if (lower.includes("carousel") || lower.includes("thread")) return "Thread";
    if (lower.includes("static")) return "Image post";
    return "Text post";
  }
  if (platform === "Pinterest") {
    if (lower.includes("video") || lower.includes("reel")) return "Video pin";
    return "Static pin";
  }
  if (platform === "YouTube") {
    if (lower.includes("static")) return "Community post";
    if (lower.includes("carousel")) return "Community post";
    return "Short video";
  }
  return format;
}

function defaultImportedCtaForPlatform(platform: string, fallbackCta: string): string {
  if (platform === "Instagram") return fallbackCta;
  if (platform === "LinkedIn") return "Comment with your takeaway and follow for the next part.";
  if (platform === "X") return "Reply with your take and repost if it resonates.";
  if (platform === "Pinterest") return "Save this pin for later and click through for the full guide.";
  if (platform === "YouTube") return "Comment with your question and subscribe for the next breakdown.";
  return fallbackCta;
}

function enrichPostForExecution<T extends { format: string; platform: string; hook: string; cta: string; pillar: string; strategicIntent?: string; expectedReason?: string; execution?: Record<string, unknown> | null; caption?: string | null; hashtags?: string[] | null; priority?: string }>(
  post: T,
): T {
  const detail = buildPostDetailPayload({
    format: post.format,
    platform: post.platform,
    pillar: post.pillar,
    objective: (post as { objective?: string }).objective ?? "",
    hook: post.hook,
    cta: post.cta,
    strategicIntent: post.strategicIntent ?? "",
    expectedReason: post.expectedReason ?? "",
    priority: post.priority ?? "medium",
    caption: post.caption ?? null,
    hashtags: post.hashtags ?? null,
    execution: post.execution ?? null,
  });
  return {
    ...post,
    caption: detail.caption,
    hashtags: detail.hashtags,
    execution: detail.execution,
  };
}

function getStrategySourceFromStructured(
  structured: Record<string, unknown> | null | undefined,
): string {
  return String(
    ((structured?.__meta as Record<string, unknown> | undefined)?.strategySource ?? "unknown"),
  ).trim();
}

function getPlannerSourceFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string {
  return String(metadata?.calendarSource ?? "unknown").trim();
}

function hashDeterministicSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function normalizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildPostSignature(input: {
  pillar: string;
  goal: string;
  format: string;
  hookStyle: string;
  funnelStage: string;
  hook: string;
}): string {
  return [
    normalizeKey(input.pillar),
    normalizeKey(input.goal).slice(0, 60),
    normalizeKey(input.format),
    normalizeKey(input.hookStyle),
    normalizeKey(input.funnelStage),
    normalizeKey(input.hook).slice(0, 80),
  ].join("|");
}

function prettifyHookStyle(style: string): string {
  return style
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function prettifyFunnelStage(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function buildDeterministicHook(input: {
  hookStyle: "curiosity" | "contrarian" | "how_to" | "myth_vs_fact" | "proof_led";
  pillar: string;
  goal: string;
  funnelStage: "awareness" | "consideration" | "conversion" | "retention";
  index: number;
}): string {
  const goal = input.goal.replace(/[.]+$/g, "").trim();
  switch (input.hookStyle) {
    case "curiosity":
      return `What most brands miss about ${input.pillar} (${prettifyFunnelStage(input.funnelStage)})`;
    case "contrarian":
      return `Stop doing this in ${input.pillar} if you want ${goal.toLowerCase()}`;
    case "how_to":
      return `How to use ${input.pillar} to ${goal.toLowerCase()}`;
    case "myth_vs_fact":
      return `Myth vs fact: ${input.pillar} and ${goal.toLowerCase()}`;
    case "proof_led":
      return `Proof post ${input.index + 1}: ${input.pillar} that supports ${goal.toLowerCase()}`;
    default:
      return `${input.pillar}: ${goal}`;
  }
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCalendarDiagnostics(input: {
  strategySource: string;
  strategyUpdatedAt: string | null;
  plannerSource: string | null;
  plannerCreatedAt: string | null;
}) {
  const strategyIsImported = input.strategySource === "chatgpt_import";
  const strategyUpdatedMs = toEpochMs(input.strategyUpdatedAt);
  const plannerCreatedMs = toEpochMs(input.plannerCreatedAt);
  const plannerMissing = !input.plannerCreatedAt;
  const plannerNotImported = input.plannerSource !== "chatgpt_import";
  const plannerOlderThanStrategy =
    strategyUpdatedMs != null && plannerCreatedMs != null && plannerCreatedMs < strategyUpdatedMs;
  const needsRegeneration =
    strategyIsImported && (plannerMissing || plannerNotImported || plannerOlderThanStrategy);
  const reason = !needsRegeneration
    ? null
    : plannerMissing
      ? "no_planner_for_imported_strategy"
      : plannerNotImported
        ? "planner_source_not_imported"
        : "planner_older_than_imported_strategy";

  return {
    strategySource: input.strategySource || "unknown",
    strategyUpdatedAt: input.strategyUpdatedAt,
    plannerSource: input.plannerSource ?? null,
    plannerCreatedAt: input.plannerCreatedAt,
    needsRegeneration,
    reason,
  };
}
