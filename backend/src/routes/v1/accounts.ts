import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import {
  accounts,
  evidence,
  offers,
  qualifications,
  signals,
  sources,
  acceptanceDecisions,
  opportunities,
  tasks,
  users,
  crmMappings,
  researchRuns,
  playbookVersions,
} from "../../db/schema/index.js";
import { acceptanceStates } from "../../db/schema/workflow.js";
import { accountResearchStates } from "../../db/schema/accounts.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import {
  accountScope,
  assertAccountReadable,
  loadMembership,
  requireCap,
} from "../../middleware/requireMembership.js";
import { toCsv } from "../../utils/csv.js";
import { newId } from "../../utils/ids.js";
import { validationError } from "../../utils/errors.js";
import { normalizeCountry, normalizeDomain } from "../../utils/normalize.js";
import { filterUnsuppressedAccounts, isSuppressed } from "../../services/suppressions.js";
import { listPendingMergeCandidates, resolveMergeCandidate } from "../../services/merges.js";
import { evidenceFreshness } from "../../services/evidence.js";
import { getQualificationFacts } from "../../services/qualification.js";
import { writeAudit } from "../../services/audit.js";
import { kickAccountLogos, needsLogoCheck, visibleLogo } from "../../services/accountLogos.js";

export async function accountRoutes(app: FastifyInstance) {
  app.get(
    "/v1/workspaces/:workspaceId/accounts",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "view_accounts");
      const q = z
        .object({
          acceptanceState: z.enum(acceptanceStates).optional(),
          researchState: z.enum(accountResearchStates).optional(),
          ownerUserId: z.string().optional(),
          /** e.g. "crm_import" for the watchlist's "From HubSpot" filter */
          source: z.enum(["manual", "import", "crm_import", "discovery", "lookalike", "list"]).optional(),
          /** Archived accounts are hidden unless asked for: "only" lists just them */
          archived: z.enum(["exclude", "only"]).default("exclude"),
          /** A playbook's template key, or "unassigned" for accounts without one */
          playbookTemplateKey: z.string().optional(),
        })
        .parse(req.query);
      const where: SQL[] = [accountScope(m)];
      where.push(q.archived === "only" ? isNotNull(accounts.archivedAt) : isNull(accounts.archivedAt));
      if (q.source) where.push(eq(accounts.source, q.source));
      if (q.acceptanceState) where.push(eq(accounts.acceptanceState, q.acceptanceState));
      if (q.researchState) where.push(eq(accounts.researchState, q.researchState));
      if (q.ownerUserId) where.push(eq(accounts.ownerUserId, q.ownerUserId));
      if (q.playbookTemplateKey) {
        where.push(
          q.playbookTemplateKey === "unassigned"
            ? isNull(accounts.playbookTemplateKey)
            : eq(accounts.playbookTemplateKey, q.playbookTemplateKey),
        );
      }
      const db = getDb();
      const rows = await db
        .select({
          ...getTableColumns(accounts),
          // An evidence gap = no source with an event date to anchor the signal in time
          hasDatedEvidence: sql<boolean>`exists (select 1 from ${evidence} where ${evidence.accountId} = ${accounts.id} and ${evidence.eventDate} is not null)`,
        })
        .from(accounts)
        .where(and(...where))
        .orderBy(desc(accounts.updatedAt));

      // Accounts without a playbook show the playbook of their latest research run
      const missingPlaybookIds = rows.filter((r) => !r.playbookTemplateKey).map((r) => r.id);
      if (missingPlaybookIds.length) {
        const runRows = await db
          .select({ accountId: researchRuns.accountId, templateKey: playbookVersions.templateKey })
          .from(researchRuns)
          .innerJoin(playbookVersions, eq(researchRuns.playbookVersionId, playbookVersions.id))
          .where(
            and(
              eq(researchRuns.workspaceId, workspaceId),
              inArray(researchRuns.accountId, missingPlaybookIds),
              isNotNull(researchRuns.playbookVersionId),
            ),
          )
          .orderBy(desc(researchRuns.createdAt));
        const playbookByAccount = new Map<string, string>();
        for (const rr of runRows) {
          if (rr.accountId && !playbookByAccount.has(rr.accountId)) playbookByAccount.set(rr.accountId, rr.templateKey);
        }
        for (const r of rows) {
          if (!r.playbookTemplateKey) r.playbookTemplateKey = playbookByAccount.get(r.id) ?? null;
        }
      }

      // Logos are looked up in the background; this list shows them from the next load on
      if (rows.some(needsLogoCheck)) kickAccountLogos(workspaceId);
      for (const r of rows) r.logoUrl = visibleLogo(r);

      return { accounts: rows };
    },
  );

  /** One row per account for the team pipeline: stage, owner, next action and when it is due */
  app.get(
    "/v1/workspaces/:workspaceId/pipeline",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "view_accounts");
      const db = getDb();
      const rows = await db
        .select({
          id: accounts.id,
          name: accounts.name,
          acceptanceState: accounts.acceptanceState,
          ownerUserId: accounts.ownerUserId,
          ownerName: users.name,
        })
        .from(accounts)
        .leftJoin(users, eq(users.id, accounts.ownerUserId))
        .where(and(accountScope(m), isNull(accounts.archivedAt)))
        .orderBy(desc(accounts.updatedAt));
      const ids = rows.map((r) => r.id);
      if (!ids.length) return { rows: [] };

      // Next action: the open task due soonest, else the next action recorded with the latest decision.
      // These four lookups are independent, so they run together (each is a database round trip).
      const [openTasks, decisions, opps, crmRows] = await Promise.all([
        db
        .select({
          accountId: tasks.accountId,
          type: tasks.type,
          instruction: tasks.instruction,
          dueAt: tasks.dueAt,
        })
        .from(tasks)
        .where(and(inArray(tasks.accountId, ids), inArray(tasks.status, ["open", "in_progress"])))
        .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt)),
        db
        .select({ accountId: acceptanceDecisions.accountId, nextAction: acceptanceDecisions.nextAction })
        .from(acceptanceDecisions)
        .where(and(inArray(acceptanceDecisions.accountId, ids), isNotNull(acceptanceDecisions.nextAction)))
        .orderBy(desc(acceptanceDecisions.createdAt)),
        // Deal stage lives on its own record, separate from acceptance (R5)
        db
        .select({
          accountId: opportunities.accountId,
          stage: opportunities.stage,
          valueAmount: opportunities.valueAmount,
          currency: opportunities.currency,
          source: opportunities.source,
          syncStatus: opportunities.syncStatus,
          updatedAt: opportunities.updatedAt,
        })
        .from(opportunities)
        .where(and(inArray(opportunities.accountId, ids), eq(opportunities.tenantId, m.tenantId))),
        // Whether each account has been sent to the CRM (its "account" mapping carries the last sync)
        db
        .select({ accountId: crmMappings.entityId, status: crmMappings.syncStatus, syncedAt: crmMappings.syncedAt })
        .from(crmMappings)
        .where(
          and(
            eq(crmMappings.workspaceId, m.workspaceId),
            eq(crmMappings.entityType, "account"),
            inArray(crmMappings.entityId, ids),
          ),
        ),
      ]);

      const taskByAccount = new Map<string, (typeof openTasks)[number]>();
      for (const t of openTasks) if (!taskByAccount.has(t.accountId)) taskByAccount.set(t.accountId, t);
      const decisionByAccount = new Map<string, string>();
      for (const d of decisions) {
        if (d.nextAction && !decisionByAccount.has(d.accountId)) decisionByAccount.set(d.accountId, d.nextAction);
      }
      const oppByAccount = new Map(opps.map((o) => [o.accountId, o]));
      const crmByAccount = new Map(crmRows.map((c) => [c.accountId, c]));

      return {
        rows: rows.map((r) => {
          const task = taskByAccount.get(r.id);
          return {
            accountId: r.id,
            name: r.name,
            acceptanceState: r.acceptanceState,
            owner: r.ownerUserId ? { id: r.ownerUserId, name: r.ownerName ?? "Unknown" } : null,
            nextAction: task ? task.instruction?.trim() || null : (decisionByAccount.get(r.id) ?? null),
            taskType: task?.type ?? null,
            dueAt: task?.dueAt ?? null,
            opportunity: oppByAccount.get(r.id) ?? null,
            crm: crmByAccount.get(r.id) ?? null,
          };
        }),
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/accounts",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      const body = z
        .object({
          name: z.string().trim().min(1).max(300),
          domain: z.string().max(300).optional(),
          country: z.string().max(60).optional(),
          companySummary: z.string().trim().max(1000).optional(),
          playbookTemplateKey: z.string().trim().max(100).optional(),
        })
        .parse(req.body);
      const domain = body.domain?.trim() ? normalizeDomain(body.domain) : null;
      if (body.domain?.trim() && !domain) throw validationError("Domain is not valid");
      const country = body.country?.trim() ? normalizeCountry(body.country) : null;
      if (body.country?.trim() && !country) throw validationError("Unknown country");
      if (domain && (await isSuppressed(workspaceId, domain))) {
        throw validationError("Domain is suppressed");
      }
      const db = getDb();
      if (domain) {
        const [dup] = await db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(and(accountScope(m), eq(accounts.domain, domain)))
          .limit(1);
        if (dup) {
          const { conflict } = await import("../../utils/errors.js");
          throw conflict(`An account with domain ${domain} already exists`, { accountId: dup.id });
        }
      }
      const id = newId("acc");
      await db.insert(accounts).values({
        id,
        tenantId: m.tenantId,
        workspaceId,
        name: body.name,
        domain,
        country,
        companySummary: body.companySummary || null,
        playbookTemplateKey: body.playbookTemplateKey || null,
        source: "manual",
        researchState: "unresearched",
        acceptanceState: "draft",
      });
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: "account.created",
        entityType: "account",
        entityId: id,
      });
      const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
      return { account: row };
    },
  );

  /** Edit an account's company overview sentence or playbook */
  app.patch(
    "/v1/workspaces/:workspaceId/accounts/:accountId",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      await assertAccountReadable(m, accountId);
      const body = z
        .object({
          companySummary: z.string().trim().max(1000).nullable().optional(),
          playbookTemplateKey: z.string().trim().max(100).nullable().optional(),
        })
        .parse(req.body ?? {});
      const db = getDb();
      const updates: { companySummary?: string | null; playbookTemplateKey?: string | null; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (body.companySummary !== undefined) updates.companySummary = body.companySummary || null;
      if (body.playbookTemplateKey !== undefined) updates.playbookTemplateKey = body.playbookTemplateKey || null;
      const [row] = await db
        .update(accounts)
        .set(updates)
        .where(and(eq(accounts.id, accountId), accountScope(m)))
        .returning();
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: "account.updated",
        entityType: "account",
        entityId: accountId,
        metadata: { fields: Object.keys(updates).filter((k) => k !== "updatedAt") },
      });
      return { account: row };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/merge-candidates",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      return { candidates: await listPendingMergeCandidates(m.tenantId, workspaceId) };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/merge-candidates/:candidateId/resolve",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, candidateId } = req.params as {
        workspaceId: string;
        candidateId: string;
      };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      const body = z
        .object({
          action: z.enum(["merge", "keep_separate", "reject"]),
          keepAccountId: z.string().optional(),
        })
        .parse(req.body);
      return resolveMergeCandidate({
        tenantId: m.tenantId,
        workspaceId,
        candidateId,
        action: body.action,
        keepAccountId: body.keepAccountId,
        actorUserId: req.actor!.userId,
      });
    },
  );

  app.get(
    "/v1/accounts/:accountId/brief",
    { preHandler: authenticateRequired },
    async (req) => {
      const { accountId } = req.params as { accountId: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      await assertAccountReadable(m, accountId);

      const db = getDb();
      // Independent reads run in parallel: each is a network round trip to the database
      const [[account], [offer], ev, sigs, [qual], decisions] = await Promise.all([
        db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1),
        db
          .select({ eventWindowDays: offers.eventWindowDays })
          .from(offers)
          .where(eq(offers.workspaceId, m.workspaceId))
          .limit(1),
        db
          .select({ evidence, source: sources })
          .from(evidence)
          .innerJoin(sources, eq(evidence.sourceId, sources.id))
          .where(and(eq(evidence.accountId, accountId), eq(evidence.workspaceId, m.workspaceId)))
          .orderBy(desc(evidence.discoveredAt)),
        db
          .select()
          .from(signals)
          .where(and(eq(signals.accountId, accountId), eq(signals.workspaceId, m.workspaceId))),
        db
          .select()
          .from(qualifications)
          .where(and(eq(qualifications.accountId, accountId), eq(qualifications.workspaceId, m.workspaceId)))
          .limit(1),
        db
          .select({ decision: acceptanceDecisions, actorName: users.name })
          .from(acceptanceDecisions)
          .innerJoin(users, eq(acceptanceDecisions.actorUserId, users.id))
          .where(eq(acceptanceDecisions.accountId, accountId))
          .orderBy(desc(acceptanceDecisions.createdAt)),
      ]);
      const windowDays = offer?.eventWindowDays ?? 90;
      if (account) {
        if (needsLogoCheck(account)) kickAccountLogos(account.workspaceId);
        account.logoUrl = visibleLogo(account);
      }
      const [facts, owner] = await Promise.all([
        qual ? getQualificationFacts(qual.id).then((f) => f.current) : Promise.resolve([]),
        account?.ownerUserId
          ? db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(eq(users.id, account.ownerUserId))
              .limit(1)
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
      ]);

      return {
        account,
        owner,
        eventWindowDays: windowDays,
        evidence: ev.map((e) => ({
          ...e.evidence,
          sourceUrl: e.source.canonicalUrl,
          sourceTitle: e.source.title,
          publisher: e.source.publisher,
          sourceCountry: e.source.country,
          freshness: evidenceFreshness(e.evidence, windowDays),
          contradiction: sigs.some((s) => s.evidenceId === e.evidence.id && s.unknownNote === "contradiction"),
        })),
        signals: sigs,
        qualification: qual ?? null,
        facts,
        decisions: decisions.map((d) => ({ ...d.decision, actorName: d.actorName })),
      };
    },
  );

  /**
   * Archive an account the researcher judged not relevant: it leaves the account lists, pipeline and
   * exports, stays readable and restorable, and research does not add new results to it.
   */
  app.post(
    "/v1/workspaces/:workspaceId/accounts/:accountId/archive",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      await assertAccountReadable(m, accountId);
      const body = z.object({ archived: z.boolean() }).parse(req.body ?? {});
      const db = getDb();
      const [row] = await db
        .update(accounts)
        .set(
          body.archived
            ? { archivedAt: new Date(), archivedBy: m.userId, updatedAt: new Date() }
            : { archivedAt: null, archivedBy: null, updatedAt: new Date() },
        )
        .where(and(eq(accounts.id, accountId), accountScope(m)))
        .returning();
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: body.archived ? "account.archived" : "account.restored",
        entityType: "account",
        entityId: accountId,
      });
      return { account: row };
    },
  );

  /**
   * Delete an account (tenant admin). Soft delete: the record and its history are kept for the audit
   * trail but it disappears everywhere, and research does not bring the company back.
   */
  app.delete(
    "/v1/workspaces/:workspaceId/accounts/:accountId",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, accountId } = req.params as { workspaceId: string; accountId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      await assertAccountReadable(m, accountId);
      const db = getDb();
      const [acct] = await db
        .update(accounts)
        .set({ deletedAt: new Date(), deletedBy: m.userId, updatedAt: new Date() })
        .where(and(eq(accounts.id, accountId), accountScope(m)))
        .returning({ name: accounts.name, domain: accounts.domain });
      // Open work on a deleted account would otherwise linger in task lists
      await db
        .update(tasks)
        .set({ status: "cancelled" })
        .where(and(eq(tasks.accountId, accountId), inArray(tasks.status, ["open", "in_progress"])));
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: "account.deleted",
        entityType: "account",
        entityId: accountId,
        metadata: { name: acct?.name ?? null, domain: acct?.domain ?? null },
      });
      return { ok: true };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/accounts/export",
    { preHandler: authenticateRequired },
    async (req, reply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "export");
      const db = getDb();
      const rows = await db.select().from(accounts).where(and(accountScope(m), isNull(accounts.archivedAt)));
      // Gate 8: suppression honored in exports
      const visible = await filterUnsuppressedAccounts(workspaceId, rows);
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: "accounts.exported",
        metadata: { rows: visible.length },
      });
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", 'attachment; filename="accounts.csv"');
      reply.header("cache-control", "no-store");
      return toCsv(
        ["name", "domain", "country", "research_state", "acceptance_state", "fit_score"],
        visible.map((r) => [r.name, r.domain, r.country, r.researchState, r.acceptanceState, r.fitScore]),
      );
    },
  );
}
