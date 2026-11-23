import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accessRequestStatuses = ["pending", "approved", "rejected"] as const;
export type AccessRequestStatus = (typeof accessRequestStatuses)[number];

/**
 * "Create account" requests from the login page. Nobody gets access until the platform admin
 * approves one, which creates the user (with the password they chose) and grants membership.
 * The password is stored only as a hash, exactly like a user's.
 */
export const accessRequests = pgTable(
  "access_requests",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    companyName: text("company_name").notNull(),
    message: text("message"),
    passwordHash: text("password_hash").notNull(),
    status: text("status").notNull().$type<AccessRequestStatus>().default("pending"),
    /** Reason shown to the platform admin's colleagues; required when rejecting */
    decisionReason: text("decision_reason"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Where an approved request landed */
    tenantId: text("tenant_id"),
    workspaceId: text("workspace_id"),
    role: text("role"),
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One open request per email; a new submission refreshes it instead of piling up
    uniqueIndex("access_requests_pending_email_uidx").on(t.email).where(sql`status = 'pending'`),
    index("access_requests_status_idx").on(t.status, t.createdAt),
  ],
);
