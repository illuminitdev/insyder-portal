import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import {
  accountIdentities,
  accounts,
  contacts,
  evidence,
  mergeCandidates,
  offers,
  providerUsage,
  researchRuns,
} from "../../db/schema/index.js";
import { getResearchProvider } from "../../providers/research/index.js";
import {
  NormalizedProviderError,
  SEARCH_LIST_PREFIX,
  type LeadContact,
  type NormalizedEvidenceItem,
  type NormalizedDiscovery,
  type ResearchFilters,
  type ResearchMode,
  type WebsetStarted,
} from "../../providers/research/types.js";
import { reconcileUsage, refundResearchBudget } from "../../services/budget.js";
import { autoQueueContactsRun, CONTACTS_MODE } from "../../services/contactsRuns.js";
import { handleContactsRun } from "./contactsRun.js";
import { handleStakeholderBriefRun } from "./stakeholderBriefRun.js";
import { BRIEF_MODE } from "../../services/stakeholderBriefs.js";
import { persistNormalizedEvidence } from "../../services/evidence.js";
import { activeSuppressionSet, isSuppressed } from "../../services/suppressions.js";
import { newId } from "../../utils/ids.js";
import { companyDomain, companyNameKey, normalizeDomain } from "../../utils/normalize.js";
import { redactString } from "../../utils/redact.js";

type FetchedResult = { stage: "fetched"; providerRunId: string; items: NormalizedEvidenceItem[] };
/** Webset runs store the started list before waiting, so a retry resumes it instead of building a second one */
type WebsetStage = { stage: "webset_started" } & WebsetStarted;

/**
 * Research job. Usage is charged exactly once per run: the provider usage row is
 * written immediately after the provider call, and a retry that finds it resumes
 * from the stored results instead of calling the provider again (gate 10).
 */
export async function handleResearchRun(
  payload: { researchRunId: string },
  attempt: { retryCount: number; retryLimit: number } = { retryCount: 0, retryLimit: 0 },
) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, payload.researchRunId))
    .limit(1);
  if (!run) return;
  if (run.status === "completed" || run.status === "cancelled") return;

  const claimed = await db
    .update(researchRuns)
    .set({ status: "running", startedAt: run.startedAt ?? new Date(), progressPct: 10, errorCode: null, errorMessage: null })
    .where(and(eq(researchRuns.id, run.id), inArray(researchRuns.status, ["queued", "retrying", "running"])))
    .returning({ id: researchRuns.id });
  if (!claimed[0]) return;

  const mode = (run.mode as ResearchMode) ?? "account";
  // In "similar" runs the account is only the seed company: its own research state is untouched
  const researchesAccount = mode === "account" && Boolean(run.accountId);

  if (run.accountId) {
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, run.accountId)).limit(1);
    // Deleted while the run was queued: nothing to research
    if (acct?.deletedAt) {
      await refundResearchBudget(run.tenantId, run.budgetReserved);
      await db
        .update(researchRuns)
        .set({ status: "cancelled", errorCode: "account_deleted", errorMessage: "Account was deleted", completedAt: new Date(), budgetActual: 0 })
        .where(eq(researchRuns.id, run.id));
      return;
    }
    if (acct?.domain && (await isSuppressed(run.workspaceId, acct.domain))) {
      await refundResearchBudget(run.tenantId, run.budgetReserved);
      await db
        .update(researchRuns)
        .set({
          status: "cancelled",
          errorCode: "suppressed",
          errorMessage: "Account domain is suppressed",
          completedAt: new Date(),
          budgetActual: 0,
        })
        .where(eq(researchRuns.id, run.id));
      if (researchesAccount) {
        await db
          .update(accounts)
          .set({ researchState: "unresearched", updatedAt: new Date() })
          .where(eq(accounts.id, run.accountId));
      }
      return;
    }
    if (researchesAccount && run.accountId) {
      await db
        .update(accounts)
        .set({ researchState: "researching", updatedAt: new Date() })
        .where(eq(accounts.id, run.accountId));
    }
  }

  // Contact searches (decision makers + emails) have their own flow and never touch research state
  if (run.mode === CONTACTS_MODE) return handleContactsRun(run, attempt);
  // Stakeholder briefs write about one person and also leave research state alone
  if (run.mode === BRIEF_MODE) return handleStakeholderBriefRun(run, attempt);

  try {
    let fetched: FetchedResult;
    const [priorUsage] = await db
      .select()
      .from(providerUsage)
      .where(eq(providerUsage.researchRunId, run.id))
      .limit(1);
    const stored = run.resultJson ? (JSON.parse(run.resultJson) as Partial<FetchedResult> | WebsetStage) : null;

    if (priorUsage && stored?.stage === "fetched") {
      // Retry after a crash: reuse charged results — no second provider call or charge
      fetched = stored as FetchedResult;
    } else if (priorUsage) {
      throw new NormalizedProviderError(
        "provider_error",
        "Provider results were charged but not stored; review manually",
        false,
      );
    } else {
      const provider = getResearchProvider();
      const filters = JSON.parse(run.filtersJson || "{}") as ResearchFilters;
      const [offer] = await db
        .select()
        .from(offers)
        .where(eq(offers.workspaceId, run.workspaceId))
        .limit(1);
      const offerExclusions = offer ? (JSON.parse(offer.exclusionsJson) as string[]) : [];
      const suppressed = await activeSuppressionSet(run.workspaceId);
      filters.excludeDomains = [
        ...new Set([
          ...(filters.excludeDomains ?? []),
          ...offerExclusions.map((e) => normalizeDomain(e)).filter((d): d is string => Boolean(d)),
          ...[...suppressed].filter((v) => !v.includes("@")),
        ]),
      ];

      await db.update(researchRuns).set({ progressPct: 40 }).where(eq(researchRuns.id, run.id));
      let discovery: NormalizedDiscovery;
      if (mode === "webset") {
        // Plans without Websets get the list built from web searches instead
        const searchList = provider.buildListFromSearch
          ? () => provider.buildListFromSearch!(run.query, filters, run.budgetReserved)
          : null;
        const hasWebsets = Boolean(provider.startWebset && provider.collectWebset);
        if (!hasWebsets && !searchList) {
          throw new NormalizedProviderError("provider_bad_request", "This research provider cannot build lists", false);
        }
        let started: WebsetStarted | null = stored?.stage === "webset_started" ? (stored as WebsetStage) : null;
        // A refresh of a list that was built by search searches again
        let useSearch = !hasWebsets || Boolean(filters.websetId?.startsWith(SEARCH_LIST_PREFIX) && searchList);
        if (!started && !useSearch) {
          try {
            started = await provider.startWebset!(run.query, filters, run.budgetReserved);
          } catch (err) {
            if (!(searchList && err instanceof NormalizedProviderError && err.code === "provider_plan")) throw err;
            useSearch = true;
          }
          if (started) {
            await db
              .update(researchRuns)
              .set({
                providerRunId: started.websetId,
                progressPct: 50,
                resultJson: JSON.stringify({ stage: "webset_started", ...started } satisfies WebsetStage),
              })
              .where(eq(researchRuns.id, run.id));
          }
        }
        discovery = started ? await provider.collectWebset!(started, filters) : await searchList!();
      } else {
        discovery = await provider.discover(run.query, filters, run.budgetReserved, mode);
      }
      const usage = await provider.reportUsage(discovery, run.budgetReserved);

      fetched = { stage: "fetched", providerRunId: discovery.providerRunId, items: discovery.items };
      await db.insert(providerUsage).values({
        id: newId("pug"),
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        researchRunId: run.id,
        provider: provider.name,
        requestRef: usage.requestRef,
        units: usage.units,
      });
      await reconcileUsage(run.tenantId, run.budgetReserved, usage.units);
      await db
        .update(researchRuns)
        .set({
          progressPct: 70,
          providerRunId: discovery.providerRunId,
          budgetActual: usage.units,
          resultJson: JSON.stringify(fetched),
        })
        .where(eq(researchRuns.id, run.id));
    }

    let summary: Record<string, unknown>;
    if (mode === "discovery" || mode === "similar" || mode === "webset") {
      summary = await accountsFromSignals(run, fetched.items, mode);
    } else if (run.accountId) {
      const result = await persistNormalizedEvidence({
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        accountId: run.accountId,
        researchRunId: run.id,
        items: fetched.items,
      });
      const [acct] = await db.select().from(accounts).where(eq(accounts.id, run.accountId)).limit(1);
      await db
        .update(accounts)
        .set({
          researchState: "researched",
          // Missing evidence cannot inflate (or erase) a score
          fitScore:
            result.fitScore == null ? (acct?.fitScore ?? null) : Math.max(acct?.fitScore ?? 0, result.fitScore),
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, run.accountId));
      summary = {
        evidenceCreated: result.created,
        duplicatesSkipped: result.duplicates,
        // "Nothing found" is recorded as such — never as a negative fact
        noResults: fetched.items.length === 0,
      };
    } else {
      summary = { noResults: fetched.items.length === 0 };
    }

    await db
      .update(researchRuns)
      .set({
        status: "completed",
        progressPct: 100,
        resultJson: JSON.stringify({ stage: "done", ...summary }),
        completedAt: new Date(),
      })
      .where(eq(researchRuns.id, run.id));

    // A researched target account also gets its decision makers looked up (skipped if done recently)
    if (researchesAccount && run.accountId) {
      const [acct] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, run.accountId)).limit(1);
      if (acct) {
        await autoQueueContactsRun({
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          accountId: run.accountId,
          accountName: acct.name,
          createdBy: run.createdBy,
        });
      }
    }
  } catch (err) {
    const normalized =
      err instanceof NormalizedProviderError
        ? err
        : new NormalizedProviderError("provider_error", err instanceof Error ? err.message : "Research failed", true);
    const willRetry = normalized.retryable && attempt.retryCount < attempt.retryLimit;
    const [charged] = await db
      .select({ id: providerUsage.id })
      .from(providerUsage)
      .where(eq(providerUsage.researchRunId, run.id))
      .limit(1);

    if (willRetry) {
      // Keep the reservation: the retry is the same run and must stay inside the quota
      await db
        .update(researchRuns)
        .set({
          status: "retrying",
          errorCode: normalized.code,
          errorMessage: redactString(normalized.message).slice(0, 500),
        })
        .where(eq(researchRuns.id, run.id));
      throw err;
    }

    // Final failure: refund only if the provider never charged this run
    if (!charged) await refundResearchBudget(run.tenantId, run.budgetReserved);
    await db
      .update(researchRuns)
      .set({
        status: "failed",
        errorCode: normalized.code,
        errorMessage: redactString(normalized.message).slice(0, 500),
        completedAt: new Date(),
        budgetActual: charged ? run.budgetActual : 0,
      })
      .where(eq(researchRuns.id, run.id));
    if (researchesAccount && run.accountId) {
      await db
        .update(accounts)
        .set({ researchState: "failed", updatedAt: new Date() })
        .where(eq(accounts.id, run.accountId));
    }
  }
}

export type DiscoveryRow = {
  accountId: string;
  name: string;
  domain: string | null;
  country: string | null;
  isNew: boolean;
  /** Company identity could not be confirmed (no website, or name-only match) */
  identityNeedsReview: boolean;
  trigger: { title: string | null; summary: string | null; eventDate: string | null; url: string };
  sources: number;
  fitScore: number | null;
  /** People found at this lead from public profiles (research and review only, unverified) */
  contacts?: LeadContact[];
};

/**
 * Discovery: each article is tied to the company it is about (entity matching),
 * grouped per company, and stored as cited evidence on that account, then scored.
 * Uncertain identities are flagged for review rather than guessed (spec §6, R2).
 */
async function accountsFromSignals(
  run: typeof researchRuns.$inferSelect,
  items: NormalizedEvidenceItem[],
  mode: "discovery" | "similar" | "webset" = "discovery",
) {
  const db = getDb();
  const suppressed = await activeSuppressionSet(run.workspaceId);
  const existing = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      domain: accounts.domain,
      country: accounts.country,
      archivedAt: accounts.archivedAt,
      deletedAt: accounts.deletedAt,
    })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, run.workspaceId), eq(accounts.tenantId, run.tenantId), isNull(accounts.mergedIntoId)));
  type Known = { id: string; name: string; domain: string | null; country: string | null; dismissed?: boolean };
  // Archived and deleted accounts are still matched, so a company the team dismissed is not added
  // again; live accounts come last so they win when a live and a dismissed record share a key.
  const known: Known[] = existing
    .map((a) => ({ id: a.id, name: a.name, domain: a.domain, country: a.country, dismissed: Boolean(a.archivedAt || a.deletedAt) }))
    .sort((a, b) => Number(b.dismissed) - Number(a.dismissed));
  const byDomain = new Map<string, Known>(known.filter((a) => a.domain).map((a) => [a.domain!, a]));
  const byName = new Map<string, Known>(known.map((a) => [companyNameKey(a.name), a]));

  type Group = Known & { isNew: boolean; review: boolean; items: NormalizedEvidenceItem[] };
  const groups = new Map<string, Group>();
  let unmatched = 0;
  let skippedSuppressed = 0;
  let skippedDismissed = 0;

  for (const item of items) {
    const name = item.subject?.companyName?.trim() || null;
    const domain = companyDomain(item.subject?.companyWebsite);
    if (!name && !domain) {
      unmatched++;
      continue;
    }
    if (domain && suppressed.has(domain)) {
      skippedSuppressed++;
      continue;
    }

    let target = domain ? byDomain.get(domain) : undefined;
    let review = !domain;
    if (!target && name) {
      const sameName = byName.get(companyNameKey(name));
      // A same-name account with a different website may be a different legal entity
      if (sameName && (!domain || !sameName.domain)) {
        target = sameName;
        review = true;
      }
    }

    if (target?.dismissed) {
      skippedDismissed++;
      continue;
    }

    let isNew = false;
    if (!target) {
      const id = newId("acc");
      const accountName = name ?? domain!;
      await db.insert(accounts).values({
        id,
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        name: accountName,
        domain,
        country: item.country ?? null,
        source: mode === "similar" ? "lookalike" : mode === "webset" ? "list" : "discovery",
        researchState: "researching",
        acceptanceState: "draft",
      });
      if (domain) {
        await db
          .insert(accountIdentities)
          .values({ id: newId("aid"), tenantId: run.tenantId, workspaceId: run.workspaceId, accountId: id, kind: "domain", value: domain })
          .onConflictDoNothing();
      }
      const sameName = name ? byName.get(companyNameKey(name)) : undefined;
      if (sameName) {
        await db.insert(mergeCandidates).values({
          id: newId("mrg"),
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          accountIdA: sameName.id,
          accountIdB: id,
          reason: `Same company name as "${sameName.name}" with ${domain ? `different domain ${domain}` : "no domain"}`,
        });
      }
      target = { id, name: accountName, domain, country: item.country ?? null };
      if (domain) byDomain.set(domain, target);
      if (name && !sameName) byName.set(companyNameKey(name), target);
      isNew = true;
    }

    const g: Group = groups.get(target.id) ?? { ...target, isNew, review: false, items: [] };
    g.review ||= review;
    g.items.push({
      ...item,
      matchRationale:
        mode !== "discovery"
          ? (item.matchRationale ?? "Matched by the research provider")
          : `Article identified ${name ?? domain} as the company${review ? " (identity not confirmed by website — check before relying on it)" : ""}`,
      excerpt: item.excerpt ?? item.subject?.eventSummary ?? undefined,
    });
    groups.set(target.id, g);
  }

  const peopleByAccount = await findLeadContacts([...groups.values()]);
  // People search results first; a list's enrichment contact (email/phone) is kept alongside.
  // Then emails/phones written on each company's own website fill in what's still missing.
  const contactsByAccount = await addSiteContactDetails(
    [...groups.values()].map((g) => ({
      id: g.id,
      name: g.name,
      domain: g.domain,
      contacts: mergeContacts([...(peopleByAccount.get(g.id) ?? []), ...g.items.flatMap((i) => (i.contact ? [i.contact] : []))]),
    })),
  );

  const rows: DiscoveryRow[] = [];
  for (const g of groups.values()) {
    const result = await persistNormalizedEvidence({
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      accountId: g.id,
      researchRunId: run.id,
      items: g.items,
    });
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, g.id)).limit(1);
    const fitScore =
      result.fitScore == null ? (acct?.fitScore ?? null) : Math.max(acct?.fitScore ?? 0, result.fitScore);
    await db
      .update(accounts)
      .set({ researchState: "researched", fitScore, updatedAt: new Date() })
      .where(eq(accounts.id, g.id));
    const latest = [...g.items].sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""))[0]!;
    const contacts = contactsByAccount.get(g.id) ?? [];
    for (const c of contacts) await saveLeadContact(run, g.id, c);
    rows.push({
      accountId: g.id,
      name: g.name,
      domain: g.domain,
      country: g.country,
      isNew: g.isNew,
      identityNeedsReview: g.review,
      trigger: {
        title: latest.title ?? null,
        summary: latest.subject?.eventSummary ?? null,
        eventDate: latest.eventDate ?? null,
        url: latest.canonicalUrl,
      },
      sources: g.items.length,
      fitScore,
      contacts,
    });
  }
  rows.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));

  return {
    rows,
    unmatched,
    skippedSuppressed,
    skippedDismissed,
    noResults: items.length === 0,
  };
}

const PEOPLE_SEARCH_LIMIT = 25;
const PEOPLE_SEARCH_PARALLEL = 5;

/**
 * Public people search per lead (a few at a time). A failure for one company never fails the
 * run: that lead simply shows no contacts.
 */
async function findLeadContacts(groups: Array<{ id: string; name: string; domain: string | null }>) {
  const found = new Map<string, LeadContact[]>();
  const provider = getResearchProvider();
  if (!provider.findContacts) return found;
  const todo = groups.slice(0, PEOPLE_SEARCH_LIMIT);
  for (let i = 0; i < todo.length; i += PEOPLE_SEARCH_PARALLEL) {
    await Promise.all(
      todo.slice(i, i + PEOPLE_SEARCH_PARALLEL).map(async (g) => {
        try {
          found.set(g.id, await provider.findContacts!({ name: g.name, domain: g.domain }));
        } catch {
          // Contacts are a bonus on top of the lead
        }
      }),
    );
  }
  return found;
}

/**
 * Emails and phones from each company's own website (a few companies at a time). Only companies
 * with a known domain and a missing email or phone are looked up; a failure keeps the contacts as found.
 */
async function addSiteContactDetails(leads: Array<{ id: string; name: string; domain: string | null; contacts: LeadContact[] }>) {
  const out = new Map(leads.map((l) => [l.id, l.contacts]));
  const provider = getResearchProvider();
  if (!provider.findContactDetails) return out;
  const todo = leads
    .filter((l) => l.domain && (!l.contacts.length || l.contacts.some((c) => !c.email || !c.phone)))
    .slice(0, PEOPLE_SEARCH_LIMIT);
  for (let i = 0; i < todo.length; i += PEOPLE_SEARCH_PARALLEL) {
    await Promise.all(
      todo.slice(i, i + PEOPLE_SEARCH_PARALLEL).map(async (l) => {
        try {
          out.set(l.id, await provider.findContactDetails!({ name: l.name, domain: l.domain! }, l.contacts));
        } catch {
          // Contact details are a bonus on top of the lead
        }
      }),
    );
  }
  return out;
}

/** One entry per person (by name or email), first occurrence wins but empty fields are filled in. */
function mergeContacts(list: LeadContact[]): LeadContact[] {
  const out: LeadContact[] = [];
  for (const c of list) {
    const same = out.find(
      (o) => (c.name && o.name && o.name.toLowerCase() === c.name.toLowerCase()) || (c.email && o.email === c.email),
    );
    if (!same) {
      out.push({ ...c, sourceUrls: [...c.sourceUrls] });
      continue;
    }
    same.title ??= c.title;
    same.email ??= c.email;
    same.phone ??= c.phone;
    same.linkedinUrl ??= c.linkedinUrl;
    same.buyingRole ??= c.buyingRole;
    same.sourceUrls = [...new Set([...same.sourceUrls, ...c.sourceUrls])].slice(0, 5);
  }
  return out.slice(0, 4);
}

/**
 * Keep a found contact on the account as an unverified, sourced person so it shows in the
 * account's People list for review. Only named people are stored (a company-wide email or
 * phone stays on the lead row); repeats of the same person are skipped.
 */
export async function saveLeadContact(
  run: typeof researchRuns.$inferSelect,
  accountId: string,
  c: LeadContact,
  opts: { evidenceId?: string; foundBy?: string } = {},
): Promise<"created" | "updated" | "skipped"> {
  if (!c.name) return "skipped";
  const db = getDb();
  try {
    const [ev] = opts.evidenceId
      ? [{ id: opts.evidenceId }]
      : await db
          .select({ id: evidence.id })
          .from(evidence)
          .where(and(eq(evidence.accountId, accountId), eq(evidence.workspaceId, run.workspaceId), eq(evidence.tenantId, run.tenantId)))
          .limit(1);
    if (!ev) return "skipped";
    const existing = await db
      .select({ id: contacts.id, name: contacts.name, email: contacts.email, phone: contacts.phone, buyingRole: contacts.buyingRole, sourceNote: contacts.sourceNote })
      .from(contacts)
      .where(and(eq(contacts.accountId, accountId), eq(contacts.workspaceId, run.workspaceId)));
    const nameKey = c.name.trim().toLowerCase();
    const general = [c.emailIsGeneral && c.email ? "email" : null, c.phoneIsGeneral && c.phone ? "phone" : null].filter(Boolean);
    const generalNote = general.length ? `The ${general.join(" and ")} ${general.length > 1 ? "are" : "is"} the company's general line, not personal` : null;
    // The LinkedIn profile is noted on its own, so it isn't repeated as a source
    const nonLinkedinSources = c.sourceUrls.filter((u) => u !== c.linkedinUrl && !/linkedin\.com\/in\//i.test(u));
    const same = existing.find((e) => e.name.trim().toLowerCase() === nameKey);
    if (same) {
      // Already saved: fill in an email, phone or buying role it was missing, keeping anything already there
      const email = same.email ? null : c.email;
      const phone = same.phone ? null : c.phone;
      const buyingRole = same.buyingRole === "unknown" && c.buyingRole && c.buyingRole !== "unknown" ? c.buyingRole : null;
      if (!email && !phone) {
        if (!buyingRole) return "skipped";
        await db.update(contacts).set({ buyingRole }).where(eq(contacts.id, same.id));
        return "updated";
      }
      const note = [same.sourceNote, generalNote, nonLinkedinSources.length ? `Contact details from: ${nonLinkedinSources.join(" ")}` : null]
        .filter(Boolean)
        .join(". ");
      await db
        .update(contacts)
        .set({ ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(buyingRole ? { buyingRole } : {}), sourceNote: note.slice(0, 1000) })
        .where(eq(contacts.id, same.id));
      return "updated";
    }
    // A company-wide email is shared by many people, so it never marks a duplicate
    if (c.email && !c.emailIsGeneral && existing.some((e) => e.email === c.email)) return "skipped";
    const note = [
      `Found by ${opts.foundBy ?? "web research"} — unverified, check before use`,
      c.linkedinUrl ? `LinkedIn: ${c.linkedinUrl}` : null,
      generalNote,
      nonLinkedinSources.length ? `Sources: ${nonLinkedinSources.join(" ")}` : null,
    ]
      .filter(Boolean)
      .join(". ");
    await db.insert(contacts).values({
      id: newId("con"),
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      accountId,
      name: c.name.slice(0, 200),
      title: c.title,
      ...(c.buyingRole ? { buyingRole: c.buyingRole } : {}),
      email: c.email,
      phone: c.phone,
      sourceType: "evidence",
      evidenceId: ev.id,
      sourceNote: note.slice(0, 1000),
      verificationStatus: "unverified",
      createdBy: run.createdBy,
    });
    return "created";
  } catch {
    // The lead itself is kept even if its contact can't be stored
    return "skipped";
  }
}
