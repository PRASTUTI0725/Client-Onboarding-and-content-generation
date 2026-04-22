import { pgTable, text, timestamp, jsonb, integer, uuid, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  website: text("website"),
  instagramHandle: text("instagram_handle"),
  oneLineDescription: text("one_line_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const onboardingProfilesTable = pgTable("onboarding_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  rawInput: jsonb("raw_input").notNull(),
  enrichedData: jsonb("enriched_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const strategiesTable = pgTable("strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  structuredStrategy: jsonb("structured_strategy").notNull(),
  strategyDocument: text("strategy_document").notNull(),
  templateType: text("template_type").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const plannersTable = pgTable("planners", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  distribution: jsonb("distribution").notNull(),
  formats: jsonb("formats").notNull(),
  angleBank: jsonb("angle_bank").notNull(),
  hookStyles: jsonb("hook_styles").notNull(),
  weeklyFlow: jsonb("weekly_flow").notNull(),
  pillars: jsonb("pillars").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const postsTable = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  plannerId: uuid("planner_id").notNull().references(() => plannersTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  platform: text("platform").notNull(),
  pillar: text("pillar").notNull(),
  angle: text("angle").notNull(),
  format: text("format").notNull(),
  objective: text("objective").notNull(),
  hook: text("hook").notNull(),
  caption: text("caption"),
  hashtags: jsonb("hashtags"),
  cta: text("cta").notNull(),
  status: text("status").notNull().default("draft"),
  comments: jsonb("comments").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export type OnboardingProfile = typeof onboardingProfilesTable.$inferSelect;
export type Strategy = typeof strategiesTable.$inferSelect;
export type Planner = typeof plannersTable.$inferSelect;
export type Post = typeof postsTable.$inferSelect;
