import { NormalizedProviderError } from "./types.js";
import type {
  BriefAgentInput,
  BriefAgentResult,
  BriefEventRole,
  BriefInterestsAndEvents,
  BriefOfferPick,
  MeetingType,
  StakeholderBriefContent,
} from "./types.js";
import { AGENT_URL, call, httpUrl, str } from "./exaAgent.js";

/**
 * Stakeholder brief: one Exa Agent run researches a decision maker in public sources and writes a
 * meeting-prep brief in a fixed JSON shape (meeting context, who they are, how they likely evaluate
 * ideas, our offer ranked for them, questions, objections, unknowns). Every point is a working
 * hypothesis for the seller to check, never a verdict on the person.
 */
export const BRIEF_AGENT = {
  /** Fixed price $0.50 per run (Exa effort table) */
  effort: "high",
  /** Must be at least the fixed price; also caps any extra spend */
  maxCostDollars: 1,
} as const;

const MEETING_LABEL: Record<MeetingType, string> = {
  first_meeting: "first meeting",
  informal: "informal meeting (lunch, coffee)",
  follow_up: "follow-up meeting",
  proposal: "proposal or pitch meeting",
  other: "meeting",
};

const ROLE_LABEL: Record<string, string> = {
  decision_maker: "decision maker",
  budget_holder: "budget holder",
};

const S = (description: string) => ({ type: "string", description });
const LIST = (description: string, maxItems = 6) => ({
  type: "array",
  maxItems,
  items: { type: "string" },
  description,
});
const OBJ = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
});
const PICKS = (description: string, maxItems = 3) => ({
  type: "array",
  maxItems,
  description,
  items: OBJ({
    offer: S("Exact name of one of our offers, copied from the list given"),
    why: S("Why this offer fits this person right now, in one or two sentences"),
  }),
});

export function briefOutputSchema() {
  return OBJ({
    meetingContext: OBJ({
      opening: S("The precise commercial opening for this meeting: the specific gap or need, not a broad pitch"),
      posture: S("The posture the seller should take (e.g. extended team, not replacement; practical, not abstract)"),
      centralTension: S("The central tension in this person's situation that we could help with"),
    }),
    whoTheyAre: OBJ({
      summary: S("Their current role, scope and what they lead, from public sources"),
      background: S("Career background and notable achievements, and what they suggest about how they operate"),
      controls: LIST("What they likely control or strongly influence"),
      doesNotControl: LIST("What they likely do not control directly (budgets, approvals, regions)", 5),
    }),
    overlay: OBJ({
      evaluationLens: S("Likely evaluation lens: how they probably judge an idea, and what to lead with because of it"),
      engagementStyle: S("Likely engagement style and how to earn their attention"),
      commercialImplication: S("Commercial implication: how to position our offer against what they have already built"),
      credibilityBuilders: LIST("Things likely to build credibility with them"),
      credibilityRisks: LIST("Things likely to lose credibility with them"),
      howToAdapt: LIST("Short, direct instructions for how the seller should adapt"),
    }),
    theirWorld: OBJ({
      companyPosition: S("Their company's current commercial position, competitors and pressures"),
      gap: S("The gap or transformation challenge this person is dealing with"),
      immediateOpportunity: S("The clearest immediate opportunity for us"),
      otherOpportunities: LIST("Other openings worth noting (e.g. community, events, partnerships)", 3),
    }),
    interestsAndEvents: OBJ({
      visibility: S(
        "How visible this person is in public sources (e.g. frequent speaker, occasional poster, almost no public footprint), so the seller knows how far to trust this section",
      ),
      interests: {
        type: "array",
        maxItems: 6,
        description: "Professional topics they visibly care about: what they speak, write, post or advocate about",
        items: OBJ({
          topic: S("The topic, in a few words"),
          evidence: S("What shows this interest, in one sentence (e.g. gave a keynote on it, writes about it regularly)"),
          url: S("URL of the page that shows it, or an empty string"),
        }),
      },
      upcomingEvents: {
        type: "array",
        maxItems: 6,
        description:
          "Conferences, summits, trade shows, webinars, panels or awards they are likely to attend in the coming months. Only events that have not happened yet.",
        items: OBJ({
          name: S("Event name"),
          date: S("Event date as YYYY-MM-DD, or YYYY-MM if only the month is known"),
          location: S("City and country, or 'Online'"),
          role: { type: "string", enum: ["speaking", "attending", "sponsoring", "likely_attending"], description: "Their role at the event" },
          basis: S(
            "Why we think they will be there (e.g. listed as speaker, their company is sponsoring, they attended the last three years)",
          ),
          url: S("URL of the page that supports this (agenda, speaker list, post)"),
        }),
      },
      recentAppearances: {
        type: "array",
        maxItems: 6,
        description: "Their most recent public talks, podcasts, interviews, articles or panels, newest first",
        items: OBJ({
          title: S("Title of the talk, episode or article"),
          date: S("Date as YYYY-MM-DD or YYYY-MM, or an empty string"),
          kind: S("talk, podcast, interview, article, panel or post"),
          url: S("URL, or an empty string"),
        }),
      },
      conversationHooks: LIST("Short, natural openers the seller could use, each tied to one interest or event above", 4),
    }),
    offerRanking: OBJ({
      leadWith: PICKS("Our offers to lead with, best fit first"),
      supportWith: PICKS("Our offers to bring in as support"),
      holdInReserve: PICKS("Our offers to hold back until later"),
      avoid: LIST("Positioning or asks to avoid with this person", 5),
    }),
    commercialShape: OBJ({
      name: S("Name of the recommended first engagement or pilot"),
      duration: S("Suggested length, e.g. six to eight weeks"),
      steps: LIST("The steps or phases, each a short line"),
      principle: S("The commercial principle behind the shape (e.g. small enough to approve, real enough to prove)"),
    }),
    meetingPlan: OBJ({
      openingApproach: S("How to open the conversation"),
      bridges: LIST("Conversation bridges: short quoted lines the seller could say to move between topics", 4),
      questions: LIST("Questions that would move the opportunity forward", 8),
      signalsToListenFor: LIST("Signals to listen for during the meeting"),
      theAsk: S("The specific ask and next step to close the meeting on"),
    }),
    objections: {
      type: "array",
      maxItems: 6,
      description: "Objections they are likely to raise",
      items: OBJ({
        objection: S("The objection in their words"),
        response: S("How to respond"),
        whatNotToDo: S("What not to do when this comes up"),
      }),
    },
    unknowns: LIST("What we do not know yet and should find out", 8),
    tacticalBrief: OBJ({
      stakeholder: S("One or two sentences on who they are and how they operate"),
      situation: S("One or two sentences on their situation"),
      leadWith: S("What to lead with"),
      supportWith: S("What to support with"),
      doNotLeadWith: S("What not to lead with"),
      bestNextStep: S("The best next step"),
      demonstrationQuestion: S("One thought-provoking question to leave them with"),
    }),
    messageGuide: {
      type: "array",
      maxItems: 6,
      description: "Phrases to use, each paired with the weaker phrase to avoid",
      items: OBJ({ use: S("A phrase to use"), avoid: S("The phrase to avoid instead") }),
    },
    sources: {
      type: "array",
      maxItems: 10,
      description: "Pages this brief is based on",
      items: OBJ({ url: { type: "string", format: "uri" }, title: S("Page title") }),
    },
  });
}

const clip = (v: string | null | undefined, max: number) => (v ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function briefAgentRequest(input: BriefAgentInput, today: Date = new Date()) {
  const { person, company, account, seller, meeting } = input;
  const todayIso = today.toISOString().slice(0, 10);
  const where = [company.name, company.domain ? `(${company.domain})` : "", company.country ? `, ${company.country}` : ""].join(" ").trim();
  const sellerName = seller.company?.trim() || "our company";

  const lines: string[] = [
    `Prepare a meeting-prep stakeholder brief for a seller at ${sellerName} who is meeting ${person.name}` +
      `${person.title ? `, ${person.title}` : ""} at ${where}. They are a likely ${ROLE_LABEL[person.buyingRole] ?? "decision maker"}.`,
    "",
    "Research this person and their company in public sources (company site, news, interviews, talks, " +
      "articles, awards, LinkedIn). Make sure it is the right person at this company.",
  ];
  const known = [...new Set([...(person.linkedinUrl ? [person.linkedinUrl] : []), ...person.sourceUrls])].slice(0, 5);
  if (known.length) lines.push(`Known pages about them: ${known.join(", ")}`);

  lines.push("", "WHAT WE KNOW ABOUT THE ACCOUNT");
  if (account.whyNow) lines.push(`Why now: ${clip(account.whyNow, 600)}`);
  for (const s of account.signals.slice(0, 6)) lines.push(`- Signal: ${clip(s, 200)}`);
  for (const e of account.evidence.slice(0, 6)) {
    lines.push(`- ${clip(e.title, 120) || "Source"}: ${clip(e.excerpt, 240)}${e.url ? ` (${e.url})` : ""}`);
  }

  lines.push("", `OUR OFFER (${sellerName}): ${clip(seller.offering, 300) || "not described"}`);
  if (seller.summary) lines.push(`Who we are: ${clip(seller.summary, 600)}`);
  if (seller.differentiators?.length) {
    lines.push(`What sets us apart: ${seller.differentiators.slice(0, 6).map((d) => clip(d, 200)).join("; ")}`);
  }
  if (seller.customers?.length) {
    lines.push(`Customers and case studies we can mention: ${seller.customers.slice(0, 8).map((c) => clip(c, 100)).join(", ")}`);
  }
  if (seller.website) {
    lines.push(
      `Our website: ${seller.website}. Read it to learn what we really offer (services, sectors, ` +
        "case studies, proof points) and use that to make the fit to this person specific. Do not list it in 'sources'.",
    );
  }
  if (seller.items.length) {
    lines.push("Our products and services (use these exact names in offerRanking):");
    for (const it of seller.items.slice(0, 15)) {
      const extra = [it.bestFor ? `best for: ${clip(it.bestFor, 200)}` : "", it.proofPoints ? `proof: ${clip(it.proofPoints, 200)}` : ""]
        .filter(Boolean)
        .join("; ");
      lines.push(`- ${clip(it.name, 80)}: ${clip(it.description, 300)}${extra ? ` (${extra})` : ""}`);
    }
  } else {
    lines.push("No product list was given: leave offerRanking lists empty and describe fit in prose elsewhere.");
  }

  lines.push(
    "",
    "THE MEETING",
    meeting.auto
      ? "Type: no meeting is booked yet; prepare the seller for a first conversation"
      : `Type: ${MEETING_LABEL[meeting.meetingType]}${meeting.meetingDate ? `, on ${meeting.meetingDate}` : ""}`,
    `Purpose: ${clip(meeting.purpose, 600)}`,
  );
  if (meeting.knownContext) lines.push(`What the seller already knows: ${clip(meeting.knownContext, 2000)}`);

  lines.push(
    "",
    `INTERESTS AND EVENTS (today is ${todayIso})`,
    "Find what this person visibly cares about professionally and where the seller could meet them in person. " +
      "Search conference agendas and speaker lists, webinar and podcast pages, industry awards, trade shows, their posts " +
      "and articles, and the events their company sponsors or exhibits at.",
    `- upcomingEvents: only events after ${todayIso}, ideally in the next six months. Each needs a page that supports it. ` +
      "Use 'speaking' only when they are named on the agenda or speaker list; 'likely_attending' when it is an inference " +
      "(e.g. they went in earlier years, or their company exhibits). Leave the list empty rather than guess.",
    "- recentAppearances: what they have said in public in the last 12 months.",
    "- Keep this to professional activity. Never include personal plans, holidays, family events or home location.",
  );

  lines.push(
    "",
    "RULES",
    "- Write for the seller, in plain, direct British English. Be specific to this person and company; no generic sales advice.",
    "- Every point about how the person thinks or behaves is a working hypothesis from public evidence, phrased as 'likely' or 'appears to'. It is preparation, not a personality diagnosis.",
    "- Use only public, professional information. Never speculate about health, religion, ethnicity, sexuality, politics, family or private life.",
    "- Position our offer as strengthening what they already have built, not replacing it.",
    "- If something cannot be found, say so in 'unknowns' instead of guessing. List the pages you relied on in 'sources'.",
  );

  return {
    query: lines.join("\n"),
    effort: BRIEF_AGENT.effort,
    outputSchema: briefOutputSchema(),
    budget: { maxCostDollars: BRIEF_AGENT.maxCostDollars },
  };
}

// ---------- Parsing: anything malformed is dropped, never guessed ----------

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown, max = 1500) => str(v, max) ?? "";
const texts = (v: unknown, maxItems: number, max = 600) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter((x): x is string => Boolean(x)).slice(0, maxItems) : [];

function picks(v: unknown, offerNames: string[], maxItems: number): BriefOfferPick[] {
  if (!Array.isArray(v)) return [];
  const byLower = new Map(offerNames.map((n) => [n.trim().toLowerCase(), n]));
  const out: BriefOfferPick[] = [];
  for (const raw of v) {
    const p = obj(raw);
    const name = str(p.offer, 120);
    const offer = name ? byLower.get(name.toLowerCase()) : undefined;
    // Only offers that exist in our catalogue; the agent must not invent products
    if (!offer || out.some((o) => o.offer === offer)) continue;
    out.push({ offer, why: text(p.why, 600) });
  }
  return out.slice(0, maxItems);
}

const EVENT_ROLES: readonly BriefEventRole[] = ["speaking", "attending", "sponsoring", "likely_attending"];
const ISO_DAY_OR_MONTH = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

/** Interests, upcoming events and recent appearances. Events must be dated, in the future and sourced. */
export function interestsAndEventsFromOutput(v: unknown, today: Date = new Date()): BriefInterestsAndEvents {
  const r = obj(v);
  const todayDay = today.toISOString().slice(0, 10);
  const todayMonth = todayDay.slice(0, 7);
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);

  const interests: BriefInterestsAndEvents["interests"] = [];
  for (const x of arr(r.interests)) {
    const o = obj(x);
    const topic = text(o.topic, 120);
    if (!topic || interests.some((i) => i.topic.toLowerCase() === topic.toLowerCase())) continue;
    interests.push({ topic, evidence: text(o.evidence, 400), url: httpUrl(o.url) ?? null });
  }

  const upcomingEvents: BriefInterestsAndEvents["upcomingEvents"] = [];
  for (const x of arr(r.upcomingEvents)) {
    const o = obj(x);
    const name = text(o.name, 200);
    const date = text(o.date, 10);
    const url = httpUrl(o.url);
    // No guessing: an event needs a name, a real date and a page that backs it up
    if (!name || !url || !ISO_DAY_OR_MONTH.test(date)) continue;
    // Past events are not "upcoming" (a month-only date counts for the whole month)
    if (date.length === 7 ? date < todayMonth : date < todayDay) continue;
    const role = EVENT_ROLES.includes(o.role as BriefEventRole) ? (o.role as BriefEventRole) : "likely_attending";
    if (upcomingEvents.some((e) => e.name.toLowerCase() === name.toLowerCase() && e.date === date)) continue;
    upcomingEvents.push({ name, date, location: text(o.location, 120), role, basis: text(o.basis, 400), url });
  }
  upcomingEvents.sort((a, b) => a.date.localeCompare(b.date));

  const recentAppearances: BriefInterestsAndEvents["recentAppearances"] = [];
  for (const x of arr(r.recentAppearances)) {
    const o = obj(x);
    const title = text(o.title, 200);
    if (!title) continue;
    const date = text(o.date, 10);
    recentAppearances.push({
      title,
      date: ISO_DAY_OR_MONTH.test(date) ? date : "",
      kind: text(o.kind, 40).toLowerCase(),
      url: httpUrl(o.url) ?? null,
    });
  }

  return {
    visibility: text(r.visibility, 600),
    interests: interests.slice(0, 6),
    upcomingEvents: upcomingEvents.slice(0, 6),
    recentAppearances: recentAppearances.slice(0, 6),
    conversationHooks: texts(r.conversationHooks, 4, 300),
  };
}

export function briefFromAgentOutput(
  structured: unknown,
  offerNames: string[],
  today: Date = new Date(),
): StakeholderBriefContent | null {
  const r = obj(structured);
  if (!Object.keys(r).length) return null;
  const mc = obj(r.meetingContext);
  const who = obj(r.whoTheyAre);
  const ov = obj(r.overlay);
  const tw = obj(r.theirWorld);
  const or = obj(r.offerRanking);
  const cs = obj(r.commercialShape);
  const mp = obj(r.meetingPlan);
  const tb = obj(r.tacticalBrief);

  const objections = (Array.isArray(r.objections) ? r.objections : [])
    .map((x) => {
      const o = obj(x);
      return { objection: text(o.objection, 300), response: text(o.response, 1000), whatNotToDo: text(o.whatNotToDo, 400) };
    })
    .filter((o) => o.objection && o.response)
    .slice(0, 6);

  const messageGuide = (Array.isArray(r.messageGuide) ? r.messageGuide : [])
    .map((x) => {
      const o = obj(x);
      return { use: text(o.use, 300), avoid: text(o.avoid, 300) };
    })
    .filter((m) => m.use)
    .slice(0, 6);

  const sources: StakeholderBriefContent["sources"] = [];
  for (const x of Array.isArray(r.sources) ? r.sources : []) {
    const o = obj(x);
    const url = httpUrl(o.url);
    if (!url || sources.some((s) => s.url === url)) continue;
    sources.push({ url, title: str(o.title, 200) });
  }

  const brief: StakeholderBriefContent = {
    meetingContext: { opening: text(mc.opening), posture: text(mc.posture), centralTension: text(mc.centralTension) },
    whoTheyAre: {
      summary: text(who.summary),
      background: text(who.background),
      controls: texts(who.controls, 8),
      doesNotControl: texts(who.doesNotControl, 6),
    },
    overlay: {
      evaluationLens: text(ov.evaluationLens),
      engagementStyle: text(ov.engagementStyle),
      commercialImplication: text(ov.commercialImplication),
      credibilityBuilders: texts(ov.credibilityBuilders, 8),
      credibilityRisks: texts(ov.credibilityRisks, 8),
      howToAdapt: texts(ov.howToAdapt, 8),
    },
    theirWorld: {
      companyPosition: text(tw.companyPosition),
      gap: text(tw.gap),
      immediateOpportunity: text(tw.immediateOpportunity),
      otherOpportunities: texts(tw.otherOpportunities, 4),
    },
    interestsAndEvents: interestsAndEventsFromOutput(r.interestsAndEvents, today),
    offerRanking: {
      leadWith: picks(or.leadWith, offerNames, 3),
      supportWith: picks(or.supportWith, offerNames, 4),
      holdInReserve: picks(or.holdInReserve, offerNames, 5),
      avoid: texts(or.avoid, 6),
    },
    commercialShape: { name: text(cs.name, 200), duration: text(cs.duration, 100), steps: texts(cs.steps, 8), principle: text(cs.principle) },
    meetingPlan: {
      openingApproach: text(mp.openingApproach),
      bridges: texts(mp.bridges, 5),
      questions: texts(mp.questions, 10),
      signalsToListenFor: texts(mp.signalsToListenFor, 8),
      theAsk: text(mp.theAsk),
    },
    objections,
    unknowns: texts(r.unknowns, 10),
    tacticalBrief: {
      stakeholder: text(tb.stakeholder),
      situation: text(tb.situation),
      leadWith: text(tb.leadWith),
      supportWith: text(tb.supportWith),
      doNotLeadWith: text(tb.doNotLeadWith),
      bestNextStep: text(tb.bestNextStep),
      demonstrationQuestion: text(tb.demonstrationQuestion, 600),
    },
    messageGuide,
    sources: sources.slice(0, 10),
  };
  // A brief with nothing in its core sections is treated as no result
  const hasCore = brief.whoTheyAre.summary || brief.overlay.evaluationLens || brief.meetingPlan.questions.length;
  return hasCore ? brief : null;
}

export async function startBriefAgentRun(apiKey: string, input: BriefAgentInput): Promise<{ runId: string }> {
  const run = await call(apiKey, "POST", AGENT_URL, briefAgentRequest(input));
  const runId = str(run.id, 200);
  if (!runId) throw new NormalizedProviderError("provider_error", "Exa did not return a run id", true);
  return { runId };
}

export async function getBriefAgentRun(apiKey: string, runId: string, offerNames: string[]): Promise<BriefAgentResult> {
  const run = await call(apiKey, "GET", `${AGENT_URL}/${encodeURIComponent(runId)}`);
  const status = String(run.status ?? "");
  const cost = Number((run.costDollars as { total?: unknown } | undefined)?.total);
  const costDollars = Number.isFinite(cost) ? cost : null;
  if (status === "completed") {
    const output = run.output as { structured?: unknown } | undefined;
    return { status: "completed", brief: briefFromAgentOutput(output?.structured, offerNames), costDollars };
  }
  if (status === "failed" || status === "cancelled") {
    const err = run.error as { message?: unknown } | undefined;
    return { status: "failed", message: str(err?.message, 300) ?? `Agent run ${status}`, costDollars };
  }
  return { status: "running" };
}
