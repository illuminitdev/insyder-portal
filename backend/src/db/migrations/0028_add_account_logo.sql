ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "logo_domain" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "logo_checked_at" timestamp with time zone;
