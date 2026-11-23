import { describe, expect, it } from "vitest";
import {
  buildDraftContent,
  cleanExcerpt,
  cleanTitleFocus,
  extractBusinessSignal,
  extractFirstName,
  rankContactsForSignal,
  sourceAttribution,
  validateDraftQuality,
} from "./drafts.js";

describe("drafts service quality", () => {
  describe("cleanExcerpt", () => {
    it("strips job board boilerplate headers like 'The Opportunity'", () => {
      const raw = `The Opportunity\n\nAs Technical Services Director, you will lead the teams that operate and evolve Graphcore's engineering labs...`;
      const cleaned = cleanExcerpt(raw);
      expect(cleaned).not.toMatch(/^the opportunity/i);
      expect(cleaned).toContain("As Technical Services Director");
    });

    it("strips legal boilerplate from the end of job postings", () => {
      const raw = `Seeking an engineer to scale our cloud clusters. Equal Opportunity Employer: all qualified applicants will receive consideration.`;
      const cleaned = cleanExcerpt(raw);
      expect(cleaned).toBe("Seeking an engineer to scale our cloud clusters");
    });

    it("strips raw URLs and HTML tags", () => {
      const raw = `Check out <a href="https://example.com/job">our opening</a> on https://example.com/jobs/123.`;
      const cleaned = cleanExcerpt(raw);
      expect(cleaned).not.toContain("https://");
      expect(cleaned).not.toContain("<a");
    });

    it("cleanly truncates long excerpts on word boundary", () => {
      const long =
        "Acme Corporation today announced the completion of their Series B funding round alongside substantial international expansion plans covering five new regional distribution and compute centers across North America and Europe.";
      const cleaned = cleanExcerpt(long);
      expect(cleaned.length).toBeLessThanOrEqual(250);
      expect(cleaned.endsWith("…")).toBe(true);
      expect(cleaned).not.toContain("  ");
    });
  });

  describe("sourceAttribution", () => {
    it("prefers publisher name and strips protocol and www", () => {
      expect(
        sourceAttribution({ publisher: "https://www.job-boards.greenhouse.io", canonicalUrl: "https://job-boards.greenhouse.io/graphcore" }),
      ).toBe("job-boards.greenhouse.io");
    });

    it("falls back to hostname without www when publisher is missing", () => {
      expect(sourceAttribution({ publisher: null, canonicalUrl: "https://www.reuters.com/business/acme" })).toBe(
        "reuters.com",
      );
    });

    it("handles invalid url safely", () => {
      expect(sourceAttribution({ publisher: undefined, canonicalUrl: "not-a-url" })).toBe("");
    });
  });

  describe("extractBusinessSignal", () => {
    it("extracts hiring signal accurately from Graphcore Greenhouse posting without assuming expansion", () => {
      const raw = `The Opportunity\n\nAs Technical Services Director, you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments globally. You will be accountable for reliable, secure, cost-effective infrastructure...`;
      const signal = extractBusinessSignal({
        rawExcerpt: raw,
        sourceTitle: "Technical Services Director - Greenhouse",
        publisher: "job-boards.greenhouse.io",
        canonicalUrl: "https://job-boards.greenhouse.io/graphcore/jobs/123",
        companyName: "Graphcore",
      });

      expect(signal.type).toBe("hiring");
      expect(signal.role).toBe("Technical Services Director");
      expect(signal.responsibilities).toBe(
        "engineering labs, high-performance computing (HPC) platforms, and data centre operations",
      );
      expect(signal.summary).toBe(
        "hiring a Technical Services Director for its engineering labs, high-performance computing (HPC) platforms, and data centre operations",
      );
    });

    it("extracts infrastructure announcement without fabricating unverified details", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: "Acme Corp announced its recent infrastructure development in Frankfurt.",
        companyName: "Acme Corp",
      });

      expect(signal.type).toBe("announcement");
      expect(signal.summary).toBe("recent announcement regarding its infrastructure development in Frankfurt");
    });

    it("extracts technology initiative signal", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: "Carter Credit Union shared details on its recent initiative involving cloud infrastructure migration.",
        companyName: "Carter Credit Union",
      });

      expect(signal.type).toBe("technology");
      expect(signal.summary).toBe("recent work involving cloud infrastructure migration");
    });
  });

  describe("buildDraftContent", () => {
    it("generates the exact expected email structure for Graphcore matching Section 10", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: `The Opportunity\n\nAs Technical Services Director, you will lead the teams that operate and evolve Graphcore's engineering labs, high-performance computing (HPC) platforms, and data center environments globally.`,
        sourceTitle: "Technical Services Director - Greenhouse",
        publisher: "job-boards.greenhouse.io",
        canonicalUrl: "https://job-boards.greenhouse.io/graphcore/jobs/123",
        companyName: "Graphcore",
      });

      const content = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers and managed infrastructure",
        channel: "email",
        signal,
        actionableHypotheses: [],
        discoveryQuestion: "Will the site use local compute, central infrastructure or cloud services?",
      });

      // Subject: Trigger-centric
      expect(content.subject).toBe("Technical Services Director role · Graphcore");

      // Paragraph 1: Personalized opening citing publisher
      expect(content.body).toContain(
        "I saw on job-boards.greenhouse.io that Graphcore is hiring a Technical Services Director for its engineering labs, high-performance computing (HPC) platforms, and data centre operations.",
      );

      // Paragraph 2: Business consideration
      expect(content.body).toContain(
        "As these environments evolve, maintaining reliable infrastructure and ensuring server capacity can scale efficiently become increasingly important.",
      );

      // Paragraph 3: Offering connection
      expect(content.body).toContain(
        "We work with engineering teams on enterprise servers and managed infrastructure to support growing compute requirements and streamline operations.",
      );

      // Paragraph 4: Discovery question (earned question for role)
      expect(content.body).toContain(
        "Is the Technical Services Director hire looking to replace someone, or are you building out a new team for this?",
      );

      // Paragraph 5: Low-pressure CTA
      expect(content.body).toContain(
        "Would you be open to a brief 10-minute conversation next week to exchange perspectives on infrastructure requirements?",
      );

      // Paragraph 6: Sign-off
      expect(content.body).toContain("Best,");

      // Length: between 90 and 140 words
      const wordCount = content.body.trim().split(/\s+/).length;
      expect(wordCount).toBeGreaterThanOrEqual(90);
      expect(wordCount).toBeLessThanOrEqual(140);
    });

    it("uses the custom discovery question from the company's specific search playbook", () => {
      const content = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers",
        channel: "email",
        signal: {
          type: "hiring",
          summary: "hiring for a Technical Services Director, with responsibilities spanning engineering labs and HPC platforms",
          responsibilities: "engineering labs, HPC platforms, and data centre operations",
          attribution: "greenhouse.io",
        },
        actionableHypotheses: [],
        discoveryQuestion: "How are you currently managing capacity across your GPU clusters and lab environments?",
      });

      expect(content.body).toContain(
        "How are you currently managing capacity across your GPU clusters and lab environments?",
      );
    });

    it("generates natural, uninvented outreach for an account without reviewed evidence", () => {
      const content = buildDraftContent({
        accountName: "State Farm",
        offering: "Enterprise Cloud Migration",
        channel: "email",
        signal: null,
        actionableHypotheses: [],
      });

      expect(content.body).toContain("I've been following State Farm's recent initiatives and work in your space.");
      expect(content.body).not.toContain("scaling globally");
      expect(content.body).not.toContain("launching a new site");

      const wordCount = content.body.trim().split(/\s+/).length;
      expect(wordCount).toBeGreaterThanOrEqual(60);
      expect(wordCount).toBeLessThanOrEqual(140);
    });

    it("generates concise LinkedIn connection note under 300 characters", () => {
      const content = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers and managed infrastructure",
        channel: "linkedin_note",
        signal: {
          type: "hiring",
          summary: "hiring for a Technical Services Director",
          attribution: "Greenhouse",
        },
        actionableHypotheses: [],
      });

      expect(content.subject).toBe("Connection request: Graphcore");
      expect(content.body).toContain("Hi {{first_name}}, noticed Graphcore's hiring for a Technical Services Director.");
      expect(content.body.length).toBeLessThanOrEqual(300);
    });

    it("generates structured phone call script for SDRs", () => {
      const content = buildDraftContent({
        accountName: "Carter Credit Union",
        offering: "Enterprise servers and managed infrastructure",
        channel: "call_script",
        signal: {
          type: "announcement",
          summary: "recent announcement regarding its infrastructure development",
          attribution: "LocalNews",
        },
        actionableHypotheses: [],
      });

      expect(content.subject).toBe("Call script: Carter Credit Union");
      expect(content.body).toContain("1. Opening:");
      expect(content.body).toContain("2. Context & Sourced Trigger:");
      expect(content.body).toContain("3. Value Proposition:");
      expect(content.body).toContain("4. Discovery Question:");
      expect(content.body).toContain("5. Closing Call-to-Action:");
    });
  });

  describe("validateDraftQuality", () => {
    it("validates that a compliant draft passes all checks", () => {
      const report = validateDraftQuality({
        subject: "Technical Services Director role · Graphcore",
        body: `Hi {{first_name}},\n\nI saw on Greenhouse that Graphcore is hiring a Technical Services Director for its engineering labs, high-performance computing (HPC) platforms, and data centre operations.\n\nAs these environments evolve, maintaining reliable infrastructure and ensuring server capacity can scale efficiently become increasingly important.\n\nWe work with engineering teams on enterprise servers and managed infrastructure to support growing compute requirements and streamline operations.\n\nAre you currently evaluating local compute, centralized infrastructure, or cloud-based solutions for your engineering workloads?\n\nWould you be open to a brief 10-minute conversation next week to exchange perspectives on infrastructure requirements?\n\nBest,\nAlex Finch\nAcme Cloud`,
        accountName: "Graphcore",
        hasReviewedEvidence: true,
        signalType: "hiring",
      });

      expect(report.valid).toBe(true);
      expect(report.issues.length).toBe(0);
      expect(report.wordCount).toBeGreaterThanOrEqual(90);
      expect(report.wordCount).toBeLessThanOrEqual(140);
    });

    it("flags unsupported claims like 'scaling globally' for a hiring signal", () => {
      const report = validateDraftQuality({
        subject: "Enterprise servers · Graphcore",
        body: `Hi {{first_name}},\n\nSaw that your team is scaling globally with a new site.\n\nBest regards,`,
        accountName: "Graphcore",
        hasReviewedEvidence: true,
        signalType: "hiring",
      });

      expect(report.valid).toBe(false);
      expect(report.issues.some((i) => i.includes("does not support claims"))).toBe(true);
    });

    it("catches raw URL artifacts and scrape headers", () => {
      const report = validateDraftQuality({
        subject: "Graphcore",
        body: `Hi {{first_name}},\n\nThe Opportunity: See https://greenhouse.io/job/123 for details.\n\nBest regards,`,
        accountName: "Graphcore",
        hasReviewedEvidence: true,
      });

      expect(report.valid).toBe(false);
      expect(report.issues.some((i) => i.includes("Raw URLs"))).toBe(true);
      expect(report.issues.some((i) => i.includes("The Opportunity"))).toBe(true);
    });

    it("catches duplicate repetitive sentences", () => {
      const report = validateDraftQuality({
        subject: "Enterprise servers · Graphcore",
        body: `Hi {{first_name}},\n\nWe work with engineering teams on enterprise servers to support growing compute requirements.\n\nWe work with engineering teams on enterprise servers to support growing compute requirements.\n\nBest regards,`,
        accountName: "Graphcore",
        hasReviewedEvidence: true,
      });

      expect(report.valid).toBe(false);
      expect(report.issues.some((i) => i.includes("Duplicate sentence"))).toBe(true);
    });

    it("flags uncited drafts for manual review without failing validation", () => {
      const report = validateDraftQuality({
        subject: "Enterprise Cloud Migration · State Farm",
        body: `Hi {{first_name}},\n\nI've been following State Farm's recent initiatives and work in your space.\n\nAs technical requirements evolve, maintaining reliable infrastructure and keeping operational overhead streamlined become essential.\n\nWe work with engineering teams on enterprise cloud migration to support growing compute requirements and streamline operations.\n\nAre you currently evaluating local compute, centralized infrastructure, or cloud-based solutions for your engineering workloads?\n\nWould you be open to a brief 10-minute conversation next week to exchange perspectives on infrastructure requirements?\n\nBest regards,`,
        accountName: "State Farm",
        hasReviewedEvidence: false,
      });

      expect(report.valid).toBe(true);
      expect(report.flaggedForReview).toBe(true);
      expect(report.warnings.some((w) => w.includes("no reviewed evidence"))).toBe(true);
    });
  });

  describe("extractFirstName", () => {
    it("strips honorifics and extracts clean first names", () => {
      expect(extractFirstName("Dr. Alistair Finch")).toBe("Alistair");
      expect(extractFirstName("Prof. Jane Doe")).toBe("Jane");
      expect(extractFirstName("Mr. David Miller")).toBe("David");
      expect(extractFirstName("Ms. Sarah Jenkins")).toBe("Sarah");
      expect(extractFirstName("Sarah Jenkins")).toBe("Sarah");
      expect(extractFirstName("Alex P. Wong")).toBe("Alex");
    });

    it("falls back gracefully to {{first_name}} when name is missing", () => {
      expect(extractFirstName(null)).toBe("{{first_name}}");
      expect(extractFirstName(undefined)).toBe("{{first_name}}");
      expect(extractFirstName("")).toBe("{{first_name}}");
      expect(extractFirstName("   ")).toBe("{{first_name}}");
    });
  });

  describe("rankContactsForSignal", () => {
    const candidates = [
      {
        id: "c1",
        name: "Jessica Marketing",
        title: "Chief Marketing Officer",
        buyingRole: "decision_maker",
        email: "jessica@example.com",
      },
      {
        id: "c2",
        name: "Marcus Miller",
        title: "Head of Infrastructure and Cloud Operations",
        buyingRole: "technical_evaluator",
        email: "marcus@example.com",
        sourceNote: "Found on web. LinkedIn: https://linkedin.com/in/marcusmiller",
      },
      {
        id: "c3",
        name: "Dr. Alistair Finch",
        title: "Chief Technology Officer",
        buyingRole: "economic_buyer",
        email: "alistair@example.com",
        sourceNote: "Found on web. LinkedIn: https://linkedin.com/in/alistairfinch",
      },
    ];

    it("prioritizes infrastructure leaders for cloud migration and infrastructure signals", () => {
      const best = rankContactsForSignal(candidates, "cloud_migration", "email");
      expect(best?.id).toBe("c2");
      expect(best?.name).toBe("Marcus Miller");
    });

    it("prioritizes executive technology leaders for digital transformation or tech initiatives", () => {
      const best = rankContactsForSignal(candidates, "digital_transformation", "email");
      expect(best?.id).toBe("c3");
      expect(best?.name).toBe("Dr. Alistair Finch");
    });

    it("bypasses suppressed contacts", () => {
      const withSuppressed = [
        {
          id: "c2",
          name: "Marcus Miller",
          title: "Head of Infrastructure",
          suppressed: true,
        },
        {
          id: "c3",
          name: "Dr. Alistair Finch",
          title: "Chief Technology Officer",
          suppressed: false,
        },
      ];
      const best = rankContactsForSignal(withSuppressed, "cloud_migration", "email");
      expect(best?.id).toBe("c3");
    });

    it("personalizes buildDraftContent with decision maker first name", () => {
      const content = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers",
        channel: "email",
        recipientName: "Dr. Alistair Finch",
        actionableHypotheses: [],
      });

      expect(content.body).toContain("Hi Alistair,");
      expect(content.body).not.toContain("Hi {{first_name}},");
    });

    it("personalizes LinkedIn connection note with decision maker first name", () => {
      const content = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers",
        channel: "linkedin_note",
        recipientName: "Sarah Jenkins",
        actionableHypotheses: [],
      });

      expect(content.body).toContain("Hi Sarah,");
      expect(content.body.length).toBeLessThanOrEqual(300);
    });
  });

  describe("cleanTitleFocus", () => {
    it("cleans and formats diverse executive and management titles", () => {
      expect(cleanTitleFocus("Head of Information Technology")).toBe("leading Information Technology");
      expect(cleanTitleFocus("Head of IT: Generation, Trading & Capital Projects")).toBe(
        "leading IT for Generation, Trading & Capital Projects",
      );
      expect(cleanTitleFocus("Head of Group IT Operations")).toBe("leading Group IT Operations");
      expect(cleanTitleFocus("VP of Engineering")).toBe("leading Engineering");
      expect(cleanTitleFocus("Director of Cloud Operations")).toBe("directing Cloud Operations");
      expect(cleanTitleFocus("Chief Information Officer")).toBe("as Chief Information Officer");
      expect(cleanTitleFocus("CTO")).toBe("as CTO");
      expect(cleanTitleFocus("Infrastructure Manager")).toBe("leading Infrastructure");
      expect(cleanTitleFocus("Senior Infrastructure Engineer")).toBe("in Senior Infrastructure Engineer");
      expect(cleanTitleFocus("")).toBeNull();
      expect(cleanTitleFocus(null)).toBeNull();
      expect(cleanTitleFocus("unknown")).toBeNull();
    });
  });

  describe("decision maker role-specific personalization", () => {
    it("generates distinct LinkedIn notes for John Boot, Tom Kingston, and Caroline Bedford at Drax Group", () => {
      const draxJohn = buildDraftContent({
        accountName: "Drax Group",
        offering: "high performance compute and private AI infrastructure",
        channel: "linkedin_note",
        recipientName: "John Boot",
        recipientTitle: "Head of Information Technology",
        actionableHypotheses: [],
      });

      const draxTom = buildDraftContent({
        accountName: "Drax Group",
        offering: "high performance compute and private AI infrastructure",
        channel: "linkedin_note",
        recipientName: "Tom Kingston",
        recipientTitle: "Head of IT: Generation, Trading & Capital Projects",
        actionableHypotheses: [],
      });

      const draxCaroline = buildDraftContent({
        accountName: "Drax Group",
        offering: "high performance compute and private AI infrastructure",
        channel: "linkedin_note",
        recipientName: "Caroline Bedford",
        recipientTitle: "Head of Group IT Operations",
        actionableHypotheses: [],
      });

      // Verify each has distinct personalization
      expect(draxJohn.body).toContain("Hi John, noticed your work leading Information Technology at Drax Group.");
      expect(draxTom.body).toContain(
        "Hi Tom, noticed your work leading IT for Generation, Trading & Capital Projects at Drax Group.",
      );
      expect(draxCaroline.body).toContain("Hi Caroline, noticed your work leading Group IT Operations at Drax Group.");

      // None of them are identical
      expect(draxJohn.body).not.toBe(draxTom.body);
      expect(draxTom.body).not.toBe(draxCaroline.body);
      expect(draxJohn.body).not.toBe(draxCaroline.body);

      // All satisfy the 300 character LinkedIn limit
      expect(draxJohn.body.length).toBeLessThanOrEqual(300);
      expect(draxTom.body.length).toBeLessThanOrEqual(300);
      expect(draxCaroline.body.length).toBeLessThanOrEqual(300);
    });

    it("synthesizes decision maker role with researched company business signals", () => {
      const draft = buildDraftContent({
        accountName: "Drax Group",
        offering: "high performance compute and private AI infrastructure",
        channel: "linkedin_note",
        recipientName: "Tom Kingston",
        recipientTitle: "Head of IT: Generation, Trading & Capital Projects",
        signal: {
          type: "technology",
          summary: "initiatives in telemetry and trading systems",
          attribution: "reuters.com",
        },
        actionableHypotheses: [],
      });

      expect(draft.body).toContain(
        "Hi Tom, noticed your work leading IT for Generation, Trading & Capital Projects at Drax Group, and Drax Group's initiatives in telemetry and trading systems.",
      );
      expect(draft.body.length).toBeLessThanOrEqual(300);
    });

    it("personalizes email outreach opening with the contact's specific focus area", () => {
      const emailDraft = buildDraftContent({
        accountName: "Drax Group",
        offering: "high performance compute and private AI infrastructure",
        channel: "email",
        recipientName: "Caroline Bedford",
        recipientTitle: "Head of Group IT Operations",
        actionableHypotheses: [],
      });

      expect(emailDraft.body).toContain("Hi Caroline,");
      expect(emailDraft.body).toContain(
        "I've been following Drax Group's recent initiatives and came across your work leading Group IT Operations.",
      );
    });

    it("generates natural, coherent outreach for recruitment agencies without injecting hardware/compute jargon", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: "Green Mountain announces major infrastructure investment in compute capability expansion across European campuses.",
        sourceTitle: "Green Mountain expands capacity - Data Center News",
        publisher: "datacenterdynamics.com",
        canonicalUrl: "https://datacenterdynamics.com/news/green-mountain-expansion",
        companyName: "Green Mountain",
        offering: "Specialist technology recruitment",
      });

      const emailDraft = buildDraftContent({
        accountName: "Green Mountain",
        offering: "Specialist technology recruitment",
        channel: "email",
        recipientName: "Nirav",
        recipientTitle: "Chief Technology Officer",
        signal,
        actionableHypotheses: [],
      });

      // Subject
      expect(emailDraft.subject).toBe("Specialist technology recruitment · Green Mountain");

      // Opening
      expect(emailDraft.body).toContain("Hi Nirav,");
      expect(emailDraft.body).toContain("infrastructure investment in compute capability expansion");
      expect(emailDraft.body).toContain("as Chief Technology Officer");

      // Business Implication: Must talk about technical talent / team capacity, NOT server density
      expect(emailDraft.body).toContain("specialist engineering talent");
      expect(emailDraft.body).not.toContain("server capacity");
      expect(emailDraft.body).not.toContain("compute density");

      // Value Proposition: Must connect recruitment to technical teams, NOT "to support growing compute requirements"
      expect(emailDraft.body).toContain("We partner with engineering and technical leaders on specialist technology recruitment");
      expect(emailDraft.body).not.toContain("to support growing compute requirements and streamline operations");

      // Discovery Question: Must ask about talent/resourcing, NOT local compute vs cloud
      expect(emailDraft.body).toContain("specialist talent to support the deployment");
      expect(emailDraft.body).not.toContain("evaluating local compute, centralized infrastructure");

      // Call to action: Must ask to exchange perspectives on hiring/scaling, NOT infrastructure requirements
      expect(emailDraft.body).toContain("exchange perspectives on technical hiring and team scaling");
      expect(emailDraft.body).not.toContain("perspectives on infrastructure requirements");
    });

    it("generates natural, coherent outreach for SaaS and custom software development firms", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: "Acme Corp initiates comprehensive digital transformation and core systems modernization across all customer portals.",
        sourceTitle: "Acme Modernization - Tech Daily",
        publisher: "techdaily.com",
        canonicalUrl: "https://techdaily.com/acme-modernization",
        companyName: "Acme Corp",
        offering: "Enterprise SaaS and cloud application development",
      });

      const emailDraft = buildDraftContent({
        accountName: "Acme Corp",
        offering: "Enterprise SaaS and cloud application development",
        channel: "email",
        recipientName: "Sarah",
        recipientTitle: "VP of Engineering",
        signal,
        actionableHypotheses: [],
      });

      expect(emailDraft.subject).toBe("Enterprise SaaS and cloud application development · Acme Corp");
      expect(emailDraft.body).toContain("Hi Sarah,");
      expect(emailDraft.body).toContain("digital transformation and core systems modernization");
      expect(emailDraft.body).toContain("leading Engineering");

      // Business implication should focus on software systems and architectures, not servers
      expect(emailDraft.body).toContain("Modernizing core systems and migrating workloads requires robust software architecture");
      expect(emailDraft.body).not.toContain("server capacity");
      expect(emailDraft.body).not.toContain("compute density");

      // Value proposition
      expect(emailDraft.body).toContain("We work with engineering and product teams on enterprise saas and cloud application development");

      // Question
      expect(emailDraft.body).toContain("are you building capabilities in-house or evaluating external software partners?");

      // CTA
      expect(emailDraft.body).toContain("exchange perspectives on your technical roadmap");
    });

    it("never invents or forces a prospect's activity into an unrelated offering, producing a grounded neutral message", () => {
      // Prospect is building data centers; User is a Corporate Financial & Legal Advisory firm
      const signal = extractBusinessSignal({
        rawExcerpt: "Green Mountain announces $200M infrastructure investment in compute capability expansion across European campuses.",
        sourceTitle: "Green Mountain Expansion - Finance News",
        publisher: "financenews.com",
        canonicalUrl: "https://financenews.com/green-mountain",
        companyName: "Green Mountain",
        offering: "Corporate financial advisory and legal services",
      });

      const emailDraft = buildDraftContent({
        accountName: "Green Mountain",
        offering: "Corporate financial advisory and legal services",
        channel: "email",
        recipientName: "David",
        recipientTitle: "Chief Executive Officer",
        signal,
        actionableHypotheses: [],
      });

      expect(emailDraft.subject).toBe("Corporate financial advisory and legal services · Green Mountain");
      expect(emailDraft.body).toContain("Hi David,");

      // Principle test: Must NOT claim the finance/legal firm provides server capacity or compute density!
      expect(emailDraft.body).not.toContain("compute density");
      expect(emailDraft.body).not.toContain("server availability");
      expect(emailDraft.body).not.toContain("compute requirements");

      // Grounded neutral implication about operational stability & organizational scaling
      expect(emailDraft.body).toContain("maintaining operational stability while balancing growth and execution is critical");

      // Natural, unforced offering connection
      expect(emailDraft.body).toContain("We partner with organizations on corporate financial advisory and legal services");

      // Professional, non-hardware question
      expect(emailDraft.body).toContain("is this an active focus area for your leadership team over the coming quarters?");

      // Dignified neutral CTA
      expect(emailDraft.body).toContain("exchange perspectives and share notes");
    });

    it("cleans raw website scrape headers and avoids inventing expansions for recruitment outreach (Datum Datacentres case)", () => {
      const signal = extractBusinessSignal({
        rawExcerpt: "# Datum Datacentres Website: datum.co.uk We specialize in bespoke solutions and embrace complexity, providing true value to our clients through collaborative working and enterprise-class service...",
        sourceTitle: "Datum Datacentres - Colocation and Data Centre Solutions",
        publisher: "datum.co.uk",
        canonicalUrl: "https://datum.co.uk",
        companyName: "Datum Datacentres",
        offering: "Specialist technology recruitment",
      });

      const emailDraft = buildDraftContent({
        accountName: "Datum Datacentres",
        offering: "Specialist technology recruitment",
        channel: "email",
        recipientName: "Daniel",
        recipientTitle: "Technical Operations",
        signal,
        actionableHypotheses: [],
      });

      expect(emailDraft.subject).toBe("Specialist technology recruitment · Datum Datacentres");
      expect(emailDraft.body).toContain("Hi Daniel,");

      // 1. Must never leak raw markdown (#), website URL (datum.co.uk), or website promotional text
      expect(emailDraft.body).not.toContain("# Datum Datacentres");
      expect(emailDraft.body).not.toContain("datum.co.uk");
      expect(emailDraft.body).not.toContain("We specialize in bespoke solutions");
      expect(emailDraft.body).not.toContain("providing true value to our clients");

      // 2. Must not repeat "came across ... and came across"
      const cameAcrossCount = (emailDraft.body.match(/came across/gi) ?? []).length;
      expect(cameAcrossCount).toBeLessThanOrEqual(1);

      // 3. Opening must be grounded and acknowledge their role without awkward possessive grammar
      expect(emailDraft.body).toContain(
        "I've been following Datum Datacentres's recent initiatives and came across your work in Technical Operations.",
      );

      // 4. Must NOT claim an expansion when there is no expansion signal
      expect(emailDraft.body).not.toContain("As you ramp up this expansion");
      expect(emailDraft.body).not.toContain("support the deployment");

      // 5. Must use a grounded technical priority discovery question
      expect(emailDraft.body).toContain(
        "As you plan across your upcoming technical priorities, are you looking to bring in specialist talent externally, or handling requirements with internal resources?",
      );

      // 6. Value prop and CTA
      expect(emailDraft.body).toContain(
        "We partner with engineering and technical leaders on specialist technology recruitment",
      );
      expect(emailDraft.body).toContain(
        "Would you be open to a brief 10-minute conversation next week to exchange perspectives on technical hiring and team scaling?",
      );
    });
  });

  describe("draft overhaul: sourcing, timing, seller context & inmail", () => {
    it("includes publisher and timing in the opening sentence and grounds value prop in seller context", () => {
      const draft = buildDraftContent({
        accountName: "Graphcore",
        offering: "Enterprise servers and managed infrastructure",
        channel: "email",
        recipientName: "Sarah Jenkins",
        recipientTitle: "VP of Engineering",
        signal: {
          type: "hiring",
          role: "Technical Services Director",
          focusArea: "engineering labs and HPC platforms",
          summary: "hiring a Technical Services Director for its engineering labs and HPC platforms",
          attribution: "Greenhouse",
          sourceDate: "2026-03-12T10:00:00Z",
        },
        actionableHypotheses: [],
        sellerContext: {
          sellerCompany: "Acme Cloud",
          sellerOffering: "High performance compute and server infrastructure",
          authorName: "Alex Finch",
        },
        hasReviewedEvidence: true,
      });

      // Subject is trigger-centric
      expect(draft.subject).toBe("Technical Services Director role · Graphcore");

      // Opening cites publisher and timing
      expect(draft.body).toContain(
        "I saw on Greenhouse this March that Graphcore is hiring a Technical Services Director for its engineering labs and HPC platforms and came across your work leading Engineering.",
      );

      // Value prop grounded in seller company
      expect(draft.body).toContain(
        "At Acme Cloud, we work with engineering teams on high performance compute and server infrastructure to support growing compute requirements and streamline operations.",
      );

      // Question is earned for the role
      expect(draft.body).toContain(
        "Is the Technical Services Director hire looking to replace someone, or are you building out a new team for this?",
      );

      // Sign-off includes author and seller company
      expect(draft.body).toContain("Best,\nAlex Finch\nAcme Cloud");
    });

    it("generates direct conversational LinkedIn InMail without email sign-off block", () => {
      const inmail = buildDraftContent({
        accountName: "Graphcore",
        offering: "Managed Cloud Infrastructure",
        channel: "linkedin_inmail",
        recipientName: "David Miller",
        recipientTitle: "Head of Infrastructure",
        signal: {
          type: "hiring",
          role: "Technical Services Director",
          focusArea: "HPC clusters",
          summary: "hiring a Technical Services Director for its HPC clusters",
          attribution: "Greenhouse",
          sourceDate: "2026-03-15T12:00:00Z",
        },
        actionableHypotheses: [],
        sellerContext: {
          sellerCompany: "Acme Cloud",
          authorName: "Alex Finch",
        },
        hasReviewedEvidence: true,
      });

      expect(inmail.subject).toBe("Technical Services Director role · Graphcore");
      expect(inmail.body).toContain("Hi David,");
      expect(inmail.body).toContain("At Acme Cloud, we work with engineering teams");
      expect(inmail.body).toContain("Would you be open to connecting briefly to exchange perspectives?");
      expect(inmail.body).toContain("— Alex");
      expect(inmail.body).not.toContain("Best regards,");
      expect(inmail.body).not.toContain("Best,");
    });

    it("generates a clean skeleton draft with clear notice when no reviewed evidence exists", () => {
      const skeleton = buildDraftContent({
        accountName: "Unreviewed Account",
        offering: "Cloud hosting",
        channel: "email",
        recipientName: "Jane Doe",
        actionableHypotheses: [],
        hasReviewedEvidence: false,
        sellerContext: {
          sellerCompany: "Acme Cloud",
          authorName: "Alex Finch",
        },
      });

      expect(skeleton.subject).toBe("Draft (Pending Evidence Review) · Unreviewed Account");
      expect(skeleton.body).toContain("[Evidence review pending: This account does not have reviewed evidence yet.");
      expect(skeleton.body).toContain("Best,\nAlex Finch\nAcme Cloud");
    });

    it("blocks saving drafts containing 'with responsibilities spanning' scrapings", () => {
      const report = validateDraftQuality({
        subject: "Technical Services Director role · Graphcore",
        body: "Hi Jane,\n\nI came across Graphcore's hiring for a Technical Services Director, with responsibilities spanning engineering labs and data centers.\n\nWe work with engineering teams on enterprise servers to support compute requirements.\n\nAre you evaluating local compute or cloud solutions?\n\nWould you be open to a brief 10-minute conversation next week?\n\nBest,\nAlex",
        accountName: "Graphcore",
        hasReviewedEvidence: true,
      });

      expect(report.valid).toBe(false);
      expect(report.issues.some((i) => i.includes("with responsibilities spanning"))).toBe(true);
    });

    it("validates LinkedIn InMail word count bounds", () => {
      const validReport = validateDraftQuality({
        subject: "Key role · Graphcore",
        body: "Hi Jane,\n\nI saw on Greenhouse that Graphcore is hiring a Technical Services Director for its HPC labs. As these environments evolve, maintaining reliable server capacity becomes critical.\n\nAt Acme Cloud, we work with engineering teams to streamline operations. Are you standardizing on hybrid infrastructure?\n\nWould you be open to connecting briefly to share perspectives?\n\n— Alex",
        accountName: "Graphcore",
        hasReviewedEvidence: true,
        channel: "linkedin_inmail",
      });

      expect(validReport.valid).toBe(true);
      expect(validReport.wordCount).toBeGreaterThanOrEqual(25);
      expect(validReport.wordCount).toBeLessThanOrEqual(160);
    });
  });
});
