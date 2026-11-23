import { NormalizedProviderError } from "./types.js";
import type { CompanyProfile, OfferItem, ProfileAgentResult } from "./types.js";
import { AGENT_URL, call, httpUrl, str } from "./exaAgent.js";
import { SIGNAL_KINDS } from "../../services/playbooks.js";
import { normalizeCountry } from "../../utils/normalize.js";

/**
 * Company profile: one Exa Agent run reads the customer's own website (and public pages about
 * them) and returns who they are, what they sell, who they sell to, and which buying signals
 * suggest a company might need them. Used to pre-fill Settings; the user reviews before applying.
 */
export const PROFILE_AGENT = {
  /** Fixed price $0.10 per run (Exa effort table) */
  effort: "medium",
  /** Spending cap; Exa rejects caps under $1 (the run itself costs about $0.10) */
  maxCostDollars: 1,
} as const;

/** What each built-in signal means, so the agent can pick the right ones */
const SIGNAL_MEANING: Record<string, string> = {
  expansion: "new office, site, factory or market",
  infra_hiring: "hiring for IT / infrastructure roles",
  refresh: "hardware or technology refresh",
  compute: "new compute, AI or data centre capacity",
  procurement: "public tender or procurement notice",
  cloud_migration: "moving to the cloud",
  leadership_change: "new executive or leadership hire",
  technology_adoption: "adopting a new technology or platform",
  infrastructure_investment: "investment in infrastructure",
  digital_transformation: "digital transformation programme",
  funding: "funding round or investment",
  m_and_a: "merger or acquisition",
  security_compliance: "security incident or new compliance need",
  cost_optimization: "cost-cutting or efficiency drive",
};

const S = (description: string) => ({ type: "string", description });
const LIST = (description: string, maxItems = 6) => ({ type: "array", maxItems, items: { type: "string" }, description });
const OBJ = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});

export function profileOutputSchema() {
  return OBJ({
    companyName: S("The company's name as it presents itself"),
    summary: S("Two or three sentences: what the company does, for whom, and how it is different"),
    offering: S("One short line (max 20 words) describing what they sell, e.g. 'Specialist technology recruitment'"),
    products: {
      type: "array",
      maxItems: 10,
      description: "Their main products or services, as named on their website",
      items: OBJ({
        name: S("Product or service name"),
        description: S("What it is, in one or two sentences"),
        bestFor: S("Which kind of customer or situation it fits best"),
        proofPoints: S("Evidence it works: named clients, results, awards, accreditations. Empty if none found"),
      }),
    },
    industries: LIST("Industries or sectors of the customers they sell to (not their own industry)", 10),
    buyerRoles: LIST("Job functions or titles that would buy from them, e.g. 'Head of IT', 'Talent acquisition'", 8),
    countries: LIST("Countries they sell into, as country names", 12),
    companySizes: LIST("Typical customer company sizes in employees, as ranges like '50-200' or '1000+'", 4),
    differentiators: LIST("What makes them different from competitors, from their own claims", 6),
    customers: LIST("Named customers, partners or case studies shown on their website", 8),
    signals: {
      type: "array",
      maxItems: 6,
      description: "Built-in buying signals that suggest a company may soon need what they sell, best first",
      items: OBJ({
        key: { type: "string", enum: [...SIGNAL_KINDS], description: "One of the built-in signal keys" },
        why: S("Why this signal fits what they sell, in one sentence"),
      }),
    },
    customSignals: {
      type: "array",
      maxItems: 3,
      description: "Other buying signals specific to their market that the built-in list misses",
      items: OBJ({
        label: S("Short signal name, max 6 words"),
        description: S("What to look for in public sources"),
        why: S("Why it suggests a company needs what they sell"),
      }),
    },
    discoveryQuestion: S("One question a seller should ask a prospect to confirm they need this offer"),
    sources: {
      type: "array",
      maxItems: 8,
      description: "Pages this profile is based on",
      items: OBJ({ url: { type: "string", format: "uri" }, title: S("Page title") }),
    },
  });
}

export function profileAgentRequest(website: string) {
  const signalList = SIGNAL_KINDS.map((k) => `- ${k}: ${SIGNAL_MEANING[k] ?? k.replace(/_/g, " ")}`).join("\n");
  const query = [
    `Build a sales profile of the company whose website is ${website}.`,
    "",
    "Read their website first (home, services or products, sectors, about, case studies, clients), then public " +
      "pages about them if needed. This profile is used to set up a B2B prospecting tool FOR this company: we need " +
      "to know what they sell, who buys it, and what events at other companies suggest those companies may need it.",
    "",
    "Built-in buying signals to choose from (use these exact keys in 'signals'):",
    signalList,
    "",
    "RULES",
    "- Use only what you can find in public sources. If something is not stated, leave the field empty rather than guessing.",
    "- Products and services: use the names the company itself uses.",
    "- Industries, buyer roles, countries and sizes describe their CUSTOMERS, not the company itself.",
    "- Write in plain, direct British English.",
    "- List the pages you relied on in 'sources'.",
  ].join("\n");
  return {
    query,
    effort: PROFILE_AGENT.effort,
    outputSchema: profileOutputSchema(),
    budget: { maxCostDollars: PROFILE_AGENT.maxCostDollars },
  };
}

// ---------- Parsing: anything malformed is dropped, never guessed ----------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, max: number) => str(v, max) ?? "";
/** Unique (case-insensitive), trimmed strings */
function texts(v: unknown, maxItems: number, max: number): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const s = str(x, max);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, maxItems);
}

export function profileFromAgentOutput(structured: unknown): CompanyProfile | null {
  const r = obj(structured);
  if (!Object.keys(r).length) return null;

  const products: OfferItem[] = [];
  for (const x of arr(r.products)) {
    const p = obj(x);
    const name = str(p.name, 80);
    const description = str(p.description, 500);
    if (!name || !description || products.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    const bestFor = str(p.bestFor, 300);
    const proofPoints = str(p.proofPoints, 300);
    products.push({ name, description, ...(bestFor ? { bestFor } : {}), ...(proofPoints ? { proofPoints } : {}) });
  }

  // Countries → ISO codes; anything we can't map is dropped (never guessed)
  const countries: string[] = [];
  for (const c of texts(r.countries, 30, 60)) {
    const code = normalizeCountry(c);
    if (code && !countries.includes(code)) countries.push(code);
  }

  const known = new Set<string>(SIGNAL_KINDS);
  const signals: CompanyProfile["signals"] = [];
  for (const x of arr(r.signals)) {
    const s = obj(x);
    const key = str(s.key, 80);
    if (!key || !known.has(key) || signals.some((o) => o.key === key)) continue;
    signals.push({ key, why: text(s.why, 300) });
  }

  const customSignals: CompanyProfile["customSignals"] = [];
  for (const x of arr(r.customSignals)) {
    const s = obj(x);
    const label = str(s.label, 60);
    if (!label || customSignals.some((o) => o.label.toLowerCase() === label.toLowerCase())) continue;
    customSignals.push({ label, description: text(s.description, 300), why: text(s.why, 300) });
  }

  const sources: CompanyProfile["sources"] = [];
  for (const x of arr(r.sources)) {
    const o = obj(x);
    const url = httpUrl(o.url);
    if (!url || sources.some((s) => s.url === url)) continue;
    sources.push({ url, title: str(o.title, 200) });
  }

  const profile: CompanyProfile = {
    companyName: str(r.companyName, 120),
    summary: text(r.summary, 1200),
    offering: text(r.offering, 300),
    products: products.slice(0, 10),
    industries: texts(r.industries, 10, 60),
    buyerRoles: texts(r.buyerRoles, 8, 80),
    countries: countries.slice(0, 15),
    companySizes: texts(r.companySizes, 4, 20),
    differentiators: texts(r.differentiators, 6, 300),
    customers: texts(r.customers, 8, 120),
    signals: signals.slice(0, 6),
    customSignals: customSignals.slice(0, 3),
    discoveryQuestion: text(r.discoveryQuestion, 400),
    sources: sources.slice(0, 8),
  };
  // Nothing about what they sell = no usable profile
  return profile.summary || profile.offering || profile.products.length ? profile : null;
}

export async function startProfileAgentRun(apiKey: string, website: string): Promise<{ runId: string }> {
  const run = await call(apiKey, "POST", AGENT_URL, profileAgentRequest(website));
  const runId = str(run.id, 200);
  if (!runId) throw new NormalizedProviderError("provider_error", "Exa did not return a run id", true);
  return { runId };
}

export async function getProfileAgentRun(apiKey: string, runId: string): Promise<ProfileAgentResult> {
  const run = await call(apiKey, "GET", `${AGENT_URL}/${encodeURIComponent(runId)}`);
  const status = String(run.status ?? "");
  if (status === "completed") {
    const output = run.output as { structured?: unknown } | undefined;
    return { status: "completed", profile: profileFromAgentOutput(output?.structured) };
  }
  if (status === "failed" || status === "cancelled") {
    const err = run.error as { message?: unknown } | undefined;
    return { status: "failed", message: str(err?.message, 300) ?? `Agent run ${status}` };
  }
  return { status: "running" };
}
