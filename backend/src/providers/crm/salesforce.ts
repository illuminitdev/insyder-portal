import { createHash } from "node:crypto";
import { redactString } from "../../utils/redact.js";
import {
  CrmError,
  type CrmCompanyInput,
  type CrmContactInput,
  type CrmDeal,
  type CrmDealInput,
  type CrmDealStage,
  type CrmObjectType,
  type CrmProvider,
  type CrmStageKey,
} from "./types.js";

/** Salesforce REST API version this adapter was written and tested against (spec §6: verify contracts per version). */
export const SALESFORCE_API_VERSION = "v62.0";
const OBJECT: Record<CrmObjectType, string> = { company: "Account", contact: "Contact", deal: "Opportunity" };
const MAX_ATTEMPTS = 3;
/** Client-credentials tokens carry no expiry; reuse one for a while and renew on 401 */
const TOKEN_TTL_MS = 30 * 60 * 1000;
/** A new opportunity needs a close date in Salesforce; Insyder has none, so it proposes one this far out */
const DEFAULT_CLOSE_DAYS = 90;

type Fetch = typeof fetch;

/**
 * What a company enters to connect Salesforce: its My Domain URL plus the consumer key/secret of a
 * Connected App (or External Client App) with the OAuth Client Credentials flow enabled.
 */
export type SalesforceCredentials = { myDomainUrl: string; clientId: string; clientSecret: string };

type Token = { accessToken: string; instanceUrl: string; expiresAt: number };
/** Per-credential token cache (keyed by a hash, never the secret itself) so each sync doesn't log in again */
const tokenCache = new Map<string, Token>();

const SF_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Accepts the company's My Domain URL in the forms people usually paste (with or without https://,
 * or the Lightning address from the browser bar) and returns `https://<name>.my.salesforce.com`.
 * Only Salesforce hosts are allowed, so the consumer secret is never sent anywhere else.
 */
export function normalizeMyDomainUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new CrmError("Enter your Salesforce My Domain URL, e.g. https://yourcompany.my.salesforce.com", null, false);
  }
  let host = url.hostname.toLowerCase();
  // yourcompany.lightning.force.com → yourcompany.my.salesforce.com (also for sandboxes)
  if (host.endsWith(".lightning.force.com")) host = host.replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.my\.salesforce\.com$/.test(host)) {
    throw new CrmError(
      "That isn't a Salesforce My Domain URL. In Salesforce open Setup → My Domain and copy the URL ending in .my.salesforce.com",
      null,
      false,
    );
  }
  return `https://${host}`;
}

function isSalesforceHost(instanceUrl: string) {
  try {
    const u = new URL(instanceUrl);
    return u.protocol === "https:" && /\.(salesforce|force)\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** SOQL string literal; LIKE patterns also escape their wildcards. */
function soql(value: string, like = false) {
  let v = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (like) v = v.replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `'${v}'`;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
/** Salesforce country fields (and State/Country picklists) take the country name, not its ISO code */
function countryName(code: string | null) {
  if (!code) return null;
  try {
    return /^[A-Z]{2}$/i.test(code) ? (regionNames.of(code.toUpperCase()) ?? code) : code;
  } catch {
    return code;
  }
}

type Resp<T> = { status: number; data: T | null };

/** Salesforce REST adapter, authenticated with the company's own Connected App (client credentials flow). */
export class SalesforceCrmProvider implements CrmProvider {
  readonly name = "salesforce";
  /** Salesforce's standard opportunity stage API names */
  readonly stageMap: Record<CrmStageKey, string> = {
    qualified: "Qualification",
    meeting: "Needs Analysis",
    proposal: "Proposal/Price Quote",
    negotiation: "Negotiation/Review",
    won: "Closed Won",
    lost: "Closed Lost",
  };
  /** Salesforce has a single opportunity stage list (sales processes aside) */
  readonly pipelineId = "default";

  private readonly myDomainUrl: string;
  private readonly cacheKey: string;

  constructor(
    private readonly creds: SalesforceCredentials,
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.myDomainUrl = normalizeMyDomainUrl(creds.myDomainUrl);
    this.cacheKey = createHash("sha256").update(`${this.myDomainUrl}|${creds.clientId}|${creds.clientSecret}`).digest("hex");
  }

  /* ---------------- auth ---------------- */

  private async token(force = false): Promise<Token> {
    const cached = tokenCache.get(this.cacheKey);
    if (!force && cached && cached.expiresAt > Date.now()) return cached;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.myDomainUrl}/services/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new CrmError(`Salesforce could not be reached: ${redactString((err as Error).message)}`, null, true);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { error?: string; error_description?: string };
        detail = j.error_description ?? j.error ?? "";
      } catch {
        /* non-JSON body */
      }
      // Salesforce answers a bad key/secret or a disabled flow with 400; treat any client error as "refused"
      const status = res.status >= 400 && res.status < 500 ? 401 : res.status;
      throw new CrmError(
        redactString(`Salesforce refused the login${detail ? `: ${detail}` : ""}`).slice(0, 500),
        status,
        res.status >= 500,
      );
    }
    const body = (await res.json()) as { access_token?: string; instance_url?: string };
    if (!body.access_token || !body.instance_url || !isSalesforceHost(body.instance_url)) {
      throw new CrmError("Salesforce returned an unexpected login response", null, false);
    }
    const token = { accessToken: body.access_token, instanceUrl: body.instance_url.replace(/\/$/, ""), expiresAt: Date.now() + TOKEN_TTL_MS };
    tokenCache.set(this.cacheKey, token);
    return token;
  }

  /** One REST call with bounded, jittered retries; renews the token once on 401. 404 is returned, not thrown. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<Resp<T>> {
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      const tok = await this.token();
      let res: Response;
      try {
        res = await this.fetchImpl(`${tok.instanceUrl}/services/data/${SALESFORCE_API_VERSION}${path}`, {
          method,
          headers: { authorization: `Bearer ${tok.accessToken}`, "content-type": "application/json", accept: "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(400 * 2 ** attempt + Math.random() * 200);
          continue;
        }
        throw new CrmError(`Salesforce could not be reached: ${redactString((err as Error).message)}`, null, true);
      }
      if (res.status === 401 && !renewed) {
        renewed = true;
        tokenCache.delete(this.cacheKey);
        attempt--;
        continue;
      }
      if (res.status === 404) return { status: 404, data: null };
      if (res.ok) {
        const text = await res.text();
        return { status: res.status, data: (text ? JSON.parse(text) : null) as T | null };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS) {
        await this.sleep(400 * 2 ** attempt + Math.random() * 200);
        continue;
      }
      throw new CrmError(await describeError(res), res.status, retryable);
    }
  }

  private async query<T>(q: string): Promise<T[]> {
    const res = await this.request<{ records: T[] }>("GET", `/query?q=${encodeURIComponent(q)}`);
    return res.data?.records ?? [];
  }

  private async create(type: CrmObjectType, fields: Record<string, unknown>) {
    const res = await this.request<{ id?: string }>("POST", `/sobjects/${OBJECT[type]}`, fields);
    if (!res.data?.id) throw new CrmError(`Salesforce did not return an id for the new ${OBJECT[type]}`, null, false);
    return res.data.id;
  }

  private async update(type: CrmObjectType, id: string, fields: Record<string, unknown>) {
    const res = SF_ID.test(id) ? await this.request("PATCH", `/sobjects/${OBJECT[type]}/${id}`, fields) : { status: 404 };
    if (res.status === 404) throw new CrmError(`The ${OBJECT[type]} no longer exists in Salesforce`, 404, false);
  }

  /* ---------------- CrmProvider ---------------- */

  async describeAccount() {
    const [org] = await this.query<{ Id: string; Name: string; OrganizationType?: string; IsSandbox?: boolean }>(
      "SELECT Id, Name, OrganizationType, IsSandbox FROM Organization LIMIT 1",
    );
    if (!org) throw new CrmError("Salesforce did not say which org this app belongs to", null, false);
    const kind = [org.OrganizationType, org.IsSandbox ? "sandbox" : null].filter(Boolean).join(", ");
    return { id: org.Id, label: `Salesforce · ${org.Name}${kind ? ` (${kind})` : ""}` };
  }

  async findCompanyByDomain(domain: string) {
    const d = domain.trim().toLowerCase().replace(/^www\./, "");
    if (!d) return null;
    // Website is free text in Salesforce: match the bare domain and the usual URL spellings of it
    const like = (f: string) => soql(f, true).slice(1, -1);
    const where = [d, `www.${d}`].flatMap((f) => [
      `Website = ${soql(f)}`,
      `Website LIKE '%://${like(f)}'`,
      `Website LIKE '%://${like(f)}/%'`,
      `Website LIKE '${like(f)}/%'`,
    ]);
    const [hit] = await this.query<{ Id: string }>(`SELECT Id FROM Account WHERE ${where.join(" OR ")} ORDER BY CreatedDate ASC LIMIT 1`);
    return hit?.Id ?? null;
  }

  async findContactByEmail(email: string) {
    const [hit] = await this.query<{ Id: string }>(
      `SELECT Id FROM Contact WHERE Email = ${soql(email.trim())} ORDER BY CreatedDate ASC LIMIT 1`,
    );
    return hit?.Id ?? null;
  }

  createCompany(c: CrmCompanyInput) {
    return this.create("company", companyFields(c));
  }

  updateCompany(id: string, c: CrmCompanyInput) {
    return this.update("company", id, companyFields(c));
  }

  createContact(c: CrmContactInput) {
    return this.create("contact", contactFields(c));
  }

  updateContact(id: string, c: CrmContactInput) {
    return this.update("contact", id, contactFields(c));
  }

  async createDeal(d: CrmDealInput) {
    const closeDate = new Date(Date.now() + DEFAULT_CLOSE_DAYS * 86_400_000).toISOString().slice(0, 10);
    return this.create("deal", { ...(await this.dealFields(d)), CloseDate: closeDate });
  }

  async updateDeal(id: string, d: CrmDealInput) {
    return this.update("deal", id, await this.dealFields(d));
  }

  private async dealFields(d: CrmDealInput) {
    const { multi } = await this.currencyInfo();
    return compact({
      Name: d.name,
      StageName: d.stageId,
      Amount: d.amount,
      // Only multi-currency orgs have this field; single-currency orgs reject it
      CurrencyIsoCode: multi ? d.currency : null,
    });
  }

  async associate(from: CrmObjectType, fromId: string, to: CrmObjectType, toId: string) {
    if (from === "contact" && to === "company") return this.update("contact", fromId, { AccountId: toId });
    if (from === "deal" && to === "company") return this.update("deal", fromId, { AccountId: toId });
    if (from === "deal" && to === "contact") {
      // Idempotent: a contact role is only added once per opportunity
      const existing = await this.query<{ Id: string }>(
        `SELECT Id FROM OpportunityContactRole WHERE OpportunityId = ${soql(fromId)} AND ContactId = ${soql(toId)} LIMIT 1`,
      );
      if (!existing.length) await this.request("POST", "/sobjects/OpportunityContactRole", { OpportunityId: fromId, ContactId: toId });
      return;
    }
    throw new CrmError(`Salesforce can't link a ${from} to a ${to}`, null, false);
  }

  async exists(type: CrmObjectType, id: string) {
    if (!SF_ID.test(id)) return false;
    return (await this.request("GET", `/sobjects/${OBJECT[type]}/${id}?fields=Id`)).status !== 404;
  }

  async getDeal(id: string): Promise<CrmDeal | null> {
    if (!SF_ID.test(id)) return null;
    const { multi, primary } = await this.currencyInfo();
    const fields = ["StageName", "Amount", "LastModifiedDate", ...(multi ? ["CurrencyIsoCode"] : [])].join(",");
    const res = await this.request<{ Id: string; StageName?: string; Amount?: number | null; CurrencyIsoCode?: string; LastModifiedDate?: string }>(
      "GET",
      `/sobjects/Opportunity/${id}?fields=${fields}`,
    );
    if (!res.data) return null;
    const amount = res.data.Amount;
    return {
      id: res.data.Id ?? id,
      stageId: res.data.StageName ?? null,
      amount: amount != null && Number.isFinite(amount) ? Math.round(amount) : null,
      currency: res.data.CurrencyIsoCode ?? primary,
      updatedAt: res.data.LastModifiedDate ?? null,
    };
  }

  async listDealStages(): Promise<CrmDealStage[]> {
    const rows = await this.query<{ ApiName: string; MasterLabel: string; IsClosed: boolean }>(
      "SELECT ApiName, MasterLabel, IsClosed FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder",
    );
    return rows.map((r) => ({ id: r.ApiName, label: r.MasterLabel, pipelineId: this.pipelineId, isClosed: Boolean(r.IsClosed) }));
  }

  private currencyCache: { primary: string; all: string[]; multi: boolean } | null = null;

  private async currencyInfo() {
    if (this.currencyCache) return this.currencyCache;
    try {
      const rows = await this.query<{ IsoCode: string; IsCorporate: boolean }>(
        "SELECT IsoCode, IsCorporate FROM CurrencyType WHERE IsActive = true",
      );
      if (rows.length) {
        const primary = rows.find((r) => r.IsCorporate)?.IsoCode ?? rows[0]!.IsoCode;
        this.currencyCache = { primary, all: [primary, ...rows.map((r) => r.IsoCode).filter((c) => c !== primary)], multi: true };
        return this.currencyCache;
      }
    } catch (err) {
      // CurrencyType only exists in multi-currency orgs; anything other than "no such object" is a real failure
      if (!(err instanceof CrmError) || err.status !== 400) throw err;
    }
    const [org] = await this.query<{ DefaultCurrencyIsoCode?: string }>("SELECT DefaultCurrencyIsoCode FROM Organization LIMIT 1");
    const primary = org?.DefaultCurrencyIsoCode ?? "USD";
    this.currencyCache = { primary, all: [primary], multi: false };
    return this.currencyCache;
  }

  async currencies() {
    const { primary, all } = await this.currencyInfo();
    return { primary, all };
  }

  recordUrl(type: CrmObjectType, id: string) {
    return `${this.myDomainUrl}/lightning/r/${OBJECT[type]}/${id}/view`;
  }
}

/** Only send fields we know; empty values are omitted so we never blank out data owned in the CRM. */
function compact(fields: Record<string, string | number | null | undefined>) {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== "") out[k] = v;
  return out;
}

function companyFields(c: CrmCompanyInput) {
  return compact({ Name: c.name, Website: c.domain, BillingCountry: countryName(c.country) });
}

/** Salesforce requires LastName; a single-word name goes there rather than being dropped. */
function contactFields(c: CrmContactInput) {
  const last = c.lastName.trim() || c.firstName.trim() || "Unknown";
  const first = c.lastName.trim() ? c.firstName : null;
  return compact({ FirstName: first, LastName: last, Email: c.email, Phone: c.phone, Title: c.jobTitle });
}

/** Readable, secret-free error text from a Salesforce error response. */
async function describeError(res: Response) {
  let code = "";
  let detail = "";
  try {
    const j = (await res.json()) as Array<{ message?: string; errorCode?: string }> | { message?: string; errorCode?: string };
    const first = Array.isArray(j) ? j[0] : j;
    code = first?.errorCode ?? "";
    detail = first?.message ?? "";
  } catch {
    /* non-JSON body */
  }
  const prefix =
    res.status === 401
      ? "Salesforce rejected the session"
      : code === "REQUEST_LIMIT_EXCEEDED"
        ? "Salesforce API request limit reached"
        : res.status === 403
          ? "The Salesforce integration user lacks permission"
          : `Salesforce error ${res.status}`;
  return redactString(detail ? `${prefix}: ${detail}` : prefix).slice(0, 500);
}

/** The stored credential is JSON; anything else is unreadable. */
export function parseSalesforceCredential(stored: string): SalesforceCredentials {
  try {
    const j = JSON.parse(stored) as Partial<SalesforceCredentials>;
    if (j.myDomainUrl && j.clientId && j.clientSecret) return { myDomainUrl: j.myDomainUrl, clientId: j.clientId, clientSecret: j.clientSecret };
  } catch {
    /* fall through */
  }
  throw new CrmError("The stored Salesforce credentials are unreadable; reconnect Salesforce", null, false);
}
