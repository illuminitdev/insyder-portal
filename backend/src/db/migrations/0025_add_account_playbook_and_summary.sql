ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "company_summary" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "playbook_template_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_playbook_idx" ON "accounts" ("workspace_id", "playbook_template_key");
