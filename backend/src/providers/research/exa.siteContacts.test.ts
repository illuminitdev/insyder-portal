import { describe, expect, it } from "vitest";
import { applyContactDetails, contactDetailsFromPages, emailMatchesName } from "./exa.js";

const person = (name: string) => ({ name, title: "CTO", email: null, phone: null, linkedinUrl: null, sourceUrls: ["https://linkedin.com/in/x"] });

describe("emailMatchesName", () => {
  it("matches common name-based addresses only", () => {
    for (const e of ["jane.doe@acme.com", "jdoe@acme.com", "j.doe@acme.com", "doe.jane@acme.com", "jane_doe@acme.com"]) {
      expect(emailMatchesName(e, "Jane Doe")).toBe(true);
    }
    expect(emailMatchesName("jane@acme.com", "Jane Doe")).toBe(false);
    expect(emailMatchesName("info@acme.com", "Jane Doe")).toBe(false);
  });
});

describe("contactDetailsFromPages", () => {
  it("reads emails and phones from the company's own pages, contact page first", () => {
    const details = contactDetailsFromPages(
      [
        { url: "https://www.acme.com/", text: "Footer: Tel: 0113 496 0000. Built by hello@webagency.io" },
        {
          url: "https://acme.com/contact-us",
          text: "Write to INFO@acme.com or call us on +44 (0)20 7946 0000. IT: jane.doe@acme.com. Ref 2024-11-10.",
        },
        // Another site's page about the company never counts
        { url: "https://directory.example/acme", text: "Tel: 0800 000 1111 sales@acme.com" },
      ],
      "acme.com",
      ["Jane Doe", "Sam Lee"],
    );
    expect(details.general).toEqual({ email: "info@acme.com", phone: "+44 (0)20 7946 0000", sourceUrl: "https://acme.com/contact-us" });
    expect([...details.people.entries()]).toEqual([["jane doe", { email: "jane.doe@acme.com", phone: null, sourceUrl: "https://acme.com/contact-us" }]]);
  });

  it("finds nothing on pages without contact details", () => {
    expect(contactDetailsFromPages([{ url: "https://acme.com", text: "Founded 2019. 120 staff." }], "acme.com", [])).toEqual({
      general: null,
      people: new Map(),
    });
  });
});

describe("applyContactDetails", () => {
  const details = {
    general: { email: "info@acme.com", phone: "020 7946 0000", sourceUrl: "https://acme.com/contact" },
    people: new Map([["jane doe", { email: "jane@acme.com", phone: null, sourceUrl: "https://acme.com/team" }]]),
  };

  it("uses a person's own details first, then the company's general ones, flagged", () => {
    const [jane, sam] = applyContactDetails([person("Jane Doe"), person("Sam Lee")], details);
    expect(jane).toMatchObject({ email: "jane@acme.com", phone: "020 7946 0000", phoneIsGeneral: true });
    expect(jane!.emailIsGeneral).toBeUndefined();
    expect(jane!.sourceUrls).toEqual(["https://linkedin.com/in/x", "https://acme.com/team", "https://acme.com/contact"]);
    expect(sam).toMatchObject({ email: "info@acme.com", emailIsGeneral: true, phone: "020 7946 0000", phoneIsGeneral: true });
  });

  it("never overwrites details a person already has", () => {
    const [c] = applyContactDetails([{ ...person("Sam Lee"), email: "sam@acme.com" }], details);
    expect(c).toMatchObject({ email: "sam@acme.com", phone: "020 7946 0000" });
    expect(c!.emailIsGeneral).toBeUndefined();
  });

  it("returns a company contact when no people were found", () => {
    expect(applyContactDetails([], details)).toEqual([
      { name: null, title: null, email: "info@acme.com", phone: "020 7946 0000", linkedinUrl: null, sourceUrls: ["https://acme.com/contact"], emailIsGeneral: true, phoneIsGeneral: true },
    ]);
    expect(applyContactDetails([], { general: null, people: new Map() })).toEqual([]);
  });
});
