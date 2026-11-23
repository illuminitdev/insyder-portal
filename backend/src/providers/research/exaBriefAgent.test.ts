import { describe, expect, it } from "vitest";
import { BRIEF_AGENT, briefAgentRequest, briefFromAgentOutput } from "./exaBriefAgent.js";
import type { BriefAgentInput } from "./types.js";
import { AUTO_MEETING } from "../../services/stakeholderBriefs.js";

const input: BriefAgentInput = {
  person: {
    name: "Larisa Lucaciu",
    title: "UK&I Business Transformation Leader",
    buyingRole: "decision_maker",
    linkedinUrl: "https://www.linkedin.com/in/example",
    sourceUrls: ["https://news.example.com/lenovo-vector"],
  },
  company: { name: "Lenovo", domain: "lenovo.com", country: "GB" },
  account: {
    whyNow: "Project Vector brings infrastructure into the PC channel.",
    signals: ["expansion: new UK partner programme"],
    evidence: [{ title: "Lenovo channel news", excerpt: "Partners asked to sell AI infrastructure", url: "https://news.example.com/a" }],
  },
  seller: {
    company: "Coterie",
    offering: "Sales enablement for channel sellers",
    items: [
      { name: "Meeting preparation", description: "Overnight buyer-specific meeting packs and role-play" },
      { name: "Coterie Connect", description: "Community events, webinars and podcasts", bestFor: "relationship building" },
    ],
  },
  meeting: { meetingType: "informal", meetingDate: "2026-11-20", purpose: "Lunch to discuss the pilot", knownContext: "She liked role-play" },
};

describe("Exa Agent stakeholder brief", () => {
  it("tells the agent about the person, the account, our offer and the meeting, with a cost cap", () => {
    const req = briefAgentRequest(input);
    expect(req.query).toContain("Larisa Lucaciu, UK&I Business Transformation Leader at Lenovo (lenovo.com)");
    expect(req.query).toContain("seller at Coterie");
    expect(req.query).toContain("- Meeting preparation: Overnight buyer-specific meeting packs");
    expect(req.query).toContain("best for: relationship building");
    expect(req.query).toContain("informal meeting (lunch, coffee), on 2026-11-20");
    expect(req.query).toContain("What the seller already knows: She liked role-play");
    expect(req.query).toContain("Project Vector");
    // Guardrails: hypotheses only, no sensitive personal traits
    expect(req.query).toMatch(/working hypothesis/);
    expect(req.query).toMatch(/Never speculate about health, religion/);
    expect(req.effort).toBe(BRIEF_AGENT.effort);
    expect(req.budget.maxCostDollars).toBe(BRIEF_AGENT.maxCostDollars);
    const props = req.outputSchema.properties as Record<string, unknown>;
    for (const k of [
      "meetingContext",
      "whoTheyAre",
      "overlay",
      "theirWorld",
      "offerRanking",
      "commercialShape",
      "meetingPlan",
      "objections",
      "unknowns",
      "tacticalBrief",
      "messageGuide",
      "sources",
    ]) {
      expect(props[k]).toBeDefined();
    }
  });

  it("prepares for a first conversation when written automatically", () => {
    const req = briefAgentRequest({ ...input, meeting: { ...AUTO_MEETING } });
    expect(req.query).toContain("no meeting is booked yet");
    expect(req.query).not.toContain("informal meeting");
    expect(req.query).toContain("Purpose: First conversation");
  });

  it("says when no product list was given", () => {
    const req = briefAgentRequest({ ...input, seller: { company: null, offering: "", items: [] } });
    expect(req.query).toContain("No product list was given");
    expect(req.query).toContain("seller at our company");
  });

  it("asks the agent to read our website when one is set", () => {
    const withSite = briefAgentRequest({ ...input, seller: { ...input.seller, website: "https://coterie.example" } });
    expect(withSite.query).toContain("Our website: https://coterie.example");
    expect(briefAgentRequest(input).query).not.toContain("Our website:");
  });

  it("keeps known offers only, drops bad sources and empty items", () => {
    const brief = briefFromAgentOutput(
      {
        whoTheyAre: { summary: "Leads Project Vector", background: "Ex-Cisco", controls: ["Operating model", "", 4], doesNotControl: [] },
        overlay: { evaluationLens: "Likely judges ideas by behaviour change", credibilityBuilders: ["Specific examples"] },
        offerRanking: {
          leadWith: [
            { offer: "meeting preparation", why: "Fits the gap" },
            { offer: "AI platform", why: "Invented" },
            { offer: "Meeting preparation", why: "Duplicate" },
          ],
          supportWith: [{ offer: "Coterie Connect", why: "Community" }],
          avoid: ["Annual retainer"],
        },
        meetingPlan: { questions: ["What has changed?"] },
        objections: [{ objection: "We have tools", response: "We do not duplicate them", whatNotToDo: "Argue" }, { objection: "", response: "x" }],
        messageGuide: [{ use: "One partner scenario", avoid: "Full capabilities deck" }, { avoid: "orphan" }],
        sources: [{ url: "https://lenovo.com/news", title: "News" }, { url: "javascript:alert(1)" }, { url: "https://lenovo.com/news" }],
      },
      ["Meeting preparation", "Coterie Connect"],
    );
    expect(brief).not.toBeNull();
    expect(brief!.whoTheyAre.controls).toEqual(["Operating model"]);
    expect(brief!.offerRanking.leadWith).toEqual([{ offer: "Meeting preparation", why: "Fits the gap" }]);
    expect(brief!.offerRanking.supportWith[0]?.offer).toBe("Coterie Connect");
    expect(brief!.objections).toHaveLength(1);
    expect(brief!.messageGuide).toHaveLength(1);
    expect(brief!.sources).toHaveLength(1);
    // Missing sections come back empty, never undefined
    expect(brief!.tacticalBrief.bestNextStep).toBe("");
    expect(brief!.commercialShape.steps).toEqual([]);
  });

  it("treats empty output as no brief", () => {
    expect(briefFromAgentOutput(null, [])).toBeNull();
    expect(briefFromAgentOutput({ sources: [] }, [])).toBeNull();
  });
});
