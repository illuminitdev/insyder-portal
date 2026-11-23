import type { BuyingRole } from "../../db/schema/contacts.js";
export type ResearchFilters = {
  /** ISO-3166 alpha-2 codes, e.g. ["GB", "IE"] */
  countries?: string[];
  industries?: string[];
  companySizes?: string[];
  signalKinds?: string[];
  /** Domains never to return (offer exclusions + active suppressions) */
  excludeDomains?: string[];
  /** Only sources published within this many days (event window) */
  eventWindowDays?: number;
  /** Account mode: the company's own domain, crawled for careers/news pages */
  companyDomain?: string;
  /** Exact phrase every result must contain (Exa includeText: one phrase, up to 5 words) */
  requiredPhrase?: string;
  /** Webset mode: refresh this existing list instead of creating a new one */
  websetId?: string;
};

/**
 * account = research one known company; discovery = find candidate companies;
 * similar = find companies like a seed company (query is the seed's URL);
 * webset = build a larger, criteria-checked company list (slow, runs for minutes)
 */
export type ResearchMode = "account" | "discovery" | "similar" | "webset";

/** A short cited answer to a question about one company. */
export type ProviderAnswer = {
  answer: string;
  citations: Array<{ url: string; title: string | null; publishedDate: string | null }>;
  requestRef: string;
};

/** A list build started at the provider; collected later (survives job retries). */
export type WebsetStarted = { websetId: string; startedAt: string };

export type NormalizedEvidenceItem = {
  canonicalUrl: string;
  publisher?: string;
  title?: string;
  excerpt?: string;
  eventDate?: string | null;
  /** ISO country derived from normalized source data (URL ccTLD), never free text */
  country?: string | null;
  matchRationale?: string;
  providerRequestRef?: string;
  signalKind?: string;
  fitHint?: number;
  qualityHint?: number;
  /** Discovery: the company the article is about, as extracted by the provider */
  subject?: {
    companyName: string | null;
    companyWebsite: string | null;
    eventSummary: string | null;
  };
  /** Webset mode: public contact details found by provider enrichment (research/review only, never verified) */
  contact?: LeadContact;
};

/** Publicly listed contact details for a lead, each found by the provider with cited sources. */
export type LeadContact = {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  /** Their part in a purchase, estimated from the job title (unset when the provider gives none) */
  buyingRole?: BuyingRole;
  /** Pages the details were found on, so a reviewer can check them */
  sourceUrls: string[];
  /** The email is the company's general address (e.g. info@), not this person's own */
  emailIsGeneral?: boolean;
  /** The phone is the company's main number, not this person's direct line */
  phoneIsGeneral?: boolean;
};

/** State of an agent contact search at the provider. */
export type ContactsAgentResult =
  | { status: "running" }
  | { status: "completed"; contacts: LeadContact[]; costDollars: number | null }
  | { status: "failed"; message: string; costDollars: number | null };

export type NormalizedDiscovery = {
  providerRunId: string;
  items: NormalizedEvidenceItem[];
  rawCount: number;
};

export type NormalizedSources = {
  items: NormalizedEvidenceItem[];
};

export type Usage = {
  requestRef: string;
  units: number;
};

/** Provider-neutral research adapter contract (spec §6). */
export interface ResearchProvider {
  name: string;
  discover(
    query: string,
    filters: ResearchFilters,
    budget: number,
    mode?: ResearchMode,
  ): Promise<NormalizedDiscovery>;
  retrieve(sourceReferences: string[]): Promise<NormalizedSources>;
  normalize(raw: unknown, requestRef?: string): NormalizedEvidenceItem[];
  reportUsage(discovery: NormalizedDiscovery, reservedUnits: number): Promise<Usage>;
  /** Optional: cited answer to a question (Exa Answer) */
  answer?(question: string, opts?: { userLocation?: string }): Promise<ProviderAnswer>;
  /** Optional: public profiles of people currently working at a company (decision makers first) */
  findContacts?(company: { name: string; domain: string | null }, roleHint?: string): Promise<LeadContact[]>;
  /**
   * Optional: fill in emails and phone numbers written on the company's own website
   * (contact, about and team pages) for the given people. Returns the people, updated.
   */
  findContactDetails?(company: { name: string; domain: string }, people: LeadContact[]): Promise<LeadContact[]>;
  /**
   * Optional: start an async agent run that finds a company's decision makers with their work
   * emails (Exa Agent). Collected later with getContactsAgent, so a job retry never pays twice.
   */
  startContactsAgent?(company: { name: string; domain: string | null }, roleHint?: string): Promise<{ runId: string }>;
  getContactsAgent?(runId: string): Promise<ContactsAgentResult>;
  /** Optional: start an async agent run that writes a stakeholder brief about one person */
  startBriefAgent?(input: BriefAgentInput): Promise<{ runId: string }>;
  getBriefAgent?(runId: string, offerNames: string[]): Promise<BriefAgentResult>;
  /** Optional: agent run that reads a company's own website and builds its sales profile */
  startProfileAgent?(website: string): Promise<{ runId: string }>;
  getProfileAgent?(runId: string): Promise<ProfileAgentResult>;
  /** Optional: start building a company list, or add a search to an existing one */
  startWebset?(query: string, filters: ResearchFilters, count: number): Promise<WebsetStarted>;
  /** Optional: wait for the list to finish and return the companies it added since startedAt */
  collectWebset?(started: WebsetStarted, filters: ResearchFilters): Promise<NormalizedDiscovery>;
  /** Optional: build a company list from web searches, for plans without list building (Websets) */
  buildListFromSearch?(query: string, filters: ResearchFilters, count: number): Promise<NormalizedDiscovery>;
}

/** providerRunId prefix of a list built by search, so a refresh searches again instead of using Websets */
export const SEARCH_LIST_PREFIX = "search:";

/** Normalized provider error codes — never contain secrets or raw payloads. */
export type ProviderErrorCode =
  | "provider_auth"
  | "provider_plan"
  | "provider_rate_limited"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_bad_request"
  | "provider_error";

export class NormalizedProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    /** Whether a retry may succeed */
    public retryable: boolean,
  ) {
    super(message);
    this.name = "NormalizedProviderError";
  }
}

/** One of our products or services, as entered in Settings > Offer. */
export type OfferItem = { name: string; description: string; proofPoints?: string; bestFor?: string };

export const meetingTypes = ["first_meeting", "informal", "follow_up", "proposal", "other"] as const;
export type MeetingType = (typeof meetingTypes)[number];

/** What the seller says about the meeting the brief prepares for. */
export type BriefMeeting = {
  meetingType: MeetingType;
  meetingDate?: string | null;
  purpose: string;
  knownContext?: string | null;
  /** Generated automatically (after a contact search or when a contact was added), not from a seller's note */
  auto?: boolean;
};

/** Everything the brief agent is told: the person, their company, our offer and the meeting. */
export type BriefAgentInput = {
  person: { name: string; title: string | null; buyingRole: BuyingRole; linkedinUrl?: string | null; sourceUrls: string[] };
  company: { name: string; domain: string | null; country?: string | null };
  account: {
    whyNow?: string | null;
    signals: string[];
    evidence: Array<{ title: string | null; excerpt: string | null; url: string | null }>;
  };
  seller: {
    company: string | null;
    website?: string | null;
    offering: string;
    items: OfferItem[];
    /** From our company profile (Settings): who we are, what sets us apart, who we've worked with */
    summary?: string | null;
    differentiators?: string[];
    customers?: string[];
  };
  meeting: BriefMeeting;
};

export type BriefOfferPick = { offer: string; why: string };

/** A stakeholder brief, section by section (mirrors the meeting-prep overlay the client sent). */
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

/** The customer's own company, read from their website (Settings → Your company profile) */
export type CompanyProfile = {
  companyName: string | null;
  summary: string;
  /** One line: what they sell */
  offering: string;
  products: OfferItem[];
  /** Industries of their customers */
  industries: string[];
  buyerRoles: string[];
  /** ISO country codes they sell into */
  countries: string[];
  companySizes: string[];
  differentiators: string[];
  customers: string[];
  /** Built-in signal keys, best first */
  signals: Array<{ key: string; why: string }>;
  customSignals: Array<{ label: string; description: string; why: string }>;
  discoveryQuestion: string;
  sources: Array<{ url: string; title: string | null }>;
};

export type ProfileAgentResult =
  | { status: "running" }
  | { status: "completed"; profile: CompanyProfile | null }
  | { status: "failed"; message: string };

export type BriefAgentResult =
  | { status: "running" }
  | { status: "completed"; brief: StakeholderBriefContent | null; costDollars: number | null }
  | { status: "failed"; message: string; costDollars: number | null };
