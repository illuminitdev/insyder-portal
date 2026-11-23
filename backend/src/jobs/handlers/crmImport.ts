import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { accountIdentities, accounts, contacts, crmMappings, importJobs, mergeCandidates, suppressions } from "../../db/schema/index.js";
import { CrmError } from "../../providers/crm/types.js";
import type { CrmImportCompany } from "../../providers/crm/types.js";
import { writeAudit } from "../../services/audit.js";
import {
  classifyCompany,
  CRM_IMPORT_CONTACTS_PER_COMPANY,
  CRM_IMPORT_MAX,
  CRM_LABELS,
  emptyCounts,
  importableCrm,
  loadImportContext,
  parseImportOptions,
  tally,
} from "../../services/crmImport.js";
import { normalizeSuppressionValue } from "../../services/suppressions.js";
import { newId } from "../../utils/ids.js";
import { companyNameKey, normalizeCountry } from "../../utils/normalize.js";

/**
 * Import companies (and optionally their contacts) from the connected CRM into a workspace.
 * Safe to re-run: companies already linked through crm_mappings are skipped, never duplicated.
 * Insyder never writes to the CRM here; it only reads.
 */
export async function handleCrmImport(payload: { importJobId: string }) {
  const db = getDb();
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, payload.importJobId)).limit(1);
  if (!job || job.status === "completed" || job.status === "failed") return;
  await db.update(importJobs).set({ status: "running" }).where(eq(importJobs.id, job.id));

  const fail = async (message: string) => {
    await db
      .update(importJobs)
      .set({ status: "failed", rowErrorsJson: JSON.stringify([message]), completedAt: new Date() })
      .where(eq(importJobs.id, job.id));
  };

  let options;
  try {
    options = parseImportOptions(job.filterJson ? JSON.parse(job.filterJson) : {});
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Invalid import options");
  }

  const crm = await importableCrm(job.tenantId, job.workspaceId);
  if (!crm) return fail("The CRM is no longer connected. Reconnect it in Settings → CRM and import again.");
  const { provider, key } = crm;
  const label = CRM_LABELS[key] ?? key;
  const ctx = await loadImportContext(job.tenantId, job.workspaceId, key);
  const counts = emptyCounts();
  const rowErrors: string[] = [];
  let read = 0;
  let cursor: string | null = null;

  const saveProgress = () =>
    db
      .update(importJobs)
      .set({
        totalRows: read,
        successRows: counts.added + counts.linked,
        errorRows: rowErrors.length,
        summaryJson: JSON.stringify(counts),
      })
      .where(eq(importJobs.id, job.id));

  const mapping = (entityType: "account" | "contact", entityId: string, externalId: string) =>
    db
      .insert(crmMappings)
      .values({
        id: newId("crm"),
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        provider: key,
        entityType,
        entityId,
        externalId,
        // Linked, not yet sent: the first push will update this CRM record instead of creating one
        syncStatus: "recorded",
      })
      // An account already linked to a CRM record keeps that link
      .onConflictDoNothing();

  const importOne = async (c: CrmImportCompany) => {
    const o = classifyCompany(c, ctx);
    const who = c.name || c.domain || `${label} company ${c.id}`;
    tally(counts, o);

    if (o.kind === "customer") {
      const value = o.domain ? normalizeSuppressionValue(o.domain) : null;
      if (value && !ctx.suppressed.has(value)) {
        await db.insert(suppressions).values({
          id: newId("sup"),
          tenantId: job.tenantId,
          workspaceId: job.workspaceId,
          addressOrDomain: value,
          reason: "existing_customer",
          source: "crm_import",
          createdBy: job.createdBy,
        });
        ctx.suppressed.add(value);
      }
      return;
    }
    if (o.kind === "no_domain") {
      rowErrors.push(`${who}: no website in ${label}, so it can't be researched (skipped)`);
      return;
    }
    if (o.kind === "suppressed") {
      rowErrors.push(`${who}: ${o.domain} is suppressed (skipped)`);
      return;
    }
    if (o.kind === "already_imported") return;

    if (o.kind === "linked") {
      if (!ctx.mappedAccounts.has(o.accountId)) {
        await mapping("account", o.accountId, c.id);
        ctx.mappedAccounts.add(o.accountId);
      }
      ctx.mappedExternal.add(c.id);
      return;
    }

    // New account
    const name = (c.name || o.domain).slice(0, 300);
    const accountId = newId("acc");
    await db.insert(accounts).values({
      id: accountId,
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      name,
      domain: o.domain,
      country: normalizeCountry(c.country),
      source: "crm_import",
      researchState: "unresearched",
      acceptanceState: "draft",
    });
    await db
      .insert(accountIdentities)
      .values({ id: newId("aid"), tenantId: job.tenantId, workspaceId: job.workspaceId, accountId, kind: "domain", value: o.domain })
      .onConflictDoNothing();
    await mapping("account", accountId, c.id);
    ctx.byDomain.set(o.domain, { id: accountId, name });
    ctx.mappedExternal.add(c.id);
    ctx.mappedAccounts.add(accountId);

    // Same name, different domain: shown for review, never merged silently (gate 4)
    if (o.nameDupId) {
      const dup = ctx.byName.get(companyNameKey(name));
      await db.insert(mergeCandidates).values({
        id: newId("mrg"),
        tenantId: job.tenantId,
        workspaceId: job.workspaceId,
        accountIdA: o.nameDupId,
        accountIdB: accountId,
        reason: `Same company name as "${dup?.name ?? name}" with different domain ${o.domain} (imported from ${label})`,
      });
      counts.mergeReview++;
    } else {
      ctx.byName.set(companyNameKey(name), { id: accountId, name });
    }

    if (options.includeContacts && provider.listCompanyContacts) {
      try {
        const people = await provider.listCompanyContacts(c.id, CRM_IMPORT_CONTACTS_PER_COMPANY);
        for (const p of people) {
          const personName = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email;
          if (!personName) continue;
          const contactId = newId("con");
          await db.insert(contacts).values({
            id: contactId,
            tenantId: job.tenantId,
            workspaceId: job.workspaceId,
            accountId,
            name: personName.slice(0, 200),
            title: p.jobTitle,
            email: p.email,
            phone: p.phone,
            sourceType: "crm_import",
            sourceNote: `Imported from ${label}`,
            createdBy: job.createdBy,
          });
          await mapping("contact", contactId, p.id);
          counts.contacts++;
        }
      } catch (e) {
        // The company is imported either way; a contacts problem is reported, not fatal
        rowErrors.push(`${who}: contacts not imported (${e instanceof Error ? e.message : "error"})`);
      }
    }
  };

  try {
    do {
      const page: { companies: CrmImportCompany[]; next: string | null } = await provider.listCompaniesForImport!(options, cursor, 100);
      for (const c of page.companies) {
        if (read >= CRM_IMPORT_MAX) break;
        read++;
        try {
          await importOne(c);
        } catch (e) {
          rowErrors.push(`${c.name || c.id}: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      cursor = page.next;
      await saveProgress();
    } while (cursor && read < CRM_IMPORT_MAX);
  } catch (e) {
    // Rate limits and outages are retried by the queue; re-running skips what's already linked
    if (e instanceof CrmError && e.retryable) {
      await db.update(importJobs).set({ status: "queued" }).where(eq(importJobs.id, job.id));
      throw e;
    }
    return fail(e instanceof Error ? e.message : `${label} import failed`);
  }

  if (cursor) rowErrors.unshift(`Stopped after ${CRM_IMPORT_MAX} companies. Run the import again to bring in the rest.`);
  await db
    .update(importJobs)
    .set({
      status: "completed",
      totalRows: read,
      successRows: counts.added + counts.linked,
      errorRows: rowErrors.length,
      summaryJson: JSON.stringify(counts),
      rowErrorsJson: JSON.stringify(rowErrors.slice(0, 500)),
      completedAt: new Date(),
    })
    .where(eq(importJobs.id, job.id));
  await writeAudit({
    tenantId: job.tenantId,
    workspaceId: job.workspaceId,
    actorUserId: job.createdBy,
    action: "crm.import.completed",
    entityType: "import_job",
    entityId: job.id,
    metadata: { provider: key, read, ...counts },
  });
}
