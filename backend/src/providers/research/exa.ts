import { Exa, WebsetSearchBehavior, type CreateEnrichmentParametersFormat } from "exa-js";
import { getEnv, isExaConfigured } from "../../config/env.js";
import { providerNotConfigured } from "../../utils/errors.js";
import { canonicalizeUrl, companyDomain, companyNameKey, countryFromUrl, hostnameOf, normalizeCountry, normalizeDomain } from "../../utils/normalize.js";
import { isKnownPublisher, withScoringHints } from "../../services/signalScoring.js";
import {
  NormalizedProviderError,
  type NormalizedDiscovery,
  type NormalizedEvidenceItem,
  type NormalizedSources,
  type ProviderAnswer,
  type ResearchFilters,
  type ResearchMode,
  type ResearchProvider,
  type LeadContact,
  SEARCH_LIST_PREFIX,
  type Usage,
  type WebsetStarted,
  type ContactsAgentResult,
  type BriefAgentInput,
  type BriefAgentResult,
  type ProfileAgentResult,
} from "./types.js";
import { getContactsAgentRun, startContactsAgentRun } from "./exaAgent.js";
import { getBriefAgentRun, startBriefAgentRun } from "./exaBriefAgent.js";
import { getProfileAgentRun, startProfileAgentRun } from "./exaProfileAgent.js";

const REQUEST_TIMEOUT_MS = 30_000;
/** A list build normally takes a few minutes; the job expires after 30 */
const WEBSET_WAIT_MS = 20 * 60_000;
const WEBSET_POLL_MS = 10_000;

const SIGNAL_TERMS: Record<string, string> = {
  expansion: "expansion new site data centre facility",
  infra_hiring: "hiring infrastructure engineers",
  refresh: "server hardware refresh migration",
  compute: "compute capacity storage requirements",
  procurement: "IT infrastructure tender procurement",
  cloud_migration: "cloud migration AWS Azure GCP cloud adoption modernize",
  leadership_change: "new CTO CIO appointment executive hired appointed",
  technology_adoption: "implementing adopting new technology stack software platform",
  infrastructure_investment: "infrastructure investment capital expenditure capex facility upgrade",
  digital_transformation: "digital transformation enterprise modernization automation initiative",
  funding: "funding round Series raised venture capital private equity investment",
  m_and_a: "acquisition merger acquired buyout corporate restructuring",
  security_compliance: "cybersecurity compliance audit ISO SOC2 security upgrade",
  cost_optimization: "cost optimization vendor consolidation cost reduction efficiency drive",
};

/** Signals reported by news outlets; hiring and tenders live on job boards and tender portals. */
const NEWS_KINDS = new Set([
  "expansion",
  "refresh",
  "compute",
  "cloud_migration",
  "leadership_change",
  "technology_adoption",
  "infrastructure_investment",
  "digital_transformation",
  "funding",
  "m_and_a",
  "security_compliance",
  "cost_optimization",
]);

const DEFAULT_SEARCH_KINDS = ["expansion", "infra_hiring", "refresh", "compute", "procurement"];

type SearchPlan = { kinds: string[]; category?: "news"; numResults: number };
type ExaResponse = { requestId?: string; results: unknown[] };

/**
 * Split the result budget between a news-only search (expansion, refresh, compute)
 * and an open web search (hiring, procurement), in proportion to the kinds asked for.
 */
export function planSearches(signalKinds: string[] | undefined, numResults: number): SearchPlan[] {
  // If explicitly empty array, no buying signals are wanted (open company search)
  if (Array.isArray(signalKinds) && signalKinds.length === 0) {
    return [{ kinds: [], numResults }];
  }
  const kinds = signalKinds?.length ? signalKinds : DEFAULT_SEARCH_KINDS;
  const news = kinds.filter((k) => NEWS_KINDS.has(k));
  const open = kinds.filter((k) => !NEWS_KINDS.has(k));
  if (!open.length) return [{ kinds, category: "news", numResults }];
  if (!news.length || numResults < 2) return [{ kinds, numResults }];
  const newsN = Math.min(numResults - 1, Math.max(1, Math.round((numResults * news.length) / kinds.length)));
  return [
    { kinds: news, category: "news", numResults: newsN },
    { kinds: open, numResults: numResults - newsN },
  ];
}

const SITE_SUBPAGES = 5;
const SITE_SUBPAGE_TARGETS = ["careers", "jobs", "news", "press", "announcements"];

const SIGNAL_TYPES = [
  "expansion",
  "infra_hiring",
  "refresh",
  "compute",
  "procurement",
  "cloud_migration",
  "leadership_change",
  "technology_adoption",
  "infrastructure_investment",
  "digital_transformation",
  "funding",
  "m_and_a",
  "security_compliance",
  "cost_optimization",
  "other",
] as const;

const SUBJECT_SUMMARY = {
  query:
    "Which single company is this page primarily about that is expanding, hiring, refreshing IT, adding compute or buying infrastructure? Leave fields empty if unclear or if several companies are equally involved.",
  schema: {
    type: "object",
    properties: {
      companyName: { type: "string", description: "Name of that one company, or empty if unclear" },
      companyWebsite: { type: "string", description: "That company's own website domain, e.g. example.com, or empty if unknown" },
      signalType: { type: "string", enum: [...SIGNAL_TYPES] },
      eventSummary: { type: "string", description: "One sentence: what the company did and where" },
    },
    required: ["companyName", "companyWebsite", "signalType", "eventSummary"],
  },
};

const SIMILAR_SUMMARY = {
  query:
    "Which company is this page about, and what is that company's own website domain? Give one sentence on what it does. Leave fields empty if unclear.",
  schema: {
    type: "object",
    properties: {
      companyName: { type: "string", description: "The company's name, or empty" },
      companyWebsite: { type: "string", description: "That company's own website domain, e.g. example.com, or empty if unknown" },
      eventSummary: { type: "string", description: "One sentence: what the company does and where" },
    },
    required: ["companyName", "companyWebsite", "eventSummary"],
  },
};

type Subject = {
  companyName: string | null;
  companyWebsite: string | null;
  signalType: string | null;
  eventSummary: string | null;
};


/** The website as given, unless it is a shared platform (LinkedIn, Crunchbase, a registry...) rather than the company's own site. */
export function ownWebsite(website: string | null | undefined): string | null {
  return website && companyDomain(website) ? website : null;
}

export function parseSubject(summary: unknown): Subject | null {
  if (typeof summary !== "string" || !summary.trim()) return null;
  try {
    const raw = JSON.parse(summary) as Record<string, unknown>;
    // The model sometimes writes "null", "N/A" or "unknown" instead of leaving a field empty
    const str = (v: unknown, max: number) =>
      typeof v === "string" && v.trim() && !/^(null|none|n\/?a|unknown|unclear|not (specified|available|found))$/i.test(v.trim())
        ? v.trim().slice(0, max)
        : null;
    const signalType = str(raw.signalType, 40);
    return {
      companyName: str(raw.companyName, 200),
      // A LinkedIn or directory page is not the company's website: drop it so the company is matched by name
      companyWebsite: ownWebsite(str(raw.companyWebsite, 200)),
      signalType: signalType && (SIGNAL_TYPES as readonly string[]).includes(signalType) && signalType !== "other" ? signalType : null,
      eventSummary: str(raw.eventSummary, 400),
    };
  } catch {
    return null;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new NormalizedProviderError("provider_timeout", "The research request timed out", true)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const SIGNAL_CRITERIA: Record<string, string> = {
  expansion: "opening a new site, office, facility or data centre",
  infra_hiring: "hiring IT infrastructure or data-centre engineers",
  refresh: "refreshing or migrating servers or IT hardware",
  compute: "adding compute or storage capacity",
  procurement: "running an IT infrastructure tender or procurement",
  cloud_migration: "migrating workloads to cloud or modernizing legacy infrastructure",
  leadership_change: "appointing a new C-level technology executive or VP",
  technology_adoption: "adopting or evaluating new enterprise software or technology",
  infrastructure_investment: "making capital investments in infrastructure, facilities or IT assets",
  digital_transformation: "undergoing an enterprise digital transformation program",
  funding: "raising institutional funding, venture capital or growth equity",
  m_and_a: "involved in an acquisition, merger or major corporate restructuring",
  security_compliance: "investing in cybersecurity, compliance or regulatory audit readiness",
  cost_optimization: "initiating vendor consolidation or infrastructure cost optimization",
};

/** Same site: equal hosts, or one is a subdomain of the other (www.acme.com ~ acme.com). */
function sameSite(a: string, b: string): boolean {
  const x = a.replace(/^www\./, "");
  const y = b.replace(/^www\./, "");
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

function websetQuery(query: string, filters: ResearchFilters): string {
  const parts = [query.trim()];
  if (filters.industries?.length) parts.push(`Industries: ${filters.industries.join(", ")}.`);
  if (filters.countries?.length) parts.push(`Located in: ${filters.countries.join(", ")}.`);
  return parts.filter(Boolean).join(" ").slice(0, 1000);
}

/** Criteria Exa checks every company against, each answered with cited references. */
export function websetCriteria(filters: ResearchFilters): Array<{ description: string }> {
  const isExplicitEmpty = Array.isArray(filters.signalKinds) && filters.signalKinds.length === 0;
  const kinds = filters.signalKinds?.length
    ? filters.signalKinds
    : (isExplicitEmpty ? [] : Object.keys(SIGNAL_CRITERIA));
  const criteria: Array<{ description: string }> = [];
  if (kinds.length) {
    const window = filters.eventWindowDays ? ` in the last ${filters.eventWindowDays} days` : " recently";
    criteria.push({
      description: `Company has publicly shown at least one of these${window}: ${kinds
        .map((k) => SIGNAL_CRITERIA[k] ?? `relevant to ${k.replace(/^custom_/, "").replace(/_/g, " ")}`)
        .join("; ")}`,
    });
  }
  if (filters.countries?.length) {
    criteria.push({ description: `Company operates in ${filters.countries.join(" or ")}` });
  }
  if (filters.requiredPhrase?.trim()) {
    criteria.push({ description: `Company's public sources mention "${filters.requiredPhrase.trim()}"` });
  }
  return criteria;
}

/** Key stored in each enrichment's metadata, so results can be mapped back to a contact field. */
const CONTACT_KEY = "signal_contact";
type ContactField = "name" | "title" | "email" | "phone" | "linkedinUrl";

/**
 * Contact enrichments requested on every company list, for research and review only.
 * Exa only finds details that are publicly listed; anything not found stays empty.
 */
export const CONTACT_ENRICHMENTS: Array<{ field: ContactField; description: string; format: CreateEnrichmentParametersFormat }> = [
  {
    field: "name",
    description: "Full name of the most senior IT, infrastructure or technology decision maker at this company (e.g. CTO, CIO, Head of IT)",
    format: "text" as CreateEnrichmentParametersFormat,
  },
  { field: "title", description: "Job title of that IT or technology decision maker", format: "text" as CreateEnrichmentParametersFormat },
  {
    field: "email",
    description: "Publicly listed business email address for that person, or else the company's general business contact email",
    format: "email" as CreateEnrichmentParametersFormat,
  },
  { field: "phone", description: "Publicly listed business phone number for the company", format: "phone" as CreateEnrichmentParametersFormat },
  { field: "linkedinUrl", description: "LinkedIn profile URL of that IT or technology decision maker", format: "url" as CreateEnrichmentParametersFormat },
];

function contactEnrichmentParams() {
  return CONTACT_ENRICHMENTS.map((e) => ({ description: e.description, format: e.format, metadata: { [CONTACT_KEY]: e.field } }));
}

type RawEnrichmentResult = {
  enrichmentId?: string;
  status?: string;
  result?: string[] | null;
  references?: Array<{ url?: string }>;
};

/** Enrichment results on one Webset item → contact details; null when nothing usable was found. */
export function contactFromEnrichments(
  results: RawEnrichmentResult[] | null | undefined,
  fieldById: Map<string, ContactField>,
): LeadContact | null {
  const contact: LeadContact = { name: null, title: null, email: null, phone: null, linkedinUrl: null, sourceUrls: [] };
  const urls = new Set<string>();
  for (const r of results ?? []) {
    const field = r.enrichmentId ? fieldById.get(r.enrichmentId) : undefined;
    if (!field || r.status !== "completed") continue;
    const value = r.result?.map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean);
    if (!value || /^(n\/?a|none|unknown|not (found|available|listed).*)$/i.test(value)) continue;
    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    if (field === "linkedinUrl" && !/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(value)) continue;
    contact[field] = field === "email" ? value.toLowerCase().slice(0, 200) : value.slice(0, 300);
    for (const ref of r.references ?? []) if (typeof ref.url === "string" && /^https?:\/\//i.test(ref.url)) urls.add(ref.url);
  }
  if (!contact.name && !contact.email && !contact.phone && !contact.linkedinUrl) return null;
  contact.sourceUrls = [...urls].slice(0, 5);
  return contact;
}

type RawPerson = {
  url?: string;
  title?: string | null;
  entities?: Array<{
    type?: string;
    properties?: {
      name?: string;
      workHistory?: Array<{ title?: string | null; dates?: { to?: string | null } | null; company?: { name?: string | null } | null }>;
    };
  }> | null;
};

/** Company names match when one contains the other once legal suffixes and punctuation are removed. */
function sameCompany(a: string, b: string): boolean {
  const x = companyNameKey(a);
  const y = companyNameKey(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

const DECISION_MAKER = /\b(cto|cio|ciso|chief|vp|vice president|head|director|founder|owner|president|ceo|coo|cfo|manager|lead)\b/i;

/**
 * People-search results → contacts who currently work at the company (a current role there in
 * their work history). Former staff and people elsewhere are dropped; senior roles come first.
 */
export function contactsFromPeople(raw: RawPerson[], companyName: string, limit = 3): LeadContact[] {
  const out: LeadContact[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const person = r.entities?.find((e) => e.type === "person")?.properties;
    const name = (person?.name ?? r.title ?? "").trim();
    if (!name || typeof r.url !== "string" || !/^https?:\/\//i.test(r.url)) continue;
    const current = (person?.workHistory ?? []).find(
      (w) => !w.dates?.to && w.company?.name && sameCompany(w.company.name, companyName),
    );
    if (!current) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const linkedin = /linkedin\.com\//i.test(r.url) ? r.url : null;
    out.push({
      name: name.slice(0, 200),
      title: current.title?.trim().slice(0, 200) || null,
      email: null,
      phone: null,
      linkedinUrl: linkedin,
      sourceUrls: [r.url],
    });
  }
  return out
    .sort((a, b) => Number(DECISION_MAKER.test(b.title ?? "")) - Number(DECISION_MAKER.test(a.title ?? "")))
    .slice(0, limit);
}

/** Pages on a company's own site most likely to list emails and phone numbers. */
const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about"];
const CONTACT_PAGE_TARGETS = ["contact", "contact-us", "about", "team", "leadership", "people", "staff"];
const CONTACT_SUBPAGES = 5;
const CONTACT_PAGE_TEXT_CHARS = 20_000;

type ContactPage = { url?: string; text?: string | null };
type FoundDetail = { email: string | null; phone: string | null; sourceUrl: string };
export type SiteContactDetails = { general: FoundDetail | null; people: Map<string, FoundDetail> };

const EMAIL_IN_TEXT = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
/** A number right after a label such as "Tel", "Phone", "Call us on" or "T:" */
const LABELLED_PHONE = /(?:\b(?:tel(?:ephone)?|phone|call(?:\s+us)?(?:\s+on)?|switchboard)\s*[:.]?|\bt\s*:)\s*(\+?\(?\d[\d\s().-]{6,20}\d)/gi;
/** An international number ("+44 …"), which needs no label */
const INTL_PHONE = /(?<![\w+])(\+\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d[\d\s().-]{6,16}\d)/g;
const GENERAL_MAILBOX = /^(info|enquiries|inquiries|enquiry|contact|contactus|hello|hi|sales|office|admin|mail|general|reception)$/;

const personKey = (name: string) => name.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");

/** True when an address's local part is built from the person's name (jane.doe, jdoe, doe.jane …). */
export function emailMatchesName(email: string, name: string): boolean {
  const parts = personKey(name).split(" ");
  if (parts.length < 2) return false;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const local = email.split("@")[0]!.toLowerCase().replace(/[._-]/g, "");
  return [first + last, first[0] + last, last + first, last + first[0], first + last[0]].includes(local);
}

function phonesIn(text: string): string[] {
  const found = [...text.matchAll(LABELLED_PHONE), ...text.matchAll(INTL_PHONE)].map((m) => m[1]!.replace(/\s+/g, " ").trim());
  return found.filter((p) => {
    const d = digitsOf(p);
    return d.length >= 9 && d.length <= 15 && !/^(\d)\1+$/.test(d);
  });
}

/**
 * Company website pages → emails and phones written in their text (nothing is inferred).
 * Only the company's own pages count and only addresses at its own domain. A person gets an
 * address built from their name; info@-style addresses and the first listed number are general.
 */
export function contactDetailsFromPages(pages: ContactPage[], domain: string, names: string[]): SiteContactDetails {
  const out: SiteContactDetails = { general: null, people: new Map() };
  const own = pages
    .filter((p): p is { url: string; text: string } => typeof p.url === "string" && Boolean(p.text) && sameSite(hostnameOf(p.url) ?? "", domain))
    // Contact pages first, so their number wins over one in a footer elsewhere
    .sort((a, b) => Number(/contact/i.test(b.url)) - Number(/contact/i.test(a.url)));
  for (const page of own) {
    const emails = [...new Set((page.text.match(EMAIL_IN_TEXT) ?? []).map((e) => e.toLowerCase()))].filter((e) =>
      sameSite(e.split("@")[1]!, domain),
    );
    for (const email of emails) {
      const name = names.find((n) => emailMatchesName(email, n));
      if (name && !out.people.has(personKey(name))) {
        out.people.set(personKey(name), { email: email.slice(0, 200), phone: null, sourceUrl: page.url });
      } else if (!name && GENERAL_MAILBOX.test(email.split("@")[0]!)) {
        out.general ??= { email: null, phone: null, sourceUrl: page.url };
        out.general.email ??= email.slice(0, 200);
      }
    }
    const phone = phonesIn(page.text)[0];
    if (phone) {
      out.general ??= { email: null, phone: null, sourceUrl: page.url };
      out.general.phone ??= phone.slice(0, 60);
    }
  }
  return out;
}

/**
 * Fill each person's empty email/phone: their own details if the site names them, else the
 * company's general ones (flagged as general). With no people, the general details become a
 * company contact of their own.
 */
export function applyContactDetails(people: LeadContact[], details: SiteContactDetails): LeadContact[] {
  const g = details.general;
  if (!people.length) {
    return g ? [{ name: null, title: null, email: g.email, phone: g.phone, linkedinUrl: null, sourceUrls: [g.sourceUrl], emailIsGeneral: Boolean(g.email), phoneIsGeneral: Boolean(g.phone) }] : [];
  }
  return people.map((person) => {
    const c: LeadContact = { ...person, sourceUrls: [...person.sourceUrls] };
    const own = c.name ? details.people.get(personKey(c.name)) : undefined;
    const used = new Set<string>();
    if (!c.email && own?.email) (c.email = own.email), used.add(own.sourceUrl);
    if (!c.phone && own?.phone) (c.phone = own.phone), used.add(own.sourceUrl);
    if (!c.email && g?.email) (c.email = g.email), (c.emailIsGeneral = true), used.add(g.sourceUrl);
    if (!c.phone && g?.phone) (c.phone = g.phone), (c.phoneIsGeneral = true), used.add(g.sourceUrl);
    c.sourceUrls = [...new Set([...c.sourceUrls, ...used])].slice(0, 5);
    return c;
  });
}

/**
 * Webset company items → evidence. The cited reference behind a satisfied criterion is the
 * source (not the homepage) where one exists; items that fail any criterion are dropped.
 */
export function normalizeWebsetItems(
  raw: unknown[],
  websetId: string,
  contactFieldById: Map<string, ContactField> = new Map(),
): NormalizedEvidenceItem[] {
  const items: NormalizedEvidenceItem[] = [];
  for (const r of raw) {
    const row = r as {
      properties?: {
        type?: string;
        url?: string;
        description?: string;
        company?: { name?: string; location?: string | null; about?: string | null };
      };
      evaluations?: Array<{
        criterion?: string;
        reasoning?: string;
        satisfied?: string;
        references?: Array<{ url?: string; title?: string | null; snippet?: string | null }>;
      }>;
      enrichments?: RawEnrichmentResult[] | null;
    };
    const p = row.properties;
    if (p?.type !== "company" || typeof p.url !== "string" || !/^https?:\/\//i.test(p.url)) continue;
    const name = p.company?.name?.trim();
    const website = hostnameOf(p.url);
    if (!name || !website) continue;
    const evals = row.evaluations ?? [];
    if (evals.some((e) => e.satisfied === "no")) continue;

    const satisfied = evals.filter((e) => e.satisfied === "yes");
    const refs = satisfied.flatMap((e) => e.references ?? []).filter((x) => typeof x.url === "string" && /^https?:\/\//i.test(x.url));
    // Prefer a third-party reference over the company's own homepage
    const ref = refs.find((x) => hostnameOf(x.url!) !== website) ?? refs[0];
    const url = ref?.url ?? p.url;
    const reasoning = satisfied.map((e) => e.reasoning?.trim()).filter(Boolean).join(" ");
    const location = p.company?.location?.split(",").pop()?.trim();

    items.push({
      canonicalUrl: canonicalizeUrl(url),
      title: (ref?.title ?? name).slice(0, 300),
      excerpt: [ref?.snippet, reasoning].filter(Boolean).join(" … ").slice(0, 800) || undefined,
      publisher: hostnameOf(url) ?? undefined,
      // Webset references carry no event date: unknown stays unknown
      eventDate: null,
      country: normalizeCountry(location) ?? countryFromUrl(p.url),
      matchRationale: `List check: ${satisfied.length} of ${evals.length} criteria met with cited sources`,
      providerRequestRef: websetId,
      signalKind: satisfied.length && satisfied.length === evals.length ? "webset_match" : "web_signal",
      subject: { companyName: name.slice(0, 200), companyWebsite: ownWebsite(website), eventSummary: (p.description ?? p.company?.about ?? "").slice(0, 400) || null },
      ...(() => {
        const contact = contactFromEnrichments(row.enrichments, contactFieldById);
        return contact ? { contact } : {};
      })(),
    });
  }
  return items;
}

/** Map Exa/HTTP failures to normalized, secret-free error codes (spec §6). */
export function normalizeExaError(err: unknown): NormalizedProviderError {
  if (err instanceof NormalizedProviderError) return err;
  const status =
    err && typeof err === "object" && "statusCode" in err
      ? Number((err as { statusCode: unknown }).statusCode)
      : err && typeof err === "object" && "status" in err
        ? Number((err as { status: unknown }).status)
        : NaN;
  const message = err instanceof Error ? err.message : "";
  if ((status === 401 || status === 403) && /plan|upgrade|does not have access/i.test(message)) {
    // The key is valid but this feature (e.g. list building) isn't in the subscribed plan
    return new NormalizedProviderError("provider_plan", "This feature isn't included in the current research plan", false);
  }
  if (status === 401 || status === 403) {
    return new NormalizedProviderError("provider_auth", "The research service rejected the API key", false);
  }
  if (status === 429) {
    return new NormalizedProviderError("provider_rate_limited", "Research rate limit reached", true);
  }
  if (status === 400 || status === 422) {
    return new NormalizedProviderError("provider_bad_request", "The research service rejected the request", false);
  }
  if (status >= 500) {
    return new NormalizedProviderError("provider_unavailable", "The research service is temporarily unavailable", true);
  }
  return new NormalizedProviderError("provider_error", "Research request failed", true);
}

/**
 * Exa research adapter (server-only). Endpoint mapping, limits and error
 * normalization stay inside the adapter; the API key never leaves this process.
 */
export class ExaResearchProvider implements ResearchProvider {
  name = "exa";

  private client(): InstanceType<typeof Exa> {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return new Exa(getEnv().EXA_API_KEY);
  }

  normalize(raw: unknown, requestRef = ""): NormalizedEvidenceItem[] {
    const results = Array.isArray(raw)
      ? raw
      : ((raw as { results?: unknown[] })?.results ?? []);
    const items: NormalizedEvidenceItem[] = [];
    for (const r of results) {
      const row = r as Record<string, unknown>;
      const url = typeof row.url === "string" ? row.url : "";
      if (!/^https?:\/\//i.test(url)) continue;
      const published = typeof row.publishedDate === "string" ? row.publishedDate : null;

      // Prefer highlights; page text is untrusted data and is only stored as an excerpt
      let excerpt: string | undefined;
      const highlights = row.highlights;
      if (Array.isArray(highlights) && highlights.length) {
        excerpt = highlights.map(String).join(" … ").slice(0, 800);
      } else if (typeof row.text === "string") {
        excerpt = row.text.slice(0, 800);
      }

      const subject = parseSubject(row.summary);
      items.push({
        canonicalUrl: canonicalizeUrl(url),
        title: typeof row.title === "string" ? row.title.slice(0, 300) : undefined,
        excerpt,
        publisher: hostnameOf(url) ?? undefined,
        // Unknown dates stay unknown
        eventDate: published && !Number.isNaN(Date.parse(published)) ? published : null,
        country: countryFromUrl(url),
        matchRationale: "Matched by web search for the research query",
        providerRequestRef: requestRef,
        signalKind: subject?.signalType ?? "web_signal",
        subject: subject
          ? {
              companyName: subject.companyName,
              companyWebsite: subject.companyWebsite,
              eventSummary: subject.eventSummary,
            }
          : undefined,
      });
    }
    // Hints without run filters; discover() recomputes fit against the run's filters
    return withScoringHints(items);
  }

  async discover(
    query: string,
    filters: ResearchFilters,
    budget: number,
    mode: ResearchMode = "account",
  ): Promise<NormalizedDiscovery> {
    const exa = this.client();
    const total = Math.min(Math.max(budget, 1), 10);
    if (mode === "similar") return this.findSimilar(exa, query, filters, total);

    // Account research also reads the company's own careers/news pages (costs one unit)
    const crawlDomain = mode === "account" && total >= 2 ? normalizeDomain(filters.companyDomain) : null;
    const plans = planSearches(filters.signalKinds, crawlDomain ? total - 1 : total);

    const startPublishedDate = filters.eventWindowDays
      ? new Date(Date.now() - filters.eventWindowDays * 86400000).toISOString()
      : undefined;

    const search = async (plan: SearchPlan) => {
      // Both modes search for signal events (news, announcements, postings) in the event window.
      // Discovery additionally asks the provider which company each article is about.
      const parts = [query];
      if (filters.industries?.length) parts.push(filters.industries.join(" "));
      if (plan.kinds.length > 0) {
        parts.push(plan.kinds.map((k) => SIGNAL_TERMS[k] ?? k).join(" "));
      }
      const fullQuery = parts.filter(Boolean).join(" ").trim().slice(0, 1000);
      const summaryPrompt = plan.kinds.length > 0 ? SUBJECT_SUMMARY : SIMILAR_SUMMARY;
      return (await withTimeout(
        exa.searchAndContents(fullQuery, {
          type: "auto",
          numResults: plan.numResults,
          highlights: true,
          ...(plan.category ? { category: plan.category } : {}),
          ...(filters.requiredPhrase?.trim() ? { includeText: [filters.requiredPhrase.trim()] } : {}),
          ...(mode === "discovery" ? { summary: summaryPrompt } : {}),
          ...(startPublishedDate ? { startPublishedDate } : {}),
          ...(filters.countries?.length === 1 ? { userLocation: filters.countries[0] } : {}),
          ...(filters.excludeDomains?.length ? { excludeDomains: filters.excludeDomains.slice(0, 100) } : {}),
        }),
        REQUEST_TIMEOUT_MS,
      )) as ExaResponse;
    };

    let responses: ExaResponse[];
    let site: { requestRef: string; items: NormalizedEvidenceItem[] } | null;
    try {
      [responses, site] = await Promise.all([
        Promise.all(plans.map(search)),
        crawlDomain ? this.crawlCompanySite(exa, crawlDomain) : Promise.resolve(null),
      ]);
    } catch (err) {
      throw normalizeExaError(err);
    }

    const refs = [...responses.map((r) => r.requestId ?? ""), site?.requestRef ?? ""].filter(Boolean);
    const seen = new Set<string>();
    let items = [...responses.flatMap((r) => this.normalize(r, r.requestId ?? "")), ...(site?.items ?? [])].filter((i) => {
      if (seen.has(i.canonicalUrl)) return false;
      seen.add(i.canonicalUrl);
      return true;
    });

    // Region match uses the normalized source country only — sources with an unknown
    // country are kept (unknown is not a mismatch), known mismatches are dropped.
    if (filters.countries?.length) {
      const allowed = new Set(filters.countries);
      items = items.filter((i) => !i.country || allowed.has(i.country));
    }
    items = withScoringHints(items, filters);

    return {
      providerRunId: refs.join(","),
      items,
      rawCount:
        responses.reduce((n, r) => n + (Array.isArray(r.results) ? r.results.length : 0), 0) + (site?.items.length ? 1 : 0),
    };
  }

  /**
   * The company's own careers, jobs and news pages. Best effort: a site that blocks
   * crawling never fails the run. Pages without a buying signal are not kept as evidence.
   */
  private async crawlCompanySite(
    exa: InstanceType<typeof Exa>,
    domain: string,
  ): Promise<{ requestRef: string; items: NormalizedEvidenceItem[] } | null> {
    try {
      const response = (await withTimeout(
        exa.getContents([`https://${domain}`], {
          highlights: true,
          summary: SUBJECT_SUMMARY,
          subpages: SITE_SUBPAGES,
          subpageTarget: SITE_SUBPAGE_TARGETS,
        }),
        REQUEST_TIMEOUT_MS,
      )) as ExaResponse;
      const requestRef = response.requestId ?? "";
      const subpages = response.results.flatMap((r) => {
        const sp = (r as { subpages?: unknown[] }).subpages;
        return Array.isArray(sp) ? sp : [];
      });
      const items = this.normalize(subpages, requestRef)
        .filter((i) => i.signalKind !== "web_signal")
        .map((i) => ({ ...i, matchRationale: `Found on ${domain}'s own website (careers / news pages)` }));
      return { requestRef, items };
    } catch {
      return null;
    }
  }

  /** Companies whose websites resemble the seed company's (Exa find-similar). */
  private async findSimilar(
    exa: InstanceType<typeof Exa>,
    seedUrl: string,
    filters: ResearchFilters,
    numResults: number,
  ): Promise<NormalizedDiscovery> {
    const seed = hostnameOf(seedUrl) ?? seedUrl;
    const seedDomain = normalizeDomain(seedUrl);
    let response: ExaResponse;
    try {
      response = (await withTimeout(
        exa.findSimilarAndContents(seedUrl, {
          numResults,
          excludeSourceDomain: true,
          highlights: true,
          summary: SIMILAR_SUMMARY,
          ...(filters.excludeDomains?.length ? { excludeDomains: filters.excludeDomains.slice(0, 100) } : {}),
        }),
        REQUEST_TIMEOUT_MS,
      )) as ExaResponse;
    } catch (err) {
      throw normalizeExaError(err);
    }
    const requestRef = response.requestId ?? "";
    let items = this.normalize(response, requestRef).flatMap((i) => {
      const host = hostnameOf(i.canonicalUrl);
      // Only company websites count: news sites, job boards and blogs are not lookalikes
      if (!host || isKnownPublisher(host) || !i.subject?.companyName) return [];
      // Only the company's own site counts: a directory or profile page *about* a company
      // (e.g. leadiq.com/company/acme) must not give that company the directory's domain
      const own = companyDomain(i.subject.companyWebsite);
      if (!own || !sameSite(host, own)) return [];
      // A page about the seed company itself is not a lookalike
      if (seedDomain && sameSite(own, seedDomain)) return [];
      return [
        {
          ...i,
          // A homepage's date is not an event: lookalikes carry no buying signal yet
          eventDate: null,
          signalKind: "lookalike",
          matchRationale: `Website similar to ${seed} (similar-company search), no buying signal yet`,
          subject: { ...i.subject, companyWebsite: own },
        },
      ];
    });
    if (filters.countries?.length) {
      const allowed = new Set(filters.countries);
      items = items.filter((i) => !i.country || allowed.has(i.country));
    }
    return {
      providerRunId: requestRef,
      items: withScoringHints(items, filters),
      rawCount: Array.isArray(response.results) ? response.results.length : 0,
    };
  }

  /** Cited answer to one question (Exa Answer). The text is AI-written; citations are the evidence. */
  async answer(question: string, opts: { userLocation?: string } = {}): Promise<ProviderAnswer> {
    const exa = this.client();
    try {
      const res = await withTimeout(
        exa.answer(question, {
          text: false,
          systemPrompt:
            "Answer only from the sources. Name dates where the sources give them. If the sources show no clear sign, say that plainly instead of guessing.",
          ...(opts.userLocation ? { userLocation: opts.userLocation } : {}),
        }),
        REQUEST_TIMEOUT_MS,
      );
      const answer = typeof res.answer === "string" ? res.answer : JSON.stringify(res.answer);
      const citations = (res.citations ?? [])
        .filter((c) => typeof c.url === "string" && /^https?:\/\//i.test(c.url))
        .slice(0, 8)
        .map((c) => ({
          url: canonicalizeUrl(c.url),
          title: typeof c.title === "string" ? c.title.slice(0, 300) : null,
          publishedDate: typeof c.publishedDate === "string" ? c.publishedDate : null,
        }));
      return { answer: answer.trim().slice(0, 1500), citations, requestRef: res.requestId ?? "" };
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** Start a company list (Webset), or add a search to an existing one ("refresh"). */
  async startWebset(query: string, filters: ResearchFilters, count: number): Promise<WebsetStarted> {
    const exa = this.client();
    const startedAt = new Date().toISOString();
    const search = {
      query: websetQuery(query, filters),
      count: Math.min(Math.max(count, 1), 25),
      entity: { type: "company" as const },
      ...(websetCriteria(filters).length ? { criteria: websetCriteria(filters) } : {}),
    };
    try {
      if (filters.websetId) {
        // Lists built before contact enrichment existed get it added once, so refreshed leads carry contacts too
        await this.ensureContactEnrichments(filters.websetId);
        await withTimeout(
          exa.websets.searches.create(filters.websetId, { ...search, behavior: WebsetSearchBehavior.append }),
          REQUEST_TIMEOUT_MS,
        );
        return { websetId: filters.websetId, startedAt };
      }
      const webset = await withTimeout(
        exa.websets.create({ search, enrichments: contactEnrichmentParams() }),
        REQUEST_TIMEOUT_MS,
      );
      return { websetId: webset.id, startedAt };
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** Wait for the list to go idle, then return the companies added since the search started. */
  async collectWebset(started: WebsetStarted, filters: ResearchFilters): Promise<NormalizedDiscovery> {
    const exa = this.client();
    try {
      await exa.websets.waitUntilIdle(started.websetId, { timeout: WEBSET_WAIT_MS, pollInterval: WEBSET_POLL_MS });
    } catch (err) {
      // Still building: a retryable timeout; the retry resumes waiting on the same list
      if (err instanceof Error && /idle|timeout|timed out/i.test(err.message) && !("statusCode" in err)) {
        throw new NormalizedProviderError("provider_timeout", "The list is still being built", true);
      }
      throw normalizeExaError(err);
    }
    let raw: unknown[];
    try {
      raw = (await exa.websets.items.getAll(started.websetId)) as unknown[];
    } catch (err) {
      throw normalizeExaError(err);
    }
    const fresh = raw.filter((r) => {
      const created = (r as { createdAt?: unknown }).createdAt;
      // Clock skew allowance: items from this search can be stamped slightly before our start time
      return typeof created !== "string" || Date.parse(created) >= Date.parse(started.startedAt) - 120_000;
    });
    const excluded = new Set((filters.excludeDomains ?? []).map((d) => normalizeDomain(d)).filter(Boolean));
    const contactFields = await this.contactFieldsById(started.websetId);
    let items = normalizeWebsetItems(fresh, started.websetId, contactFields).filter(
      (i) => !excluded.has(normalizeDomain(i.subject?.companyWebsite) ?? ""),
    );
    if (filters.countries?.length) {
      const allowed = new Set(filters.countries);
      items = items.filter((i) => !i.country || allowed.has(i.country));
    }
    return {
      providerRunId: started.websetId,
      items: withScoringHints(items, filters),
      rawCount: fresh.length,
    };
  }

  /**
   * A company list built from web searches, for plans without Websets. One search per buying
   * signal (news for expansion/refresh/compute, the open web for hiring and tenders), merged
   * and grouped by company; up to `count` companies, each with every source that named it.
   */
  async buildListFromSearch(query: string, filters: ResearchFilters, count: number): Promise<NormalizedDiscovery> {
    const exa = this.client();
    const target = Math.min(Math.max(count, 1), 25);
    const isExplicitEmpty = Array.isArray(filters.signalKinds) && filters.signalKinds.length === 0;
    const kinds = filters.signalKinds?.length
      ? filters.signalKinds
      : (isExplicitEmpty ? [] : Object.keys(SIGNAL_TERMS));
    const base = [query.trim(), filters.industries?.join(" ")].filter(Boolean).join(" ");

    const searches = kinds.length > 0
      ? kinds.map((kind) => ({
          term: `${base} ${SIGNAL_TERMS[kind] ?? kind.replace(/^custom_/, "").replace(/_/g, " ")}`.trim().slice(0, 1000),
          category: NEWS_KINDS.has(kind) ? ("news" as const) : undefined,
          summary: SUBJECT_SUMMARY,
        }))
      : [{
          term: base.trim().slice(0, 1000),
          category: undefined,
          summary: SIMILAR_SUMMARY,
        }];

    // Roughly two articles per wanted company, as several articles name the same company or none
    const perSearch = Math.min(25, Math.max(10, Math.ceil((target * 2) / Math.max(searches.length, 1))));
    const startPublishedDate = filters.eventWindowDays
      ? new Date(Date.now() - filters.eventWindowDays * 86400000).toISOString()
      : undefined;

    const settled = await Promise.allSettled(
      searches.map(
        (s) =>
          withTimeout(
            exa.searchAndContents(
              s.term,
              {
                type: "auto",
                numResults: perSearch,
                highlights: true,
                summary: s.summary,
                ...(s.category ? { category: s.category } : {}),
                ...(filters.requiredPhrase?.trim() ? { includeText: [filters.requiredPhrase.trim()] } : {}),
                ...(startPublishedDate ? { startPublishedDate } : {}),
                ...(filters.countries?.length === 1 ? { userLocation: filters.countries[0] } : {}),
                ...(filters.excludeDomains?.length ? { excludeDomains: filters.excludeDomains.slice(0, 100) } : {}),
              },
            ),
            REQUEST_TIMEOUT_MS,
          ) as Promise<ExaResponse>,
      ),
    );
    const responses = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    // One failed search only narrows the list; all failing fails the run
    if (!responses.length) {
      const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      throw normalizeExaError(first?.reason);
    }

    const excluded = new Set((filters.excludeDomains ?? []).map((d) => normalizeDomain(d)).filter(Boolean));
    const allowed = filters.countries?.length ? new Set(filters.countries) : null;
    const seenUrls = new Set<string>();
    const byCompany = new Map<string, NormalizedEvidenceItem[]>();
    for (const r of responses) {
      for (const i of this.normalize(r, r.requestId ?? "")) {
        if (seenUrls.has(i.canonicalUrl)) continue;
        seenUrls.add(i.canonicalUrl);
        const name = i.subject?.companyName?.trim();
        const domain = companyDomain(i.subject?.companyWebsite);
        // A list holds companies: articles that name no single company are dropped
        if (!name) continue;
        if (domain && excluded.has(domain)) continue;
        if (allowed && i.country && !allowed.has(i.country)) continue;
        const key = domain ?? `name:${companyNameKey(name)}`;
        const list = byCompany.get(key) ?? [];
        list.push({ ...i, matchRationale: `List search: web sources name ${name} with a buying signal` });
        byCompany.set(key, list);
      }
    }

    // Companies named by more sources first, then the most recent event
    const latest = (list: NormalizedEvidenceItem[]) => list.reduce((d, i) => ((i.eventDate ?? "") > d ? (i.eventDate ?? "") : d), "");
    const companies = [...byCompany.values()]
      .sort((a, b) => b.length - a.length || latest(b).localeCompare(latest(a)))
      .slice(0, target);

    return {
      providerRunId: `${SEARCH_LIST_PREFIX}${responses.map((r) => r.requestId ?? "").filter(Boolean).join(",")}`.slice(0, 1000),
      items: withScoringHints(companies.flat(), filters),
      // Charged per company on the list, as a Webset list is
      rawCount: companies.length,
    };
  }

  /** Company search: homepages of companies with this name (category "company"), best first. */
  async findCompanyWebsites(company: { name: string; country?: string | null }): Promise<Array<{ url: string; title: string | null }>> {
    try {
      const res = (await withTimeout(
        this.client().search(`${company.name}${company.country ? ` (${company.country})` : ""} official website`, {
          numResults: 5,
          category: "company",
        } as unknown as Parameters<InstanceType<typeof Exa>["search"]>[1]),
        REQUEST_TIMEOUT_MS,
      )) as { results?: Array<{ url?: unknown; title?: unknown }> };
      return (res.results ?? [])
        .filter((r): r is { url: string; title?: unknown } => typeof r.url === "string" && /^https?:\/\//i.test(r.url))
        .map((r) => ({ url: r.url, title: typeof r.title === "string" ? r.title.slice(0, 300) : null }));
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** People search: current staff at the company, IT/technology decision makers first. */
  async findContacts(company: { name: string; domain: string | null }, roleHint?: string): Promise<LeadContact[]> {
    const role = roleHint?.trim() || "CTO, CIO, Head of IT or Head of Infrastructure";
    try {
      const res = (await withTimeout(
        this.client().search(`${role} at ${company.name}${company.domain ? ` (${company.domain})` : ""}`, {
          numResults: 8,
          category: "people",
          // "people" is accepted by the API but not yet in the SDK's category type
        } as unknown as Parameters<InstanceType<typeof Exa>["search"]>[1]),
        REQUEST_TIMEOUT_MS,
      )) as { results?: RawPerson[] };
      return contactsFromPeople(res.results ?? [], company.name);
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** Agent run that finds decision makers with work emails (see exaAgent.ts). */
  async startContactsAgent(company: { name: string; domain: string | null }, roleHint?: string) {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return startContactsAgentRun(getEnv().EXA_API_KEY, company, roleHint);
  }

  async getContactsAgent(runId: string): Promise<ContactsAgentResult> {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return getContactsAgentRun(getEnv().EXA_API_KEY, runId);
  }

  /** Agent run that writes a stakeholder brief about one person (see exaBriefAgent.ts). */
  async startBriefAgent(input: BriefAgentInput) {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return startBriefAgentRun(getEnv().EXA_API_KEY, input);
  }

  async getBriefAgent(runId: string, offerNames: string[]): Promise<BriefAgentResult> {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return getBriefAgentRun(getEnv().EXA_API_KEY, runId, offerNames);
  }

  /** Agent run that reads a company's own website and builds its sales profile (see exaProfileAgent.ts). */
  async startProfileAgent(website: string) {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return startProfileAgentRun(getEnv().EXA_API_KEY, website);
  }

  async getProfileAgent(runId: string): Promise<ProfileAgentResult> {
    if (!isExaConfigured()) throw providerNotConfigured("exa");
    return getProfileAgentRun(getEnv().EXA_API_KEY, runId);
  }

  /** Emails and phones written on the company's own contact, about and team pages. */
  async findContactDetails(company: { name: string; domain: string }, people: LeadContact[]): Promise<LeadContact[]> {
    const domain = normalizeDomain(company.domain);
    if (!domain) return people;
    try {
      const res = (await withTimeout(
        this.client().getContents(
          CONTACT_PATHS.map((p) => `https://${domain}${p}`),
          {
            text: { maxCharacters: CONTACT_PAGE_TEXT_CHARS },
            subpages: CONTACT_SUBPAGES,
            subpageTarget: CONTACT_PAGE_TARGETS,
            livecrawl: "fallback",
          },
        ),
        REQUEST_TIMEOUT_MS,
      )) as { results?: Array<ContactPage & { subpages?: ContactPage[] }> };
      const pages = (res.results ?? []).flatMap((r) => [r, ...(Array.isArray(r.subpages) ? r.subpages : [])]);
      const names = people.flatMap((p) => (p.name ? [p.name] : []));
      return applyContactDetails(people, contactDetailsFromPages(pages, domain, names));
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** The list's contact enrichments, by id → the contact field each one fills. */
  private async contactFieldsById(websetId: string, strict = false): Promise<Map<string, ContactField>> {
    const map = new Map<string, ContactField>();
    try {
      const webset = (await withTimeout(this.client().websets.get(websetId), REQUEST_TIMEOUT_MS)) as {
        enrichments?: Array<{ id?: string; metadata?: Record<string, string> | null }>;
      };
      for (const e of webset.enrichments ?? []) {
        const field = e.metadata?.[CONTACT_KEY] as ContactField | undefined;
        if (e.id && field && CONTACT_ENRICHMENTS.some((c) => c.field === field)) map.set(e.id, field);
      }
    } catch (err) {
      if (strict) throw err;
      // Contacts are a bonus: the leads are still returned without them
    }
    return map;
  }

  private async ensureContactEnrichments(websetId: string) {
    try {
      // Strict read: if the list can't be read, skip rather than risk adding duplicate enrichments
      const existing = new Set((await this.contactFieldsById(websetId, true)).values());
      const exa = this.client();
      for (const params of contactEnrichmentParams()) {
        if (existing.has(params.metadata[CONTACT_KEY] as ContactField)) continue;
        await withTimeout(exa.websets.enrichments.create(websetId, params), REQUEST_TIMEOUT_MS);
      }
    } catch {
      // Contacts are a bonus: the refresh still runs without them
    }
  }

  async retrieve(sourceReferences: string[]): Promise<NormalizedSources> {
    const exa = this.client();
    const urls = sourceReferences.filter(Boolean).slice(0, 10);
    if (urls.length === 0) return { items: [] };
    try {
      const response = (await withTimeout(
        exa.getContents(urls, { highlights: true }),
        REQUEST_TIMEOUT_MS,
      )) as { requestId?: string; results: unknown[] };
      return { items: this.normalize(response, response.requestId ?? "") };
    } catch (err) {
      throw normalizeExaError(err);
    }
  }

  /** One unit per result returned (minimum one for the request); unused units are refunded. */
  async reportUsage(discovery: NormalizedDiscovery, reservedUnits: number): Promise<Usage> {
    return {
      requestRef: discovery.providerRunId,
      units: Math.min(reservedUnits, Math.max(1, discovery.rawCount)),
    };
  }
}
