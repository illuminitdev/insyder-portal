import { describe, expect, it } from "vitest";
import { parseSubject } from "./exa.js";

describe("parseSubject", () => {
  it("reads the structured company summary", () => {
    expect(
      parseSubject(JSON.stringify({ companyName: "Acme", companyWebsite: "acme.com", signalType: "expansion", eventSummary: "Acme expands" })),
    ).toEqual({ companyName: "Acme", companyWebsite: "acme.com", signalType: "expansion", eventSummary: "Acme expands" });
  });

  it("treats empty, unknown or malformed values as unknown", () => {
    expect(parseSubject(JSON.stringify({ companyName: " ", companyWebsite: "", signalType: "other" }))).toEqual({
      companyName: null,
      companyWebsite: null,
      signalType: null,
      eventSummary: null,
    });
    expect(parseSubject("not json")).toBeNull();
    expect(parseSubject(undefined)).toBeNull();
  });

  it("drops a LinkedIn or directory page given as the company website", () => {
    const s = parseSubject(JSON.stringify({ companyName: "Charles Simon Associates", companyWebsite: "linkedin.com/company/csa" }));
    expect(s?.companyName).toBe("Charles Simon Associates");
    expect(s?.companyWebsite).toBeNull();
  });
});
