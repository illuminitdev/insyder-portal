CREATE TABLE IF NOT EXISTS "demo_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "company" text,
  "role" text,
  "website" text,
  "message" text,
  "status" text DEFAULT 'new' NOT NULL,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_requests_status_idx" ON "demo_requests" ("status", "created_at");
