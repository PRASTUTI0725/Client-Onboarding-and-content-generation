CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"instagram_handle" text,
	"one_line_description" text,
	"sow" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"platform" text,
	"content" text,
	"image_url" text,
	"scheduled_date" date,
	"status" text DEFAULT 'draft',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"raw_input" jsonb NOT NULL,
	"enriched_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"distribution" jsonb NOT NULL,
	"formats" jsonb NOT NULL,
	"platform_split" jsonb,
	"angle_bank" jsonb NOT NULL,
	"hook_styles" jsonb NOT NULL,
	"weekly_flow" jsonb NOT NULL,
	"pillars" jsonb NOT NULL,
	"kpis" jsonb,
	"phases" jsonb,
	"month" text,
	"goal" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"planner_id" uuid NOT NULL,
	"date" date NOT NULL,
	"platform" text NOT NULL,
	"pillar" text NOT NULL,
	"angle" text NOT NULL,
	"format" text NOT NULL,
	"objective" text NOT NULL,
	"hook" text NOT NULL,
	"caption" text,
	"hashtags" jsonb,
	"cta" text NOT NULL,
	"strategic_intent" text,
	"expected_metric" text,
	"expected_reason" text,
	"priority" text,
	"execution" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"structured_strategy" jsonb NOT NULL,
	"strategy_document" text NOT NULL,
	"template_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_calendar" ADD CONSTRAINT "content_calendar_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_profiles" ADD CONSTRAINT "onboarding_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planners" ADD CONSTRAINT "planners_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_planner_id_planners_id_fk" FOREIGN KEY ("planner_id") REFERENCES "public"."planners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;