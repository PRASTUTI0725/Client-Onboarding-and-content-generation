import { Router, type IRouter } from "express";
import {
  db,
  clientsTable,
  onboardingProfilesTable,
  strategiesTable,
  plannersTable,
  postsTable,
} from "@workspace/db";
import { eq, desc, asc } from "drizzle-orm";
import { GenerateCalendarBody, UpdatePostBody } from "@workspace/api-zod";
import { generateMonthlyPlan, type SowInput } from "../lib/planner/generate.js";

const router: IRouter = Router();

router.get("/clients/:clientId/calendar", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  const [planner] = await db
    .select()
    .from(plannersTable)
    .where(eq(plannersTable.clientId, clientId))
    .orderBy(desc(plannersTable.createdAt))
    .limit(1);

  if (!planner) {
    res.json({ planner: null, posts: [] });
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
  });
});

router.post("/clients/:clientId/calendar/generate", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = GenerateCalendarBody.parse(req.body ?? {});

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if (!client.sow) {
    res.status(400).json({ error: "Set the SOW (Statement of Work) before generating the calendar." });
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
  const [profile] = await db
    .select()
    .from(onboardingProfilesTable)
    .where(eq(onboardingProfilesTable.clientId, clientId))
    .orderBy(desc(onboardingProfilesTable.createdAt))
    .limit(1);

  const enriched = (profile?.enrichedData ?? {}) as Record<string, unknown>;
  const structured = strategy.structuredStrategy as Record<string, unknown>;
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

  try {
    const { planner, posts } = await generateMonthlyPlan(client.name, enriched, structured, sow, {
      month: monthLabel,
      startDate,
      goal: body.goal ?? "",
      notes: body.notes ?? "",
    });

    if (posts.length === 0) {
      res.status(500).json({ error: "Generation returned no posts." });
      return;
    }

    // Replace any prior planner/posts for this client.
    await db.delete(plannersTable).where(eq(plannersTable.clientId, clientId));

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
        month: monthLabel,
        goal: body.goal ?? null,
        notes: body.notes ?? null,
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
          status: "draft",
        })),
      )
      .returning();

    res.json({
      planner: serializePlanner(savedPlanner),
      posts: inserted.map(serializePost),
    });
  } catch (err) {
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
    month: p.month,
    goal: p.goal,
    notes: p.notes,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
  };
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
    status: p.status,
    comments: p.comments ?? [],
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
  };
}

export default router;
