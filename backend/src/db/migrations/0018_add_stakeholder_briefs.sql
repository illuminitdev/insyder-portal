ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "seller_company" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "offer_items_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stakeholder_briefs" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id"),
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id"),
  "account_id" text NOT NULL REFERENCES "accounts"("id"),
  "contact_id" text NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  "research_run_id" text NOT NULL REFERENCES "research_runs"("id"),
  "meeting_json" text DEFAULT '{}' NOT NULL,
  "content_json" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_briefs_contact_idx" ON "stakeholder_briefs" ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stakeholder_briefs_run_idx" ON "stakeholder_briefs" ("research_run_id");
