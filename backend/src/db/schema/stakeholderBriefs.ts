import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenants, workspaces } from "./identity.js";
import { accounts } from "./accounts.js";
import { contacts } from "./contacts.js";
import { researchRuns } from "./research.js";

/**
 * A meeting-prep brief about one decision-maker contact: who they are, how they likely evaluate
 * ideas, which of our offers to lead with, questions, objections. Every point is a working
 * hypothesis built from public sources, never verified (spec §6). Each generation is a new row so
 * earlier versions are kept; progress and errors live on the linked research run.
 */
export const stakeholderBriefs = pgTable(
  "stakeholder_briefs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    researchRunId: text("research_run_id")
      .notNull()
      .references(() => researchRuns.id),
    /** What the seller told us about the meeting: type, date, purpose, what we already know */
    meetingJson: text("meeting_json").notNull().default("{}"),
    /** The generated brief (StakeholderBriefContent); null until the run completes */
    contentJson: text("content_json"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("stakeholder_briefs_contact_idx").on(t.contactId, t.createdAt),
    index("stakeholder_briefs_run_idx").on(t.researchRunId),
  ],
);
