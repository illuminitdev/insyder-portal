import { api } from "./client";

export type PlatformCompany = {
  id: string;
  name: string;
  researchQuotaMonthly: number;
  researchUsedMonthly: number;
  createdAt: string;
  workspaces: number;
  members: number;
  membersByRole: Record<string, number>;
  accounts: number;
  /** The CRM this company connected, or null */
  crm: { provider: string; status: string; accountLabel: string | null; connectedAt: string; lastCheckedAt: string | null } | null;
};

export type PlatformOverview = {
  totals: { companies: number; workspaces: number; members: number; accounts: number; crmConnected: number };
  companies: PlatformCompany[];
};

export async function getPlatformOverview() {
  return api<PlatformOverview>("/v1/platform/overview");
}

export async function createCompany(body: {
  companyName: string;
  workspaceName?: string;
  adminEmail: string;
  adminName?: string;
  adminPassword: string;
}) {
  return api<{ tenantId: string; adminEmail: string }>("/v1/platform/tenants", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type PlatformCompanyDetail = {
  id: string;
  name: string;
  createdAt: string;
  researchQuotaMonthly: number;
  researchUsedMonthly: number;
  researchQuotaPeriodStart: string;
  /** Their own website from Settings → Offer & targeting, or null when not set */
  website: string | null;
  sellerCompany: string | null;
  users: number;
  accounts: number;
  usersByRole: Record<string, number>;
  admins: Array<{ userId: string; name: string; email: string }>;
  workspaces: Array<{
    id: string;
    name: string;
    createdAt: string;
    users: number;
    accounts: number;
    website: string | null;
    crm: PlatformCompany["crm"];
  }>;
  crm: PlatformCompany["crm"];
};

/** One company in detail (usage, website, users, workspaces). */
export async function getPlatformCompany(tenantId: string) {
  return api<PlatformCompanyDetail>(`/v1/platform/tenants/${tenantId}`);
}

/** Delete a company: its workspaces are deleted and every membership revoked (records kept). */
export async function deleteCompany(tenantId: string) {
  return api<{ deleted: true; tenantId: string }>(`/v1/platform/tenants/${tenantId}`, { method: "DELETE" });
}

/** Rename a company. */
export async function renameCompany(tenantId: string, name: string) {
  return api<{ id: string; name: string }>(`/v1/platform/tenants/${tenantId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Set a company's research units used this month back to 0. */
export async function resetCompanyResearch(tenantId: string) {
  return api<{ researchUsedMonthly: number; researchQuotaMonthly: number }>(
    `/v1/platform/tenants/${tenantId}/reset-research`,
    { method: "POST" },
  );
}

export type PlatformWorkspace = {
  id: string;
  name: string;
  tenantId: string;
  companyName: string;
  createdAt: string;
  members: number;
  accounts: number;
};

export async function listPlatformWorkspaces() {
  return api<{ workspaces: PlatformWorkspace[] }>("/v1/platform/workspaces");
}

export type PlatformUsersCompany = {
  id: string;
  name: string;
  createdAt: string;
  /** Distinct active users across the company's workspaces */
  users: number;
  usersByRole: Record<string, number>;
  admins: Array<{ userId: string; name: string; email: string }>;
  workspaces: Array<{ id: string; name: string; users: number }>;
  /** The CRM this company connected, or null */
  crm: PlatformCompany["crm"];
};

export async function getPlatformUsers() {
  return api<{
    totals: { users: number; admins: number; companies: number; workspaces: number };
    companies: PlatformUsersCompany[];
  }>("/v1/platform/users");
}

export async function createWorkspace(body: {
  tenantId: string;
  name: string;
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
}) {
  return api<{ workspaceId: string; adminEmails: string[]; existingAccount: boolean }>("/v1/platform/workspaces", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ---------------- Access requests (login page "Create account") ---------------- */

export type AccessRequestStatus = "pending" | "approved" | "rejected";

/** Window event fired after an approve/reject, so the nav badge and bell refresh their pending count. */
export const ACCESS_REQUESTS_CHANGED = "insyder:access-requests-changed";

export type AccessRequest = {
  id: string;
  name: string;
  email: string;
  companyName: string;
  message: string | null;
  status: AccessRequestStatus;
  decisionReason: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  role: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listAccessRequests(status?: AccessRequestStatus) {
  return api<{ counts: Record<AccessRequestStatus, number>; requests: AccessRequest[] }>(
    `/v1/platform/access-requests${status ? `?status=${status}` : ""}`,
  );
}

export type ApproveAccessDecision =
  | { kind: "new_company"; companyName: string; workspaceName?: string }
  | { kind: "existing_workspace"; tenantId: string; workspaceId: string; role: string };

export function approveAccessRequest(id: string, decision: ApproveAccessDecision) {
  return api<{ tenantId: string; workspaceId: string; userId: string; role: string }>(
    `/v1/platform/access-requests/${id}/approve`,
    { method: "POST", body: JSON.stringify(decision) },
  );
}

export function rejectAccessRequest(id: string, reason: string) {
  return api<{ ok: true }>(`/v1/platform/access-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/* ---------------- Demo requests (marketing site "Book a demo") ---------------- */

export type DemoRequestStatus = "new" | "contacted" | "closed";

/** Window event fired after a status change, so the nav badge refreshes its "new" count. */
export const DEMO_REQUESTS_CHANGED = "insyder:demo-requests-changed";

export type DemoRequest = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  website: string | null;
  message: string | null;
  status: DemoRequestStatus;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listDemoRequests(status?: DemoRequestStatus) {
  return api<{ counts: Record<DemoRequestStatus, number>; requests: DemoRequest[] }>(
    `/v1/platform/demo-requests${status ? `?status=${status}` : ""}`,
  );
}

export function setDemoRequestStatus(id: string, status: DemoRequestStatus) {
  return api<{ ok: true }>(`/v1/platform/demo-requests/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
