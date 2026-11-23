import { and, eq, inArray, lt, notExists } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts, providerUsage, researchRuns } from "../db/schema/index.js";
import { refundResearchBudget } from "../services/budget.js";

const ACTIVE = ["queued", "running", "retrying"];

/** List builds wait up to 20 minutes per attempt and retry, so they get longer before they count as stuck. */
export const STALE_AFTER_MINUTES = { webset: 180, other: 60 } as const;

export function staleCutoff(mode: string, now = new Date()): Date {
  const minutes = mode === "webset" ? STALE_AFTER_MINUTES.webset : STALE_AFTER_MINUTES.other;
  return new Date(now.getTime() - minutes * 60_000);
}

/**
 * Fails research runs that a worker never finished (the worker was down, restarted, or slept
 * mid-job) and frees their accounts so research can be run again. The budget is refunded only if
 * the provider never charged the run, matching the job handler's own final-failure rule.
 */
export async function failStaleResearchRuns(now = new Date()) {
  const db = getDb();
  const candidates = await db
    .select({ id: researchRuns.id, mode: researchRuns.mode, createdAt: researchRuns.createdAt })
    .from(researchRuns)
    .where(and(inArray(researchRuns.status, ACTIVE), lt(researchRuns.createdAt, staleCutoff("other", now))));

  let failed = 0;
  for (const c of candidates) {
    if (c.createdAt >= staleCutoff(c.mode, now)) continue;
    // Only this sweep moves the run out of an active state, so a worker finishing it at the same moment wins
    const [run] = await db
      .update(researchRuns)
      .set({
        status: "failed",
        errorCode: "worker_timeout",
        errorMessage: "Research did not finish in time. Run it again.",
        completedAt: now,
      })
      .where(and(eq(researchRuns.id, c.id), inArray(researchRuns.status, ACTIVE)))
      .returning();
    if (!run) continue;
    failed++;
    const [charged] = await db
      .select({ id: providerUsage.id })
      .from(providerUsage)
      .where(eq(providerUsage.researchRunId, run.id))
      .limit(1);
    if (!charged) {
      await refundResearchBudget(run.tenantId, run.budgetReserved);
      await db.update(researchRuns).set({ budgetActual: 0 }).where(eq(researchRuns.id, run.id));
    }
  }

  // Any account still marked "researching" with no active run behind it is freed, which also covers
  // accounts a crashed discovery run created mid-way
  const freed = await db
    .update(accounts)
    .set({ researchState: "failed", updatedAt: now })
    .where(
      and(
        eq(accounts.researchState, "researching"),
        lt(accounts.updatedAt, staleCutoff("other", now)),
        notExists(
          db
            .select({ id: researchRuns.id })
            .from(researchRuns)
            .where(and(eq(researchRuns.accountId, accounts.id), inArray(researchRuns.status, ACTIVE))),
        ),
      ),
    )
    .returning({ id: accounts.id });

  return { runsFailed: failed, accountsFreed: freed.length };
}
