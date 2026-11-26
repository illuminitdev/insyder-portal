ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "plan" text DEFAULT 'starter' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_status" text DEFAULT 'unpaid' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;
--> statement-breakpoint
-- Companies that existed before plans keep working: Starter, treated as paid
UPDATE "tenants" SET "billing_status" = 'active' WHERE "billing_status" = 'unpaid';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_stripe_customer_idx" ON "tenants" ("stripe_customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signups" (
  "id" text PRIMARY KEY NOT NULL,
  "plan" text NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "company_name" text NOT NULL,
  "website" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "stripe_session_id" text,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "tenant_id" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signups_email_idx" ON "signups" ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signups_session_uidx" ON "signups" ("stripe_session_id");
