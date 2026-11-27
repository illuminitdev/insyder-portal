import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { tenants, workspaces } from "./identity.js";

export const accountResearchStates = [
  "unresearched",
  "researching",
  "researched",
  "failed",
] as const;
export type AccountResearchState = (typeof accountResearchStates)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    domain: text("domain"),
    country: text("country"),
    legalName: text("legal_name"),
    /** manual | import | discovery */
    source: text("source").notNull().default("manual"),
    researchState: text("research_state")
      .notNull()
      .$type<AccountResearchState>()
      .default("unresearched"),
    fitScore: integer("fit_score"),
    acceptanceState: text("acceptance_state")
      .notNull()
      .default("draft"),
    ownerUserId: text("owner_user_id"),
    /** Set when this record was merged into another account (merge history, R2) */
    mergedIntoId: text("merged_into_id"),
    /** Archived as not relevant: hidden from lists by default, restorable, and not re-added by research */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by"),
    /** Deleted (soft): hidden everywhere; research does not bring it back */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    version: integer("version").notNull().default(1),
    /** AI-written "why now?" summary (Exa Answer). Untrusted: shown with its citations, never as evidence */
    whyNowText: text("why_now_text"),
    /** JSON array of { url, title, publishedDate } the summary cites */
    whyNowCitationsJson: text("why_now_citations_json"),
    whyNowAt: timestamp("why_now_at", { withTimezone: true }),
    /** 1-sentence summary of what the company is/does */
    companySummary: text("company_summary"),
    /** Playbook template key this account belongs to */
    playbookTemplateKey: text("playbook_template_key"),
    /** Logo image address found on the company's website (only the URL; nothing is stored) */
    logoUrl: text("logo_url"),
    /** The domain the logo was looked up for: a different domain means look again */
    logoDomain: text("logo_domain"),
    logoCheckedAt: timestamp("logo_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounts_workspace_idx").on(t.workspaceId),
    index("accounts_tenant_idx").on(t.tenantId),
    index("accounts_domain_idx").on(t.workspaceId, t.domain),
    index("accounts_playbook_idx").on(t.workspaceId, t.playbookTemplateKey),
  ],
);

export const accountIdentities = pgTable(
  "account_identities",
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
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_identities_account_idx").on(t.accountId),
    uniqueIndex("account_identities_ws_kind_val_uidx").on(t.workspaceId, t.kind, t.value),
  ],
);

export const mergeCandidates = pgTable(
  "merge_candidates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    accountIdA: text("account_id_a")
      .notNull()
      .references(() => accounts.id),
    accountIdB: text("account_id_b")
      .notNull()
      .references(() => accounts.id),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merge_candidates_workspace_idx").on(t.workspaceId)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    status: text("status").notNull().default("queued"),
    totalRows: integer("total_rows").notNull().default(0),
    successRows: integer("success_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    rowErrorsJson: text("row_errors_json"),
    mappingJson: text("mapping_json"),
    /** csv | hubspot (later: other CRMs) */
    source: text("source").notNull().default("csv"),
    /** CRM import: what was chosen (lifecycle stages, contacts) */
    filterJson: text("filter_json"),
    /** CRM import: added / linked / skipped / suppressed / contacts counts for the done screen */
    summaryJson: text("summary_json"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("import_jobs_workspace_idx").on(t.workspaceId)],
);
