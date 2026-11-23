import { describe, expect, it } from "vitest";
import { profileAgentRequest, profileFromAgentOutput } from "./exaProfileAgent.js";

describe("profileAgentRequest", () => {
  it("names the website and lists the built-in signal keys", () => {
    const req = profileAgentRequest("https://acme.example");
    expect(req.query).toContain("https://acme.example");
    expect(req.query).toContain("- infra_hiring:");
    expect(req.effort).toBe("medium");
    // Exa rejects a spending cap under $1
    expect(req.budget.maxCostDollars).toBeGreaterThanOrEqual(1);
  });
});

describe("profileFromAgentOutput", () => {
  it("keeps valid parts and drops anything malformed or made up", () => {
    const p = profileFromAgentOutput({
      companyName: "Acme Talent",
      summary: "IT recruitment for UK scale-ups.",
      offering: "Specialist technology recruitment",
      products: [
        { name: "Contract hiring", description: "Interim engineers", bestFor: "Fast projects", proofPoints: "" },
        { name: "contract hiring", description: "duplicate" },
        { name: "", description: "no name" },
      ],
      industries: ["Fintech", "fintech", "Healthcare"],
      buyerRoles: ["Head of Talent"],
      countries: ["United Kingdom", "Narnia", "Ireland"],
      companySizes: ["50-500"],
      differentiators: ["20 years in tech hiring"],
      customers: ["Monzo"],
      signals: [
        { key: "infra_hiring", why: "They hire for IT roles" },
        { key: "made_up_signal", why: "x" },
        { key: "infra_hiring", why: "dup" },
      ],
      customSignals: [{ label: "New engineering hub", description: "Opens a tech office", why: "Needs staff" }],
      discoveryQuestion: "Which roles are hard to fill?",
      sources: [{ url: "https://acme.example/about", title: "About" }, { url: "javascript:alert(1)", title: "bad" }],
    });
    expect(p).not.toBeNull();
    expect(p!.products.map((x) => x.name)).toEqual(["Contract hiring"]);
    expect(p!.products[0]).not.toHaveProperty("proofPoints");
    expect(p!.industries).toEqual(["Fintech", "Healthcare"]);
    expect(p!.countries).toEqual(["GB", "IE"]);
    expect(p!.signals.map((s) => s.key)).toEqual(["infra_hiring"]);
    expect(p!.customSignals).toHaveLength(1);
    expect(p!.sources).toHaveLength(1);
  });

  it("returns null when nothing about what they sell was found", () => {
    expect(profileFromAgentOutput({ companyName: "X", industries: ["Retail"] })).toBeNull();
    expect(profileFromAgentOutput(null)).toBeNull();
  });
});
