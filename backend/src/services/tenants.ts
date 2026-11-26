import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  entitlements,
  memberships,
  offers,
  playbookVersions,
  tenants,
  users,
  workspaces,
} from "../db/schema/index.js";
import { hashPassword } from "../auth/password.js";
import { newId } from "../utils/ids.js";
import { conflict, forbidden, notFound, validationError } from "../utils/errors.js";
import { forgetMemberships } from "../middleware/requireMembership.js";
import { grantMembership } from "./memberships.js";
import { BUILT_IN_PLAYBOOKS } from "./playbooks.js";
import { assertCanAddWorkspace, DEFAULT_PLAN, PLANS, type PlanKey } from "./plans.js";
import type { BillingStatus } from "../db/schema/index.js";

/** Versioned playbook templates (R1); defined with the rest of the playbook logic. */
const PLAYBOOKS = BUILT_IN_PLAYBOOKS;

/**
 * Creates a tenant, its first workspace and its first tenant admin (with the password
 * the platform admin chose), plus the default offer, playbooks and entitlement.
 */
export async function provisionTenant(input: {
  tenantName: string;
  workspaceName: string;
  adminEmail: string;
  adminName?: string;
  /** Plain password chosen by the platform admin, or… */
  adminPassword?: string;
  /** …an already-hashed one (an approved access request keeps the password its requester chose) */
  adminPasswordHash?: string;
  /** Plan for the new company (default Starter); sets its monthly research units */
  plan?: PlanKey;
  /** Default "unpaid": research stays locked until the plan is paid */
  billingStatus?: BillingStatus;
  /** Temporary password (e.g. emailed after a paid sign-up): the admin must choose their own at first login */
  mustChangePassword?: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}) {
  if (!input.adminPassword && !input.adminPasswordHash) throw validationError("A password is required for the admin");
  const db = getDb();
  const email = input.adminEmail.trim().toLowerCase();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw conflict(`${email} already has an account`);

  const tenantId = newId("ten");
  const workspaceId = newId("ws");
  const userId = newId("usr");

  const plan = input.plan ?? DEFAULT_PLAN;
  await db.insert(tenants).values({
    id: tenantId,
    name: input.tenantName,
    plan,
    researchQuotaMonthly: PLANS[plan].researchUnits,
    billingStatus: input.billingStatus ?? "unpaid",
    stripeCustomerId: input.stripeCustomerId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
  });
  await db.insert(workspaces).values({ id: workspaceId, tenantId, name: input.workspaceName });
  await db.insert(users).values({
    id: userId,
    email,
    name: input.adminName?.trim() || email.split("@")[0]!,
    passwordHash: input.adminPasswordHash ?? (await hashPassword(input.adminPassword!)),
    mustChangePassword: input.mustChangePassword ?? false,
  });
  await db.insert(memberships).values({ id: newId("mem"), tenantId, workspaceId, userId, role: "tenant_admin" });
  await ensureWorkspaceDefaults(tenantId, workspaceId);

  return { tenantId, workspaceId, userId, email };
}

/** Adds any missing default offer, playbook templates and entitlement row (idempotent). */
export async function ensureWorkspaceDefaults(tenantId: string, workspaceId: string) {
  const db = getDb();
  const [offer] = await db.select({ id: offers.id }).from(offers).where(eq(offers.workspaceId, workspaceId)).limit(1);
  if (!offer) {
    await db.insert(offers).values({ id: newId("ofr"), tenantId, workspaceId, offering: "Infrastructure servers and managed IT" });
  }

  const existingPlaybooks = await db
    .select()
    .from(playbookVersions)
    .where(eq(playbookVersions.workspaceId, workspaceId));
  for (const p of PLAYBOOKS) {
    if (existingPlaybooks.some((e) => e.templateKey === p.templateKey)) continue;
    await db.insert(playbookVersions).values({
      id: newId("pbk"),
      tenantId,
      workspaceId,
      name: p.name,
      templateKey: p.templateKey,
      version: 1,
      rulesJson: JSON.stringify(p.rules),
    });
  }

  const [ent] = await db
    .select()
    .from(entitlements)
    .where(and(eq(entitlements.workspaceId, workspaceId), eq(entitlements.tenantId, tenantId)))
    .limit(1);
  if (!ent) await db.insert(entitlements).values({ id: newId("ent"), tenantId, workspaceId });
}

export async function provisionWorkspace(input: {
  tenantId: string;
  name: string;
  adminEmail?: string;
  adminName?: string;
  /** Needed only when the admin email has no account yet */
  adminPassword?: string;
  actorUserId: string;
}) {
  const db = getDb();
  const [tenant] = await db
    .select({ id: tenants.id, deletedAt: tenants.deletedAt })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant || tenant.deletedAt) throw notFound("Company not found");
  await assertCanAddWorkspace(input.tenantId);

  const companyAdmins = input.adminEmail
    ? []
    : await db
        .selectDistinct({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(eq(memberships.tenantId, input.tenantId), eq(memberships.role, "tenant_admin"), isNull(memberships.revokedAt)),
        );
  if (!input.adminEmail && !companyAdmins.length) {
    throw validationError("This company has no tenant admin yet. Enter an admin email for the new workspace.");
  }
  if (input.adminEmail) {
    // Refuse before creating anything, so a rejected email never leaves an orphan workspace
    const [u] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.email, input.adminEmail.trim().toLowerCase()))
      .limit(1);
    if (u?.isPlatformAdmin) throw forbidden("This email belongs to the platform admin and can't be added to a workspace");
    if (!u && (!input.adminPassword || input.adminPassword.length < 8)) {
      throw validationError("Set a password of at least 8 characters for this new admin");
    }
  }

  const workspaceId = newId("ws");
  await db.insert(workspaces).values({ id: workspaceId, tenantId: input.tenantId, name: input.name });
  await ensureWorkspaceDefaults(input.tenantId, workspaceId);

  if (input.adminEmail) {
    const granted = await grantMembership({
      tenantId: input.tenantId,
      workspaceId,
      email: input.adminEmail,
      name: input.adminName,
      role: "tenant_admin",
      password: input.adminPassword,
      actorUserId: input.actorUserId,
    });
    return { workspaceId, adminEmails: [input.adminEmail.trim().toLowerCase()], existingAccount: granted.existingAccount };
  }

  for (const a of companyAdmins) {
    await db.insert(memberships).values({ id: newId("mem"), tenantId: input.tenantId, workspaceId, userId: a.userId, role: "tenant_admin" });
  }
  forgetMemberships();
  const admins = await Promise.all(
    companyAdmins.map(async (a) => (await db.select({ email: users.email }).from(users).where(eq(users.id, a.userId)).limit(1))[0]!.email),
  );
  return { workspaceId, adminEmails: admins, existingAccount: true };
}
