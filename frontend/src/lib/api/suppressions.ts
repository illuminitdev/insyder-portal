import { api } from "./client";

export type Suppression = {
  id: string;
  addressOrDomain: string;
  reason: string;
  source: string;
  effectiveAt: string;
  expiresAt: string | null;
  createdAt: string;
};

export function listSuppressions(workspaceId: string) {
  return api<{ suppressions: Suppression[]; reasons: string[] }>(
    `/v1/workspaces/${workspaceId}/suppressions`,
  );
}

export function createSuppression(
  workspaceId: string,
  body: { addressOrDomain: string; reason: string; source?: string; expiresAt?: string | null },
) {
  return api<{ suppression: Suppression }>(`/v1/workspaces/${workspaceId}/suppressions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function expireSuppression(workspaceId: string, suppressionId: string) {
  return api<{ suppression: Suppression }>(
    `/v1/workspaces/${workspaceId}/suppressions/${suppressionId}/expire`,
    { method: "POST", body: "{}" },
  );
}

export type BulkSuppressionResult = { added: number; duplicates: number; invalid: number; invalidSamples: string[] };

export function bulkCreateSuppressions(
  workspaceId: string,
  body: {
    entries: Array<{ addressOrDomain: string; reason?: string | null }>;
    reason: string;
    expiresAt?: string | null;
  },
) {
  return api<BulkSuppressionResult>(`/v1/workspaces/${workspaceId}/suppressions/bulk`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
