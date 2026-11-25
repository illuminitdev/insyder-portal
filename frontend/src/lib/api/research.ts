import { api } from "./client";

export type ResearchFilters = {
  countries?: string[];
  industries?: string[];
  companySizes?: string[];
  signalKinds?: string[];
  eventWindowDays?: number | null;
  requiredPhrase?: string;
};

/**
 * account = research one company; discovery = quick search; similar = companies like an account;
 * webset = build a larger, criteria-checked list (takes minutes)
 */
export type ResearchMode = "account" | "discovery" | "similar" | "webset";

export type ParsedBrief = {
  structured: {
    keywords: string;
    countries: string[];
    industries: string[];
    companySizes: string[];
    signalKinds: string[];
    eventWindowDays: number | null;
  };
  unsupported: string[];
  usage: { quotaMonthly: number; usedMonthly: number };
};

export function parseBrief(workspaceId: string, brief: string) {
  return api<ParsedBrief>(`/v1/workspaces/${workspaceId}/research-runs/parse-brief`, {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
}

export function startResearchRun(
  workspaceId: string,
  body: {
    mode: ResearchMode;
    /** Not needed for "similar": the query is the seed account's website */
    query?: string;
    brief?: string;
    filters?: ResearchFilters;
    accountId?: string;
    playbookVersionId?: string;
    budget?: number;
    idempotencyKey?: string;
    /** Webset mode: add new matches to the list built by this earlier run */
    refreshRunId?: string;
  },
) {
  return api<{ researchRunId: string; status: string; reused?: boolean }>(
    `/v1/workspaces/${workspaceId}/research-runs`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export type ResearchRun = {
  id: string;
  mode: string;
  status: string;
  progressPct: number;
  errorCode: string | null;
  errorMessage: string | null;
  budgetReserved: number;
  budgetActual: number | null;
  accountId: string | null;
  brief?: string | null;
  result: {
    noResults?: boolean;
    evidenceCreated?: number;
    duplicatesSkipped?: number;
    rows?: DiscoveryRow[];
    unmatched?: number;
    skippedSuppressed?: number;
    /** Contact searches: where the people came from and how many were saved */
    source?: "agent" | "search";
    peopleFound?: number;
    contactsCreated?: number;
    contactsUpdated?: number;
    /** Old runs only: role hypotheses used to start automatically after the search */
    roleHypothesesQueued?: number;
    emailsFound?: number;
    fallbackReason?: string | null;
  } | null;
};

/** One company found by a discovery search, with its latest trigger */
export type DiscoveryRow = {
  accountId: string;
  name: string;
  domain: string | null;
  country: string | null;
  companySummary?: string | null;
  isNew: boolean;
  identityNeedsReview: boolean;
  trigger: { title: string | null; summary: string | null; eventDate: string | null; url: string };
  sources: number;
  fitScore: number | null;
  /** People found at this lead from public profiles (unverified; research and review only) */
  contacts?: LeadContact[];
  /** Older runs stored a single contact */
  contact?: LeadContact | null;
};

export type LeadContact = {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  sourceUrls: string[];
  /** The email is the company's general address, not this person's own */
  emailIsGeneral?: boolean;
  /** The phone is the company's main number, not this person's direct line */
  phoneIsGeneral?: boolean;
};

export function getResearchRun(id: string, workspaceId: string) {
  return api<{ researchRun: ResearchRun }>(`/v1/research-runs/${id}?workspaceId=${workspaceId}`);
}

/** Run kinds that can be listed: research modes plus contact searches */
export type RunKind = ResearchMode | "contacts";

export type ResearchRunSummary = {
  id: string;
  mode: RunKind;
  status: string;
  brief: string | null;
  query: string;
  accountId: string | null;
  companies: number | null;
  createdAt: string;
  completedAt: string | null;
};

export function listResearchRuns(
  workspaceId: string,
  opts: { mode?: RunKind | RunKind[]; accountId?: string; limit?: number } = {},
) {
  const qs = new URLSearchParams(
    Object.entries(opts)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]),
  );
  return api<{ runs: ResearchRunSummary[] }>(`/v1/workspaces/${workspaceId}/research-runs${qs.size ? `?${qs}` : ""}`);
}

export function deleteResearchRun(workspaceId: string, id: string) {
  return api<{ ok: boolean }>(`/v1/workspaces/${workspaceId}/research-runs/${id}`, {
    method: "DELETE",
  });
}

/** Find an account's decision makers with work emails (runs in the background, 1 research unit). */
export function findAccountContacts(workspaceId: string, accountId: string) {
  return api<{ researchRunId: string; status: string; reused: boolean }>(
    `/v1/workspaces/${workspaceId}/accounts/${accountId}/find-contacts`,
    { method: "POST" },
  );
}
