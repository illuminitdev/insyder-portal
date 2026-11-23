ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "why_now_text" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "why_now_citations_json" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "why_now_at" timestamp with time zone;
