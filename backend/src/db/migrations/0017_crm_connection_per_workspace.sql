ALTER TABLE "crm_connections" ADD COLUMN IF NOT EXISTS "workspace_id" text REFERENCES "workspaces"("id");--> statement-breakpoint
-- An existing company-wide connection now belongs to the workspace it was connected from (its latest
-- "crm.connected" audit event), else the company's oldest live workspace. Other workspaces start unconnected.
UPDATE "crm_connections" c SET "workspace_id" = COALESCE(
  (SELECT a."workspace_id" FROM "audit_events" a
     JOIN "workspaces" w ON w."id" = a."workspace_id" AND w."deleted_at" IS NULL
    WHERE a."tenant_id" = c."tenant_id" AND a."action" = 'crm.connected'
    ORDER BY a."created_at" DESC LIMIT 1),
  (SELECT w."id" FROM "workspaces" w
    WHERE w."tenant_id" = c."tenant_id" AND w."deleted_at" IS NULL
    ORDER BY w."created_at" ASC LIMIT 1)
) WHERE c."workspace_id" IS NULL;--> statement-breakpoint
DELETE FROM "crm_connections" WHERE "workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "crm_connections" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "crm_connections_tenant_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_connections_workspace_uidx" ON "crm_connections" ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_connections_tenant_idx" ON "crm_connections" ("tenant_id");
