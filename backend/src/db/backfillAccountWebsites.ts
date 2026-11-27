/**
 * One-off: find the company's own website for live accounts that have none (all workspaces).
 * Dry run by default; pass --apply to save. Accounts whose "name" is a tender or job-ad title are
 * listed, not changed (delete them in the app if they aren't real companies).
 *   npx tsx src/db/backfillAccountWebsites.ts [--apply]
 */
import "../dns-fallback.js";
import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./client.js";
import { accountIdentities, accounts } from "./schema/index.js";
import { findCompanyDomain, looksLikeNotACompany } from "../services/companyWebsite.js";
import { newId } from "../utils/ids.js";

const apply = process.argv.includes("--apply");
const db = getDb();

const rows = await db
  .select({ id: accounts.id, tenantId: accounts.tenantId, workspaceId: accounts.workspaceId, name: accounts.name, country: accounts.country })
  .from(accounts)
  .where(and(isNull(accounts.domain), isNull(accounts.deletedAt), isNull(accounts.mergedIntoId)));

console.log(`${rows.length} accounts without a website${apply ? "" : " (dry run, nothing saved)"}`);
for (const a of rows) {
  if (looksLikeNotACompany(a.name)) {
    console.log(`  NOT A COMPANY  ${a.name.slice(0, 80)}…`);
    continue;
  }
  const domain = await findCompanyDomain(a.name, a.country);
  if (!domain) {
    console.log(`  not found      ${a.name}`);
    continue;
  }
  const [taken] = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, a.workspaceId), eq(accounts.domain, domain), isNull(accounts.mergedIntoId)))
    .limit(1);
  if (taken) {
    console.log(`  in use         ${a.name} → ${domain} (already on "${taken.name}")`);
    continue;
  }
  console.log(`  found          ${a.name} → ${domain}`);
  if (apply) {
    await db.update(accounts).set({ domain }).where(and(eq(accounts.id, a.id), isNull(accounts.domain)));
    await db
      .insert(accountIdentities)
      .values({ id: newId("aid"), tenantId: a.tenantId, workspaceId: a.workspaceId, accountId: a.id, kind: "domain", value: domain })
      .onConflictDoNothing();
  }
}
