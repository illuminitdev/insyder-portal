import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts, crmMappings } from "../db/schema/index.js";
import { getCrmConnection, getCrmProvider, SUPPORTED_CRM_PROVIDERS } from "../providers/crm/index.js";
import type { CrmImportCompany, CrmImportFilter, CrmProvider } from "../providers/crm/types.js";
import { companyNameKey, normalizeDomain } from "../utils/normalize.js";
import { validationError } from "../utils/errors.js";
import { activeSuppressionSet, normalizeSuppressionValue } from "./suppressions.js";

/** Most companies one import run reads from the CRM. */
export const CRM_IMPORT_MAX = 5000;
/** Preview reads this many companies to estimate what will happen (the real import reads all). */
export const CRM_PREVIEW_SAMPLE = 500;
/** Contacts read per imported company. */
export const CRM_IMPORT_CONTACTS_PER_COMPANY = 25;

export const CRM_LABELS: Record<string, string> = { hubspot: "HubSpot", salesforce: "Salesforce" };

/** Lifecycle stages offered on the "Choose" step, with what is ticked by default. */
export const CRM_IMPORT_STAGES = [
  { key: "lead", label: "Lead", default: true },
  { key: "marketingqualifiedlead", label: "Marketing qualified lead", default: true },
  { key: "salesqualifiedlead", label: "Sales qualified lead", default: true },
  { key: "subscriber", label: "Subscriber", default: false },
  { key: "opportunity", label: "Opportunity", default: false },
  { key: "customer", label: "Customer (added to suppression)", default: false },
  { key: "evangelist", label: "Evangelist", default: false },
  { key: "other", label: "Other or no stage", default: true },
] as const;

export type CrmImportOptions = CrmImportFilter & { includeContacts: boolean };

export type CrmImportOutcome =
  | { kind: "new"; domain: string; nameDupId: string | null }
  | { kind: "linked"; domain: string; accountId: string }
  | { kind: "already_imported" }
  | { kind: "customer"; domain: string | null }
  | { kind: "suppressed"; domain: string }
  | { kind: "no_domain" };

/**
 * The connected CRM, if this company can import from it: connected, supported, and the adapter can read.
 * Returns null otherwise, which is what hides the import button.
 */
export async function importableCrm(
  tenantId: string,
  workspaceId: string,
): Promise<{ provider: CrmProvider; key: string; accountLabel: string | null } | null> {
  const conn = await getCrmConnection(tenantId, workspaceId);
  if (!conn || conn.status !== "connected" || !SUPPORTED_CRM_PROVIDERS.has(conn.provider)) return null;
  const provider = await getCrmProvider(tenantId, workspaceId);
  if (!provider.listCompaniesForImport || !provider.countCompaniesForImport) return null;
  return { provider, key: conn.provider, accountLabel: conn.externalAccountLabel };
}

export function parseImportOptions(raw: unknown): CrmImportOptions {
  const o = (raw ?? {}) as Partial<CrmImportOptions>;
  const allowed = new Set<string>(CRM_IMPORT_STAGES.map((s) => s.key));
  const stages = Array.isArray(o.stages) ? o.stages.filter((s): s is string => typeof s === "string" && allowed.has(s)) : [];
  if (!stages.length) throw validationError("Pick at least one lifecycle stage to import");
  return { stages, includeContacts: Boolean(o.includeContacts) };
}

/** What the workspace already has, so each CRM company can be classified without a query per row. */
export async function loadImportContext(tenantId: string, workspaceId: string, providerKey: string) {
  const db = getDb();
  const [existing, mapped, suppressed] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name, domain: accounts.domain })
      .from(accounts)
      .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.tenantId, tenantId), isNull(accounts.mergedIntoId))),
    db
      .select({ entityId: crmMappings.entityId, externalId: crmMappings.externalId })
      .from(crmMappings)
      .where(
        and(
          eq(crmMappings.workspaceId, workspaceId),
          eq(crmMappings.provider, providerKey),
          eq(crmMappings.entityType, "account"),
        ),
      ),
    activeSuppressionSet(workspaceId),
  ]);
  const byDomain = new Map<string, { id: string; name: string }>();
  const byName = new Map<string, { id: string; name: string }>();
  for (const a of existing) {
    if (a.domain) byDomain.set(a.domain, a);
    byName.set(companyNameKey(a.name), a);
  }
  return {
    byDomain,
    byName,
    suppressed,
    /** CRM company ids already linked to an account in this workspace */
    mappedExternal: new Set(mapped.map((m) => m.externalId).filter((x): x is string => Boolean(x))),
    /** Accounts that already have a CRM link (never re-linked to a different CRM record) */
    mappedAccounts: new Set(mapped.map((m) => m.entityId)),
  };
}

export type ImportContext = Awaited<ReturnType<typeof loadImportContext>>;

/** Decide what happens to one CRM company. Pure: the caller does the writes. */
export function classifyCompany(c: CrmImportCompany, ctx: ImportContext): CrmImportOutcome {
  if (ctx.mappedExternal.has(c.id)) return { kind: "already_imported" };
  const domain = normalizeDomain(c.domain);
  if (c.lifecycleStage === "customer") return { kind: "customer", domain };
  if (!domain) return { kind: "no_domain" };
  if (ctx.suppressed.has(normalizeSuppressionValue(domain))) return { kind: "suppressed", domain };
  const dup = ctx.byDomain.get(domain);
  if (dup) return { kind: "linked", domain, accountId: dup.id };
  const nameDup = c.name ? ctx.byName.get(companyNameKey(c.name)) : undefined;
  return { kind: "new", domain, nameDupId: nameDup?.id ?? null };
}

export type ImportCounts = {
  added: number;
  linked: number;
  alreadyImported: number;
  customers: number;
  suppressed: number;
  noDomain: number;
  contacts: number;
  mergeReview: number;
};

export const emptyCounts = (): ImportCounts => ({
  added: 0,
  linked: 0,
  alreadyImported: 0,
  customers: 0,
  suppressed: 0,
  noDomain: 0,
  contacts: 0,
  mergeReview: 0,
});

/** Read-only estimate for the preview step: total, outcome counts over a sample, and the first rows. */
export async function previewCrmImport(tenantId: string, workspaceId: string, options: CrmImportOptions) {
  const crm = await importableCrm(tenantId, workspaceId);
  if (!crm) throw validationError("Connect a CRM first (Settings → CRM)");
  const { provider, key } = crm;
  const total = await provider.countCompaniesForImport!(options);
  const ctx = await loadImportContext(tenantId, workspaceId, key);
  const counts = emptyCounts();
  const sample: Array<CrmImportCompany & { outcome: CrmImportOutcome["kind"] }> = [];
  let cursor: string | null = null;
  let read = 0;
  do {
    const page: { companies: CrmImportCompany[]; next: string | null } = await provider.listCompaniesForImport!(options, cursor, 100);
    for (const c of page.companies) {
      const o = classifyCompany(c, ctx);
      tally(counts, o);
      if (o.kind === "new" && o.nameDupId) counts.mergeReview++;
      if (sample.length < 20) sample.push({ ...c, outcome: o.kind });
    }
    read += page.companies.length;
    cursor = page.next;
  } while (cursor && read < Math.min(CRM_PREVIEW_SAMPLE, CRM_IMPORT_MAX));

  return {
    provider: key,
    providerLabel: CRM_LABELS[key] ?? key,
    total,
    sampled: read,
    /** Counts cover only `sampled` companies when it's less than `total` */
    estimate: read < total,
    counts,
    willImport: Math.min(total, CRM_IMPORT_MAX),
    max: CRM_IMPORT_MAX,
    sample,
  };
}

export function tally(counts: ImportCounts, o: CrmImportOutcome) {
  if (o.kind === "new") counts.added++;
  else if (o.kind === "linked") counts.linked++;
  else if (o.kind === "already_imported") counts.alreadyImported++;
  else if (o.kind === "customer") counts.customers++;
  else if (o.kind === "suppressed") counts.suppressed++;
  else counts.noDomain++;
}
