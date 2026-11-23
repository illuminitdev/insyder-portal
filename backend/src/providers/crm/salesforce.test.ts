import { describe, expect, it } from "vitest";
import { normalizeMyDomainUrl, parseSalesforceCredential, SALESFORCE_API_VERSION, SalesforceCrmProvider } from "./salesforce.js";
import { CrmError } from "./types.js";

const SECRET = "sf-consumer-secret-never-leaks-0000";
const INSTANCE = "https://acme.my.salesforce.com";
const API = `${INSTANCE}/services/data/${SALESFORCE_API_VERSION}`;
const TOKEN_OK = { status: 200, body: { access_token: "tok-1", instance_url: INSTANCE } };

/** Scripted fetch: returns queued responses in order and records each request. */
function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body: string | undefined; auth: string | null }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : undefined, auth: headers.get("authorization") });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// A unique client id per provider keeps the module token cache from leaking between tests
let n = 0;
const make = (f: ReturnType<typeof fakeFetch>) =>
  new SalesforceCrmProvider({ myDomainUrl: "acme.my.salesforce.com", clientId: `client-${++n}`, clientSecret: SECRET }, f.impl, async () => undefined);

describe("normalizeMyDomainUrl", () => {
  it("accepts My Domain and Lightning URLs, including sandboxes", () => {
    expect(normalizeMyDomainUrl("acme.my.salesforce.com")).toBe("https://acme.my.salesforce.com");
    expect(normalizeMyDomainUrl("https://acme.lightning.force.com/lightning/page/home")).toBe("https://acme.my.salesforce.com");
    expect(normalizeMyDomainUrl("https://acme--uat.sandbox.lightning.force.com")).toBe("https://acme--uat.sandbox.my.salesforce.com");
  });

  it("refuses non-Salesforce hosts so the secret is never sent elsewhere", () => {
    expect(() => normalizeMyDomainUrl("https://evil.example.com")).toThrow(CrmError);
    expect(() => normalizeMyDomainUrl("https://acme.my.salesforce.com.evil.com")).toThrow(CrmError);
  });
});

describe("SalesforceCrmProvider", () => {
  it("logs in with client credentials, then calls the instance with the bearer token", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 200, body: { records: [{ Id: "00D000000000001", Name: "Acme Ltd", OrganizationType: "Enterprise Edition", IsSandbox: false }] } }]);
    const acct = await make(f).describeAccount();
    expect(acct).toEqual({ id: "00D000000000001", label: "Salesforce · Acme Ltd (Enterprise Edition)" });
    expect(f.calls[0]!.url).toBe("https://acme.my.salesforce.com/services/oauth2/token");
    expect(f.calls[0]!.body).toContain("grant_type=client_credentials");
    expect(f.calls[1]!.url.startsWith(`${API}/query?q=`)).toBe(true);
    expect(f.calls[1]!.auth).toBe("Bearer tok-1");
  });

  it("reports a refused login as a 401 CrmError without leaking the secret", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "invalid_client", error_description: "invalid client credentials" } }]);
    const err = await make(f).describeAccount().catch((e) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(SECRET);
  });

  it("renews an expired session once and retries the call", async () => {
    const f = fakeFetch([
      TOKEN_OK,
      { status: 401, body: [{ errorCode: "INVALID_SESSION_ID", message: "Session expired" }] },
      { status: 200, body: { access_token: "tok-2", instance_url: INSTANCE } },
      { status: 200, body: { records: [{ Id: "0015g00000ABCDE" }] } },
    ]);
    expect(await make(f).findCompanyByDomain("acme.co.uk")).toBe("0015g00000ABCDE");
    expect(f.calls[3]!.auth).toBe("Bearer tok-2");
  });

  it("matches a company by website and escapes quotes in SOQL", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 200, body: { records: [] } }]);
    await make(f).findCompanyByDomain("o'brien.ie");
    const q = decodeURIComponent(f.calls[1]!.url.split("q=")[1]!);
    expect(q).toContain("Website = 'o\\'brien.ie'");
    expect(q).toContain("Website LIKE '%://www.o\\'brien.ie/%'");
  });

  it("creates an Account with the country name and only non-empty fields", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 201, body: { id: "0015g00000ABCDE", success: true } }]);
    expect(await make(f).createCompany({ name: "Acme", domain: "acme.co.uk", country: "GB" })).toBe("0015g00000ABCDE");
    expect(f.calls[1]).toMatchObject({ url: `${API}/sobjects/Account`, method: "POST" });
    expect(JSON.parse(f.calls[1]!.body!)).toEqual({ Name: "Acme", Website: "acme.co.uk", BillingCountry: "United Kingdom" });
  });

  it("puts a single-word contact name in the required LastName", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 201, body: { id: "0035g00000ABCDE" } }]);
    await make(f).createContact({ firstName: "Prince", lastName: "", email: null, phone: null, jobTitle: "CTO" });
    expect(JSON.parse(f.calls[1]!.body!)).toEqual({ LastName: "Prince", Title: "CTO" });
  });

  it("creates an Opportunity with a close date and no currency field in a single-currency org", async () => {
    const f = fakeFetch([
      TOKEN_OK,
      { status: 400, body: [{ errorCode: "INVALID_TYPE", message: "sObject type 'CurrencyType' is not supported." }] },
      { status: 200, body: { records: [{ DefaultCurrencyIsoCode: "GBP" }] } },
      { status: 201, body: { id: "0065g00000ABCDE" } },
    ]);
    await make(f).createDeal({ name: "Acme deal", stageId: "Qualification", pipelineId: "default", amount: 300000, currency: "GBP" });
    const body = JSON.parse(f.calls[3]!.body!);
    expect(body).toMatchObject({ Name: "Acme deal", StageName: "Qualification", Amount: 300000 });
    expect(body.CurrencyIsoCode).toBeUndefined();
    expect(body.CloseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists currencies from a multi-currency org with the corporate one first", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 200, body: { records: [{ IsoCode: "EUR", IsCorporate: false }, { IsoCode: "USD", IsCorporate: true }] } }]);
    expect(await make(f).currencies()).toEqual({ primary: "USD", all: ["USD", "EUR"] });
  });

  it("adds an opportunity contact role only once", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 200, body: { records: [{ Id: "00K000000000001" }] } }]);
    await make(f).associate("deal", "0065g00000ABCDE", "contact", "0035g00000ABCDE");
    expect(f.calls.filter((c) => c.method === "POST" && c.url.includes("OpportunityContactRole"))).toHaveLength(0);
  });

  it("treats a foreign (e.g. HubSpot) id as not existing, without calling Salesforce", async () => {
    const f = fakeFetch([]);
    expect(await make(f).exists("deal", "12345")).toBe(false);
    expect(f.calls).toHaveLength(0);
  });

  it("maps stages to Salesforce's standard stage names and lists active stages", async () => {
    const f = fakeFetch([TOKEN_OK, { status: 200, body: { records: [{ ApiName: "Closed Won", MasterLabel: "Closed Won", IsClosed: true }] } }]);
    const p = make(f);
    expect(p.stageMap.won).toBe("Closed Won");
    expect(await p.listDealStages()).toEqual([{ id: "Closed Won", label: "Closed Won", pipelineId: "default", isClosed: true }]);
  });

  it("links records into Lightning", () => {
    expect(make(fakeFetch([])).recordUrl("company", "0015g00000ABCDE")).toBe("https://acme.my.salesforce.com/lightning/r/Account/0015g00000ABCDE/view");
  });

  it("parses stored credentials and rejects anything else", () => {
    expect(parseSalesforceCredential(JSON.stringify({ myDomainUrl: "a", clientId: "b", clientSecret: "c" }))).toEqual({ myDomainUrl: "a", clientId: "b", clientSecret: "c" });
    expect(() => parseSalesforceCredential("pat-hubspot-token")).toThrow(CrmError);
  });
});
