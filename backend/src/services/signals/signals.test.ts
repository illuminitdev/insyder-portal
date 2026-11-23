import { describe, expect, it } from "vitest";
import {
  classifySignal,
  computeOfferingRelevance,
  computeSignalConfidence,
  deduplicateEvidence,
  extractIntelligentSignal,
  rankEvidence,
  verifyEvidence,
  buildBusinessContext,
  type RawEvidenceInput,
} from "./index.js";

describe("Business Signal Intelligence Layer", () => {
  describe("classifySignal across 8 categories", () => {
    it("classifies cloud migration initiatives", () => {
      const result = classifySignal({
        companyName: "FinTech Global",
        rawExcerpt: "FinTech Global announced its cloud migration to AWS to modernize legacy transactional databases.",
        sourceTitle: "FinTech Global moves core platform to AWS",
      });

      expect(result.category).toBe("cloud_migration");
      expect(result.rawSummary).toContain("cloud migration");
    });

    it("classifies executive leadership changes", () => {
      const result = classifySignal({
        companyName: "HealthTech Labs",
        rawExcerpt: "HealthTech Labs appointed Dr. Alistair Finch as CTO to oversee engineering and AI research.",
        sourceTitle: "New CTO appointment at HealthTech Labs",
      });

      expect(result.category).toBe("leadership_change");
      expect(result.role).toBe("CTO");
      expect(result.focusArea).toBe("Dr. Alistair Finch");
    });

    it("classifies engineering hiring with responsibilities", () => {
      const result = classifySignal({
        companyName: "Graphcore",
        rawExcerpt: "As Technical Services Director, you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments globally.",
        sourceTitle: "Technical Services Director - Greenhouse",
      });

      expect(result.category).toBe("hiring");
      expect(result.role).toBe("Technical Services Director");
      expect(result.responsibilities).toContain("data centre operations");
    });

    it("classifies infrastructure investments and data center rollouts", () => {
      const result = classifySignal({
        companyName: "CloudServe",
        rawExcerpt: "CloudServe announced new high-performance computing cluster and server facility build in Frankfurt.",
        sourceTitle: "CloudServe expands HPC infrastructure",
      });

      expect(result.category).toBe("infrastructure_investment");
      expect(result.rawSummary).toContain("infrastructure investment");
    });

    it("classifies enterprise digital transformation", () => {
      const result = classifySignal({
        companyName: "RetailCorp",
        rawExcerpt: "RetailCorp began a digital transformation modernizing legacy supply chain systems.",
      });

      expect(result.category).toBe("digital_transformation");
    });

    it("classifies company expansion, funding rounds, and M&A", () => {
      const result = classifySignal({
        companyName: "Hyperion Analytics",
        rawExcerpt: "Hyperion Analytics raised £18M Series A to expand international sales teams across the UK and Europe.",
      });

      expect(result.category).toBe("company_expansion");
      expect(result.rawSummary).toContain("expansion");
    });

    it("classifies technology adoption", () => {
      const result = classifySignal({
        companyName: "Aura Health",
        rawExcerpt: "Aura Health shared details on its recent deployment around predictive AI diagnostics.",
      });

      expect(result.category).toBe("technology_adoption");
      expect(result.rawSummary).toContain("predictive AI diagnostics");
    });

    it("classifies general business initiatives cleanly", () => {
      const result = classifySignal({
        companyName: "Logistics One",
        rawExcerpt: "Logistics One announced a major partnership with regional carriers across the Midlands.",
      });

      expect(result.category).toBe("general");
    });
  });

  describe("verifyEvidence", () => {
    it("flags ungrounded claims of global scaling from a job posting", () => {
      const result = verifyEvidence({
        companyName: "Acme",
        rawExcerpt: "We are scaling globally across every continent! Apply for our junior developer opening.",
        canonicalUrl: "https://job-boards.greenhouse.io/acme/job/1",
        publisher: "job-boards.greenhouse.io",
      });

      expect(result.hasUnsupportedClaims).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.reasons[0]).toContain("Job posting evidence cannot be used to substantiate ungrounded claims");
    });

    it("verifies credible major trade press evidence", () => {
      const result = verifyEvidence({
        companyName: "Graphcore",
        rawExcerpt: "Graphcore announced their next generation IPU compute infrastructure.",
        canonicalUrl: "https://www.theregister.com/2026/05/graphcore-ipu",
        publisher: "theregister.com",
      });

      expect(result.verified).toBe(true);
      expect(result.credibilityScore).toBeGreaterThanOrEqual(75);
      expect(result.credibilityTier).toBe("major_or_trade_press");
    });
  });

  describe("scoreSignal", () => {
    it("computes high relevance when offering directly matches signal category", () => {
      const cloudRelevance = computeOfferingRelevance({
        category: "cloud_migration",
        rawText: "migrating core transactional platform to AWS cloud",
        offering: "Enterprise cloud migration and managed infrastructure",
      });

      const genericRelevance = computeOfferingRelevance({
        category: "general",
        rawText: "holiday party scheduled for employees",
        offering: "Enterprise cloud migration and managed infrastructure",
      });

      expect(cloudRelevance).toBeGreaterThan(genericRelevance);
      expect(cloudRelevance).toBeGreaterThanOrEqual(85);
    });

    it("computes confidence score incorporating credibility and entity specificity", () => {
      const highConfidence = computeSignalConfidence({
        category: "leadership_change",
        hasRoleOrEntity: true,
        credibilityScore: 85,
        textLength: 120,
      });

      const lowConfidence = computeSignalConfidence({
        category: "general",
        hasRoleOrEntity: false,
        credibilityScore: 30,
        textLength: 20,
      });

      expect(highConfidence).toBeGreaterThan(lowConfidence);
      expect(highConfidence).toBeGreaterThan(75);
    });
  });

  describe("deduplicateEvidence", () => {
    it("consolidates duplicate syndicated wire articles to the higher credibility source", () => {
      const items: RawEvidenceInput[] = [
        {
          companyName: "Acme",
          sourceTitle: "Acme raises Series A",
          rawExcerpt: "Acme raises £10M Series A for cloud platform",
          canonicalUrl: "https://prnewswire.com/acme-release",
          publisher: "prnewswire.com",
          eventDate: "2026-05-01",
        },
        {
          companyName: "Acme",
          sourceTitle: "Acme raises Series A",
          rawExcerpt: "Acme raises £10M Series A for cloud platform",
          canonicalUrl: "https://bloomberg.com/news/acme-series-a",
          publisher: "bloomberg.com",
          eventDate: "2026-05-01",
        },
      ];

      const deduped = deduplicateEvidence(items);
      expect(deduped.length).toBe(1);
      // Bloomberg has higher credibility (majorNews = 85) than prnewswire (pressWires = 70)
      expect(deduped[0]!.publisher).toBe("bloomberg.com");
    });
  });

  describe("rankEvidence", () => {
    it("ranks recent, high-relevance, credible evidence above stale or generic items", () => {
      const items: RawEvidenceInput[] = [
        {
          companyName: "TechCorp",
          sourceTitle: "Old general update",
          rawExcerpt: "TechCorp updated its logo and office signage.",
          canonicalUrl: "https://some-directory.com/techcorp",
          publisher: "some-directory.com",
          eventDate: "2025-01-01", // Stale
        },
        {
          companyName: "TechCorp",
          sourceTitle: "TechCorp announces cloud migration and HPC infrastructure upgrade",
          rawExcerpt: "TechCorp announced a major cloud migration to AWS alongside high-performance computing expansion.",
          canonicalUrl: "https://theregister.com/techcorp-hpc",
          publisher: "theregister.com",
          eventDate: new Date().toISOString(), // Fresh
          reviewedAt: new Date().toISOString(),
        },
      ];

      const ranked = rankEvidence(items, "Enterprise servers, cloud migration, and managed infrastructure");
      expect(ranked[0]!.rawInput.sourceTitle).toContain("cloud migration");
      expect(ranked[0]!.rankingScore).toBeGreaterThan(ranked[1]!.rankingScore);
    });
  });

  describe("buildBusinessContext", () => {
    it("generates concrete operational implications for cloud migration", () => {
      const context = buildBusinessContext({
        companyName: "BankCorp",
        classification: {
          category: "cloud_migration",
          rawSummary: "migrating legacy systems to AWS",
          attribution: "theregister.com",
          focusArea: "AWS cloud migration",
        },
      });

      expect(context.observedFact).toContain("cloud migration");
      expect(context.potentialBusinessImplication).toContain("resilience");
      expect(context.potentialBusinessImplication).toContain("compute consumption");
    });
  });

  describe("extractIntelligentSignal end-to-end", () => {
    it("returns a fully populated BusinessSignal conforming to requirements", () => {
      const signal = extractIntelligentSignal({
        companyName: "Graphcore",
        rawExcerpt: "As Technical Services Director, you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments globally.",
        sourceTitle: "Technical Services Director - Greenhouse",
        publisher: "job-boards.greenhouse.io",
        canonicalUrl: "https://job-boards.greenhouse.io/graphcore/jobs/123",
        eventDate: "2026-05-01",
        offering: "Enterprise servers and managed infrastructure",
      });

      expect(signal.category).toBe("hiring");
      expect(signal.observedFact).toContain("Technical Services Director");
      expect(signal.potentialBusinessImplication).toContain("infrastructure");
      expect(signal.sourceUrl).toBe("https://job-boards.greenhouse.io/graphcore/jobs/123");
      expect(signal.sourceDate).toBe("2026-05-01");
      expect(signal.confidence).toBeGreaterThan(0);
      expect(signal.relevanceScore).toBeGreaterThan(0);
      expect(signal.verified).toBe(true);
    });
  });
});
