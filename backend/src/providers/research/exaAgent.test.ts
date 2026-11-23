import { describe, expect, it } from "vitest";
import { CONTACTS_AGENT, contactsAgentRequest, contactsFromAgentOutput } from "./exaAgent.js";

describe("Exa Agent contact search", () => {
  it("asks for decision makers at the exact company, with sources, an email field and a cost cap", () => {
    const req = contactsAgentRequest({ name: "University of Birmingham", domain: "birmingham.ac.uk" });
    expect(req.query).toContain("University of Birmingham (birmingham.ac.uk)");
    expect(req.effort).toBe("medium");
    expect(req.budget.maxCostDollars).toBe(CONTACTS_AGENT.maxCostDollars);
    const people = req.outputSchema.properties.people;
    expect(people.maxItems).toBe(CONTACTS_AGENT.maxPeople);
    const props = people.items.properties as Record<string, { format?: string }>;
    expect(props.email?.format).toBe("email");
    // Phones cost extra and are off
    expect(props.phone).toBeUndefined();
    expect(people.items.required).toContain("evidence_urls");
  });

  it("keeps sourced people, lowercases emails and flags general inboxes", () => {
    const contacts = contactsFromAgentOutput({
      people: [
        {
          full_name: "Jane Smith",
          title: "Chief Information Officer",
          email: "J.Smith@Bham.ac.uk",
          linkedin_url: "https://www.linkedin.com/in/janesmith",
          evidence_urls: ["https://www.birmingham.ac.uk/staff/jane-smith"],
        },
        { full_name: "Info Person", title: "Office", email: "info@bham.ac.uk", evidence_urls: ["https://bham.ac.uk/contact"] },
      ],
    });
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      name: "Jane Smith",
      email: "j.smith@bham.ac.uk",
      emailIsGeneral: false,
      linkedinUrl: expect.stringContaining("linkedin.com/in/janesmith"),
    });
    expect(contacts[0]!.sourceUrls.length).toBeGreaterThan(0);
    expect(contacts[1]!.emailIsGeneral).toBe(true);
  });

  it("drops people without a name or any source page, bad emails, and duplicates", () => {
    const contacts = contactsFromAgentOutput({
      people: [
        { full_name: "", title: "CTO", evidence_urls: ["https://example.com/a"] },
        { full_name: "No Source", title: "CTO", evidence_urls: [] },
        { full_name: "Bad Email", title: "CIO", email: "not-an-email", evidence_urls: ["https://example.com/b"] },
        { full_name: "bad email", title: "CIO", evidence_urls: ["https://example.com/c"] },
      ],
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ name: "Bad Email", email: null });
  });

  it("keeps a valid buying role and ignores an unrecognised one", () => {
    const contacts = contactsFromAgentOutput({
      people: [
        { full_name: "Ann Lee", title: "CIO", buying_role: "decision_maker", evidence_urls: ["https://example.com/a"] },
        { full_name: "Bo Ray", title: "Architect", buying_role: "Technical_Evaluator", evidence_urls: ["https://example.com/b"] },
      ],
    });
    expect(contacts.map((c) => c.buyingRole)).toEqual(["decision_maker", "technical_evaluator"]);
    const odd = contactsFromAgentOutput({
      people: [{ full_name: "Cy Dee", title: "Analyst", buying_role: "chief_vibes", evidence_urls: ["https://example.com/c"] }],
    });
    expect(odd[0]?.buyingRole).toBeUndefined();
  });

  it("keeps at most 2 people per search", () => {
    expect(CONTACTS_AGENT.maxPeople).toBe(2);
    const contacts = contactsFromAgentOutput({
      people: ["Ann Lee", "Bo Ray", "Cy Dee"].map((n, i) => ({
        full_name: n,
        title: "CIO",
        evidence_urls: [`https://example.com/${i}`],
      })),
    });
    expect(contacts.map((c) => c.name)).toEqual(["Ann Lee", "Bo Ray"]);
  });

  it("asks Exa for a buying role limited to the allowed values", () => {
    const req = contactsAgentRequest({ name: "Datum", domain: "datum.co.uk" });
    const role = (req.outputSchema.properties.people.items.properties as Record<string, { enum?: string[] }>).buying_role;
    expect(role?.enum).toContain("decision_maker");
    expect(role?.enum).toContain("unknown");
  });

  it("returns nothing for missing or malformed output", () => {
    expect(contactsFromAgentOutput(null)).toEqual([]);
    expect(contactsFromAgentOutput({ people: "x" })).toEqual([]);
  });
});
