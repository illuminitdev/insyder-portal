-- White label: a tenant admin's brand colours for one workspace (JSON: { primary, accent, sidebar })
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "branding_json" text;
