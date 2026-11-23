import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  accounts,
  contacts,
  evidence,
  offers,
  researchRuns,
  signals,
  sources,
  stakeholderBriefs,
  type BuyingRole,
} from "../db/schema/index.js";
import { enqueueResearchRun } from "../jobs/queue.js";
import { getResearchProvider } from "../providers/research/index.js";
import type { BriefAgentInput, BriefMeeting, OfferItem, StakeholderBriefContent } from "../providers/research/types.js";
import { newId } from "../utils/ids.js";
import { notFound, validationError } from "../utils/errors.js";
import { writeAudit } from "./audit.js";
import { refundResearchBudget, reserveResearchBudget } from "./budget.js";
import { parseProfile } from "./companyProfile.js";
import { activeSuppressionSet, normalizeSuppressionValue } from "./suppressions.js";

/** A research run in this mode writes a stakeholder brief about one contact. */
export const BRIEF_MODE = "stakeholder_brief";
/** Research units per brief (a deep agent run costs more than a contact search) */
export const BRIEF_RUN_UNITS = 2;
/** Briefs are for the people who decide or hold the budget, as the client's sample brief is */
export const BRIEF_ROLES: readonly BuyingRole[] = ["decision_maker", "budget_holder"];

const ACTIVE = ["queued", "running", "retrying"];

/**
 * Default meeting note when the user runs a role hypothesis without writing one (the "Run role hypothesis"
 * button): prepare for a first conversation. The seller can regenerate with their own note.
 */
export const AUTO_MEETING: BriefMeeting = {
  meetingType: "first_meeting",
  meetingDate: null,
  purpose:
    "First conversation: understand their priorities and the gap they are working on, show how our offer could help, " +
    "and agree one concrete next step.",
  knownContext: null,
  auto: true,
};

type Scope = { tenantId: string; workspaceId: string; accountId: string };

export function briefAgentAvailable() {
  try {
    const p = getResearchProvider();
    return Boolean(p.startBriefAgent && p.getBriefAgent);
  } catch {
    return false;
  }
}

export function parseOfferItems(json: string | null | undefined): OfferItem[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? (v as OfferItem[]).filter((i) => i && typeof i.name === "string" && i.name.trim()) : [];
  } catch {
    return [];
  }
}

async function loadContact(s: Scope, contactId: string) {
  const db = getDb();
  const [contact] = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.id, contactId),
        eq(contacts.accountId, s.accountId),
        eq(contacts.workspaceId, s.workspaceId),
        eq(contacts.tenantId, s.tenantId),
      ),
    )
    .limit(1);
  if (!contact) throw notFound("Contact not found");
  return contact;
}

/**
 * Queue a stakeholder brief for one decision-maker contact. Reserves research units (throws when
 * the monthly quota is used up) and reuses a brief that is already being written.
 */
export async function createStakeholderBrief(
  s: Scope & { contactId: string; actorUserId: string; meeting: BriefMeeting },
): Promise<{ briefId: string; researchRunId: string; reused: boolean }> {
  const db = getDb();
  const contact = await loadContact(s, s.contactId);
  if (!BRIEF_ROLES.includes(contact.buyingRole)) {
    throw validationError("Stakeholder briefs are for decision makers and budget holders. Set the contact's buying role first.");
  }
  if (contact.email) {
    const email = normalizeSuppressionValue(contact.email);
    const suppressed = await activeSuppressionSet(s.workspaceId);
    if (suppressed.has(email) || suppressed.has(email.split("@")[1] ?? "")) {
      throw validationError("This contact has opted out, so no brief can be written about them");
    }
  }

  const [running] = await db
    .select({ id: stakeholderBriefs.id, runId: researchRuns.id })
    .from(stakeholderBriefs)
    .innerJoin(researchRuns, eq(researchRuns.id, stakeholderBriefs.researchRunId))
    .where(and(eq(stakeholderBriefs.contactId, contact.id), inArray(researchRuns.status, ACTIVE)))
    .limit(1);
  if (running) return { briefId: running.id, researchRunId: running.runId, reused: true };

  await reserveResearchBudget(s.tenantId, BRIEF_RUN_UNITS);
  const runId = newId("rr");
  const briefId = newId("sbr");
  try {
    await db.insert(researchRuns).values({
      id: runId,
      tenantId: s.tenantId,
      workspaceId: s.workspaceId,
      accountId: s.accountId,
      mode: BRIEF_MODE,
      query: `Stakeholder brief: ${contact.name}`.slice(0, 1000),
      brief: s.meeting.purpose.slice(0, 2000),
      budgetReserved: BRIEF_RUN_UNITS,
      createdBy: s.actorUserId,
      status: "queued",
    });
    await db.insert(stakeholderBriefs).values({
      id: briefId,
      tenantId: s.tenantId,
      workspaceId: s.workspaceId,
      accountId: s.accountId,
      contactId: contact.id,
      researchRunId: runId,
      meetingJson: JSON.stringify(s.meeting),
      createdBy: s.actorUserId,
    });
    await enqueueResearchRun(runId);
  } catch (err) {
    await refundResearchBudget(s.tenantId, BRIEF_RUN_UNITS);
    await db.update(researchRuns).set({ status: "failed", errorMessage: "Could not queue the brief" }).where(eq(researchRuns.id, runId)).catch(() => {});
    throw err;
  }

  await writeAudit({
    tenantId: s.tenantId,
    workspaceId: s.workspaceId,
    actorUserId: s.actorUserId,
    action: "stakeholder_brief.requested",
    entityType: "contact",
    entityId: contact.id,
    metadata: { accountId: s.accountId, briefId, meetingType: s.meeting.meetingType },
  });
  return { briefId, researchRunId: runId, reused: false };
}

const briefColumns = {
  id: stakeholderBriefs.id,
  contactId: stakeholderBriefs.contactId,
  accountId: stakeholderBriefs.accountId,
  researchRunId: stakeholderBriefs.researchRunId,
  meetingJson: stakeholderBriefs.meetingJson,
  contentJson: stakeholderBriefs.contentJson,
  createdBy: stakeholderBriefs.createdBy,
  createdAt: stakeholderBriefs.createdAt,
  completedAt: stakeholderBriefs.completedAt,
  status: researchRuns.status,
  progressPct: researchRuns.progressPct,
  errorMessage: researchRuns.errorMessage,
};

function present<T extends { meetingJson: string; contentJson: string | null }>(r: T) {
  const { meetingJson, contentJson, ...rest } = r;
  return {
    ...rest,
    meeting: JSON.parse(meetingJson) as BriefMeeting,
    content: contentJson ? (JSON.parse(contentJson) as StakeholderBriefContent) : null,
  };
}

/** All briefs for a contact, newest first (the first one is the current brief). */
export async function listBriefs(s: Scope & { contactId: string }) {
  await loadContact(s, s.contactId);
  const rows = await getDb()
    .select(briefColumns)
    .from(stakeholderBriefs)
    .innerJoin(researchRuns, eq(researchRuns.id, stakeholderBriefs.researchRunId))
    .where(
      and(
        eq(stakeholderBriefs.contactId, s.contactId),
        eq(stakeholderBriefs.accountId, s.accountId),
        eq(stakeholderBriefs.workspaceId, s.workspaceId),
        eq(stakeholderBriefs.tenantId, s.tenantId),
      ),
    )
    .orderBy(desc(stakeholderBriefs.createdAt))
    .limit(20);
  return rows.map(present);
}

/** Status of each contact's latest brief on an account, for the People panel. */
export async function latestBriefStatuses(s: Scope): Promise<Map<string, { status: string; briefId: string }>> {
  const rows = await getDb()
    .select({ contactId: stakeholderBriefs.contactId, id: stakeholderBriefs.id, status: researchRuns.status, createdAt: stakeholderBriefs.createdAt })
    .from(stakeholderBriefs)
    .innerJoin(researchRuns, eq(researchRuns.id, stakeholderBriefs.researchRunId))
    .where(
      and(
        eq(stakeholderBriefs.accountId, s.accountId),
        eq(stakeholderBriefs.workspaceId, s.workspaceId),
        eq(stakeholderBriefs.tenantId, s.tenantId),
      ),
    )
    .orderBy(desc(stakeholderBriefs.createdAt));
  const out = new Map<string, { status: string; briefId: string }>();
  for (const r of rows) {
    const prior = out.get(r.contactId);
    // Show "ready" while a newer brief is still being written, so the old one stays reachable
    if (!prior) out.set(r.contactId, { status: r.status, briefId: r.id });
    else if (ACTIVE.includes(prior.status) && r.status === "completed") prior.status = "completed_refreshing";
  }
  return out;
}

const URL_IN_TEXT = /https?:\/\/[^\s)>\]]+/g;

/** Everything the agent needs about the person, the account and our offer. Used by the job. */
export async function buildBriefInput(briefId: string): Promise<{ input: BriefAgentInput; offerNames: string[] } | null> {
  const db = getDb();
  const [brief] = await db.select().from(stakeholderBriefs).where(eq(stakeholderBriefs.id, briefId)).limit(1);
  if (!brief) return null;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, brief.contactId)).limit(1);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, brief.accountId)).limit(1);
  if (!contact || !account) return null;

  const [offer] = await db.select().from(offers).where(eq(offers.workspaceId, brief.workspaceId)).limit(1);
  const items = parseOfferItems(offer?.offerItemsJson);
  const profile = parseProfile(offer?.companyProfileJson);

  const personUrls: string[] = [...(contact.sourceNote?.match(URL_IN_TEXT) ?? [])];
  if (contact.evidenceId) {
    const [src] = await db
      .select({ url: sources.canonicalUrl })
      .from(evidence)
      .innerJoin(sources, eq(sources.id, evidence.sourceId))
      .where(eq(evidence.id, contact.evidenceId))
      .limit(1);
    if (src) personUrls.unshift(src.url);
  }
  const linkedinUrl = personUrls.find((u) => /linkedin\.com\/in\//i.test(u)) ?? null;

  const [sigRows, evRows] = await Promise.all([
    db
      .select({ kind: signals.kind, fact: signals.observedFact })
      .from(signals)
      .where(eq(signals.accountId, account.id))
      .orderBy(desc(signals.createdAt))
      .limit(6),
    db
      .select({ title: sources.title, excerpt: evidence.excerpt, url: sources.canonicalUrl })
      .from(evidence)
      .innerJoin(sources, eq(sources.id, evidence.sourceId))
      .where(eq(evidence.accountId, account.id))
      .orderBy(desc(evidence.createdAt))
      .limit(6),
  ]);

  return {
    offerNames: items.map((i) => i.name),
    input: {
      person: {
        name: contact.name,
        title: contact.title,
        buyingRole: contact.buyingRole,
        linkedinUrl,
        sourceUrls: [...new Set(personUrls)].slice(0, 5),
      },
      company: { name: account.name, domain: account.domain, country: account.country },
      account: {
        whyNow: account.whyNowText,
        signals: sigRows.map((r) => [r.kind, r.fact].filter(Boolean).join(": ")).filter(Boolean),
        evidence: evRows,
      },
      seller: {
        company: offer?.sellerCompany ?? null,
        website: offer?.sellerWebsite ?? null,
        offering: offer?.offering ?? "",
        items,
        summary: profile?.summary ?? null,
        differentiators: profile?.differentiators ?? [],
        customers: profile?.customers ?? [],
      },
      meeting: JSON.parse(brief.meetingJson) as BriefMeeting,
    },
  };
}
