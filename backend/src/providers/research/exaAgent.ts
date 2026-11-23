import { canonicalizeUrl } from "../../utils/normalize.js";
import { redactString } from "../../utils/redact.js";
import { buyingRoles, type BuyingRole } from "../../db/schema/contacts.js";
import { NormalizedProviderError, type ContactsAgentResult, type LeadContact } from "./types.js";

/**
 * Exa Agent API (https://exa.ai/docs/agent): an async research run that returns schema-shaped
 * JSON. Fields marked format "email" are filled by Exa's paid contact enrichment, which the plain
 * search and contents endpoints cannot do. Patterns follow the "Find all GTM members" and
 * "Enrich rows with bounded contact fields" examples.
 */
export const AGENT_URL = "https://api.exa.ai/agent/runs";
const REQUEST_TIMEOUT_MS = 30_000;

/** Spend limits per company: medium effort ($0.10) + up to 2 emails ($0.02 each), capped at $1. */
export const CONTACTS_AGENT = {
  effort: "medium",
  maxPeople: 2,
  maxCostDollars: 1,
  /** Phone numbers cost $0.07 each; turned off for now */
  phones: false,
} as const;

const DEFAULT_ROLES = "CTO, CIO, IT Director, Head of IT, Head of Infrastructure, Head of Digital or Technology";

export function contactsAgentRequest(company: { name: string; domain: string | null }, roleHint?: string) {
  const roles = roleHint?.trim() || DEFAULT_ROLES;
  const where = company.domain ? `${company.name} (${company.domain})` : company.name;
  const person: Record<string, unknown> = {
    full_name: { type: "string", description: "The person's full name" },
    title: { type: "string", description: "Their current job title at this organisation" },
    buying_role: {
      type: "string",
      enum: [...buyingRoles],
      description:
        "Their likely part in buying IT infrastructure, judged from their job title: decision_maker (signs off, e.g. CTO, CIO, " +
        "IT Director, Head of IT/Technology/Operations), budget_holder (owns the budget, e.g. CFO, Finance Director), " +
        "technical_evaluator (assesses the technology, e.g. architect, infrastructure or engineering manager), influencer, " +
        "procurement, user, or unknown if the title gives no clear signal",
    },
    email: { type: "string", format: "email", description: "Their own work email address, not a general inbox" },
    linkedin_url: { type: "string", format: "uri", description: "Their LinkedIn profile URL, if found" },
    evidence_urls: {
      type: "array",
      items: { type: "string", format: "uri" },
      minItems: 1,
      maxItems: 3,
      description: "Pages that show this person currently holds this role at this organisation",
    },
  };
  if (CONTACTS_AGENT.phones) {
    person.phone = { type: "string", format: "phone", description: "Their direct work phone number" };
  }
  return {
    query:
      `Find the current technology decision makers (${roles}) at ${where}. ` +
      `Only include people who CURRENTLY work at this exact organisation in that kind of role; verify each one ` +
      `against a recent source (staff page, news, LinkedIn) and skip anyone who has left or works at a different ` +
      `organisation with a similar name. Most senior first. For each person give their own work email if it can be found.`,
    effort: CONTACTS_AGENT.effort,
    outputSchema: {
      type: "object",
      properties: {
        people: {
          type: "array",
          maxItems: CONTACTS_AGENT.maxPeople,
          items: {
            type: "object",
            properties: person,
            required: ["full_name", "title", "evidence_urls"],
          },
        },
      },
      required: ["people"],
    },
    budget: { maxCostDollars: CONTACTS_AGENT.maxCostDollars },
  };
}

const GENERAL_MAILBOX = /^(info|enquiries|inquiries|enquiry|contact|contactus|hello|hi|sales|office|admin|mail|general|reception|it|helpdesk|servicedesk|support)$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function httpUrl(v: unknown): string | null {
  const s = str(v, 500);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    return canonicalizeUrl(s);
  } catch {
    return null;
  }
}

/** The agent's structured output → contacts. Anything malformed is dropped, never guessed. */
export function contactsFromAgentOutput(structured: unknown): LeadContact[] {
  const people = (structured as { people?: unknown } | null)?.people;
  if (!Array.isArray(people)) return [];
  const out: LeadContact[] = [];
  for (const p of people as Array<Record<string, unknown>>) {
    const name = str(p?.full_name, 200);
    if (!name) continue;
    if (out.some((o) => o.name?.toLowerCase() === name.toLowerCase())) continue;
    const rawEmail = str(p.email, 200)?.toLowerCase() ?? null;
    const email = rawEmail && EMAIL.test(rawEmail) ? rawEmail : null;
    const linkedin = httpUrl(p.linkedin_url);
    const evidenceUrls = Array.isArray(p.evidence_urls)
      ? (p.evidence_urls as unknown[]).map(httpUrl).filter((u): u is string => Boolean(u))
      : [];
    const sourceUrls = [...new Set([...evidenceUrls, ...(linkedin ? [linkedin] : [])])].slice(0, 5);
    // A person with no source page can't be checked by a reviewer, so it isn't kept
    if (!sourceUrls.length) continue;
    const role = str(p.buying_role, 40)?.toLowerCase();
    const buyingRole = role && (buyingRoles as readonly string[]).includes(role) ? (role as BuyingRole) : undefined;
    out.push({
      name,
      title: str(p.title, 200),
      ...(buyingRole ? { buyingRole } : {}),
      email,
      phone: CONTACTS_AGENT.phones ? str(p.phone, 50) : null,
      linkedinUrl: linkedin && /linkedin\.com\/in\//i.test(linkedin) ? linkedin : null,
      sourceUrls,
      emailIsGeneral: email ? GENERAL_MAILBOX.test(email.split("@")[0]!) : undefined,
    });
  }
  return out.slice(0, CONTACTS_AGENT.maxPeople);
}

/** HTTP status → the provider-neutral error the job understands. */
export function agentError(status: number, body: string): NormalizedProviderError {
  if (status === 402 || /credit|balance|billing|insufficient/i.test(body)) {
    return new NormalizedProviderError("provider_plan", "The Exa account is out of credit for agent runs", false);
  }
  if (status === 401 || status === 403) {
    return new NormalizedProviderError("provider_auth", "Exa rejected the API key for agent runs", false);
  }
  if (status === 429) return new NormalizedProviderError("provider_rate_limited", "Exa rate limit reached", true);
  if (status === 400 || status === 404 || status === 422) {
    return new NormalizedProviderError("provider_bad_request", "Exa rejected the agent request", false);
  }
  return new NormalizedProviderError("provider_unavailable", "Exa is temporarily unavailable", true);
}

export async function call(apiKey: string, method: "GET" | "POST", url: string, body?: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "x-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new NormalizedProviderError("provider_timeout", "Exa did not respond in time", true);
  }
  const text = await res.text();
  if (!res.ok) {
    // Exa's own reason, for whoever reads the server log (the user sees a plain message)
    console.warn(`Exa agent ${method} ${res.status}: ${redactString(text.slice(0, 500))}`);
    throw agentError(res.status, text.slice(0, 500));
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new NormalizedProviderError("provider_error", "Exa returned an unreadable response", true);
  }
}

export async function startContactsAgentRun(
  apiKey: string,
  company: { name: string; domain: string | null },
  roleHint?: string,
): Promise<{ runId: string }> {
  const run = await call(apiKey, "POST", AGENT_URL, contactsAgentRequest(company, roleHint));
  const runId = str(run.id, 200);
  if (!runId) throw new NormalizedProviderError("provider_error", "Exa did not return a run id", true);
  return { runId };
}

export async function getContactsAgentRun(apiKey: string, runId: string): Promise<ContactsAgentResult> {
  const run = await call(apiKey, "GET", `${AGENT_URL}/${encodeURIComponent(runId)}`);
  const status = String(run.status ?? "");
  const cost = Number((run.costDollars as { total?: unknown } | undefined)?.total);
  const costDollars = Number.isFinite(cost) ? cost : null;
  if (status === "completed") {
    const output = run.output as { structured?: unknown } | undefined;
    return { status: "completed", contacts: contactsFromAgentOutput(output?.structured), costDollars };
  }
  if (status === "failed" || status === "cancelled") {
    const err = run.error as { message?: unknown } | undefined;
    return { status: "failed", message: str(err?.message, 300) ?? `Agent run ${status}`, costDollars };
  }
  return { status: "running" };
}
