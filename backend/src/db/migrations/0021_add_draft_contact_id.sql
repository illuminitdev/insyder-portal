ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "contact_id" text REFERENCES "contacts"("id") ON DELETE SET NULL;

