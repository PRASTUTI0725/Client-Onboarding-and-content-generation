import { Router, type IRouter } from "express";
import { db, clientsTable, onboardingProfilesTable, strategiesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  CreateClientBody,
  GenerateStrategyBody,
  UpdateStrategyBody,
} from "@workspace/api-zod";
import { enrich } from "../lib/strategy/enrich.js";
import {
  generateStructuredStrategy,
  generateStrategyDocument,
} from "../lib/strategy/generate.js";
import { selectTemplate, type TemplateType } from "../lib/strategy/templates.js";

const router: IRouter = Router();

router.get("/clients", async (_req, res) => {
  const rows = await db.execute<{
    id: string;
    name: string;
    website: string | null;
    instagram_handle: string | null;
    one_line_description: string | null;
    created_at: Date;
    template_type: string | null;
    status: string | null;
  }>(sql`
    select c.id, c.name, c.website, c.instagram_handle, c.one_line_description, c.created_at,
      s.template_type, s.status
    from clients c
    left join lateral (
      select template_type, status
      from strategies
      where client_id = c.id
      order by version desc
      limit 1
    ) s on true
    order by c.created_at desc
  `);

  const items = rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    website: r.website,
    instagramHandle: r.instagram_handle,
    oneLineDescription: r.one_line_description,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    hasStrategy: r.template_type !== null,
    templateType: r.template_type,
    status: r.status,
  }));
  res.json(items);
});

router.post("/clients", async (req, res) => {
  const body = CreateClientBody.parse(req.body);

  const [client] = await db
    .insert(clientsTable)
    .values({
      name: body.name,
      website: body.websiteUrl,
      instagramHandle: body.instagramHandle,
      oneLineDescription: body.oneLineDescription,
    })
    .returning();

  if (!client) {
    res.status(500).json({ error: "Failed to create client" });
    return;
  }

  await db.insert(onboardingProfilesTable).values({
    clientId: client.id,
    rawInput: {
      name: body.name,
      websiteUrl: body.websiteUrl,
      instagramHandle: body.instagramHandle,
      oneLineDescription: body.oneLineDescription,
    },
  });

  res.status(201).json(serializeClient(client));
});

router.get("/clients/:clientId", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const [onboarding] = await db
    .select()
    .from(onboardingProfilesTable)
    .where(eq(onboardingProfilesTable.clientId, clientId))
    .orderBy(desc(onboardingProfilesTable.createdAt))
    .limit(1);

  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.clientId, clientId))
    .orderBy(desc(strategiesTable.version))
    .limit(1);

  res.json({
    client: serializeClient(client),
    onboarding: onboarding
      ? {
          id: onboarding.id,
          clientId: onboarding.clientId,
          rawInput: onboarding.rawInput,
          enrichedData: onboarding.enrichedData,
        }
      : null,
    strategy: strategy ? serializeStrategy(strategy) : null,
  });
});

router.delete("/clients/:clientId", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
  res.status(204).send();
});

router.post("/clients/:clientId/strategy/generate", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = GenerateStrategyBody.parse(req.body ?? {});

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const [profile] = await db
    .select()
    .from(onboardingProfilesTable)
    .where(eq(onboardingProfilesTable.clientId, clientId))
    .orderBy(desc(onboardingProfilesTable.createdAt))
    .limit(1);

  if (!profile) {
    res.status(400).json({ error: "No onboarding profile found" });
    return;
  }

  const raw = profile.rawInput as {
    name: string;
    websiteUrl: string;
    instagramHandle: string;
    oneLineDescription: string;
  };

  try {
    const enriched = await enrich(raw);

    await db
      .update(onboardingProfilesTable)
      .set({ enrichedData: enriched, updatedAt: new Date() })
      .where(eq(onboardingProfilesTable.id, profile.id));

    const tpl: TemplateType = selectTemplate(
      enriched as unknown as Record<string, unknown>,
      body.templateType ?? null,
    );

    const structured = await generateStructuredStrategy(raw, enriched, tpl);
    const document = await generateStrategyDocument(raw, enriched, structured, tpl);

    const [existing] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.clientId, clientId))
      .orderBy(desc(strategiesTable.version))
      .limit(1);

    const nextVersion = (existing?.version ?? 0) + 1;

    const [strategy] = await db
      .insert(strategiesTable)
      .values({
        clientId,
        structuredStrategy: structured,
        strategyDocument: document,
        templateType: tpl,
        version: nextVersion,
        status: "draft",
      })
      .returning();

    if (!strategy) {
      res.status(500).json({ error: "Failed to save strategy" });
      return;
    }

    res.json(serializeStrategy(strategy));
  } catch (err) {
    req.log.error({ err }, "Strategy generation failed");
    res.status(500).json({ error: "Strategy generation failed", detail: String(err) });
  }
});

router.patch("/clients/:clientId/strategy", async (req, res) => {
  const { clientId } = req.params;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }
  const body = UpdateStrategyBody.parse(req.body);

  const [existing] = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.clientId, clientId))
    .orderBy(desc(strategiesTable.version))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "No strategy found" });
    return;
  }

  const updates: Partial<typeof strategiesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.strategyDocument !== undefined) updates.strategyDocument = body.strategyDocument;
  if (body.structuredStrategy !== undefined)
    updates.structuredStrategy = body.structuredStrategy as Record<string, unknown>;
  if (body.status !== undefined) updates.status = body.status;

  const [updated] = await db
    .update(strategiesTable)
    .set(updates)
    .where(eq(strategiesTable.id, existing.id))
    .returning();

  if (!updated) {
    res.status(500).json({ error: "Failed to update strategy" });
    return;
  }

  res.json(serializeStrategy(updated));
});

function serializeClient(c: typeof clientsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    instagramHandle: c.instagramHandle,
    oneLineDescription: c.oneLineDescription,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  };
}

function serializeStrategy(s: typeof strategiesTable.$inferSelect) {
  return {
    id: s.id,
    clientId: s.clientId,
    structuredStrategy: s.structuredStrategy,
    strategyDocument: s.strategyDocument,
    templateType: s.templateType,
    version: s.version,
    status: s.status,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : String(s.updatedAt),
  };
}

export default router;
