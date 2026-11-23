import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { providerUsage, researchRuns, stakeholderBriefs } from "../../db/schema/index.js";
import { getResearchProvider } from "../../providers/research/index.js";
import { NormalizedProviderError, type StakeholderBriefContent } from "../../providers/research/types.js";
import { refundResearchBudget } from "../../services/budget.js";
import { buildBriefInput } from "../../services/stakeholderBriefs.js";
import { newId } from "../../utils/ids.js";
import { redactString } from "../../utils/redact.js";

type Run = typeof researchRuns.$inferSelect;

/** How long one job attempt waits for the agent; a retry resumes waiting on the same agent run. */
const WAIT_PER_ATTEMPT_MS = 9 * 60_000;
const POLL_MS = 6_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Writes one stakeholder brief with an Exa Agent run. The agent run id is stored the moment it
 * starts, so a retry (worker restart, timeout) keeps waiting on the same run and Exa is never
 * paid twice. There is no fallback: a failed brief is reported and can be generated again.
 */
export async function handleStakeholderBriefRun(run: Run, attempt: { retryCount: number; retryLimit: number }) {
  const db = getDb();
  const [brief] = await db
    .select({ id: stakeholderBriefs.id })
    .from(stakeholderBriefs)
    .where(eq(stakeholderBriefs.researchRunId, run.id))
    .limit(1);
  const built = brief ? await buildBriefInput(brief.id) : null;
  if (!brief || !built) {
    await fail(run, "provider_bad_request", "The contact or account no longer exists");
    return;
  }

  let content: StakeholderBriefContent | null;
  try {
    content = await runAgent(run, built);
  } catch (err) {
    const n =
      err instanceof NormalizedProviderError
        ? err
        : new NormalizedProviderError("provider_error", err instanceof Error ? err.message : "Brief failed", true);
    if (n.retryable && attempt.retryCount < attempt.retryLimit) {
      await db
        .update(researchRuns)
        .set({ status: "retrying", errorCode: n.code, errorMessage: redactString(n.message).slice(0, 500) })
        .where(eq(researchRuns.id, run.id));
      throw err;
    }
    await fail(run, n.code, n.message);
    return;
  }

  if (!content) {
    await fail(run, "no_results", "Not enough public information was found to write a brief. Add what you know and try again.");
    return;
  }

  const now = new Date();
  await db.update(stakeholderBriefs).set({ contentJson: JSON.stringify(content), completedAt: now }).where(eq(stakeholderBriefs.id, brief.id));
  await db
    .update(researchRuns)
    .set({
      status: "completed",
      progressPct: 100,
      completedAt: now,
      resultJson: JSON.stringify({ stage: "done", briefId: brief.id, sources: content.sources.length }),
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(researchRuns.id, run.id));
}

async function runAgent(run: Run, built: NonNullable<Awaited<ReturnType<typeof buildBriefInput>>>) {
  const db = getDb();
  const provider = getResearchProvider();
  if (!provider.startBriefAgent || !provider.getBriefAgent) {
    throw new NormalizedProviderError("provider_plan", "This research provider cannot write stakeholder briefs", false);
  }

  let agentRunId = run.providerRunId;
  if (!agentRunId) {
    ({ runId: agentRunId } = await provider.startBriefAgent(built.input));
    // Saved before waiting: from here on a retry resumes this run instead of starting (and paying for) another
    await db.update(researchRuns).set({ providerRunId: agentRunId, progressPct: 20 }).where(eq(researchRuns.id, run.id));
    await chargeOnce(run, agentRunId);
  }

  const deadline = Date.now() + WAIT_PER_ATTEMPT_MS;
  let pct = 20;
  while (Date.now() < deadline) {
    const r = await provider.getBriefAgent(agentRunId, built.offerNames);
    if (r.status === "completed") return r.brief;
    if (r.status === "failed") throw new NormalizedProviderError("provider_error", r.message, false);
    pct = Math.min(92, pct + 3);
    await db.update(researchRuns).set({ progressPct: pct }).where(eq(researchRuns.id, run.id));
    await sleep(POLL_MS);
  }
  throw new NormalizedProviderError("provider_timeout", "The brief is still being written", true);
}

/** The run's research units, recorded once however many attempts it takes. */
async function chargeOnce(run: Run, requestRef: string) {
  const db = getDb();
  const [prior] = await db.select({ id: providerUsage.id }).from(providerUsage).where(eq(providerUsage.researchRunId, run.id)).limit(1);
  if (prior) return;
  await db.insert(providerUsage).values({
    id: newId("pug"),
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    researchRunId: run.id,
    provider: getResearchProvider().name,
    requestRef,
    units: run.budgetReserved,
  });
  await db.update(researchRuns).set({ budgetActual: run.budgetReserved }).where(eq(researchRuns.id, run.id));
}

/** Final failure. Units are refunded only if the provider was never paid (same rule as stale runs). */
async function fail(run: Run, code: string, message: string) {
  const db = getDb();
  const [charged] = await db.select({ id: providerUsage.id }).from(providerUsage).where(eq(providerUsage.researchRunId, run.id)).limit(1);
  if (!charged) await refundResearchBudget(run.tenantId, run.budgetReserved);
  await db
    .update(researchRuns)
    .set({
      status: "failed",
      progressPct: 100,
      completedAt: new Date(),
      errorCode: code,
      errorMessage: redactString(message).slice(0, 500),
      ...(charged ? {} : { budgetActual: 0 }),
    })
    .where(eq(researchRuns.id, run.id));
}
