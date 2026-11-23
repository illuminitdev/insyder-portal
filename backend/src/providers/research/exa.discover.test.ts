import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  search: [] as Array<{ query: string; opts: Record<string, unknown> }>,
  contents: [] as Array<{ urls: string[]; opts: Record<string, unknown> }>,
  similar: [] as Array<{ url: string; opts: Record<string, unknown> }>,
  contentsResponse: null as unknown,
  contentsError: null as unknown,
  similarResponse: null as unknown,
  answers: [] as Array<{ q: string; opts: Record<string, unknown> }>,
  websetCreates: [] as unknown[],
  websetSearches: [] as Array<{ id: string; params: Record<string, unknown> }>,
  websetEnrichments: [] as Array<{ id: string; metadata: Record<string, string> }>,
  enrichmentCreates: [] as Array<{ id: string; params: Record<string, unknown> }>,
  websetItems: [] as unknown[],
  idleError: null as unknown,
}));

vi.mock("../../config/env.js", () => ({
  isExaConfigured: () => true,
  getEnv: () => ({ EXA_API_KEY: "test-key" }),
}));

vi.mock("exa-js", () => ({
  WebsetSearchBehavior: { append: "append", override: "override" },
  Exa: class {
    async searchAndContents(query: string, opts: Record<string, unknown>) {
      calls.search.push({ query, opts });
      const n = opts.numResults as number;
      return {
        requestId: `req-${calls.search.length}`,
        results: Array.from({ length: n }, (_, i) => ({
          url: `https://news${calls.search.length}.example.org/a${i}`,
          title: `Story ${calls.search.length}-${i}`,
          publishedDate: new Date().toISOString(),
          highlights: [`highlight ${i}`],
        })),
      };
    }
    async getContents(urls: string[], opts: Record<string, unknown>) {
      calls.contents.push({ urls, opts });
      if (calls.contentsError) throw calls.contentsError;
      return calls.contentsResponse;
    }
    async findSimilarAndContents(url: string, opts: Record<string, unknown>) {
      calls.similar.push({ url, opts });
      return calls.similarResponse;
    }
    async answer(q: string, opts: Record<string, unknown>) {
      calls.answers.push({ q, opts });
      return {
        requestId: "ans",
        answer: "Yes. Acme opened a Manchester data centre in September 2026.",
        citations: [
          { url: "https://www.datacenterdynamics.com/acme?utm_source=x", title: "Acme opens DC", publishedDate: "2026-09-10" },
          { url: "ftp://bad", title: "bad" },
        ],
      };
    }
    websets = {
      create: async (params: unknown) => {
        calls.websetCreates.push(params);
        return { id: "ws_1" };
      },
      searches: {
        create: async (id: string, params: Record<string, unknown>) => {
          calls.websetSearches.push({ id, params });
          return { id: "wss_1" };
        },
      },
      waitUntilIdle: async () => {
        if (calls.idleError) throw calls.idleError;
        return { id: "ws_1", status: "idle" };
      },
      items: { getAll: async () => calls.websetItems },
      get: async (id: string) => ({ id, enrichments: calls.websetEnrichments }),
      enrichments: {
        create: async (id: string, params: Record<string, unknown>) => {
          calls.enrichmentCreates.push({ id, params });
          return { id: `en_${calls.enrichmentCreates.length}` };
        },
      },
    };
  },
}));

const { ExaResearchProvider, planSearches, websetCriteria } = await import("./exa.js");

const summary = (o: Record<string, string>) => JSON.stringify(o);

beforeEach(() => {
  calls.search = [];
  calls.contents = [];
  calls.similar = [];
  calls.contentsResponse = { requestId: "site", results: [] };
  calls.contentsError = null;
  calls.similarResponse = { requestId: "sim", results: [] };
  calls.answers = [];
  calls.websetCreates = [];
  calls.websetSearches = [];
  calls.websetEnrichments = [];
  calls.enrichmentCreates = [];
  calls.websetItems = [];
  calls.idleError = null;
});

describe("planSearches", () => {
  it("splits news kinds and hiring/tender kinds into two searches", () => {
    expect(planSearches(undefined, 3)).toEqual([
      { kinds: ["expansion", "refresh", "compute"], category: "news", numResults: 2 },
      { kinds: ["infra_hiring", "procurement"], numResults: 1 },
    ]);
  });

  it("uses one news search when only news kinds are asked for", () => {
    expect(planSearches(["expansion"], 4)).toEqual([{ kinds: ["expansion"], category: "news", numResults: 4 }]);
  });

  it("uses one open search for hiring only, or when the budget is one result", () => {
    expect(planSearches(["infra_hiring"], 3)).toEqual([{ kinds: ["infra_hiring"], numResults: 3 }]);
    expect(planSearches(undefined, 1)).toEqual([
      { kinds: ["expansion", "infra_hiring", "refresh", "compute", "procurement"], numResults: 1 },
    ]);
  });
});

describe("discover", () => {
  it("runs the news search with category news and the open search without it", async () => {
    const out = await new ExaResearchProvider().discover("acme", {}, 3, "discovery");
    expect(calls.search.map((c) => c.opts.category)).toEqual(["news", undefined]);
    expect(calls.search[0]!.query).toContain("expansion");
    expect(calls.search[1]!.query).toContain("hiring");
    expect(out.items).toHaveLength(3);
    expect(out.rawCount).toBe(3);
    expect(out.providerRunId).toBe("req-1,req-2");
  });

  it("account research crawls the company's own pages and keeps only signal pages", async () => {
    calls.contentsResponse = {
      requestId: "site",
      results: [
        {
          url: "https://acme.com",
          subpages: [
            {
              url: "https://acme.com/careers/infra-engineer",
              title: "Infrastructure Engineer",
              summary: summary({ companyName: "Acme", companyWebsite: "acme.com", signalType: "infra_hiring", eventSummary: "Acme is hiring" }),
            },
            {
              url: "https://acme.com/about",
              title: "About us",
              summary: summary({ companyName: "Acme", companyWebsite: "acme.com", signalType: "other", eventSummary: "" }),
            },
          ],
        },
      ],
    };
    const out = await new ExaResearchProvider().discover("Acme acme.com", { companyDomain: "acme.com" }, 3, "account");
    expect(calls.contents[0]!.urls).toEqual(["https://acme.com"]);
    expect(calls.contents[0]!.opts.subpages).toBe(5);
    // One unit goes to the site crawl: 2 search results + 1
    expect(calls.search.reduce((n, c) => n + (c.opts.numResults as number), 0)).toBe(2);
    const sitePages = out.items.filter((i) => i.canonicalUrl.includes("acme.com"));
    expect(sitePages.map((i) => i.canonicalUrl)).toEqual(["https://acme.com/careers/infra-engineer"]);
    expect(sitePages[0]!.qualityHint).toBe(90);
    expect(out.rawCount).toBe(3);
  });

  it("a site that blocks crawling never fails account research", async () => {
    calls.contentsError = Object.assign(new Error("blocked"), { statusCode: 403 });
    const out = await new ExaResearchProvider().discover("Acme", { companyDomain: "acme.com" }, 3, "account");
    expect(out.items).toHaveLength(2);
    expect(out.rawCount).toBe(2);
  });
});

describe("find similar", () => {
  it("keeps company websites only, with no event date", async () => {
    calls.similarResponse = {
      requestId: "sim",
      results: [
        {
          url: "https://www.globex.co.uk/",
          title: "Globex",
          publishedDate: new Date().toISOString(),
          summary: summary({ companyName: "Globex", companyWebsite: "globex.co.uk", eventSummary: "UK logistics firm" }),
        },
        {
          // A profile page on a data site about another company: not that company's domain
          url: "https://unknownsite.io/company/initech",
          title: "Initech profile",
          summary: summary({ companyName: "Initech", companyWebsite: "initech.com", eventSummary: "Initech makes software" }),
        },
        {
          // A page about the seed company itself
          url: "https://www.acme.com/about",
          title: "About Acme",
          summary: summary({ companyName: "Acme", companyWebsite: "acme.com", eventSummary: "Acme" }),
        },
        {
          url: "https://leadiq.com/c/datum",
          title: "Datum on LeadIQ",
          summary: summary({ companyName: "Datum", companyWebsite: "leadiq.com", eventSummary: "" }),
        },
        { url: "https://www.reuters.com/x", title: "News", summary: summary({ companyName: "Reuters", eventSummary: "" }) },
        { url: "https://unknown.example.org/", title: "Directory", summary: summary({ companyName: "", eventSummary: "" }) },
      ],
    };
    const out = await new ExaResearchProvider().discover("https://acme.com", {}, 5, "similar");
    expect(calls.similar[0]!.url).toBe("https://acme.com");
    expect(calls.similar[0]!.opts.excludeSourceDomain).toBe(true);
    expect(calls.search).toHaveLength(0);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      eventDate: null,
      signalKind: "lookalike",
      subject: { companyName: "Globex", companyWebsite: "globex.co.uk" },
    });
  });
});

describe("required phrase (includeText)", () => {
  it("is sent with every search when set, and left out otherwise", async () => {
    await new ExaResearchProvider().discover("acme", { requiredPhrase: " data centre " }, 3, "discovery");
    expect(calls.search.map((c) => c.opts.includeText)).toEqual([["data centre"], ["data centre"]]);
    calls.search = [];
    await new ExaResearchProvider().discover("acme", {}, 3, "discovery");
    expect(calls.search.every((c) => !("includeText" in c.opts))).toBe(true);
  });
});

describe("answer (why now)", () => {
  it("returns the answer with clean, canonical http citations only", async () => {
    const res = await new ExaResearchProvider().answer("Is Acme expanding?", { userLocation: "GB" });
    expect(calls.answers[0]!.opts.userLocation).toBe("GB");
    expect(res.answer).toMatch(/Manchester/);
    expect(res.citations).toEqual([
      { url: "https://datacenterdynamics.com/acme", title: "Acme opens DC", publishedDate: "2026-09-10" },
    ]);
    expect(res.requestRef).toBe("ans");
  });
});

const websetItem = (o: { name: string; url: string; created?: string; satisfied?: string[]; ref?: string; location?: string }) => ({
  id: `it_${o.name}`,
  createdAt: o.created ?? new Date().toISOString(),
  properties: {
    type: "company",
    url: o.url,
    description: `${o.name} is relevant`,
    company: { name: o.name, location: o.location ?? null, about: null },
  },
  evaluations: (o.satisfied ?? ["yes"]).map((s) => ({
    criterion: "signal",
    reasoning: `${o.name} is opening a site`,
    satisfied: s,
    references: o.ref ? [{ url: o.ref, title: "Announcement", snippet: "opens new site" }] : [],
  })),
});

describe("websets (company lists)", () => {
  it("builds criteria from signals, countries and the required phrase", () => {
    const c = websetCriteria({ signalKinds: ["expansion"], countries: ["GB"], eventWindowDays: 90, requiredPhrase: "data centre" });
    expect(c.map((x) => x.description)).toEqual([
      "Company has publicly shown at least one of these in the last 90 days: opening a new site, office, facility or data centre",
      "Company operates in GB",
      `Company's public sources mention "data centre"`,
    ]);
  });

  it("creates a new list, or appends a search to an existing one on refresh", async () => {
    const p = new ExaResearchProvider();
    const a = await p.startWebset("UK logistics firms", { countries: ["GB"] }, 40);
    expect(a.websetId).toBe("ws_1");
    expect(calls.websetCreates[0]).toMatchObject({ search: { count: 25, entity: { type: "company" } } });
    const b = await p.startWebset("UK logistics firms", { websetId: "ws_old" }, 5);
    expect(b.websetId).toBe("ws_old");
    expect(calls.websetSearches[0]).toMatchObject({ id: "ws_old", params: { behavior: "append", count: 5 } });
  });

  it("asks Exa for contact details with every new list, and adds them once to older lists", async () => {
    const p = new ExaResearchProvider();
    await p.startWebset("UK logistics firms", {}, 10);
    const created = calls.websetCreates[0] as { enrichments: Array<{ format: string; metadata: Record<string, string> }> };
    expect(created.enrichments.map((e) => e.metadata.signal_contact)).toEqual(["name", "title", "email", "phone", "linkedinUrl"]);
    expect(created.enrichments.map((e) => e.format)).toEqual(["text", "text", "email", "phone", "url"]);

    calls.websetEnrichments = [{ id: "en_old", metadata: { signal_contact: "email" } }];
    await p.startWebset("UK logistics firms", { websetId: "ws_old" }, 5);
    expect(calls.enrichmentCreates.map((c) => (c.params.metadata as Record<string, string>).signal_contact)).toEqual([
      "name",
      "title",
      "phone",
      "linkedinUrl",
    ]);
  });

  it("returns only new, fully matching companies, citing the third-party reference", async () => {
    const startedAt = new Date().toISOString();
    calls.websetItems = [
      websetItem({ name: "Globex", url: "https://globex.co.uk", ref: "https://www.reuters.com/globex", location: "Leeds, United Kingdom" }),
      websetItem({ name: "Old", url: "https://old.com", created: "2020-01-01T00:00:00Z" }),
      websetItem({ name: "Fails", url: "https://fails.com", satisfied: ["yes", "no"] }),
      websetItem({ name: "Blocked", url: "https://blocked.com" }),
    ];
    const out = await new ExaResearchProvider().collectWebset({ websetId: "ws_1", startedAt }, { excludeDomains: ["blocked.com"] });
    expect(out.providerRunId).toBe("ws_1");
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      canonicalUrl: "https://reuters.com/globex",
      country: "GB",
      eventDate: null,
      signalKind: "webset_match",
      subject: { companyName: "Globex", companyWebsite: "globex.co.uk" },
      qualityHint: 85,
    });
  });

  it("a list still building is a retryable timeout", async () => {
    calls.idleError = new Error("Webset ws_1 did not reach idle state within 1200000ms");
    await expect(
      new ExaResearchProvider().collectWebset({ websetId: "ws_1", startedAt: new Date().toISOString() }, {}),
    ).rejects.toMatchObject({ code: "provider_timeout", retryable: true });
  });
});
