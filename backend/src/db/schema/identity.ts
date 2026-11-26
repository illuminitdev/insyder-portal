import {
  boolean,
  pgTable,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  researchQuotaMonthly: integer("research_quota_monthly").notNull().default(100),
  researchUsedMonthly: integer("research_used_monthly").notNull().default(0),
  researchQuotaPeriodStart: timestamp("research_quota_period_start", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Plan key from services/plans.ts (starter | growth | enterprise) */
  plan: text("plan").notNull().default("starter"),
  /** unpaid | active | past_due | canceled. Research needs "active". */
  billingStatus: text("billing_status").notNull().default("unpaid"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** End of the paid period Stripe reported last (next renewal date) */
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when a platform admin deletes the company; its records stay for the audit trail */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    /** ISO 4217 — disclosed on outcomes reports (gate 11) */
    currency: text("currency").notNull().default("GBP"),
    /** Tenant-specific acceptance gates, e.g. {"requireBudgetKnown": false} */
    acceptanceGatesJson: text("acceptance_gates_json").notNull().default("{}"),
    /** White label colours set by the tenant admin (JSON { primary, accent, sidebar }); null = Insyder colours */
    brandingJson: text("branding_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when a tenant admin deletes the workspace; its records stay for the audit trail */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("workspaces_tenant_idx").on(t.tenantId)],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Set for admin-issued temporary passwords; cleared when the user picks their own */
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    /** App owner: sees counts across all tenants, never tenant records. Set only by the seed script. */
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uidx").on(t.email)],
);

/** Roles from spec §4 */
export const membershipRoles = [
  "tenant_admin",
  "researcher",
  "sdr",
  "sales_reviewer",
  "partner",
  "analyst",
] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().$type<MembershipRole>(),
    /** When set, user loses subsequent workspace access (gate 2) */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_ws_uidx").on(t.userId, t.workspaceId),
    index("memberships_workspace_idx").on(t.workspaceId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_uidx").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);
