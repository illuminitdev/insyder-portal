import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { accounts, evidence, providerUsage, researchRuns, sources } from "../../db/schema/index.js";
import { getResearchProvider } from "../../providers/research/index.js";
import { CONTACTS_AGENT } from "../../providers/research/exaAgent.js";
import { NormalizedProviderError, type LeadContact } from "../../providers/research/types.js";
import { activeSuppressionSet } from "../../services/suppressions.js";
import { newId } from "../../utils/ids.js";
import { canonicalizeUrl } from "../../utils/normalize.js";
import { redactString } from "../../utils/redact.js";
import { saveLeadContact } from "./researchRun.js";

type Run = typeof researchRuns.$inferSelect;
type Found = { contacts: LeadContact[]; source: "agent" | "search"; costDollars: number | null; fallbackReason?: string };

/** How long one job attempt waits for the agent; a retry resumes waiting on the same agent run. */
const WAIT_PER_ATTEMPT_MS = 8 * 60_000;
const POLL_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Contact search for one account: an Exa Agent run finds decision makers with work emails.
 * The agent run id is stored the moment it starts, so a retry (worker restart, timeout) keeps
 * waiting on the same run and Exa is never paid twice. If the agent fails, the older public
 * people search is used so the account still gets names.
 */
export async function handleContactsRun(run: Run, attempt: { retryCount: number; retryLimit: number }) {
  const db = getDb();
  const [account] = run.accountId
    ? await db.select().from(accounts).where(eq(accounts.id, run.accountId)).limit(1)
    : [];
  if (!account) {
    await finish(run, "failed", { errorCode: "provider_bad_request", errorMessage: "The account no longer exists" });
    return;
  }
  const company = { name: account.name, domain: account.domain };

  let found: Found;
  try {
    found = await runAgent(run, company);
  } catch (err) {
    const n =
      err instanceof NormalizedProviderError
        ? err
        : new NormalizedProviderError("provider_error", err instanceof Error ? err.message : "Contact search failed", true);
    if (n.retryable && attempt.retryCount < attempt.retryLimit) {
      await db
        .update(researchRuns)
        .set({ status: "retrying", errorCode: n.code, errorMessage: redactString(n.message).slice(0, 500) })
        .where(eq(researchRuns.id, run.id));
      throw err;
    }
    found = await fallbackSearch(company, n.message);
  }

  await chargeOnce(run);

  // Opted-out people are never stored
  const suppressed = await activeSuppressionSet(run.workspaceId);
  // Same limit for both searches (the web people search can return up to 8): at most 2 people per search
  const people = found.contacts
    .filter((c) => !(c.email && suppressed.has(c.email.toLowerCase())))
    .slice(0, CONTACTS_AGENT.maxPeople);
  const foundBy = found.source === "agent" ? "Exa Agent contact search" : "web people search";
  let created = 0;
  let updated = 0;
  for (const c of people) {
    const evidenceId = await contactSourceEvidence(run, account.id, c);
    const r = await saveLeadContact(run, account.id, c, { evidenceId: evidenceId ?? undefined, foundBy });
    if (r === "created") created++;
    if (r === "updated") updated++;
  }

  // Role hypotheses are on demand only: the user runs them from the contact card
  await finish(run, "completed", {
    result: {
      stage: "done",
      source: found.source,
      peopleFound: people.length,
      contactsCreated: created,
      contactsUpdated: updated,
      emailsFound: people.filter((c) => c.email && !c.emailIsGeneral).length,
      costDollars: found.costDollars,
      fallbackReason: found.fallbackReason ?? null,
      noResults: people.length === 0,
    },
  });

}

async function runAgent(run: Run, company: { name: string; domain: string | null }): Promise<Found> {
  const db = getDb();
  const provider = getResearchProvider();
  if (!provider.startContactsAgent || !provider.getContactsAgent) {
    throw new NormalizedProviderError("provider_plan", "This research provider has no agent contact search", false);
  }

  let agentRunId = run.providerRunId;
  if (!agentRunId) {
    ({ runId: agentRunId } = await provider.startContactsAgent(company));
    // Saved before waiting: from here on a retry resumes this run instead of starting (and paying for) another
    await db.update(researchRuns).set({ providerRunId: agentRunId, progressPct: 30 }).where(eq(researchRuns.id, run.id));
    await chargeOnce(run, agentRunId);
  }

  const deadline = Date.now() + WAIT_PER_ATTEMPT_MS;
  let pct = 30;
  while (Date.now() < deadline) {
    const r = await provider.getContactsAgent(agentRunId);
    if (r.status === "completed") return { contacts: r.contacts, source: "agent", costDollars: r.costDollars };
    if (r.status === "failed") throw new NormalizedProviderError("provider_error", r.message, false);
    pct = Math.min(90, pct + 4);
    await db.update(researchRuns).set({ progressPct: pct }).where(eq(researchRuns.id, run.id));
    await sleep(POLL_MS);
  }
  throw new NormalizedProviderError("provider_timeout", "The contact search is still running", true);
}

async function fallbackSearch(company: { name: string; domain: string | null }, reason: string): Promise<Found> {
  const provider = getResearchProvider();
  try {
    const contacts = provider.findContacts ? await provider.findContacts(company) : [];
    return { contacts, source: "search", costDollars: null, fallbackReason: redactString(reason).slice(0, 300) };
  } catch {
    return { contacts: [], source: "search", costDollars: null, fallbackReason: redactString(reason).slice(0, 300) };
  }
}

/** One research unit per contact search, recorded once however many attempts it takes. */
async function chargeOnce(run: Run, requestRef: string | null = run.providerRunId) {
  const db = getDb();
  const [prior] = await db
    .select({ id: providerUsage.id })
    .from(providerUsage)
    .where(eq(providerUsage.researchRunId, run.id))
    .limit(1);
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

/**
 * Each found person is tied to the page that shows them in the role (spec: a contact needs a
 * source record). Stored as evidence only — no signal — so it never changes the account's score.
 */
async function contactSourceEvidence(run: Run, accountId: string, c: LeadContact): Promise<string | null> {
  const url = c.sourceUrls.find((u) => u !== c.linkedinUrl) ?? c.sourceUrls[0];
  if (!url) return null;
  const db = getDb();
  try {
    const canonicalUrl = canonicalizeUrl(url);
    await db
      .insert(sources)
      .values({ id: newId("src"), tenantId: run.tenantId, workspaceId: run.workspaceId, canonicalUrl, title: `${c.name}${c.title ? `, ${c.title}` : ""}` })
      .onConflictDoNothing();
    const [source] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.workspaceId, run.workspaceId), eq(sources.canonicalUrl, canonicalUrl)))
      .limit(1);
    if (!source) return null;
    const [existing] = await db
      .select({ id: evidence.id })
      .from(evidence)
      .where(and(eq(evidence.accountId, accountId), eq(evidence.sourceId, source.id)))
      .limit(1);
    if (existing) return existing.id;
    const id = newId("ev");
    await db.insert(evidence).values({
      id,
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      accountId,
      sourceId: source.id,
      researchRunId: run.id,
      excerpt: `${c.name}${c.title ? ` — ${c.title}` : ""}`.slice(0, 400),
      matchRationale: "Source showing this person in the role (contact search)",
      providerRequestRef: run.providerRunId,
    });
    return id;
  } catch {
    return null;
  }
}

async function finish(
  run: Run,
  status: "completed" | "failed",
  data: { result?: Record<string, unknown>; errorCode?: string; errorMessage?: string },
) {
  await getDb()
    .update(researchRuns)
    .set({
      status,
      progressPct: 100,
      completedAt: new Date(),
      resultJson: data.result ? JSON.stringify(data.result) : null,
      errorCode: data.errorCode ?? null,
      errorMessage: data.errorMessage ?? null,
    })
    .where(eq(researchRuns.id, run.id));
}
