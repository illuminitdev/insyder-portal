import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { accounts, evidence, offers, playbookVersions, providerUsage, researchRuns } from "../../db/schema/index.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import {
  assertAccountReadable,
  loadMembership,
  requireCap,
} from "../../middleware/requireMembership.js";
import { enqueueResearchRun } from "../../jobs/queue.js";
import { isResearchConfigured } from "../../providers/research/index.js";
import { notFound, providerNotConfigured, validationError } from "../../utils/errors.js";
import { getUsage, reserveResearchBudget } from "../../services/budget.js";
import { assertResearchAllowed } from "../../services/entitlements.js";
import { activeSuppressionSet, isAccountSuppressed } from "../../services/suppressions.js";
import { toCsv } from "../../utils/csv.js";
import type { DiscoveryRow } from "../../jobs/handlers/researchRun.js";
import type { LeadContact } from "../../providers/research/types.js";
import { parseBrief } from "../../services/briefParser.js";
import { newId } from "../../utils/ids.js";
import { writeAudit } from "../../services/audit.js";
import type { ResearchFilters } from "../../providers/research/types.js";
import { getPlaybookVersion, latestPlaybook } from "../../services/playbooks.js";
import { normalizeCountry } from "../../utils/normalize.js";
import { CONTACTS_MODE, contactsAgentAvailable, createContactsRun } from "../../services/contactsRuns.js";

const filtersSchema = z.object({
  // Codes or names ("GB", "United Kingdom"); turned into ISO codes, unknown ones are refused
  countries: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .optional()
    .transform((list, ctx) => {
      if (!list) return list;
      const codes: string[] = [];
      for (const raw of list) {
        const code = normalizeCountry(raw);
        if (!code) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown country "${raw}". Use a country name or ISO code, e.g. GB` });
          return z.NEVER;
        }
        if (!codes.includes(code)) codes.push(code);
      }
      return codes;
    }),
  industries: z.array(z.string().max(80)).max(20).optional(),
  companySizes: z.array(z.string().max(20)).max(10).optional(),
  signalKinds: z.array(z.string().max(40)).max(10).optional(),
  eventWindowDays: z.number().int().min(1).max(3650).nullable().optional(),
  requiredPhrase: z.string().trim().max(60).optional(),
});

const RUN_MODES = ["account", "discovery", "similar", "webset"] as const;
/** Lists (Websets) can hold more companies than a quick search returns */
const MAX_BUDGET: Record<(typeof RUN_MODES)[number], number> = { account: 10, discovery: 10, similar: 10, webset: 25 };

type RunMode = (typeof RUN_MODES)[number];
/** Run kinds that can be listed: the research modes plus contact searches */
const LIST_MODES = [...RUN_MODES, CONTACTS_MODE] as const;

/**
 * Executed filters and query for a run: what the user confirmed, else the playbook's rules, else
 * workspace targeting. The playbook version is persisted with every run (R1).
 */
async function buildRunPlan(
  workspaceId: string,
  body: {
    mode: RunMode;
    query: string;
    filters?: z.infer<typeof filtersSchema>;
    playbookVersionId?: string;
    account?: typeof accounts.$inferSelect;
    websetId?: string;
  },
) {
  const db = getDb();
  const { account, websetId } = body;
  const [offer] = await db.select().from(offers).where(eq(offers.workspaceId, workspaceId)).limit(1);
  const isNoPlaybook = body.playbookVersionId === "none";
  let playbook =
    body.playbookVersionId && !isNoPlaybook
      ? await getPlaybookVersion(workspaceId, body.playbookVersionId)
      : null;
  if (body.playbookVersionId && !isNoPlaybook && !playbook) {
    throw validationError("Unknown playbook version");
  }
  // If explicitly "none", no playbook is attached (open search). Otherwise fall back to workspace active playbook.
  if (!isNoPlaybook && !playbook) {
    playbook = await latestPlaybook(workspaceId, offer?.activePlaybookTemplateKey ?? "infrastructure");
  }
  const playbookVersionId = playbook?.id ?? null;
  const rules = playbook?.rules;

  const offerTerritory = (offer ? (JSON.parse(offer.territoryJson) as string[]) : [])
    .map((t) => normalizeCountry(t))
    .filter((c): c is string => Boolean(c));
  // What the brief itself names, used only when nothing else sets a country
  const briefCountries = body.mode === "discovery" || body.mode === "webset" ? parseBrief(body.query).structured.countries : [];
  const countries = body.filters?.countries?.length
    ? body.filters.countries
    : rules?.countries.length
      ? rules.countries
      : offerTerritory.length
        ? offerTerritory
        : briefCountries;
  // A company search with no country runs worldwide (e.g. "councils" returned California): refuse
  // it before any credits are reserved. Refreshing an existing list keeps that list's scope.
  if ((body.mode === "discovery" || body.mode === "webset") && !websetId && !countries.length) {
    throw validationError(
      "Add at least one country. A search with no location runs worldwide and wastes research units.",
    );
  }
  const filters: ResearchFilters = {
    countries,
    industries:
      body.filters?.industries ??
      (rules?.industries.length ? rules.industries : offer ? (JSON.parse(offer.industriesJson) as string[]) : []),
    companySizes: body.filters?.companySizes ?? [],
    signalKinds:
      body.filters?.signalKinds !== undefined
        ? body.filters.signalKinds
        : (isNoPlaybook ? [] : (rules?.signals ?? [])),
    eventWindowDays:
      body.filters?.eventWindowDays != null
        ? body.filters.eventWindowDays
        : (isNoPlaybook ? undefined : (rules?.eventWindowDays ?? offer?.eventWindowDays ?? 90)),
    ...(body.mode === "account" && account?.domain ? { companyDomain: account.domain } : {}),
    ...((body.filters?.requiredPhrase ?? rules?.requiredPhrase)?.trim()
      ? { requiredPhrase: (body.filters?.requiredPhrase ?? rules?.requiredPhrase)!.trim() }
      : {}),
    ...(websetId ? { websetId } : {}),
  };
  const query =
    body.mode === "similar"
      ? `https://${account!.domain}`
      : body.mode === "account" && account
        ? `${account.name}${account.domain ? ` ${account.domain}` : ""} ${body.query}`.trim()
        : body.query;
  return { filters, query, playbookVersionId };
}

/** Same question as "Run research" on a single account. */
const ACCOUNT_RESEARCH_QUERY = "infrastructure expansion, hiring, refresh or procurement";
const BATCH_MAX = 50;

export async function researchRunRoutes(app: FastifyInstance) {
  /**
   * Find an account's decision makers with work emails (Exa Agent, runs in the background).
   * One research unit; a search already running for the account is returned instead of a new one.
   */
  app.post(
    "/v1/workspaces/:workspaceId/accounts/:accountId/find-contacts",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "research");
      await assertResearchAllowed(m.tenantId, workspaceId);
      if (!isResearchConfigured()) throw providerNotConfigured("exa");
      if (!contactsAgentAvailable()) throw validationError("The research provider can't search for contacts");
      await assertAccountReadable(m, accountId);
      if (await isAccountSuppressed(m.workspaceId, accountId)) throw validationError("Cannot search a suppressed account");
      const db = getDb();
      const [account] = await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, workspaceId), eq(accounts.tenantId, m.tenantId)))
        .limit(1);
      if (!account) throw notFound("Account not found");

      const { researchRunId, reused } = await createContactsRun({
        tenantId: m.tenantId,
        workspaceId,
        accountId,
        accountName: account.name,
        createdBy: req.actor!.userId,
      });
      if (!reused) {
        await writeAudit({
          tenantId: m.tenantId,
          workspaceId,
          actorUserId: req.actor!.userId,
          action: "research_run.queued",
          entityType: "research_run",
          entityId: researchRunId,
          metadata: { mode: CONTACTS_MODE, accountId },
        });
      }
      return { researchRunId, status: "queued", reused };
    },
  );

  /** Parse a brief into a visible structured query for confirmation (R1). Free. */
  app.post(
    "/v1/workspaces/:workspaceId/research-runs/parse-brief",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "discover");
      const body = z.object({ brief: z.string().min(1).max(2000) }).parse(req.body);
      const parsed = parseBrief(body.brief);
      const usage = await getUsage(m.tenantId);
      return { ...parsed, usage };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/research-runs",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "research");
      await assertResearchAllowed(m.tenantId, workspaceId);
      if (!isResearchConfigured()) throw providerNotConfigured("exa");

      const body = z
        .object({
          mode: z.enum(RUN_MODES).default("account"),
          // "similar" builds its query from the seed account's website
          query: z.string().max(1000).default(""),
          brief: z.string().max(2000).optional(),
          filters: filtersSchema.optional(),
          accountId: z.string().optional(),
          playbookVersionId: z.string().optional(),
          idempotencyKey: z.string().max(200).optional(),
          budget: z.number().int().min(1).max(25).default(3),
          /** Webset mode: add new matches to the list built by this earlier run */
          refreshRunId: z.string().optional(),
        })
        .parse(req.body);
      if (body.budget > MAX_BUDGET[body.mode]) {
        throw validationError(`At most ${MAX_BUDGET[body.mode]} results for this kind of search`);
      }

      if (body.mode !== "account") requireCap(m, "discover");
      if (body.mode !== "similar" && !body.query.trim()) throw validationError("A search query is required");
      if ((body.mode === "account" || body.mode === "similar") && !body.accountId) {
        throw validationError(body.mode === "similar" ? "Find similar requires a seed accountId" : "Account research requires an accountId");
      }

      const db = getDb();
      let websetId: string | undefined;
      if (body.refreshRunId) {
        if (body.mode !== "webset") throw validationError("Only lists can be refreshed");
        const [prev] = await db
          .select({ mode: researchRuns.mode, providerRunId: researchRuns.providerRunId })
          .from(researchRuns)
          .where(
            and(
              eq(researchRuns.id, body.refreshRunId),
              eq(researchRuns.workspaceId, workspaceId),
              eq(researchRuns.tenantId, m.tenantId),
            ),
          )
          .limit(1);
        if (prev?.mode !== "webset" || !prev.providerRunId) throw validationError("That list can't be refreshed");
        websetId = prev.providerRunId;
      }
      let account: typeof accounts.$inferSelect | undefined;
      if (body.accountId) {
        await assertAccountReadable(m, body.accountId);
        if (await isAccountSuppressed(m.workspaceId, body.accountId)) {
          throw validationError("Cannot research a suppressed account");
        }
        [account] = await db.select().from(accounts).where(eq(accounts.id, body.accountId)).limit(1);
      }
      if (body.mode === "similar" && !account?.domain) {
        throw validationError("Find similar needs the account's website domain");
      }

      if (body.idempotencyKey) {
        const existing = await db
          .select()
          .from(researchRuns)
          .where(
            and(
              eq(researchRuns.workspaceId, workspaceId),
              eq(researchRuns.idempotencyKey, body.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing[0]) {
          return { researchRunId: existing[0].id, status: existing[0].status, reused: true };
        }
      }

      const { filters, query, playbookVersionId } = await buildRunPlan(workspaceId, {
        mode: body.mode,
        query: body.query,
        filters: body.filters,
        playbookVersionId: body.playbookVersionId,
        account,
        websetId,
      });

      await reserveResearchBudget(m.tenantId, body.budget);

      const id = newId("rr");
      await db.insert(researchRuns).values({
        id,
        tenantId: m.tenantId,
        workspaceId,
        accountId: body.accountId,
        mode: body.mode,
        query,
        brief: body.brief,
        filtersJson: JSON.stringify(filters),
        playbookVersionId,
        budgetReserved: body.budget,
        idempotencyKey: body.idempotencyKey,
        createdBy: req.actor!.userId,
        status: "queued",
      });

      if (body.mode === "account" && body.accountId) {
        await db
          .update(accounts)
          .set({ researchState: "researching", updatedAt: new Date() })
          .where(eq(accounts.id, body.accountId));
      }

      await enqueueResearchRun(id);
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "research_run.queued",
        entityType: "research_run",
        entityId: id,
        metadata: { mode: body.mode, budget: body.budget },
      });

      return { researchRunId: id, status: "queued" };
    },
  );

  /**
   * Research several accounts at once (e.g. right after a CRM import). Each one becomes a normal
   * account research run, so evidence, scoring and review work exactly as for a single account.
   * Units for the whole batch are checked up front, so it never stops half way for lack of budget.
   */
  app.post(
    "/v1/workspaces/:workspaceId/research-runs/batch",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "research");
      await assertResearchAllowed(m.tenantId, workspaceId);
      if (!isResearchConfigured()) throw providerNotConfigured("exa");
      const body = z
        .object({
          accountIds: z
            .array(z.string())
            .min(1, "Pick at least one account")
            .max(BATCH_MAX, `At most ${BATCH_MAX} accounts at a time`),
          budgetPerAccount: z.number().int().min(1).max(MAX_BUDGET.account).default(3),
        })
        .parse(req.body);
      const ids = [...new Set(body.accountIds)];
      const db = getDb();

      const rows = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.tenantId, m.tenantId), inArray(accounts.id, ids), isNull(accounts.deletedAt)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const suppressed = await activeSuppressionSet(workspaceId);
      const skipped: Array<{ accountId: string; reason: string }> = [];
      const toRun: Array<typeof accounts.$inferSelect> = [];
      for (const id of ids) {
        const a = byId.get(id);
        if (!a) {
          skipped.push({ accountId: id, reason: "Not found in this workspace" });
          continue;
        }
        await assertAccountReadable(m, id);
        if (a.domain && suppressed.has(a.domain.toLowerCase())) skipped.push({ accountId: id, reason: "Suppressed" });
        else if (a.researchState === "researching") skipped.push({ accountId: id, reason: "Already being researched" });
        else toRun.push(a);
      }
      if (!toRun.length) return { queued: [], skipped, unitsReserved: 0 };

      const units = toRun.length * body.budgetPerAccount;
      const usage = await getUsage(m.tenantId);
      const left = Math.max(0, usage.quotaMonthly - usage.usedMonthly);
      if (units > left) {
        throw validationError(
          `This needs ${units} research units and ${left} are left this month. Pick fewer accounts (about ${Math.floor(left / body.budgetPerAccount)}).`,
        );
      }

      const queued: Array<{ accountId: string; researchRunId: string }> = [];
      for (const account of toRun) {
        const { filters, query, playbookVersionId } = await buildRunPlan(workspaceId, {
          mode: "account",
          query: ACCOUNT_RESEARCH_QUERY,
          account,
        });
        await reserveResearchBudget(m.tenantId, body.budgetPerAccount);
        const id = newId("rr");
        await db.insert(researchRuns).values({
          id,
          tenantId: m.tenantId,
          workspaceId,
          accountId: account.id,
          mode: "account",
          query,
          filtersJson: JSON.stringify(filters),
          playbookVersionId,
          budgetReserved: body.budgetPerAccount,
          createdBy: req.actor!.userId,
          status: "queued",
        });
        await db
          .update(accounts)
          .set({ researchState: "researching", updatedAt: new Date() })
          .where(eq(accounts.id, account.id));
        await enqueueResearchRun(id);
        queued.push({ accountId: account.id, researchRunId: id });
      }
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "research_run.batch_queued",
        entityType: "research_run",
        metadata: { accounts: queued.length, skipped: skipped.length, units },
      });
      return { queued, skipped, unitsReserved: units };
    },
  );

  /** Recent runs, so pages can restore the latest search or an in-progress run after a refresh. */
  app.get(
    "/v1/workspaces/:workspaceId/research-runs",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      const q = z
        .object({
          /** One mode, or several comma-separated (e.g. "discovery,webset") */
          mode: z
            .string()
            .transform((v) => v.split(",").map((s) => s.trim()))
            .pipe(z.array(z.enum(LIST_MODES)).min(1))
            .optional(),
          accountId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(10),
        })
        .parse(req.query);
      if (q.accountId) await assertAccountReadable(m, q.accountId);
      else requireCap(m, q.mode?.some((x) => x !== "account" && x !== CONTACTS_MODE) ? "discover" : "view_accounts");

      const db = getDb();
      const where = [eq(researchRuns.workspaceId, m.workspaceId), eq(researchRuns.tenantId, m.tenantId)];
      if (q.mode) where.push(inArray(researchRuns.mode, q.mode));
      if (q.accountId) where.push(eq(researchRuns.accountId, q.accountId));
      const runs = await db
        .select({
          id: researchRuns.id,
          mode: researchRuns.mode,
          status: researchRuns.status,
          brief: researchRuns.brief,
          query: researchRuns.query,
          accountId: researchRuns.accountId,
          resultJson: researchRuns.resultJson,
          createdAt: researchRuns.createdAt,
          completedAt: researchRuns.completedAt,
        })
        .from(researchRuns)
        .where(and(...where))
        .orderBy(desc(researchRuns.createdAt))
        .limit(q.limit);
      return {
        runs: runs.map(({ resultJson, ...r }) => {
          const result = resultJson ? (JSON.parse(resultJson) as { stage?: string; rows?: unknown[] }) : null;
          return { ...r, companies: result?.stage === "done" ? (result.rows?.length ?? 0) : null };
        }),
      };
    },
  );

  /** Formula-safe CSV of a discovery run's companies; suppressed domains are left out. */
  app.get(
    "/v1/research-runs/:id/results.csv",
    { preHandler: authenticateRequired },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      requireCap(m, "export");
      const db = getDb();
      const [run] = await db
        .select()
        .from(researchRuns)
        .where(and(eq(researchRuns.id, id), eq(researchRuns.workspaceId, m.workspaceId), eq(researchRuns.tenantId, m.tenantId)))
        .limit(1);
      if (!run) throw notFound("Research run not found");
      const result = run.resultJson ? (JSON.parse(run.resultJson) as { stage?: string; rows?: DiscoveryRow[] }) : null;
      if (result?.stage !== "done" || !result.rows) throw validationError("This run has no exportable results");
      const suppressed = await activeSuppressionSet(m.workspaceId);
      const rows = result.rows.filter((r) => !r.domain || !suppressed.has(r.domain));
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId: m.workspaceId,
        actorUserId: m.userId,
        action: "research_run.results_exported",
        entityType: "research_run",
        entityId: run.id,
        metadata: { rows: rows.length },
      });
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="search-results-${run.id}.csv"`);
      reply.header("cache-control", "no-store");
      return toCsv(
        [
          "company", "domain", "country", "trigger", "event_date", "source_url", "sources", "priority", "identity_check",
          "contact_name", "contact_title", "contact_email", "contact_phone", "contact_linkedin", "contact_status",
        ],
        rows.map((r) => {
          // Older runs stored a single "contact"; newer ones a "contacts" list
          const c = r.contacts?.[0] ?? (r as { contact?: LeadContact | null }).contact ?? null;
          // A suppressed (opted-out) address is never exported
          const email = c?.email && !suppressed.has(c.email.toLowerCase()) ? c.email : null;
          return [
          r.name,
          r.domain,
          r.country,
          r.trigger.summary ?? r.trigger.title,
          r.trigger.eventDate ? r.trigger.eventDate.slice(0, 10) : "unknown",
          r.trigger.url,
          r.sources,
          r.fitScore,
          r.identityNeedsReview ? "needs review" : "confirmed by website",
          c?.name,
          c?.title,
          email,
          c?.phone,
          c?.linkedinUrl,
          c ? "unverified - for research and review" : null,
          ];
        }),
      );
    },
  );

  app.get(
    "/v1/research-runs/:id",
    { preHandler: authenticateRequired },
    async (req) => {
      const { id } = req.params as { id: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      requireCap(m, "view_accounts");
      const db = getDb();
      const [run] = await db
        .select()
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.id, id),
            eq(researchRuns.workspaceId, m.workspaceId),
            eq(researchRuns.tenantId, m.tenantId),
          ),
        )
        .limit(1);
      if (!run) throw notFound("Research run not found");
      const result = run.resultJson ? (JSON.parse(run.resultJson) as Record<string, unknown>) : null;
      return {
        researchRun: {
          id: run.id,
          mode: run.mode,
          status: run.status,
          progressPct: run.progressPct,
          budgetReserved: run.budgetReserved,
          budgetActual: run.budgetActual,
          errorCode: run.errorCode,
          errorMessage: run.errorMessage,
          providerRunId: run.providerRunId,
          accountId: run.accountId,
          brief: run.brief,
          filters: JSON.parse(run.filtersJson || "{}"),
          playbookVersionId: run.playbookVersionId,
          // Never echo raw provider items; only the summary
          result: result && result.stage === "done" ? result : null,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
        },
      };
    },
  );

  app.delete(
    "/v1/workspaces/:workspaceId/research-runs/:id",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, id } = req.params as { workspaceId: string; id: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "discover");
      const db = getDb();
      const [existing] = await db
        .select()
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.id, id),
            eq(researchRuns.workspaceId, m.workspaceId),
            eq(researchRuns.tenantId, m.tenantId),
          ),
        )
        .limit(1);
      if (!existing) throw notFound("Research run not found");

      await db.update(evidence).set({ researchRunId: null }).where(eq(evidence.researchRunId, id));
      await db.update(providerUsage).set({ researchRunId: null }).where(eq(providerUsage.researchRunId, id));
      await db
        .delete(researchRuns)
        .where(
          and(
            eq(researchRuns.id, id),
            eq(researchRuns.workspaceId, m.workspaceId),
            eq(researchRuns.tenantId, m.tenantId),
          ),
        );
      return { ok: true };
    },
  );
}
