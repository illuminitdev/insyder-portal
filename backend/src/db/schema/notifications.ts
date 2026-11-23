import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants, workspaces } from "./identity.js";

/**
 * Per person, per bell group: when they last read it and when they cleared it. Kept on the
 * server so the bell shows the same thing on every device and browser.
 */
export const notificationReads = pgTable(
  "notification_reads",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id").notNull(),
    /** Bell group key, e.g. "review_assigned" */
    key: text("key").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notification_reads_user_key_uidx").on(t.workspaceId, t.userId, t.key)],
);
