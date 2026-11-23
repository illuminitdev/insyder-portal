import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { tenants, workspaces } from "./identity.js";

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    offering: text("offering").notNull().default(""),
    /** Our own company name, used in stakeholder briefs ("who we are") */
    sellerCompany: text("seller_company"),
    /** Our own website, e.g. https://example.com: role hypotheses read it to learn what we offer */
    sellerWebsite: text("seller_website"),
    /** Our company profile read from our website (CompanyProfile JSON); suggestions until applied */
    companyProfileJson: text("company_profile_json"),
    /** The website analysis: Exa agent run id, running | completed | failed, and any error */
    profileRunId: text("profile_run_id"),
    profileStatus: text("profile_status"),
    profileError: text("profile_error"),
    profileStartedAt: timestamp("profile_started_at", { withTimezone: true }),
    profileUpdatedAt: timestamp("profile_updated_at", { withTimezone: true }),
    /** Our products and services: [{ name, description, proofPoints?, bestFor? }] */
    offerItemsJson: text("offer_items_json").notNull().default("[]"),
    activePlaybookTemplateKey: text("active_playbook_template_key").notNull().default("infrastructure"),
    buyerRolesJson: text("buyer_roles_json").notNull().default("[]"),
    industriesJson: text("industries_json").notNull().default("[]"),
    companySizesJson: text("company_sizes_json").notNull().default("[]"),
    territoryJson: text("territory_json").notNull().default("[]"),
    exclusionsJson: text("exclusions_json").notNull().default("[]"),
    eventWindowDays: integer("event_window_days").notNull().default(90),
    naturalLanguageBrief: text("natural_language_brief"),
    structuredQueryJson: text("structured_query_json"),
    unsupportedFiltersJson: text("unsupported_filters_json").notNull().default("[]"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offers_workspace_idx").on(t.workspaceId)],
);

export const playbookVersions = pgTable(
  "playbook_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    templateKey: text("template_key").notNull(),
    version: integer("version").notNull(),
    rulesJson: text("rules_json").notNull().default("{}"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playbook_versions_workspace_idx").on(t.workspaceId)],
);
