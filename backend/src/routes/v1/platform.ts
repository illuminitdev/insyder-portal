import type { FastifyInstance } from "fastify";
import { and, count, countDistinct, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { accounts, crmConnections, memberships, offers, tenants, users, workspaces } from "../../db/schema/index.js";
import { requirePlatformAdmin } from "../../middleware/authenticate.js";
import { forgetMemberships } from "../../middleware/requireMembership.js";
import { provisionTenant, provisionWorkspace } from "../../services/tenants.js";
import { writeAudit } from "../../services/audit.js";
import { notFound } from "../../utils/errors.js";
import { approveAccessRequest, listAccessRequests, rejectAccessRequest } from "../../services/accessRequests.js";
import { accessRequestStatuses, membershipRoles } from "../../db/schema/index.js";

/**
 * App-owner console. Returns counts only: a platform admin never reads a tenant's
 * accounts, evidence, briefs or member details (spec §4 tenant boundary). The one
 * exception is each company's tenant admin contact, on /v1/platform/users.
 */
export async function platformRoutes(app: FastifyInstance) {
  app.get("/v1/platform/overview", { preHandler: requirePlatformAdmin }, async () => {
    const db = getDb();
    const [tenantRows, wsCounts, memberCounts, accountCounts, crmRows] = await Promise.all([
      db
        .select({
          id: tenants.id,
          name: tenants.name,
          researchQuotaMonthly: tenants.researchQuotaMonthly,
          researchUsedMonthly: tenants.researchUsedMonthly,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .where(isNull(tenants.deletedAt))
        .orderBy(tenants.createdAt),
      db
        .select({ tenantId: workspaces.tenantId, n: count() })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt))
        .groupBy(workspaces.tenantId),
      db
        .select({ tenantId: memberships.tenantId, role: memberships.role, n: countDistinct(memberships.userId) })
        .from(memberships)
        .where(isNull(memberships.revokedAt))
        .groupBy(memberships.tenantId, memberships.role),
      db
        .select({ tenantId: accounts.tenantId, n: count() })
        .from(accounts)
        .innerJoin(workspaces, eq(accounts.workspaceId, workspaces.id))
        .where(isNull(workspaces.deletedAt))
        .groupBy(accounts.tenantId),
      // Which CRM each company's workspaces connected (provider and status only; never the credential).
      // A company counts as connected when any live workspace is; a healthy connection is shown first.
      db
        .select({
          tenantId: crmConnections.tenantId,
          provider: crmConnections.provider,
          status: crmConnections.status,
          accountLabel: crmConnections.externalAccountLabel,
          connectedAt: crmConnections.createdAt,
          lastCheckedAt: crmConnections.lastCheckedAt,
        })
        .from(crmConnections)
        .innerJoin(workspaces, eq(crmConnections.workspaceId, workspaces.id))
        .where(isNull(workspaces.deletedAt))
        .orderBy(desc(sql`${crmConnections.status} = 'connected'`), crmConnections.createdAt),
    ]);
    const crmByTenant = new Map<string, (typeof crmRows)[number]>();
    for (const r of crmRows) if (!crmByTenant.has(r.tenantId)) crmByTenant.set(r.tenantId, r);

    const byTenant = (rows: { tenantId: string; n: number }[]) => new Map(rows.map((r) => [r.tenantId, Number(r.n)]));
    const wsMap = byTenant(wsCounts);
    const accMap = byTenant(accountCounts);

    const companies = tenantRows.map((t) => {
      const roles: Record<string, number> = {};
      for (const m of memberCounts) if (m.tenantId === t.id) roles[m.role] = Number(m.n);
      return {
        ...t,
        workspaces: wsMap.get(t.id) ?? 0,
        members: Object.values(roles).reduce((a, b) => a + b, 0),
        membersByRole: roles,
        accounts: accMap.get(t.id) ?? 0,
        crm: (() => {
          const c = crmByTenant.get(t.id);
          return c ? { provider: c.provider, status: c.status, accountLabel: c.accountLabel, connectedAt: c.connectedAt, lastCheckedAt: c.lastCheckedAt } : null;
        })(),
      };
    });

    return {
      totals: {
        companies: companies.length,
        workspaces: companies.reduce((a, c) => a + c.workspaces, 0),
        members: companies.reduce((a, c) => a + c.members, 0),
        accounts: companies.reduce((a, c) => a + c.accounts, 0),
        crmConnected: companies.filter((c) => c.crm).length,
      },
      companies,
    };
  });

  /** Onboard a new customer company: tenant, first workspace and its tenant admin. */
  app.post("/v1/platform/tenants", { preHandler: requirePlatformAdmin }, async (req) => {
    const body = z
      .object({
        companyName: z.string().trim().min(1, "Company name is required").max(200),
        workspaceName: z.string().trim().max(200).optional(),
        adminEmail: z.string().trim().email("Enter a valid admin email"),
        adminName: z.string().trim().max(200).optional(),
        adminPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
      })
      .parse(req.body);

    const created = await provisionTenant({
      tenantName: body.companyName,
      workspaceName: body.workspaceName || "Default Workspace",
      adminEmail: body.adminEmail,
      adminName: body.adminName,
      adminPassword: body.adminPassword,
    });
    await writeAudit({
      tenantId: created.tenantId,
      workspaceId: created.workspaceId,
      actorUserId: req.actor!.userId,
      action: "tenant.created_by_platform_admin",
      entityType: "tenant",
      entityId: created.tenantId,
      metadata: { adminEmail: created.email },
    });
    return { tenantId: created.tenantId, adminEmail: created.email };
  });

  /** Reset a company's research usage for the current month back to 0 units. */
  app.post("/v1/platform/tenants/:tenantId/reset-research", { preHandler: requirePlatformAdmin }, async (req) => {
    const { tenantId } = req.params as { tenantId: string };
    const db = getDb();
    const [before] = await db
      .select({ used: tenants.researchUsedMonthly })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!before) throw notFound("Company not found");

    const [after] = await db
      .update(tenants)
      .set({ researchUsedMonthly: 0 })
      .where(eq(tenants.id, tenantId))
      .returning({ researchUsedMonthly: tenants.researchUsedMonthly, researchQuotaMonthly: tenants.researchQuotaMonthly });
    await writeAudit({
      tenantId,
      actorUserId: req.actor!.userId,
      action: "tenant.research_usage_reset_by_platform_admin",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { previousUsed: before.used },
    });
    return after;
  });

  /** Rename a company (Platform → Users → Edit). */
  app.patch("/v1/platform/tenants/:tenantId", { preHandler: requirePlatformAdmin }, async (req) => {
    const { tenantId } = req.params as { tenantId: string };
    const body = z
      .object({ name: z.string().trim().min(1, "Company name is required").max(200) })
      .parse(req.body);
    const db = getDb();
    const [before] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);
    if (!before) throw notFound("Company not found");

    const [after] = await db
      .update(tenants)
      .set({ name: body.name })
      .where(eq(tenants.id, tenantId))
      .returning({ id: tenants.id, name: tenants.name });
    await writeAudit({
      tenantId,
      actorUserId: req.actor!.userId,
      action: "tenant.renamed_by_platform_admin",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { previousName: before.name, name: body.name },
    });
    return after;
  });

  /**
   * One company in detail (Platform → Companies / Users → View): research usage, website,
   * CRM, users by role and per workspace. Like /users, only tenant admins are named.
   */
  app.get("/v1/platform/tenants/:tenantId", { preHandler: requirePlatformAdmin }, async (req) => {
    const { tenantId } = req.params as { tenantId: string };
    const db = getDb();
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        createdAt: tenants.createdAt,
        researchQuotaMonthly: tenants.researchQuotaMonthly,
        researchUsedMonthly: tenants.researchUsedMonthly,
        researchQuotaPeriodStart: tenants.researchQuotaPeriodStart,
      })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);
    if (!tenant) throw notFound("Company not found");

    const live = and(eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt));
    const [wsRows, userCount, roleCounts, wsUserCounts, accountCounts, adminRows, offerRows, crmRows] = await Promise.all([
      db
        .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
        .from(workspaces)
        .where(live)
        .orderBy(workspaces.createdAt),
      db
        .select({ n: countDistinct(memberships.userId) })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt))),
      db
        .select({ role: memberships.role, n: countDistinct(memberships.userId) })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt)))
        .groupBy(memberships.role),
      db
        .select({ workspaceId: memberships.workspaceId, n: count() })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt)))
        .groupBy(memberships.workspaceId),
      db
        .select({ workspaceId: accounts.workspaceId, n: count() })
        .from(accounts)
        .where(eq(accounts.tenantId, tenantId))
        .groupBy(accounts.workspaceId),
      db
        .selectDistinct({ userId: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "tenant_admin"), isNull(memberships.revokedAt))),
      db
        .select({ workspaceId: offers.workspaceId, sellerWebsite: offers.sellerWebsite, sellerCompany: offers.sellerCompany })
        .from(offers)
        .innerJoin(workspaces, eq(offers.workspaceId, workspaces.id))
        .where(live),
      db
        .select({
          workspaceId: crmConnections.workspaceId,
          provider: crmConnections.provider,
          status: crmConnections.status,
          accountLabel: crmConnections.externalAccountLabel,
          connectedAt: crmConnections.createdAt,
          lastCheckedAt: crmConnections.lastCheckedAt,
        })
        .from(crmConnections)
        .innerJoin(workspaces, eq(crmConnections.workspaceId, workspaces.id))
        .where(live)
        .orderBy(desc(sql`${crmConnections.status} = 'connected'`), crmConnections.createdAt),
    ]);

    const usersByWs = new Map(wsUserCounts.map((r) => [r.workspaceId, Number(r.n)]));
    const accountsByWs = new Map(accountCounts.map((r) => [r.workspaceId, Number(r.n)]));
    const offerByWs = new Map(offerRows.map((o) => [o.workspaceId, o]));
    const crmByWs = new Map<string, (typeof crmRows)[number]>();
    for (const c of crmRows) if (!crmByWs.has(c.workspaceId)) crmByWs.set(c.workspaceId, c);
    const usersByRole: Record<string, number> = {};
    for (const r of roleCounts) usersByRole[r.role] = Number(r.n);

    const ws = wsRows.map((w) => {
      const crm = crmByWs.get(w.id);
      return {
        ...w,
        users: usersByWs.get(w.id) ?? 0,
        accounts: accountsByWs.get(w.id) ?? 0,
        website: offerByWs.get(w.id)?.sellerWebsite || null,
        crm: crm
          ? {
              provider: crm.provider,
              status: crm.status,
              accountLabel: crm.accountLabel,
              connectedAt: crm.connectedAt,
              lastCheckedAt: crm.lastCheckedAt,
            }
          : null,
      };
    });
    const firstOffer = offerRows.find((o) => o.sellerWebsite) ?? offerRows.find((o) => o.sellerCompany);
    const firstCrm = crmRows[0];

    return {
      ...tenant,
      website: firstOffer?.sellerWebsite || null,
      sellerCompany: firstOffer?.sellerCompany || null,
      users: Number(userCount[0]?.n ?? 0),
      accounts: ws.reduce((a, w) => a + w.accounts, 0),
      usersByRole,
      admins: adminRows,
      workspaces: ws,
      crm: firstCrm
        ? {
            provider: firstCrm.provider,
            status: firstCrm.status,
            accountLabel: firstCrm.accountLabel,
            connectedAt: firstCrm.connectedAt,
            lastCheckedAt: firstCrm.lastCheckedAt,
          }
        : null,
    };
  });

  /**
   * Delete a company. Like deleting a workspace, its records stay (audit trail, spec §4
   * retention) but it disappears: every workspace is deleted, every membership revoked
   * (so its people can no longer sign in to it), and it is hidden from platform lists.
   */
  app.delete("/v1/platform/tenants/:tenantId", { preHandler: requirePlatformAdmin }, async (req) => {
    const { tenantId } = req.params as { tenantId: string };
    const db = getDb();
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);
    if (!tenant) throw notFound("Company not found");

    const now = new Date();
    await db.update(tenants).set({ deletedAt: now }).where(eq(tenants.id, tenantId));
    const wsDeleted = await db
      .update(workspaces)
      .set({ deletedAt: now })
      .where(and(eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt)))
      .returning({ id: workspaces.id });
    const revoked = await db
      .update(memberships)
      .set({ revokedAt: now })
      .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt)))
      .returning({ id: memberships.id });
    forgetMemberships();
    await writeAudit({
      tenantId,
      actorUserId: req.actor!.userId,
      action: "tenant.deleted_by_platform_admin",
      entityType: "tenant",
      entityId: tenantId,
      metadata: { name: tenant.name, workspacesDeleted: wsDeleted.length, membershipsRevoked: revoked.length },
    });
    return { deleted: true, tenantId };
  });

  /** Every workspace across all companies, with counts only. */
  app.get("/v1/platform/workspaces", { preHandler: requirePlatformAdmin }, async () => {
    const db = getDb();
    const [rows, memberCounts, accountCounts] = await Promise.all([
      db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          tenantId: workspaces.tenantId,
          companyName: tenants.name,
          createdAt: workspaces.createdAt,
        })
        .from(workspaces)
        .innerJoin(tenants, eq(workspaces.tenantId, tenants.id))
        .where(isNull(workspaces.deletedAt))
        .orderBy(tenants.name, workspaces.createdAt),
      db
        .select({ workspaceId: memberships.workspaceId, n: count() })
        .from(memberships)
        .where(isNull(memberships.revokedAt))
        .groupBy(memberships.workspaceId),
      db.select({ workspaceId: accounts.workspaceId, n: count() }).from(accounts).groupBy(accounts.workspaceId),
    ]);
    const members = new Map(memberCounts.map((r) => [r.workspaceId, Number(r.n)]));
    const accs = new Map(accountCounts.map((r) => [r.workspaceId, Number(r.n)]));
    return {
      workspaces: rows.map((w) => ({ ...w, members: members.get(w.id) ?? 0, accounts: accs.get(w.id) ?? 0 })),
    };
  });

  /**
   * Users per company: head counts by role and workspace, plus the tenant admins'
   * names and emails (the people the platform admin onboards). Other members stay counts.
   */
  app.get("/v1/platform/users", { preHandler: requirePlatformAdmin }, async () => {
    const db = getDb();
    const [tenantRows, userCounts, roleCounts, wsRows, wsUserCounts, adminRows, crmRows] = await Promise.all([
      db
        .select({ id: tenants.id, name: tenants.name, createdAt: tenants.createdAt })
        .from(tenants)
        .where(isNull(tenants.deletedAt))
        .orderBy(tenants.name),
      db
        .select({ tenantId: memberships.tenantId, n: countDistinct(memberships.userId) })
        .from(memberships)
        .where(isNull(memberships.revokedAt))
        .groupBy(memberships.tenantId),
      db
        .select({ tenantId: memberships.tenantId, role: memberships.role, n: countDistinct(memberships.userId) })
        .from(memberships)
        .where(isNull(memberships.revokedAt))
        .groupBy(memberships.tenantId, memberships.role),
      db
        .select({ id: workspaces.id, name: workspaces.name, tenantId: workspaces.tenantId })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt))
        .orderBy(workspaces.createdAt),
      db
        .select({ workspaceId: memberships.workspaceId, n: count() })
        .from(memberships)
        .where(isNull(memberships.revokedAt))
        .groupBy(memberships.workspaceId),
      db
        .selectDistinct({ tenantId: memberships.tenantId, userId: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(and(eq(memberships.role, "tenant_admin"), isNull(memberships.revokedAt))),
      // Which CRM each company connected (provider and status only); a healthy connection first.
      db
        .select({
          tenantId: crmConnections.tenantId,
          provider: crmConnections.provider,
          status: crmConnections.status,
          accountLabel: crmConnections.externalAccountLabel,
          connectedAt: crmConnections.createdAt,
          lastCheckedAt: crmConnections.lastCheckedAt,
        })
        .from(crmConnections)
        .innerJoin(workspaces, eq(crmConnections.workspaceId, workspaces.id))
        .where(isNull(workspaces.deletedAt))
        .orderBy(desc(sql`${crmConnections.status} = 'connected'`), crmConnections.createdAt),
    ]);
    const crmByTenant = new Map<string, (typeof crmRows)[number]>();
    for (const r of crmRows) if (!crmByTenant.has(r.tenantId)) crmByTenant.set(r.tenantId, r);
    const usersByTenant = new Map(userCounts.map((r) => [r.tenantId, Number(r.n)]));
    const usersByWs = new Map(wsUserCounts.map((r) => [r.workspaceId, Number(r.n)]));

    const companies = tenantRows.map((t) => {
      const usersByRole: Record<string, number> = {};
      for (const r of roleCounts) if (r.tenantId === t.id) usersByRole[r.role] = Number(r.n);
      const ws = wsRows.filter((w) => w.tenantId === t.id);
      return {
        ...t,
        users: usersByTenant.get(t.id) ?? 0,
        usersByRole,
        admins: adminRows.filter((a) => a.tenantId === t.id).map(({ userId, name, email }) => ({ userId, name, email })),
        workspaces: ws.map((w) => ({ id: w.id, name: w.name, users: usersByWs.get(w.id) ?? 0 })),
        crm: (() => {
          const c = crmByTenant.get(t.id);
          return c
            ? { provider: c.provider, status: c.status, accountLabel: c.accountLabel, connectedAt: c.connectedAt, lastCheckedAt: c.lastCheckedAt }
            : null;
        })(),
      };
    });

    return {
      totals: {
        users: companies.reduce((a, c) => a + c.users, 0),
        admins: new Set(adminRows.map((a) => a.userId)).size,
        companies: companies.length,
        workspaces: wsRows.length,
      },
      companies,
    };
  });

  /** Add an empty workspace to an existing company. */
  app.post("/v1/platform/workspaces", { preHandler: requirePlatformAdmin }, async (req) => {
    const body = z
      .object({
        tenantId: z.string().min(1, "Choose a company"),
        name: z.string().trim().min(1, "Workspace name is required").max(200),
        adminEmail: z.string().trim().email("Enter a valid admin email").optional(),
        adminName: z.string().trim().max(200).optional(),
        adminPassword: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
      })
      .parse(req.body);

    const created = await provisionWorkspace({ ...body, actorUserId: req.actor!.userId });
    await writeAudit({
      tenantId: body.tenantId,
      workspaceId: created.workspaceId,
      actorUserId: req.actor!.userId,
      action: "workspace.created_by_platform_admin",
      entityType: "workspace",
      entityId: created.workspaceId,
      metadata: { name: body.name, adminEmails: created.adminEmails },
    });
    return created;
  });

  /** Sign-up requests from the login page, newest first. */
  app.get("/v1/platform/access-requests", { preHandler: requirePlatformAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(accessRequestStatuses).optional() }).parse(req.query);
    return listAccessRequests(status);
  });

  /** Approve: into a brand-new company (as its tenant admin) or an existing company's workspace with a role. */
  app.post("/v1/platform/access-requests/:id/approve", { preHandler: requirePlatformAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const decision = z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("new_company"),
          companyName: z.string().trim().min(1, "Company name is required").max(200),
          workspaceName: z.string().trim().max(200).optional(),
        }),
        z.object({
          kind: z.literal("existing_workspace"),
          tenantId: z.string().min(1, "Choose a company"),
          workspaceId: z.string().min(1, "Choose a workspace"),
          role: z.enum(membershipRoles),
        }),
      ])
      .parse(req.body);
    return approveAccessRequest(id, req.actor!.userId, decision);
  });

  app.post("/v1/platform/access-requests/:id/reject", { preHandler: requirePlatformAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().trim().min(1, "Give a reason").max(1000) }).parse(req.body);
    await rejectAccessRequest(id, req.actor!.userId, reason);
    return { ok: true };
  });
}
