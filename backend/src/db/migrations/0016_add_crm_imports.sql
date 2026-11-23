ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "filter_json" text;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "summary_json" text;
