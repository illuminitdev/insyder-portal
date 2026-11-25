import { describe, expect, it } from "vitest";
import { BRIEF_AGENT, briefAgentRequest, briefFromAgentOutput, interestsAndEventsFromOutput } from "./exaBriefAgent.js";
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

  it("asks for interests and upcoming events relative to today, professional only", () => {
    const req = briefAgentRequest(input, new Date("2026-11-25T10:00:00Z"));
    expect(req.query).toContain("INTERESTS AND EVENTS (today is 2026-11-25)");
    expect(req.query).toContain("only events after 2026-11-25");
    expect(req.query).toMatch(/Never include personal plans/);
    expect((req.outputSchema.properties as Record<string, unknown>).interestsAndEvents).toBeDefined();
  });

  it("keeps only dated, sourced, future events and tidies interests", () => {
    const today = new Date("2026-11-25T10:00:00Z");
    const ie = interestsAndEventsFromOutput(
      {
        visibility: "Frequent conference speaker",
        interests: [
          { topic: "Channel enablement", evidence: "Keynote at Canalys", url: "https://example.com/talk" },
          { topic: "channel enablement", evidence: "duplicate" },
          { topic: "AI adoption", evidence: "Posts weekly", url: "not a url" },
          { topic: "" },
        ],
        upcomingEvents: [
          { name: "Canalys Forum EMEA", date: "2027-03", location: "Barcelona", role: "speaking", basis: "On the agenda", url: "https://example.com/agenda" },
          { name: "Partner Summit", date: "2026-12-02", location: "London", role: "weird", basis: "Company sponsors", url: "https://example.com/ps" },
          { name: "Past Expo", date: "2026-10-01", url: "https://example.com/past" },
          { name: "This month", date: "2026-11", url: "https://example.com/nov" },
          { name: "No source", date: "2027-01-10" },
          { name: "Fuzzy date", date: "Spring 2027", url: "https://example.com/f" },
        ],
        recentAppearances: [{ title: "Podcast ep 12", date: "last year", kind: "Podcast", url: "https://example.com/p" }, { title: "" }],
        conversationHooks: ["Saw your Canalys talk on enablement", ""],
      },
      today,
    );
    expect(ie.visibility).toBe("Frequent conference speaker");
    expect(ie.interests.map((i) => i.topic)).toEqual(["Channel enablement", "AI adoption"]);
    expect(ie.interests[1]!.url).toBeNull();
    // Sorted by date; past, unsourced and undated events dropped; unknown role falls back to an inference
    expect(ie.upcomingEvents.map((e) => e.name)).toEqual(["This month", "Partner Summit", "Canalys Forum EMEA"]);
    expect(ie.upcomingEvents[1]!.role).toBe("likely_attending");
    expect(ie.upcomingEvents[2]!.role).toBe("speaking");
    expect(ie.recentAppearances).toEqual([{ title: "Podcast ep 12", date: "", kind: "podcast", url: "https://example.com/p" }]);
    expect(ie.conversationHooks).toEqual(["Saw your Canalys talk on enablement"]);
  });

  it("returns an empty interests section when the agent gives none", () => {
    const brief = briefFromAgentOutput({ whoTheyAre: { summary: "Leads sales" } }, []);
    expect(brief!.interestsAndEvents).toEqual({ visibility: "", interests: [], upcomingEvents: [], recentAppearances: [], conversationHooks: [] });
  });

  it("treats empty output as no brief", () => {
    expect(briefFromAgentOutput(null, [])).toBeNull();
    expect(briefFromAgentOutput({ sources: [] }, [])).toBeNull();
  });
});
