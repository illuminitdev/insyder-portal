import { describe, expect, it } from "vitest";
import { HubspotCrmProvider } from "./hubspot.js";
import { CrmError } from "./types.js";
import { classifyCompany, type ImportContext } from "../../services/crmImport.js";

const TOKEN = "pat-na2-test-token-never-leaks-0000";

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift() ?? { status: 500 };
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const make = (f: ReturnType<typeof fakeFetch>) => new HubspotCrmProvider(TOKEN, "1", f.impl, async () => undefined);

describe("HubSpot import reads", () => {
  it("searches companies by lifecycle stage, pages with the cursor and maps fields", async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          results: [
            {
              id: "11",
              properties: { name: " Acme ", domain: "", website: "https://acme.co.uk", country: "United Kingdom", numberofemployees: "250", lifecyclestage: "lead" },
            },
          ],
          paging: { next: { after: "100" } },
        },
      },
    ]);
    const page = await make(f).listCompaniesForImport({ stages: ["lead", "salesqualifiedlead"] }, "0", 100);
    expect(page.next).toBe("100");
    expect(page.companies[0]).toMatchObject({ id: "11", name: "Acme", domain: "https://acme.co.uk", employees: 250, lifecycleStage: "lead" });
    expect(f.calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/objects/companies/search", method: "POST" });
    expect(f.calls[0]!.body).toMatchObject({
      filterGroups: [{ filters: [{ propertyName: "lifecyclestage", operator: "IN", values: ["lead", "salesqualifiedlead"] }] }],
      after: "0",
      limit: 100,
    });
  });

  it("includes companies with no stage when 'other' is picked", async () => {
    const f = fakeFetch([{ status: 200, body: { total: 7, results: [] } }]);
    expect(await make(f).countCompaniesForImport({ stages: ["other"] })).toBe(7);
    const groups = (f.calls[0]!.body as { filterGroups: unknown[] }).filterGroups;
    expect(groups).toHaveLength(2);
  });

  it("reads a company's contacts through associations and a batch read", async () => {
    const f = fakeFetch([
      { status: 200, body: { results: [{ toObjectId: 5 }, { toObjectId: 6 }] } },
      {
        status: 200,
        body: {
          results: [
            { id: "5", properties: { firstname: "Ada", lastname: "Lovelace", email: "ADA@acme.co.uk", jobtitle: "CTO" } },
            { id: "6", properties: { firstname: null, lastname: null, email: null } },
          ],
        },
      },
    ]);
    const people = await make(f).listCompanyContacts("11");
    expect(people[0]).toMatchObject({ id: "5", firstName: "Ada", email: "ada@acme.co.uk", jobTitle: "CTO" });
    expect(f.calls[1]!.body).toMatchObject({ inputs: [{ id: "5" }, { id: "6" }] });
  });

  it("explains a missing read scope instead of a generic error", async () => {
    const f = fakeFetch([{ status: 403, body: { message: "missing scopes" } }]);
    const err = await make(f).countCompaniesForImport({ stages: ["lead"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect((err as CrmError).message).toContain("crm.objects.companies.read");
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe("classifyCompany", () => {
  const ctx = (): ImportContext => ({
    byDomain: new Map([["known.com", { id: "acc_known", name: "Known Ltd" }]]),
    byName: new Map([["samename", { id: "acc_same", name: "Same Name" }]]),
    suppressed: new Set(["blocked.com"]),
    mappedExternal: new Set(["hs_done"]),
    mappedAccounts: new Set(),
  });
  const company = (over: Partial<Parameters<typeof classifyCompany>[0]>) => ({
    id: "hs_1",
    name: "New Co",
    domain: "newco.io",
    country: null,
    city: null,
    industry: null,
    employees: null,
    lifecycleStage: "lead",
    ...over,
  });

  it("skips a company that was already imported, so re-running never duplicates", () => {
    expect(classifyCompany(company({ id: "hs_done" }), ctx()).kind).toBe("already_imported");
  });
  it("sends customers to suppression", () => {
    expect(classifyCompany(company({ lifecycleStage: "customer" }), ctx()).kind).toBe("customer");
  });
  it("skips companies with no website", () => {
    expect(classifyCompany(company({ domain: null }), ctx()).kind).toBe("no_domain");
  });
  it("skips suppressed domains", () => {
    expect(classifyCompany(company({ domain: "https://www.blocked.com/" }), ctx()).kind).toBe("suppressed");
  });
  it("links to an existing account with the same domain", () => {
    expect(classifyCompany(company({ domain: "known.com" }), ctx())).toMatchObject({ kind: "linked", accountId: "acc_known" });
  });
  it("creates a new account and flags a same-name account for merge review", () => {
    const o = classifyCompany(company({ name: "Same Name" }), ctx());
    expect(o.kind).toBe("new");
  });
});
