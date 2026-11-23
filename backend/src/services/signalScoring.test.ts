import { describe, expect, it } from "vitest";
import type { NormalizedEvidenceItem } from "../providers/research/types.js";
import { scoreEvidence } from "./scoring.js";
import { fitHint, mentionsIndustry, QUALITY, sourceQualityHint, withScoringHints } from "./signalScoring.js";

const item = (extra: Partial<NormalizedEvidenceItem> = {}): NormalizedEvidenceItem => ({
  canonicalUrl: "https://example.org/news/1",
  title: "Acme opens new data centre in Manchester",
  excerpt: "Acme, a logistics firm, is adding compute capacity.",
  country: "GB",
  signalKind: "expansion",
  subject: { companyName: "Acme", companyWebsite: "acme.com", eventSummary: "Acme opened a data centre" },
  ...extra,
});

describe("sourceQualityHint", () => {
  it("ranks publishers by trust", () => {
    expect(sourceQualityHint("https://news.acme.com/press", "acme.com")).toBe(QUALITY.firstParty);
    expect(sourceQualityHint("https://www.find-tender.service.gov.uk/x")).toBe(QUALITY.official);
    expect(sourceQualityHint("https://www.reuters.com/a")).toBe(QUALITY.majorNews);
    expect(sourceQualityHint("https://www.datacenterdynamics.com/a")).toBe(QUALITY.tradePress);
    expect(sourceQualityHint("https://www.prnewswire.com/a")).toBe(QUALITY.pressWire);
    expect(sourceQualityHint("https://uk.linkedin.com/jobs/1")).toBe(QUALITY.jobBoard);
    expect(sourceQualityHint("https://someone.medium.com/post")).toBe(QUALITY.userContent);
    expect(sourceQualityHint("https://random-site.io/a")).toBe(QUALITY.unknown);
  });

  it("does not treat look-alike hosts as the company or a known publisher", () => {
    expect(sourceQualityHint("https://notacme.com/a", "acme.com")).toBe(QUALITY.unknown);
    expect(sourceQualityHint("https://fakereuters.com/a")).toBe(QUALITY.unknown);
  });
});

describe("mentionsIndustry", () => {
  it("matches phrases and distinctive words, ignoring generic ones", () => {
    expect(mentionsIndustry(item(), ["Logistics"])).toBe(true);
    expect(mentionsIndustry(item({ excerpt: "Financial firm" }), ["Financial Services"])).toBe(true);
    expect(mentionsIndustry(item(), ["Healthcare"])).toBe(false);
    expect(mentionsIndustry(item({ excerpt: "IT services provider" }), ["Professional Services"])).toBe(false);
  });
});

describe("fitHint", () => {
  it("scores a fully matching, identified lead highly", () => {
    expect(fitHint(item(), { signalKinds: ["expansion"], countries: ["GB"], industries: ["Logistics"] })).toBe(95);
  });

  it("drops for unselected kinds, unknown country, no industry match and unconfirmed identity", () => {
    const weak = item({
      signalKind: "web_signal",
      country: null,
      excerpt: "A firm did something",
      title: "Update",
      subject: { companyName: "Acme", companyWebsite: null, eventSummary: null },
    });
    expect(fitHint(weak, { signalKinds: ["expansion"], countries: ["GB"], industries: ["Logistics"] })).toBe(42);
  });

  it("stays within 0–100", () => {
    const f = fitHint(item(), {});
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(100);
  });
});

describe("resulting lead scores", () => {
  it("spread across a real range instead of four fixed values", () => {
    const filters = { signalKinds: ["expansion"], countries: ["GB"], industries: ["Logistics"] };
    const totals = withScoringHints(
      [
        item({ canonicalUrl: "https://acme.com/press/1" }),
        item({ canonicalUrl: "https://www.reuters.com/a" }),
        item({ canonicalUrl: "https://blog.medium.com/a", signalKind: "web_signal", country: null }),
      ],
      filters,
    ).map(
      (i) =>
        scoreEvidence({ hasEvidence: true, daysSinceEvent: 10, sourceQuality: i.qualityHint!, fitHints: i.fitHint! }).total,
    );
    expect(totals[0]).toBeGreaterThan(totals[1]!);
    expect(totals[1]).toBeGreaterThan(totals[2]!);
    expect(new Set(totals).size).toBe(3);
  });
});
