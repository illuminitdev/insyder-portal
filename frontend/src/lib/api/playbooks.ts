import { api } from "./client";

export const SIGNAL_LABELS: Record<string, string> = {
  expansion: "Expansion / new site",
  infra_hiring: "Infrastructure hiring",
  refresh: "Hardware refresh / migration",
  compute: "Compute & storage capacity",
  procurement: "Tender / procurement",
  cloud_migration: "Cloud migration / modernization",
  leadership_change: "Leadership & executive changes",
  technology_adoption: "Technology adoption / stack change",
  infrastructure_investment: "Infrastructure investment & capex",
  digital_transformation: "Digital transformation initiative",
  funding: "Funding round / capital raise",
  m_and_a: "Mergers, acquisitions & restructuring",
  security_compliance: "Security, compliance & governance",
  cost_optimization: "Cost optimization & vendor consolidation",
};

export type CustomSignal = {
  key: string;
  label: string;
  description?: string;
};

export type PlaybookRules = {
  signals: string[];
  customSignals?: CustomSignal[];
  description: string;
  requiredEvidence: string;
  discoveryQuestion: string;
  countries: string[];
  industries: string[];
  eventWindowDays: number | null;
  /** Exact phrase every search result must contain (up to 5 words); empty = none */
  requiredPhrase?: string;
  archived?: boolean;
};

export type PlaybookView = {
  id: string;
  templateKey: string;
  name: string;
  version: number;
  builtIn: boolean;
  archived: boolean;
  rules: PlaybookRules;
  createdAt: string;
};

export type PlaybookInput = Omit<PlaybookRules, "archived"> & { name: string };

const base = (ws: string) => `/v1/workspaces/${ws}/playbooks`;

export function listPlaybooks(workspaceId: string) {
  return api<{
    playbooks: PlaybookView[];
    activeTemplateKey: string;
    signalKinds: string[];
    customSignals?: CustomSignal[];
    canManage: boolean;
  }>(base(workspaceId));
}

export function createCustomSignal(
  workspaceId: string,
  body: { label: string; description?: string; key?: string },
) {
  return api<{ customSignal: CustomSignal }>(`${base(workspaceId)}/custom-signals`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function playbookVersions(workspaceId: string, templateKey: string) {
  return api<{ versions: PlaybookView[] }>(`${base(workspaceId)}/${templateKey}/versions`);
}

export function createPlaybook(workspaceId: string, body: PlaybookInput) {
  return api<{ playbook: PlaybookView }>(base(workspaceId), { method: "POST", body: JSON.stringify(body) });
}

export function savePlaybookFromRun(
  workspaceId: string,
  runId: string,
  body: { name: string; description?: string; discoveryQuestion?: string },
) {
  return api<{ playbook: PlaybookView }>(`/v1/workspaces/${workspaceId}/research-runs/${runId}/save-playbook`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePlaybook(workspaceId: string, templateKey: string, body: PlaybookInput) {
  return api<{ playbook: PlaybookView }>(`${base(workspaceId)}/${templateKey}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function archivePlaybook(workspaceId: string, templateKey: string, archived: boolean) {
  return api<{ playbook: PlaybookView }>(`${base(workspaceId)}/${templateKey}/archive`, {
    method: "POST",
    body: JSON.stringify({ archived }),
  });
}
