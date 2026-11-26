import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const billingStatuses = ["unpaid", "active", "past_due", "canceled"] as const;
export type BillingStatus = (typeof billingStatuses)[number];

export const signupStatuses = ["pending", "provisioning", "provisioned", "failed"] as const;
export type SignupStatus = (typeof signupStatuses)[number];

/**
 * Paid sign-ups from the marketing site's Plans page. A row is created before Stripe Checkout;
 * when Stripe confirms payment the company, workspace and admin are created and the row is
 * marked provisioned. No password is stored here: a temporary one is emailed on provisioning.
 */
export const signups = pgTable(
  "signups",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    companyName: text("company_name").notNull(),
    website: text("website"),
    status: text("status").notNull().$type<SignupStatus>().default("pending"),
    stripeSessionId: text("stripe_session_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    tenantId: text("tenant_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("signups_email_idx").on(t.email), uniqueIndex("signups_session_uidx").on(t.stripeSessionId)],
);
