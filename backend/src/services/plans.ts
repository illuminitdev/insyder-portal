import { and, countDistinct, eq, isNull, count } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { memberships, monitors, tenants, users, workspaces, type BillingStatus } from "../db/schema/index.js";
import { AppError, notFound, validationError } from "../utils/errors.js";
import { writeAudit } from "./audit.js";

/**
 * The plans. Change prices and limits HERE (and on the marketing site's Plans page,
 * Insyder repo: frontend/src/components/plans.ts). Prices are in PLAN_CURRENCY (UK pounds), per company per month.
 * Monitor cadences are in hours: 24 = daily, 168 = weekly, 720 = monthly.
 */
export const PLANS = {
  starter: {
    name: "Starter",
    price: 40,
    researchUnits: 100,
    maxWorkspaces: 1,
    maxUsers: 4,
    monitorCadenceHours: [720],
  },
  growth: {
    name: "Growth",
    price: 80,
    researchUnits: 250,
    maxWorkspaces: 3,
    maxUsers: 10,
    monitorCadenceHours: [168, 720],
  },
  enterprise: {
    name: "Enterprise",
    price: 150,
    researchUnits: 500,
    maxWorkspaces: 6,
    maxUsers: 20,
    monitorCadenceHours: [24, 168],
  },
} as const satisfies Record<string, Plan>;

export type Plan = {
  name: string;
  price: number;
  researchUnits: number;
  maxWorkspaces: number;
  maxUsers: number;
  monitorCadenceHours: readonly number[];
};
/** Currency every plan is charged in (Stripe currency code). Prices above are whole pounds. */
export const PLAN_CURRENCY = "gbp" as const;

export type PlanKey = keyof typeof PLANS;
export const planKeys = Object.keys(PLANS) as PlanKey[];
export const DEFAULT_PLAN: PlanKey = "starter";

export function isPlanKey(v: unknown): v is PlanKey {
  return typeof v === "string" && Object.hasOwn(PLANS, v);
}

export function planOf(key: string | null | undefined): Plan & { key: PlanKey } {
  const k = isPlanKey(key) ? key : DEFAULT_PLAN;
  return { key: k, ...PLANS[k] };
}

export const CADENCE_LABELS: Record<number, string> = { 24: "Daily", 168: "Weekly", 720: "Monthly" };

/** Public list for the portal UI and the marketing site. */
export function listPlans() {
  return planKeys.map((key) => ({
    key,
    ...PLANS[key],
    monitorCadences: PLANS[key].monitorCadenceHours.map((h) => ({ hours: h, label: CADENCE_LABELS[h] ?? `${h}h` })),
  }));
}

/** Plan limit reached: 403 with a code the UI can show next to an "Upgrade" link. */
function planLimit(message: string) {
  return new AppError(403, message, "plan_limit");
}

/** Which of the plans that allow `hours`, for "available on Growth" style hints. */
function plansAllowing(hours: number) {
  return planKeys.filter((k) => (PLANS[k].monitorCadenceHours as readonly number[]).includes(hours)).map((k) => PLANS[k].name);
}

/** The allowed cadence closest to `hours` (ties go to the less frequent one, which costs fewer units). */
export function nearestAllowedCadence(hours: number, allowed: readonly number[]): number {
  return [...allowed].sort((a, b) => Math.abs(a - hours) - Math.abs(b - hours) || b - a)[0]!;
}

export async function getTenantPlan(tenantId: string) {
  const db = getDb();
  const [t] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) throw notFound("Company not found");
  return { ...planOf(t.plan), billingStatus: t.billingStatus as BillingStatus };
}

/** People with an active membership anywhere in the company (each person counted once). */
export async function countTenantUsers(tenantId: string) {
  const db = getDb();
  const [row] = await db
    .select({ n: countDistinct(memberships.userId) })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt)));
  return Number(row?.n ?? 0);
}

export async function countTenantWorkspaces(tenantId: string) {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(workspaces)
    .where(and(eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt)));
  return Number(row?.n ?? 0);
}

export async function assertCanAddWorkspace(tenantId: string) {
  const plan = await getTenantPlan(tenantId);
  const used = await countTenantWorkspaces(tenantId);
  if (used >= plan.maxWorkspaces) {
    throw planLimit(
      `Your ${plan.name} plan includes ${plan.maxWorkspaces} workspace${plan.maxWorkspaces === 1 ? "" : "s"}. Upgrade your plan to add more.`,
    );
  }
}

/** Adding `email` to the company must not go over the plan's users. Someone already in the company doesn't count again. */
export async function assertCanAddUser(tenantId: string, email: string) {
  const db = getDb();
  const [existing] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), isNull(memberships.revokedAt), eq(users.email, email.trim().toLowerCase())))
    .limit(1);
  if (existing) return;
  const plan = await getTenantPlan(tenantId);
  const used = await countTenantUsers(tenantId);
  if (used >= plan.maxUsers) {
    throw planLimit(`Your ${plan.name} plan includes ${plan.maxUsers} users. Upgrade your plan to add more people.`);
  }
}

export async function assertCadenceAllowed(tenantId: string, hours: number) {
  const plan = await getTenantPlan(tenantId);
  if (!(plan.monitorCadenceHours as readonly number[]).includes(hours)) {
    const label = CADENCE_LABELS[hours] ?? `Every ${hours} hours`;
    const on = plansAllowing(hours);
    throw planLimit(
      `${label} monitors aren't included in the ${plan.name} plan${on.length ? ` (available on ${on.join(" and ")})` : ""}.`,
    );
  }
}

/** The cadence a new monitor gets when none is chosen: weekly if the plan has it, else its first one. */
export async function defaultCadence(tenantId: string) {
  const plan = await getTenantPlan(tenantId);
  const allowed = plan.monitorCadenceHours as readonly number[];
  return allowed.includes(168) ? 168 : allowed[0]!;
}

/** Research spends money, so it needs a paid (active) subscription. */
export async function assertBillingActive(tenantId: string) {
  const plan = await getTenantPlan(tenantId);
  if (plan.billingStatus !== "active") {
    const why =
      plan.billingStatus === "past_due"
        ? "The last payment for your plan failed."
        : plan.billingStatus === "canceled"
          ? "Your plan has been cancelled."
          : "Your plan hasn't been paid yet.";
    throw new AppError(402, `${why} A company admin can fix this in Settings → Plan & billing.`, "billing_inactive");
  }
}

/**
 * Put a company on a plan (Stripe webhook or platform admin): sets the monthly research units
 * and moves monitors onto cadences the plan allows. Users and workspaces are never removed;
 * a company over its new limits just can't add more.
 */
export async function setTenantPlan(input: {
  tenantId: string;
  plan: PlanKey;
  billingStatus?: BillingStatus;
  actorUserId?: string | null;
  source: "stripe" | "platform_admin" | "signup";
}) {
  if (!isPlanKey(input.plan)) throw validationError("Unknown plan");
  const db = getDb();
  const [before] = await db
    .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!before) throw notFound("Company not found");
  const plan = PLANS[input.plan];

  await db
    .update(tenants)
    .set({
      plan: input.plan,
      researchQuotaMonthly: plan.researchUnits,
      ...(input.billingStatus ? { billingStatus: input.billingStatus } : {}),
    })
    .where(eq(tenants.id, input.tenantId));

  // Monitors on a cadence the plan doesn't include move to the nearest one it does
  const allowed = plan.monitorCadenceHours as readonly number[];
  const mons = await db
    .select({ id: monitors.id, cadenceHours: monitors.cadenceHours })
    .from(monitors)
    .where(eq(monitors.tenantId, input.tenantId));
  let movedMonitors = 0;
  for (const m of mons) {
    if (allowed.includes(m.cadenceHours)) continue;
    await db
      .update(monitors)
      .set({ cadenceHours: nearestAllowedCadence(m.cadenceHours, allowed), updatedAt: new Date() })
      .where(eq(monitors.id, m.id));
    movedMonitors++;
  }

  if (before.plan !== input.plan || (input.billingStatus && before.billingStatus !== input.billingStatus)) {
    await writeAudit({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "tenant.plan_changed",
      entityType: "tenant",
      entityId: input.tenantId,
      metadata: {
        source: input.source,
        previousPlan: before.plan,
        plan: input.plan,
        previousBillingStatus: before.billingStatus,
        billingStatus: input.billingStatus ?? before.billingStatus,
        movedMonitors,
      },
    });
  }
}

/** Plan, limits and usage for the tenant admin's "Plan & billing" page. */
export async function planUsage(tenantId: string) {
  const db = getDb();
  const [t] = await db
    .select({
      plan: tenants.plan,
      billingStatus: tenants.billingStatus,
      currentPeriodEnd: tenants.currentPeriodEnd,
      stripeCustomerId: tenants.stripeCustomerId,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) throw notFound("Company not found");
  const plan = planOf(t.plan);
  return {
    plan: {
      key: plan.key,
      name: plan.name,
      price: plan.price,
      researchUnits: plan.researchUnits,
      maxUsers: plan.maxUsers,
      maxWorkspaces: plan.maxWorkspaces,
      monitorCadences: plan.monitorCadenceHours.map((h) => ({ hours: h, label: CADENCE_LABELS[h] ?? `${h}h` })),
    },
    billingStatus: t.billingStatus as BillingStatus,
    currentPeriodEnd: t.currentPeriodEnd,
    hasStripeCustomer: Boolean(t.stripeCustomerId),
    users: { used: await countTenantUsers(tenantId), max: plan.maxUsers },
    workspaces: { used: await countTenantWorkspaces(tenantId), max: plan.maxWorkspaces },
  };
}
