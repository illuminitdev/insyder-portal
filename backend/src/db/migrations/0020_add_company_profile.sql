ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "company_profile_json" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "profile_run_id" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "profile_status" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "profile_error" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "profile_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "profile_updated_at" timestamp with time zone;
