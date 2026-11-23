import { api } from "./client";

export type OfferItem = { name: string; description: string; proofPoints?: string; bestFor?: string };

export type Offer = {
  offering: string;
  /** Our own company name (stakeholder briefs) */
  sellerCompany: string | null;
  /** Our own website (role hypotheses read it to learn what we offer) */
  sellerWebsite: string | null;
  /** Our products and services (stakeholder briefs rank them per person) */
  offerItems: OfferItem[];
  activePlaybookTemplateKey?: string;
  buyerRoles: string[];
  industries: string[];
  companySizes: string[];
  territory: string[];
  exclusions: string[];
  eventWindowDays: number;
  naturalLanguageBrief: string | null;
  structuredQuery: Record<string, unknown> | null;
  unsupportedFilters: string[];
  version: number;
};

/** Latest version of a playbook (see lib/api/playbooks for managing them) */
export type Playbook = import("./playbooks").PlaybookView;

export function getOffer(workspaceId: string) {
  return api<{ offer: Offer | null; playbooks: Playbook[] }>(
    `/v1/workspaces/${workspaceId}/settings/offer`,
  );
}

export function saveOffer(workspaceId: string, body: Record<string, unknown>) {
  return api<{ ok: boolean; territory: string[]; sellerWebsite: string | null; unsupportedFilters: string[]; structuredQuery: Record<string, unknown> }>(
    `/v1/workspaces/${workspaceId}/settings/offer`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export function setActivePlaybook(workspaceId: string, templateKey: string) {
  return api<{ ok: boolean; activePlaybookTemplateKey: string }>(
    `/v1/workspaces/${workspaceId}/settings/active-playbook`,
    { method: "PUT", body: JSON.stringify({ templateKey }) },
  );
}

export function setEventWindow(workspaceId: string, eventWindowDays: number) {
  return api<{ ok: boolean; eventWindowDays: number }>(
    `/v1/workspaces/${workspaceId}/settings/event-window`,
    { method: "PUT", body: JSON.stringify({ eventWindowDays }) },
  );
}

export type AcceptanceGates = {
  requiredKnownFields: string[];
  /** One-person workflow: whoever qualifies a lead accepts it, no separate sales review */
  skipReview?: boolean;
};

export function getAcceptanceGates(workspaceId: string) {
  return api<{ gates: AcceptanceGates; fieldKeys: string[] }>(
    `/v1/workspaces/${workspaceId}/settings/acceptance-gates`,
  );
}

export function saveAcceptanceGates(workspaceId: string, requiredKnownFields: string[]) {
  return api<{ gates: AcceptanceGates }>(
    `/v1/workspaces/${workspaceId}/settings/acceptance-gates`,
    { method: "PUT", body: JSON.stringify({ requiredKnownFields }) },
  );
}

/** Turn the one-person workflow (no separate sales review) on or off */
export function saveSkipReview(workspaceId: string, skipReview: boolean) {
  return api<{ gates: AcceptanceGates }>(
    `/v1/workspaces/${workspaceId}/settings/acceptance-gates`,
    { method: "PUT", body: JSON.stringify({ skipReview }) },
  );
}

export type Connections = {
  research: { provider: string; configured: boolean };
  usage: { quotaMonthly: number; usedMonthly: number; periodStart: string | null };
  entitlements: { researchEnabled: boolean; researchKillSwitch: boolean };
  crm: { provider: string | null; configured: boolean; accountLabel?: string | null; enabled: boolean; note: string };
  sending: { enabled: boolean; note: string };
};

export function getConnections(workspaceId: string) {
  return api<Connections>(`/v1/workspaces/${workspaceId}/settings/connections`);
}

export function patchEntitlements(
  workspaceId: string,
  body: { researchEnabled?: boolean; researchKillSwitch?: boolean },
) {
  return api<{ entitlements: Connections["entitlements"] }>(`/v1/workspaces/${workspaceId}/entitlements`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export type ReportView = "admin" | "researcher" | "reviewer" | "sdr" | "analyst";

export type AdminReport = {
  usage: { quotaMonthly: number; usedMonthly: number; periodStart: string | null };
  team: Array<{
    userId: string;
    name: string;
    roles: string[];
    researchRuns: number;
    evidenceReviewed: number;
    briefsSubmitted: number;
    reviewerDecisions: number;
    tasksCompleted: number;
    openTasks: number;
  }>;
};

export type ResearcherReport = {
  researchRuns: number;
  runsCompleted: number;
  runsFailed: number;
  runsWithNoResults: number;
  discoveryRuns: number;
  companiesFound: number;
  accountsResearched: number;
  evidenceReviewed: number;
  accountsWithReviewedEvidence: number;
  briefsSubmitted: number;
  submittedAwaitingDecision: number;
  submittedAccepted: number;
  submittedReturned: number;
  submittedRejected: number;
  returnReasons: Record<string, number>;
};

export type ReviewerReport = {
  decisionEvents: number;
  accountsDecided: number;
  accepted: number;
  returned: number;
  rejected: number;
  acceptanceRate: number | null;
  reasons: Record<string, number>;
  queueWaiting: number;
  oldestWaitingDays: number | null;
  handoffsPrepared: number;
  handoffsByState: Record<string, number>;
};

export type SdrReport = {
  openTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  dueToday: number;
  completedTasks: number;
  cancelledTasks: number;
  completedByType: Record<string, number>;
  assignedAccounts: number;
  acceptedAssignedAccounts: number;
  accountsWithMyTasks: number;
};

/** Workspace-wide totals. Not returned to SDRs, whose report covers only their own work. */
export type WorkspaceOutcomes = {
  currency: string;
  denominators: { accountsWithReviewerDecision: number };
  metrics: {
    uniqueResearchReviewedAccounts: number;
    explicitSalesAccepted: number;
    returnedDecisions: number;
    rejectedDecisions: number;
    acceptanceRate: number | null;
    reviewerDecisionEvents: number;
    completedSdrActions: number;
    openSdrTasks: number;
    cancelledSdrActions: number;
    partnerHandoffsPrepared: number;
    partnerHandoffsShared: number;
    crmOpportunities: number | null;
    meetings: number | null;
    attribution: string;
    opportunities: {
      total: number;
      open: number;
      won: number;
      lost: number;
      openValue: number;
      wonValue: number;
      openWithoutValue: number;
      otherCurrency: number;
      source: "user_entered" | "mixed";
    };
  };
  breakdowns: {
    activityByTaskType: Record<string, number>;
    rejectionReasons: Record<string, number>;
    opportunityStages: Record<string, number>;
    researchQuality: Record<string, number>;
  };
  notes: string[];
};

export type Outcomes = {
  view: ReportView;
  cohort: { from: string; to: string; dateBasis: string; decisionRule: string };
  admin?: AdminReport;
  researcher?: ResearcherReport;
  reviewer?: ReviewerReport;
  sdr?: SdrReport;
} & Partial<WorkspaceOutcomes>;

export function getOutcomes(workspaceId: string, from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return api<Outcomes>(`/v1/workspaces/${workspaceId}/outcomes${qs.size ? `?${qs}` : ""}`);
}

/** Our company and products, used by stakeholder briefs. Targeting is not touched. */
export function saveOfferProducts(workspaceId: string, body: { sellerCompany: string | null; offerItems: OfferItem[] }) {
  return api<{ ok: boolean; sellerCompany: string | null; offerItems: OfferItem[] }>(
    `/v1/workspaces/${workspaceId}/settings/offer/products`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

/** Our company, read from our website (Settings → Your company profile) */
export type CompanyProfile = {
  companyName: string | null;
  summary: string;
  offering: string;
  products: OfferItem[];
  industries: string[];
  buyerRoles: string[];
  /** ISO country codes */
  countries: string[];
  companySizes: string[];
  differentiators: string[];
  customers: string[];
  signals: Array<{ key: string; why: string }>;
  customSignals: Array<{ label: string; description: string; why: string }>;
  discoveryQuestion: string;
  sources: Array<{ url: string; title: string | null }>;
};

export type CompanyProfileState = {
  website: string | null;
  status: "none" | "running" | "completed" | "failed";
  error: string | null;
  profile: CompanyProfile | null;
  updatedAt: string | null;
  /** False when the research provider can't read websites (e.g. simulation mode) */
  available: boolean;
  /** Research units one analysis uses */
  units: number;
};

export type ProfileSections = {
  offering?: boolean;
  companyName?: boolean;
  industries?: boolean;
  buyerRoles?: boolean;
  territory?: boolean;
  companySizes?: boolean;
  products?: boolean;
  playbook?: boolean;
  makeDefault?: boolean;
};

export function getCompanyProfile(workspaceId: string) {
  return api<CompanyProfileState>(`/v1/workspaces/${workspaceId}/settings/company-profile`);
}

export function analyzeWebsite(workspaceId: string, website: string) {
  return api<CompanyProfileState>(`/v1/workspaces/${workspaceId}/settings/company-profile/analyze`, {
    method: "POST",
    body: JSON.stringify({ website }),
  });
}

export function applyCompanyProfile(workspaceId: string, sections: ProfileSections) {
  return api<{ applied: string[]; playbook: { templateKey: string; name: string } | null }>(
    `/v1/workspaces/${workspaceId}/settings/company-profile/apply`,
    { method: "POST", body: JSON.stringify(sections) },
  );
}
