import { describe, expect, it } from "vitest";
import { looksLikeNotACompany, websiteMatchesCompany } from "./companyWebsite.js";

describe("looksLikeNotACompany", () => {
  it("flags tender and job-ad titles", () => {
    expect(
      looksLikeNotACompany(
        "Selection of Implementation Support Agency for Infrastructure Enablement, It Equipment & Consumables Supply, and Operation & Maintenance for Implementing the Hospital Management & Electronic Health Re",
      ),
    ).toBe(true);
    expect(looksLikeNotACompany("Supply of IT Equipment to District Hospitals")).toBe(true);
    expect(looksLikeNotACompany("Request for Proposal: Managed SOC Services")).toBe(true);
    expect(looksLikeNotACompany("Sales Development Representative - Cybersecurity")).toBe(true);
    expect(looksLikeNotACompany("Tender for Supply and Installation of Servers")).toBe(true);
  });

  it("keeps real company names", () => {
    for (const n of [
      "Spaulding Rehabilitation Hospital Boston",
      "Premier Systems Pvt. Ltd.",
      "The Change Organisation",
      "Siemens Mobility",
      "Arondite",
      "SecurityHQ",
      "Talanos Cybersecurity",
      "Renaissance Distribution",
      "Bidwells",
      "Supply Chain Partners Ltd",
    ]) {
      expect(looksLikeNotACompany(n), n).toBe(false);
    }
  });
});

describe("websiteMatchesCompany", () => {
  it("accepts the company's own site", () => {
    expect(websiteMatchesCompany("Spaulding Rehabilitation Hospital Boston", "https://spauldingrehab.org", "Spaulding Rehabilitation")).toBe(true);
    expect(websiteMatchesCompany("SecurityHQ", "https://www.securityhq.com/", "SecurityHQ")).toBe(true);
    expect(websiteMatchesCompany("Siemens Mobility", "https://www.mobility.siemens.com/", "Siemens Mobility")).toBe(true);
    expect(websiteMatchesCompany("Arondite", "https://arondite.com", null)).toBe(true);
    expect(websiteMatchesCompany("The Change Organisation", "https://thechange.co.uk", "The Change Organisation")).toBe(true);
  });

  it("rejects other sites", () => {
    expect(websiteMatchesCompany("Spaulding Rehabilitation Hospital Boston", "https://healthtechmagazine.net/article/x", "Rehabilitation hospitals")).toBe(false);
    expect(websiteMatchesCompany("Spaulding Rehabilitation Hospital Boston", "https://rocketreach.co/spaulding", "Spaulding IT department")).toBe(false);
    expect(websiteMatchesCompany("SecurityHQ", "https://linkedin.com/company/securityhq", "SecurityHQ")).toBe(false);
    expect(websiteMatchesCompany("Premier Systems Pvt. Ltd.", "https://premierhealth.com", "Premier Health")).toBe(false);
    expect(websiteMatchesCompany("Boston Hospital Group", "https://bostonglobe.com", "Boston Globe")).toBe(false);
  });
});
