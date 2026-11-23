import { describe, expect, it } from "vitest";
import { contactFromEnrichments, contactsFromPeople, normalizeWebsetItems } from "./exa.js";

const fields = new Map([
  ["en_name", "name"],
  ["en_title", "title"],
  ["en_email", "email"],
  ["en_phone", "phone"],
  ["en_li", "linkedinUrl"],
] as const);

const done = (enrichmentId: string, value: string, url = "https://acme.com/team") => ({
  enrichmentId,
  status: "completed",
  result: [value],
  references: [{ url }],
});

describe("contactFromEnrichments", () => {
  it("maps completed enrichment results to contact fields with their sources", () => {
    expect(
      contactFromEnrichments(
        [
          done("en_name", "Jane Doe"),
          done("en_title", "CTO"),
          done("en_email", "Jane.Doe@Acme.com"),
          done("en_phone", "+44 20 7946 0000", "https://acme.com/contact"),
          done("en_li", "https://www.linkedin.com/in/janedoe"),
        ],
        new Map(fields),
      ),
    ).toEqual({
      name: "Jane Doe",
      title: "CTO",
      email: "jane.doe@acme.com",
      phone: "+44 20 7946 0000",
      linkedinUrl: "https://www.linkedin.com/in/janedoe",
      sourceUrls: ["https://acme.com/team", "https://acme.com/contact"],
    });
  });

  it("drops pending, placeholder and malformed values, and returns null when nothing is usable", () => {
    expect(
      contactFromEnrichments(
        [
          { enrichmentId: "en_name", status: "pending", result: ["Jane"] },
          done("en_email", "not an email"),
          done("en_li", "https://example.com/jane"),
          done("en_phone", "N/A"),
          done("en_unknown", "x"),
        ],
        new Map(fields),
      ),
    ).toBeNull();
    expect(contactFromEnrichments(null, new Map(fields))).toBeNull();
  });
});

describe("normalizeWebsetItems contacts", () => {
  it("attaches the found contact to the lead", () => {
    const [item] = normalizeWebsetItems(
      [
        {
          properties: { type: "company", url: "https://acme.com", company: { name: "Acme" } },
          evaluations: [],
          enrichments: [done("en_email", "info@acme.com")],
        },
      ],
      "ws_1",
      new Map(fields),
    );
    expect(item?.contact?.email).toBe("info@acme.com");
  });
});

describe("contactsFromPeople", () => {
  const person = (name: string, url: string, jobs: Array<[string, string, string | null]>) => ({
    url,
    title: name,
    entities: [
      {
        type: "person",
        properties: { name, workHistory: jobs.map(([title, company, to]) => ({ title, company: { name: company }, dates: { to } })) },
      },
    ],
  });

  it("keeps only people currently at the company, senior roles first", () => {
    const out = contactsFromPeople(
      [
        person("Ann Analyst", "https://linkedin.com/in/ann", [["Data Analyst", "Ocado Group", null]]),
        person("Paul Former", "https://linkedin.com/in/paul", [["CTO", "Ocado Group plc", "2023-01-01"], ["Advisor", "Other", null]]),
        person("Cara Cio", "https://uk.linkedin.com/in/cara", [["Chief Information Officer", "Ocado Group plc", null]]),
        person("Elsewhere", "https://linkedin.com/in/x", [["CTO", "Tesco", null]]),
      ],
      "Ocado Group",
    );
    expect(out.map((c) => [c.name, c.title, c.linkedinUrl])).toEqual([
      ["Cara Cio", "Chief Information Officer", "https://uk.linkedin.com/in/cara"],
      ["Ann Analyst", "Data Analyst", "https://linkedin.com/in/ann"],
    ]);
  });
});
