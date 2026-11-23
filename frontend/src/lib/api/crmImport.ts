import { api } from "./client";

export type CrmImportStage = { key: string; label: string; default: boolean };

/** `available: false` until a supported CRM is connected and healthy; that's what hides the import button. */
export type CrmImportAvailability =
  | { available: false }
  | {
      available: true;
      provider: string;
      providerLabel: string;
      accountLabel: string | null;
      companyCount: number | null;
      max: number;
      stages: CrmImportStage[];
      usage: { quotaMonthly: number; usedMonthly: number };
      canResearch: boolean;
    };

export type CrmImportOptions = { stages: string[]; includeContacts: boolean };

export type CrmImportCounts = {
  added: number;
  linked: number;
  alreadyImported: number;
  customers: number;
  suppressed: number;
  noDomain: number;
  contacts: number;
  mergeReview: number;
};

export type CrmImportOutcomeKind = "new" | "linked" | "already_imported" | "customer" | "suppressed" | "no_domain";

export type CrmImportPreview = {
  provider: string;
  providerLabel: string;
  total: number;
  sampled: number;
  estimate: boolean;
  counts: CrmImportCounts;
  willImport: number;
  max: number;
  sample: Array<{
    id: string;
    name: string;
    domain: string | null;
    country: string | null;
    industry: string | null;
    lifecycleStage: string | null;
    outcome: CrmImportOutcomeKind;
  }>;
};

export type CrmImportJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  source: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  rowErrors: string[];
  summary: CrmImportCounts | null;
  createdAt: string;
  completedAt: string | null;
};

const base = (workspaceId: string) => `/v1/workspaces/${workspaceId}/imports/crm`;

export function getCrmImportAvailability(workspaceId: string) {
  return api<CrmImportAvailability>(base(workspaceId));
}

export function previewCrmImport(workspaceId: string, options: CrmImportOptions) {
  return api<CrmImportPreview>(`${base(workspaceId)}/preview`, { method: "POST", body: JSON.stringify(options) });
}

export function startCrmImport(workspaceId: string, options: CrmImportOptions) {
  return api<{ importJobId: string; status: string; alreadyRunning: boolean }>(base(workspaceId), {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function getCrmImportJob(importJobId: string, workspaceId: string) {
  return api<{ import: CrmImportJob }>(`/v1/imports/${importJobId}?workspaceId=${workspaceId}`);
}

/** Research several accounts at once; each one is a normal account research run. */
export function startBatchResearch(workspaceId: string, accountIds: string[], budgetPerAccount = 3) {
  return api<{
    queued: Array<{ accountId: string; researchRunId: string }>;
    skipped: Array<{ accountId: string; reason: string }>;
    unitsReserved: number;
  }>(`/v1/workspaces/${workspaceId}/research-runs/batch`, {
    method: "POST",
    body: JSON.stringify({ accountIds, budgetPerAccount }),
  });
}
