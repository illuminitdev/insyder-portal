import { api } from "./client";

export const BUYING_ROLES = [
  "decision_maker",
  "budget_holder",
  "technical_evaluator",
  "influencer",
  "procurement",
  "user",
  "unknown",
] as const;
export type BuyingRole = (typeof BUYING_ROLES)[number];

export type Contact = {
  id: string;
  name: string;
  title: string | null;
  buyingRole: BuyingRole;
  email: string | null;
  phone: string | null;
  sourceType: "evidence" | "user_entered";
  evidenceId: string | null;
  sourceNote: string | null;
  verificationStatus: "unverified";
  suppressed: boolean;
  createdAt: string;
  /** Latest stakeholder brief: run status ("completed_refreshing" = an older brief is ready while a new one runs) */
  latestBrief: { status: string; briefId: string } | null;
};

export type RoleHypothesis = {
  id: string;
  roleTitle: string;
  buyingRole: BuyingRole;
  rationale: string;
  evidenceIds: string[];
  contactId: string | null;
  createdAt: string;
};

const base = (accountId: string) => `/v1/accounts/${accountId}`;

export function listAccountPeople(accountId: string, workspaceId: string) {
  return api<{ contacts: Contact[]; roleHypotheses: RoleHypothesis[]; briefRoles: BuyingRole[] }>(
    `${base(accountId)}/contacts?workspaceId=${workspaceId}`,
  );
}

export function createContact(
  accountId: string,
  workspaceId: string,
  body: {
    name: string;
    title?: string | null;
    buyingRole: BuyingRole;
    email?: string | null;
    phone?: string | null;
    sourceType: "evidence" | "user_entered";
    evidenceId?: string | null;
    sourceNote?: string | null;
  },
) {
  return api<{ contact: Contact }>(`${base(accountId)}/contacts?workspaceId=${workspaceId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteContact(accountId: string, workspaceId: string, contactId: string) {
  return api<{ ok: boolean }>(`${base(accountId)}/contacts/${contactId}?workspaceId=${workspaceId}`, { method: "DELETE" });
}

export function createRoleHypothesis(
  accountId: string,
  workspaceId: string,
  body: { roleTitle: string; buyingRole: BuyingRole; rationale: string; evidenceIds: string[] },
) {
  return api<{ roleHypothesis: RoleHypothesis }>(`${base(accountId)}/role-hypotheses?workspaceId=${workspaceId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function linkRoleHypothesis(accountId: string, workspaceId: string, hypothesisId: string, contactId: string | null) {
  return api<{ roleHypothesis: RoleHypothesis }>(
    `${base(accountId)}/role-hypotheses/${hypothesisId}?workspaceId=${workspaceId}`,
    { method: "PATCH", body: JSON.stringify({ contactId }) },
  );
}

export function deleteRoleHypothesis(accountId: string, workspaceId: string, hypothesisId: string) {
  return api<{ ok: boolean }>(`${base(accountId)}/role-hypotheses/${hypothesisId}?workspaceId=${workspaceId}`, {
    method: "DELETE",
  });
}

// ---------- Stakeholder briefs ----------

export const MEETING_TYPES = [
  { value: "first_meeting", label: "First meeting" },
  { value: "informal", label: "Lunch / informal" },
  { value: "follow_up", label: "Follow-up" },
  { value: "proposal", label: "Proposal / pitch" },
  { value: "other", label: "Other" },
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number]["value"];

export type BriefMeeting = {
  meetingType: MeetingType;
  meetingDate?: string | null;
  purpose: string;
  knownContext?: string | null;
  /** Run without a meeting note: prepared for a first conversation */
  auto?: boolean;
};

export type BriefOfferPick = { offer: string; why: string };

export type StakeholderBriefContent = {
  meetingContext: { opening: string; posture: string; centralTension: string };
  whoTheyAre: { summary: string; background: string; controls: string[]; doesNotControl: string[] };
  overlay: {
    evaluationLens: string;
    engagementStyle: string;
    commercialImplication: string;
    credibilityBuilders: string[];
    credibilityRisks: string[];
    howToAdapt: string[];
  };
  theirWorld: { companyPosition: string; gap: string; immediateOpportunity: string; otherOpportunities: string[] };
  offerRanking: { leadWith: BriefOfferPick[]; supportWith: BriefOfferPick[]; holdInReserve: BriefOfferPick[]; avoid: string[] };
  commercialShape: { name: string; duration: string; steps: string[]; principle: string };
  meetingPlan: { openingApproach: string; bridges: string[]; questions: string[]; signalsToListenFor: string[]; theAsk: string };
  objections: Array<{ objection: string; response: string; whatNotToDo: string }>;
  unknowns: string[];
  tacticalBrief: {
    stakeholder: string;
    situation: string;
    leadWith: string;
    supportWith: string;
    doNotLeadWith: string;
    bestNextStep: string;
    demonstrationQuestion: string;
  };
  messageGuide: Array<{ use: string; avoid: string }>;
  sources: Array<{ url: string; title: string | null }>;
};

export type StakeholderBrief = {
  id: string;
  contactId: string;
  accountId: string;
  researchRunId: string;
  status: "queued" | "running" | "retrying" | "completed" | "failed" | "cancelled";
  progressPct: number;
  errorMessage: string | null;
  meeting: BriefMeeting;
  content: StakeholderBriefContent | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
};

export function listStakeholderBriefs(accountId: string, workspaceId: string, contactId: string) {
  return api<{
    contact: { id: string; name: string; title: string | null; buyingRole: BuyingRole };
    account: { id: string; name: string; domain: string | null } | null;
    briefs: StakeholderBrief[];
    canGenerate: boolean;
  }>(`${base(accountId)}/contacts/${contactId}/briefs?workspaceId=${workspaceId}`);
}

/** Without a body (or purpose) the role hypothesis prepares for a first conversation. */
export function createStakeholderBrief(accountId: string, workspaceId: string, contactId: string, body: Partial<BriefMeeting> = {}) {
  return api<{ briefId: string; researchRunId: string; reused: boolean }>(
    `${base(accountId)}/contacts/${contactId}/briefs?workspaceId=${workspaceId}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}
