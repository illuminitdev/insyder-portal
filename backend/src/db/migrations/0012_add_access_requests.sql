CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "company_name" text NOT NULL,
  "message" text,
  "password_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decision_reason" text,
  "reviewed_by" text,
  "reviewed_at" timestamp with time zone,
  "tenant_id" text,
  "workspace_id" text,
  "role" text,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_requests_pending_email_uidx" ON "access_requests" ("email") WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_requests_status_idx" ON "access_requests" ("status", "created_at");
