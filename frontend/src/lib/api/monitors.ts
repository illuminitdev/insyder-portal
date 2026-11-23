import { api } from "./client";

export type Monitor = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  playbookTemplateKey: string;
  recipeJson: string;
  cadenceHours: number;
  status: "active" | "paused";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastRunStatus: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ChangeEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  monitorId: string;
  accountId: string | null;
  dedupeKey: string;
  title: string;
  detail: string | null;
  material: boolean;
  discoveredAt: string;
  createdAt: string;
};

export function listMonitors(workspaceId: string) {
  return api<{ monitors: Monitor[] }>(`/v1/workspaces/${workspaceId}/monitors`);
}

export function createMonitorFromPlaybook(
  workspaceId: string,
  options?: { templateKey?: string; cadenceHours?: number },
) {
  return api<{ monitor: Monitor }>(`/v1/workspaces/${workspaceId}/monitors/from-playbook`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
}

export function createMonitorFromAccounts(
  workspaceId: string,
  options: {
    accountIds: string[];
    cadenceHours?: number;
    templateKey?: string;
    name?: string;
  },
) {
  return api<{ monitor: Monitor }>(`/v1/workspaces/${workspaceId}/monitors/from-accounts`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export function updateMonitor(
  workspaceId: string,
  monitorId: string,
  patch: { cadenceHours?: number; status?: "active" | "paused" },
) {
  return api<{ monitor: Monitor }>(`/v1/workspaces/${workspaceId}/monitors/${monitorId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteMonitor(workspaceId: string, monitorId: string) {
  return api<{ success: boolean }>(`/v1/workspaces/${workspaceId}/monitors/${monitorId}`, {
    method: "DELETE",
  });
}

/** Run a live check now; it uses research units like the scheduled run. */
export function runMonitorCheck(workspaceId: string, monitorId: string) {
  return api<{
    monitor: Monitor;
    freshEventsCount: number;
    skippedDuplicates: number;
    skippedSuppressed: number;
    summary: string;
    status: string;
  }>(`/v1/workspaces/${workspaceId}/monitors/${monitorId}/run`, {
    method: "POST",
    body: "{}",
  });
}

export function listChangeEvents(workspaceId: string, monitorId?: string) {
  const query = monitorId ? `?monitorId=${encodeURIComponent(monitorId)}` : "";
  return api<{ changeEvents: ChangeEvent[] }>(
    `/v1/workspaces/${workspaceId}/monitors/changes${query}`,
  );
}
