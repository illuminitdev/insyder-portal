import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema/index.js";
import { isSharedPlatformDomain } from "../utils/normalize.js";
import { findSiteLogo } from "./siteLogo.js";

/**
 * Account logos: the logo address found on each account's website (`accounts.logo_url`), looked up
 * in the background so lists never wait for it. An account is looked up when its domain has not
 * been checked yet (new, imported, or domain changed); when nothing was found it is tried again
 * after RETRY_DAYS. Runs inside the API process, started by a request that reads accounts, so it
 * never wakes the database on its own. One run per workspace at a time.
 */
const RETRY_DAYS = 30;
const BATCH = 20;
const CONCURRENCY = 5;
/** Most accounts one run looks up; the next page load continues */
const MAX_PER_RUN = 200;

const running = new Set<string>();

type LogoFields = { domain: string | null; logoUrl: string | null; logoDomain: string | null; logoCheckedAt: Date | null };

/** True when this account's logo should be looked up (again) */
export function needsLogoCheck(a: LogoFields): boolean {
  if (!a.domain || isSharedPlatformDomain(a.domain)) return false;
  if (a.logoDomain !== a.domain) return true;
  if (a.logoUrl) return false;
  return !a.logoCheckedAt || Date.now() - a.logoCheckedAt.getTime() > RETRY_DAYS * 86_400_000;
}

/** The logo to show: only one found for the account's current domain */
export function visibleLogo(a: LogoFields): string | null {
  return a.domain && a.logoDomain === a.domain ? a.logoUrl : null;
}

function dueWhere(workspaceId: string) {
  const retryBefore = new Date(Date.now() - RETRY_DAYS * 86_400_000);
  return and(
    eq(accounts.workspaceId, workspaceId),
    isNull(accounts.deletedAt),
    isNotNull(accounts.domain),
    or(
      sql`${accounts.logoDomain} is distinct from ${accounts.domain}`,
      and(isNull(accounts.logoUrl), or(isNull(accounts.logoCheckedAt), lt(accounts.logoCheckedAt, retryBefore))),
    ),
  );
}

async function runWorkspace(workspaceId: string) {
  const db = getDb();
  let done = 0;
  const skip = new Set<string>();
  while (done < MAX_PER_RUN) {
    const rows = (
      await db
        .select({ id: accounts.id, domain: accounts.domain })
        .from(accounts)
        .where(dueWhere(workspaceId))
        .limit(BATCH + skip.size)
    ).filter((r) => !skip.has(r.id));
    if (!rows.length) return;

    const queue = rows.slice(0, BATCH);
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          const domain = r.domain!;
          const logoUrl = isSharedPlatformDomain(domain) ? null : await findSiteLogo(`https://${domain}`);
          // Only if the domain didn't change meanwhile
          const updated = await db
            .update(accounts)
            .set({ logoUrl, logoDomain: domain, logoCheckedAt: new Date() })
            .where(and(eq(accounts.id, r.id), eq(accounts.domain, domain)))
            .returning({ id: accounts.id });
          if (!updated.length) skip.add(r.id);
          done++;
        }
      }),
    );
  }
}

/** Start looking up missing logos for a workspace in the background (no-op if already running). Never throws. */
export function kickAccountLogos(workspaceId: string): void {
  if (running.has(workspaceId)) return;
  running.add(workspaceId);
  void runWorkspace(workspaceId)
    .catch((e) => console.warn("[accountLogos] lookup failed", workspaceId, e instanceof Error ? e.message : e))
    .finally(() => running.delete(workspaceId));
}
