import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { researchRuns } from "../db/schema/index.js";
import { enqueueResearchRun } from "../jobs/queue.js";
import { getResearchProvider } from "../providers/research/index.js";
import { newId } from "../utils/ids.js";
import { refundResearchBudget, reserveResearchBudget } from "./budget.js";

/** A research run in this mode finds an account's decision makers (Exa Agent), not signals. */
export const CONTACTS_MODE = "contacts";
/** One research unit per company searched */
export const CONTACTS_RUN_UNITS = 1;
/** After research, contacts are looked up again only if the last lookup is older than this */
export const AUTO_CONTACTS_EVERY_DAYS = 30;

const ACTIVE = ["queued", "running", "retrying"];

export function contactsAgentAvailable() {
  try {
    const p = getResearchProvider();
    return Boolean(p.startContactsAgent && p.getContactsAgent);
  } catch {
    return false;
  }
}

/** The contacts run already in progress for this account, if any. */
export async function activeContactsRun(workspaceId: string, accountId: string) {
  const db = getDb();
  const [run] = await db
    .select({ id: researchRuns.id, status: researchRuns.status })
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.workspaceId, workspaceId),
        eq(researchRuns.accountId, accountId),
        eq(researchRuns.mode, CONTACTS_MODE),
        inArray(researchRuns.status, ACTIVE),
      ),
    )
    .limit(1);
  return run ?? null;
}

/**
 * Queue a contact search for one account. Reserves one research unit (throws when the
 * monthly quota is used up) and reuses a search that is already running.
 */
export async function createContactsRun(input: {
  tenantId: string;
  workspaceId: string;
  accountId: string;
  accountName: string;
  createdBy: string;
}): Promise<{ researchRunId: string; reused: boolean }> {
  const running = await activeContactsRun(input.workspaceId, input.accountId);
  if (running) return { researchRunId: running.id, reused: true };

  await reserveResearchBudget(input.tenantId, CONTACTS_RUN_UNITS);
  const id = newId("rr");
  const db = getDb();
  try {
    await db.insert(researchRuns).values({
      id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      accountId: input.accountId,
      mode: CONTACTS_MODE,
      query: `Decision makers at ${input.accountName}`.slice(0, 1000),
      budgetReserved: CONTACTS_RUN_UNITS,
      createdBy: input.createdBy,
      status: "queued",
    });
    await enqueueResearchRun(id);
  } catch (err) {
    await refundResearchBudget(input.tenantId, CONTACTS_RUN_UNITS);
    throw err;
  }
  return { researchRunId: id, reused: false };
}

/**
 * After account research: look for decision makers too, unless contacts were already looked up
 * recently. Never fails the research run (no quota left, provider without agent runs: skipped).
 */
export async function autoQueueContactsRun(run: {
  tenantId: string;
  workspaceId: string;
  accountId: string;
  accountName: string;
  createdBy: string;
}) {
  if (!contactsAgentAvailable()) return null;
  try {
    const db = getDb();
    const since = new Date(Date.now() - AUTO_CONTACTS_EVERY_DAYS * 86400000);
    const [recent] = await db
      .select({ id: researchRuns.id })
      .from(researchRuns)
      .where(
        and(
          eq(researchRuns.workspaceId, run.workspaceId),
          eq(researchRuns.accountId, run.accountId),
          eq(researchRuns.mode, CONTACTS_MODE),
          inArray(researchRuns.status, [...ACTIVE, "completed"]),
          gt(researchRuns.createdAt, since),
        ),
      )
      .limit(1);
    if (recent) return null;
    return await createContactsRun(run);
  } catch (err) {
    console.error("[contacts] could not queue contact search:", err instanceof Error ? err.message : err);
    return null;
  }
}
