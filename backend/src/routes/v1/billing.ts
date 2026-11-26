import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema/index.js";
import { isStripeConfigured } from "../../config/env.js";
import { assertIntakeKey } from "../../utils/intakeKey.js";
import { getUsage } from "../../services/budget.js";
import { billingDetails, billingPortalUrl, changeTenantPlan, handleStripeEvent, signupStatus, startSignup, verifyWebhook } from "../../services/billing.js";
import { getTenantPlan, listPlans, planKeys, planUsage, CADENCE_LABELS, type PlanKey } from "../../services/plans.js";

const planEnum = z.enum(planKeys as [PlanKey, ...PlanKey[]]);

const signupBody = z.object({
  plan: planEnum,
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  phone: z.string().trim().max(40).optional(),
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\//i.test(v), "Website should start with http:// or https://")
    .optional(),
});

export async function billingRoutes(app: FastifyInstance) {
  /** The plans with prices and limits (public: the portal UI reads them instead of hardcoding). */
  app.get("/v1/plans", async () => ({ plans: listPlans(), paymentsEnabled: isStripeConfigured() }));

  /** Paid sign-up, step 1: the marketing site sends the buyer's details and gets a Stripe Checkout URL back. */
  app.post("/v1/intake/signups", async (req, reply) => {
    assertIntakeKey(req);
    const result = await startSignup(signupBody.parse(req.body));
    reply.status(201);
    return result;
  });

  /** For the marketing site's "payment received" page: is the account ready yet? */
  app.get("/v1/intake/signups/status", async (req) => {
    assertIntakeKey(req);
    const { sessionId } = z.object({ sessionId: z.string().min(1).max(300) }).parse(req.query);
    return signupStatus(sessionId);
  });

  /** Any member: the company's plan, for limits shown in the app (e.g. monitor frequencies). */
  app.get("/v1/workspaces/:workspaceId/plan", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    const p = await getTenantPlan(m.tenantId);
    return {
      key: p.key,
      name: p.name,
      billingStatus: p.billingStatus,
      monitorCadences: p.monitorCadenceHours.map((h) => ({ hours: h, label: CADENCE_LABELS[h] ?? `${h}h` })),
    };
  });

  /** Tenant admin: plan, price, status, renewal date and usage against the plan's limits. */
  app.get("/v1/workspaces/:workspaceId/billing", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "manage_membership");
    const [usage, research] = await Promise.all([planUsage(m.tenantId), getUsage(m.tenantId)]);
    return {
      ...usage,
      research: { used: research.usedMonthly, max: research.quotaMonthly, periodStart: research.periodStart },
      plans: listPlans(),
      paymentsEnabled: isStripeConfigured(),
    };
  });

  /** Tenant admin: invoices, card on file and cancellation date, read live from Stripe. */
  app.get("/v1/workspaces/:workspaceId/billing/details", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "manage_membership");
    return billingDetails(m.tenantId);
  });

  /** Tenant admin: pay for or switch plan. Returns { url } for Stripe Checkout, or { switched: true }. */
  app.post("/v1/workspaces/:workspaceId/billing/change-plan", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "manage_membership");
    const { plan } = z.object({ plan: planEnum }).parse(req.body);
    const [me] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, m.userId)).limit(1);
    return changeTenantPlan({ tenantId: m.tenantId, plan, adminEmail: me!.email, actorUserId: m.userId });
  });

  /** Tenant admin: Stripe's billing page (card, invoices, cancel). */
  app.post("/v1/workspaces/:workspaceId/billing/portal", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "manage_membership");
    const { flow } = z.object({ flow: z.enum(["cancel", "payment_method"]).optional() }).parse(req.body ?? {});
    return billingPortalUrl(m.tenantId, flow);
  });

  /**
   * Stripe webhook. Registered in its own scope so its JSON body stays raw bytes:
   * the signature check needs the exact body Stripe sent.
   */
  await app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/v1/stripe/webhook", async (req) => {
      const sig = req.headers["stripe-signature"];
      const event = verifyWebhook(req.body as Buffer, typeof sig === "string" ? sig : undefined);
      await handleStripeEvent(event);
      return { received: true };
    });
  });
}
