import { randomInt } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import Stripe from "stripe";
import { getEnv, isStripeConfigured, portalUrl } from "../config/env.js";
import { getDb } from "../db/client.js";
import { memberships, offers, sessions, signups, tenants, users, type BillingStatus } from "../db/schema/index.js";
import { hashPassword } from "../auth/password.js";
import { forgetUserSessions } from "../auth/session.js";
import { AppError, conflict, notFound, validationError } from "../utils/errors.js";
import { newId } from "../utils/ids.js";
import { writeAudit } from "./audit.js";
import { loginDetailsEmail, sendEmail } from "./email.js";
import { isPlanKey, PLAN_CURRENCY, PLANS, planOf, setTenantPlan, type PlanKey } from "./plans.js";
import { provisionTenant } from "./tenants.js";

// ── Stripe client and prices ────────────────────────────────────────────────

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!isStripeConfigured()) {
    throw new AppError(503, "Payments aren't set up yet. Set STRIPE_SECRET_KEY in backend/.env.", "payments_not_configured");
  }
  stripeClient ??= new Stripe(getEnv().STRIPE_SECRET_KEY.trim());
  return stripeClient;
}

/** Stripe lookup key of a plan's monthly price. It includes currency and amount, so changing either makes a new Stripe price. */
function lookupKey(plan: PlanKey) {
  return `insyder_${plan}_${PLAN_CURRENCY}_${PLANS[plan].price}_monthly`;
}

const priceIds = new Map<PlanKey, string>();

/** The Stripe price for a plan, created on first use, so nothing has to be set up in the Stripe dashboard. */
async function ensurePrice(plan: PlanKey): Promise<string> {
  const cached = priceIds.get(plan);
  if (cached) return cached;
  const stripe = getStripe();
  const key = lookupKey(plan);
  const found = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  let id = found.data[0]?.id;
  if (!id) {
    const p = PLANS[plan];
    const created = await stripe.prices.create({
      currency: PLAN_CURRENCY,
      unit_amount: p.price * 100,
      recurring: { interval: "month" },
      lookup_key: key,
      product_data: { name: `Insyder ${p.name}`, metadata: { plan } },
      metadata: { plan },
    });
    id = created.id;
  }
  priceIds.set(plan, id);
  return id;
}

/** Which plan a Stripe price belongs to (metadata, else the lookup key). */
function planFromPrice(price: Stripe.Price | null | undefined): PlanKey | null {
  if (!price) return null;
  if (isPlanKey(price.metadata?.plan)) return price.metadata.plan;
  const m = /^insyder_([a-z]+)_[a-z]{3}_/.exec(price.lookup_key ?? "");
  return m && isPlanKey(m[1]) ? m[1] : null;
}

function billingStatusFrom(status: Stripe.Subscription.Status): BillingStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "unpaid";
}

/** Renewal date: on current Stripe API versions it lives on the subscription item. */
function periodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const legacy = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const ts = item?.current_period_end ?? legacy;
  return ts ? new Date(ts * 1000) : null;
}

function idOf(v: string | { id: string } | null | undefined) {
  return typeof v === "string" ? v : (v?.id ?? null);
}

// ── Paid sign-up from the marketing site ────────────────────────────────────

export type SignupInput = {
  plan: PlanKey;
  name: string;
  email: string;
  phone?: string;
  companyName: string;
  website?: string;
};

/**
 * Step 1 of a paid sign-up: save the buyer's details and open Stripe Checkout.
 * Nothing is created in the portal until Stripe confirms the payment (completeSignup).
 */
export async function startSignup(input: SignupInput) {
  const stripe = getStripe();
  if (!isPlanKey(input.plan)) throw validationError("Choose a plan");
  const email = input.email.trim().toLowerCase();
  const db = getDb();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw conflict("This email already has an Insyder account. Log in instead, or use another email.");

  const id = newId("sgn");
  await db.insert(signups).values({
    id,
    plan: input.plan,
    name: input.name.trim(),
    email,
    phone: input.phone?.trim() || null,
    companyName: input.companyName.trim(),
    website: input.website?.trim() || null,
  });

  const site = getEnv().MARKETING_SITE_URL.replace(/\/+$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: await ensurePrice(input.plan), quantity: 1 }],
    customer_email: email,
    client_reference_id: id,
    metadata: { signupId: id, plan: input.plan },
    subscription_data: { metadata: { signupId: id, plan: input.plan } },
    success_url: `${site}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/pricing/checkout?plan=${input.plan}&cancelled=1`,
  });
  await db.update(signups).set({ stripeSessionId: session.id, updatedAt: new Date() }).where(eq(signups.id, id));
  if (!session.url) throw new AppError(502, "Stripe didn't return a checkout page", "provider_error");
  return { url: session.url };
}

/** A readable temporary password: 12 characters without look-alikes (0/O, 1/l/I). */
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join("");
}

/**
 * Step 2, from the Stripe webhook: the payment went through, so create the company on its plan,
 * its first workspace and its admin with a temporary password, then email the login details.
 * Safe to run twice (Stripe retries webhooks): only the call that claims the row does the work.
 */
async function completeSignup(session: Stripe.Checkout.Session) {
  const signupId = session.metadata?.signupId;
  if (!signupId) return;
  const db = getDb();
  const [claimed] = await db
    .update(signups)
    .set({ status: "provisioning", updatedAt: new Date() })
    .where(and(eq(signups.id, signupId), inArray(signups.status, ["pending", "failed"])))
    .returning();
  if (!claimed) return; // already done, or being done by another delivery

  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  try {
    const password = tempPassword();
    const created = await provisionTenant({
      tenantName: claimed.companyName,
      workspaceName: "Default Workspace",
      adminEmail: claimed.email,
      adminName: claimed.name,
      adminPassword: password,
      plan: isPlanKey(claimed.plan) ? claimed.plan : "starter",
      billingStatus: "active",
      mustChangePassword: true,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
    if (claimed.website) {
      await db.update(offers).set({ sellerWebsite: claimed.website }).where(eq(offers.workspaceId, created.workspaceId));
    }
    if (subscriptionId) {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      await db.update(tenants).set({ currentPeriodEnd: periodEnd(sub) }).where(eq(tenants.id, created.tenantId));
    }
    await db
      .update(signups)
      .set({ status: "provisioned", tenantId: created.tenantId, stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, error: null, updatedAt: new Date() })
      .where(eq(signups.id, signupId));

    const emailed = await sendEmail(
      loginDetailsEmail({ name: claimed.name, email: claimed.email, tempPassword: password, planName: planOf(claimed.plan).name, companyName: claimed.companyName }),
    );
    await writeAudit({
      tenantId: created.tenantId,
      workspaceId: created.workspaceId,
      action: "tenant.created_by_signup",
      entityType: "tenant",
      entityId: created.tenantId,
      metadata: { plan: claimed.plan, email: claimed.email, phone: claimed.phone, website: claimed.website, loginEmailSent: emailed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(signups).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(signups.id, signupId));
    throw err; // Stripe retries the webhook; the row can be claimed again
  }
}

/** What the marketing site's success page shows: whether the account exists yet. Reveals no account details. */
export async function signupStatus(sessionId: string) {
  const db = getDb();
  const [row] = await db
    .select({ status: signups.status, email: signups.email, plan: signups.plan })
    .from(signups)
    .where(eq(signups.stripeSessionId, sessionId))
    .limit(1);
  if (!row) throw notFound("Sign-up not found");
  const [user, domain] = row.email.split("@");
  return {
    status: row.status === "provisioned" ? "ready" : row.status === "failed" ? "failed" : "processing",
    plan: planOf(row.plan).name,
    // Masked, e.g. j***@acme.com, so the page can say where the email went without exposing it
    emailHint: `${user!.slice(0, 1)}***@${domain}`,
    loginUrl: `${portalUrl()}/login`,
  };
}

// ── Subscriptions of existing companies ─────────────────────────────────────

/** Keep a company's plan, status and renewal date in step with its Stripe subscription. */
async function syncSubscription(sub: Stripe.Subscription) {
  const db = getDb();
  const customerId = idOf(sub.customer);
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.stripeSubscriptionId, sub.id))
    .limit(1);
  let tenantId = tenant?.id ?? (isTenantId(sub.metadata?.tenantId) ? sub.metadata.tenantId : null);
  if (!tenantId && customerId) {
    const [byCustomer] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.stripeCustomerId, customerId)).limit(1);
    tenantId = byCustomer?.id ?? null;
  }
  if (!tenantId) return; // a sign-up not provisioned yet: completeSignup handles it

  const plan = planFromPrice(sub.items?.data?.[0]?.price) ?? (isPlanKey(sub.metadata?.plan) ? sub.metadata.plan : null);
  const status = billingStatusFrom(sub.status);
  await db
    .update(tenants)
    .set({ stripeSubscriptionId: sub.id, stripeCustomerId: customerId, currentPeriodEnd: periodEnd(sub) })
    .where(eq(tenants.id, tenantId));
  if (plan) {
    await setTenantPlan({ tenantId, plan, billingStatus: status, source: "stripe" });
  } else {
    await db.update(tenants).set({ billingStatus: status }).where(eq(tenants.id, tenantId));
  }
}

function isTenantId(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("ten_");
}

/**
 * Tenant admin pays for, or switches, the company's plan.
 * With a live subscription the plan is switched in place (Stripe prorates); otherwise Checkout opens.
 */
export async function changeTenantPlan(input: { tenantId: string; plan: PlanKey; adminEmail: string; actorUserId: string }) {
  const stripe = getStripe();
  if (!isPlanKey(input.plan)) throw validationError("Choose a plan");
  const db = getDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!t) throw notFound("Company not found");
  const price = await ensurePrice(input.plan);

  if (t.stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(t.stripeSubscriptionId);
    if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") {
      const item = sub.items.data[0];
      if (!item) throw new AppError(502, "The Stripe subscription has no items", "provider_error");
      const updated = await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price }],
        proration_behavior: "create_prorations",
        metadata: { ...sub.metadata, plan: input.plan, tenantId: t.id },
      });
      await syncSubscription(updated);
      return { switched: true as const };
    }
  }

  const back = `${portalUrl()}/admin/settings/billing`;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    ...(t.stripeCustomerId ? { customer: t.stripeCustomerId } : { customer_email: input.adminEmail }),
    client_reference_id: t.id,
    metadata: { tenantId: t.id, plan: input.plan },
    subscription_data: { metadata: { tenantId: t.id, plan: input.plan } },
    success_url: `${back}?paid=1`,
    cancel_url: back,
  });
  if (!session.url) throw new AppError(502, "Stripe didn't return a checkout page", "provider_error");
  return { url: session.url };
}

export type PortalFlow = "cancel" | "payment_method";

/**
 * Stripe's own page for changing the card, downloading invoices or cancelling.
 * With a flow it opens straight on that step: "cancel" (needs a subscription) or "payment_method".
 */
export async function billingPortalUrl(tenantId: string, flow?: PortalFlow) {
  const stripe = getStripe();
  const [t] = await getDb()
    .select({ customer: tenants.stripeCustomerId, subscription: tenants.stripeSubscriptionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t?.customer) throw validationError("There's no payment on file yet. Choose a plan to pay first.");
  const returnUrl = `${portalUrl()}/admin/settings/billing`;
  let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (flow === "cancel") {
    if (!t.subscription) throw validationError("There's no subscription to cancel.");
    flowData = {
      type: "subscription_cancel",
      subscription_cancel: { subscription: t.subscription },
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    };
  } else if (flow === "payment_method") {
    flowData = {
      type: "payment_method_update",
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    };
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: t.customer,
    return_url: returnUrl,
    ...(flowData ? { flow_data: flowData } : {}),
  });
  return { url: session.url };
}

export type InvoiceRow = {
  id: string;
  number: string | null;
  date: string;
  description: string;
  status: string;
  amount: number;
  currency: string;
  url: string | null;
  pdf: string | null;
};

type CardInfo = { brand: string; last4: string; expMonth: number; expYear: number } | null;

function cardOf(pm: string | Stripe.PaymentMethod | null | undefined): CardInfo {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
}

/**
 * Tenant admin: what the billing page shows from Stripe: invoices (newest first), the card on file and,
 * if the plan was cancelled, the date it ends. Empty when payments aren't set up or nothing was paid yet.
 */
export async function billingDetails(tenantId: string) {
  const empty = { invoices: [] as InvoiceRow[], card: null as CardInfo, cancelAt: null as Date | null, error: null as string | null };
  if (!isStripeConfigured()) return empty;
  const [t] = await getDb()
    .select({ customer: tenants.stripeCustomerId, subscription: tenants.stripeSubscriptionId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t?.customer) return empty;
  const stripe = getStripe();
  try {
    const [list, sub] = await Promise.all([
      stripe.invoices.list({ customer: t.customer, limit: 24 }),
      t.subscription
        ? stripe.subscriptions.retrieve(t.subscription, { expand: ["default_payment_method"] }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const invoices: InvoiceRow[] = list.data
      .filter((i) => i.status !== "draft")
      .map((i) => ({
        id: i.id ?? "",
        number: i.number ?? null,
        date: new Date(i.created * 1000).toISOString(),
        description: i.lines.data[0]?.description ?? i.description ?? "Insyder subscription",
        status: i.status ?? "open",
        amount: i.total / 100,
        currency: i.currency,
        url: i.hosted_invoice_url ?? null,
        pdf: i.invoice_pdf ?? null,
      }));

    let card = cardOf(sub?.default_payment_method);
    if (!card) {
      const c = await stripe.customers.retrieve(t.customer, { expand: ["invoice_settings.default_payment_method"] });
      if (!("deleted" in c && c.deleted)) card = cardOf((c as Stripe.Customer).invoice_settings?.default_payment_method);
    }

    let cancelAt: Date | null = null;
    if (sub && sub.status !== "canceled") {
      if (sub.cancel_at) cancelAt = new Date(sub.cancel_at * 1000);
      else if (sub.cancel_at_period_end) cancelAt = periodEnd(sub);
    }
    return { invoices, card, cancelAt, error: null };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : "Couldn't load billing details from Stripe" };
  }
}

// ── Webhook ─────────────────────────────────────────────────────────────────

export function verifyWebhook(rawBody: Buffer, signature: string | undefined) {
  const secret = getEnv().STRIPE_WEBHOOK_SECRET.trim();
  if (!secret) throw new AppError(503, "Stripe webhook isn't set up. Set STRIPE_WEBHOOK_SECRET.", "payments_not_configured");
  if (!signature) throw new AppError(400, "Missing Stripe signature", "bad_signature");
  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new AppError(400, "Invalid Stripe signature", "bad_signature");
  }
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode !== "subscription" || s.payment_status === "unpaid") return;
      if (s.metadata?.signupId) {
        await completeSignup(s);
      } else if (isTenantId(s.metadata?.tenantId)) {
        const subId = idOf(s.subscription);
        await getDb()
          .update(tenants)
          .set({ stripeCustomerId: idOf(s.customer), stripeSubscriptionId: subId })
          .where(eq(tenants.id, s.metadata.tenantId));
        if (subId) await syncSubscription(await getStripe().subscriptions.retrieve(subId));
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      return;
    case "invoice.payment_failed": {
      const customerId = idOf(event.data.object.customer);
      if (customerId) {
        await getDb().update(tenants).set({ billingStatus: "past_due" }).where(eq(tenants.stripeCustomerId, customerId));
      }
      return;
    }
    default:
      return;
  }
}

// ── Platform admin ──────────────────────────────────────────────────────────

/**
 * Platform admin: issue a new temporary password to a company's first admin and email it.
 * If the email can't be sent, the password is returned so the admin can pass it on.
 */
export async function resendLoginDetails(tenantId: string, actorUserId: string) {
  const db = getDb();
  const [t] = await db.select({ id: tenants.id, name: tenants.name, plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t) throw notFound("Company not found");
  const [admin] = await db
    .select({ id: users.id, email: users.email, name: users.name, isPlatformAdmin: users.isPlatformAdmin })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "tenant_admin"), isNull(memberships.revokedAt)))
    .orderBy(memberships.createdAt)
    .limit(1);
  if (!admin || admin.isPlatformAdmin) throw notFound("This company has no admin to send login details to");

  const password = tempPassword();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() })
    .where(eq(users.id, admin.id));
  await db.delete(sessions).where(eq(sessions.userId, admin.id));
  forgetUserSessions(admin.id);

  const emailed = await sendEmail(
    loginDetailsEmail({ name: admin.name, email: admin.email, tempPassword: password, planName: planOf(t.plan).name, companyName: t.name }),
  );
  await writeAudit({
    tenantId,
    actorUserId,
    action: "tenant.login_details_resent",
    entityType: "user",
    entityId: admin.id,
    metadata: { email: admin.email, emailed },
  });
  return { email: admin.email, emailed, ...(emailed ? {} : { tempPassword: password }) };
}
