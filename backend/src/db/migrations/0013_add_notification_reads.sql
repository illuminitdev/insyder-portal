CREATE TABLE IF NOT EXISTS "notification_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"seen_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_user_key_uidx" ON "notification_reads" USING btree ("workspace_id","user_id","key");
