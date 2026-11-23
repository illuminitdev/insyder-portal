import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accessRequests, membershipRoles, tenants, users, workspaces, type AccessRequestStatus, type MembershipRole } from "../db/schema/index.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { newId } from "../utils/ids.js";
import { conflict, notFound, validationError } from "../utils/errors.js";
import { writeAudit } from "./audit.js";
import { grantMembership } from "./memberships.js";
import { provisionTenant } from "./tenants.js";

/**
 * Submit (or refresh) an access request from the login page. Always resolves the same way,
 * whether or not the email already has an account, so the form can't be used to probe emails.
 */
export async function submitAccessRequest(input: { name: string; email: string; companyName: string; message?: string; password: string }) {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) return;

  const values = {
    name: input.name.trim(),
    companyName: input.companyName.trim(),
    message: input.message?.trim() || null,
    passwordHash: await hashPassword(input.password),
    updatedAt: new Date(),
  };
  const [pending] = await db
    .select({ id: accessRequests.id })
    .from(accessRequests)
    .where(and(eq(accessRequests.email, email), eq(accessRequests.status, "pending")))
    .limit(1);
  if (pending) {
    await db.update(accessRequests).set(values).where(eq(accessRequests.id, pending.id));
    return;
  }
  await db
    .insert(accessRequests)
    .values({ id: newId("areq"), email, status: "pending", ...values })
    .onConflictDoNothing();
}

/**
 * For the login page: if this email+password match an access request that hasn't become an
 * account, say where it stands. Only revealed with the right password, so it leaks nothing.
 */
export async function accessRequestStatusForLogin(email: string, password: string): Promise<"pending" | "rejected" | null> {
  const db = getDb();
  const [latest] = await db
    .select({ status: accessRequests.status, passwordHash: accessRequests.passwordHash })
    .from(accessRequests)
    .where(eq(accessRequests.email, email.trim().toLowerCase()))
    .orderBy(desc(accessRequests.createdAt))
    .limit(1);
  if (!latest || latest.status === "approved") return null;
  return (await verifyPassword(password, latest.passwordHash)) ? latest.status : null;
}

/** Platform admin view. Never includes the password hash. */
export async function listAccessRequests(status?: AccessRequestStatus) {
  const db = getDb();
  const rows = await db
    .select({
      id: accessRequests.id,
      name: accessRequests.name,
      email: accessRequests.email,
      companyName: accessRequests.companyName,
      message: accessRequests.message,
      status: accessRequests.status,
      decisionReason: accessRequests.decisionReason,
      reviewedAt: accessRequests.reviewedAt,
      reviewedByName: users.name,
      tenantId: accessRequests.tenantId,
      workspaceId: accessRequests.workspaceId,
      role: accessRequests.role,
      createdAt: accessRequests.createdAt,
      updatedAt: accessRequests.updatedAt,
    })
    .from(accessRequests)
    .leftJoin(users, eq(users.id, accessRequests.reviewedBy))
    .where(status ? eq(accessRequests.status, status) : undefined)
    .orderBy(desc(accessRequests.createdAt));

  // Name where approved requests landed
  const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const wsRows = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces);
  const tName = new Map(tenantRows.map((t) => [t.id, t.name]));
  const wName = new Map(wsRows.map((w) => [w.id, w.name]));
  const all = await db.select({ status: accessRequests.status }).from(accessRequests);
  return {
    counts: {
      pending: all.filter((r) => r.status === "pending").length,
      approved: all.filter((r) => r.status === "approved").length,
      rejected: all.filter((r) => r.status === "rejected").length,
    },
    requests: rows.map((r) => ({
      ...r,
      tenantName: r.tenantId ? (tName.get(r.tenantId) ?? null) : null,
      workspaceName: r.workspaceId ? (wName.get(r.workspaceId) ?? null) : null,
    })),
  };
}

export type ApproveDecision =
  | { kind: "new_company"; companyName: string; workspaceName?: string }
  | { kind: "existing_workspace"; tenantId: string; workspaceId: string; role: MembershipRole };

async function loadPending(id: string) {
  const db = getDb();
  const [req] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
  if (!req) throw notFound("Access request not found");
  if (req.status !== "pending") throw conflict(`This request was already ${req.status}`);
  return req;
}

/** Approve: create the account with the requester's own password and give it access where the admin chose. */
export async function approveAccessRequest(id: string, actorUserId: string, decision: ApproveDecision) {
  const req = await loadPending(id);
  const db = getDb();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, req.email)).limit(1);
  if (taken) throw conflict(`${req.email} already has an account. Reject this request, or add them from the company's Members page.`);

  let landed: { tenantId: string; workspaceId: string; userId: string; role: MembershipRole };
  if (decision.kind === "new_company") {
    const created = await provisionTenant({
      tenantName: decision.companyName.trim(),
      workspaceName: decision.workspaceName?.trim() || "Default Workspace",
      adminEmail: req.email,
      adminName: req.name,
      adminPasswordHash: req.passwordHash,
    });
    landed = { tenantId: created.tenantId, workspaceId: created.workspaceId, userId: created.userId, role: "tenant_admin" };
  } else {
    if (!membershipRoles.includes(decision.role)) throw validationError("Choose a valid role");
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, decision.workspaceId), eq(workspaces.tenantId, decision.tenantId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!ws) throw notFound("That workspace doesn't belong to the chosen company");
    const userId = newId("usr");
    await db.insert(users).values({ id: userId, email: req.email, name: req.name, passwordHash: req.passwordHash });
    // Existing-account path: grants the membership and writes the tenant's membership audit
    await grantMembership({
      tenantId: decision.tenantId,
      workspaceId: decision.workspaceId,
      email: req.email,
      role: decision.role,
      actorUserId,
    });
    landed = { tenantId: decision.tenantId, workspaceId: decision.workspaceId, userId, role: decision.role };
  }

  const now = new Date();
  await db
    .update(accessRequests)
    .set({ status: "approved", reviewedBy: actorUserId, reviewedAt: now, updatedAt: now, ...landed })
    .where(eq(accessRequests.id, id));
  await writeAudit({
    tenantId: landed.tenantId,
    workspaceId: landed.workspaceId,
    actorUserId,
    action: "access_request.approved_by_platform_admin",
    entityType: "access_request",
    entityId: id,
    metadata: { email: req.email, role: landed.role, newCompany: decision.kind === "new_company" },
  });
  return landed;
}

/** Reject with a reason. No account is created; the person may request again later. */
export async function rejectAccessRequest(id: string, actorUserId: string, reason: string) {
  await loadPending(id);
  const now = new Date();
  await getDb()
    .update(accessRequests)
    .set({ status: "rejected", decisionReason: reason.trim(), reviewedBy: actorUserId, reviewedAt: now, updatedAt: now })
    .where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")));
}
