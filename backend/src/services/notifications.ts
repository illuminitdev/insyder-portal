import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  acceptanceDecisions,
  accounts,
  auditEvents,
  changeEvents,
  crmMappings,
  handoffAccess,
  handoffs,
  notificationReads,
  tasks,
} from "../db/schema/index.js";
import { hasCapability, type Capability } from "../auth/permissions.js";
import { accountScope, type MembershipContext } from "../middleware/requireMembership.js";
import { newId } from "../utils/ids.js";

/** One thing inside a bell group, linking straight to where it's handled */
export type NotificationEntry = { label: string; href: string };

/**
 * One bell entry. `times` holds when each underlying thing happened (newest first), so the
 * browser can show how many are new since this person last looked. `href` is a page path
 * inside their own portal ("/accounts/qualify"); the portal prefix is added in the browser.
 * `entries` names up to three of the actual leads/tasks, each with its own link.
 */
export type NotificationItem = {
  key: string;
  kind: "tasks" | "review" | "returned" | "decided" | "shared" | "handoff_reply" | "changes" | "accepted";
  label: string;
  detail: string | null;
  href: string;
  count: number;
  times: string[];
  entries: NotificationEntry[];
  /** A quieter line (e.g. the shared review queue): shown, but never counted as new */
  quiet?: boolean;
};

/** Recent events (e.g. partner replies) are shown for this long; queues (open work) always show. */
const RECENT_DAYS = 30;
/** Monitor changes are news, not work: only the last week */
const CHANGE_DAYS = 7;
const MAX_TIMES = 50;
const MAX_ENTRIES = 3;

const TASK_LABELS: Record<string, string> = {
  research: "Research",
  review: "Sales review",
  call: "Call",
  email: "Email",
  follow_up: "Follow-up",
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const timesOf = (dates: Array<Date | null | undefined>) =>
  dates
    .map(iso)
    .filter((t): t is string => Boolean(t))
    .sort()
    .reverse()
    .slice(0, MAX_TIMES);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const detail = (id: string, step?: string) => `/accounts/detail?id=${id}${step ? `&step=${step}` : ""}`;

/** Newest first, one entry per account */
function entriesOf<T extends { accountId: string | null; at: Date | null }>(
  rows: T[],
  label: (r: T) => string,
  href: (r: T) => string,
): NotificationEntry[] {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .filter((r) => {
      if (!r.accountId || seen.has(r.accountId)) return false;
      seen.add(r.accountId);
      return true;
    })
    .slice(0, MAX_ENTRIES)
    .map((r) => ({ label: label(r), href: href(r) }));
}

/** Start a query only when the member's role needs it; otherwise an empty result. */
function when<T>(needed: boolean, query: PromiseLike<T[]>): Promise<T[]> {
  return needed ? Promise.resolve(query) : Promise.resolve([]);
}

/**
 * In-app notifications for one member, built from live records and their role's permissions.
 * Nothing is sent anywhere (no email): this only tells people what is waiting in their portal.
 */
export async function notificationsFor(m: MembershipContext, email: string): Promise<NotificationItem[]> {
  const db = getDb();
  const can = (cap: Capability) => hasCapability(m.role, cap);
  const since = new Date(Date.now() - RECENT_DAYS * 86400000);
  const items: NotificationItem[] = [];
  const ws = and(eq(tasks.tenantId, m.tenantId), eq(tasks.workspaceId, m.workspaceId));

  // Every group's query starts here, so they run in parallel: each one is a round trip to the
  // database, and one after another they made the bell (loaded on every page) slow.

  // My open tasks, with the account each is about
  const minePromise = when(
    can("view_tasks"),
    db
      .select({
        id: tasks.id,
        accountId: tasks.accountId,
        name: accounts.name,
        state: accounts.acceptanceState,
        createdAt: tasks.createdAt,
        dueAt: tasks.dueAt,
        type: tasks.type,
        createdBy: tasks.createdBy,
      })
      .from(tasks)
      .leftJoin(accounts, eq(tasks.accountId, accounts.id))
      .where(and(ws, eq(tasks.ownerUserId, m.userId), inArray(tasks.status, ["open", "in_progress"]))),
  );
  // Reviewers: the team review queue
  const queuePromise = when(
    can("accept"),
    db
      .select({ accountId: accounts.id, name: accounts.name, at: accounts.updatedAt })
      .from(accounts)
      .where(and(accountScope(m), eq(accounts.acceptanceState, "ready_for_review"))),
  );
  // Researchers: decisions on briefs I sent
  const sentByMe = db
    .select({ accountId: acceptanceDecisions.accountId })
    .from(acceptanceDecisions)
    .where(
      and(
        eq(acceptanceDecisions.workspaceId, m.workspaceId),
        eq(acceptanceDecisions.actorUserId, m.userId),
        eq(acceptanceDecisions.toState, "ready_for_review"),
      ),
    );
  const decisionsPromise = when(
    can("submit_review") && !can("accept"),
    db
      .select({
        accountId: acceptanceDecisions.accountId,
        name: accounts.name,
        state: accounts.acceptanceState,
        toState: acceptanceDecisions.toState,
        reason: acceptanceDecisions.reasonDetail,
        at: acceptanceDecisions.createdAt,
      })
      .from(acceptanceDecisions)
      .innerJoin(accounts, eq(acceptanceDecisions.accountId, accounts.id))
      .where(
        and(
          eq(acceptanceDecisions.workspaceId, m.workspaceId),
          inArray(acceptanceDecisions.toState, ["accepted", "rejected", "needs_research"]),
          ne(acceptanceDecisions.actorUserId, m.userId),
          gte(acceptanceDecisions.createdAt, since),
          inArray(acceptanceDecisions.accountId, sentByMe),
        ),
      ),
  );
  // Partners: accounts shared with me
  const sharedPromise = when(
    can("acknowledge_handoff") && !can("view_accounts"),
    db
      .select({ id: handoffs.id, sharedAt: handoffs.sharedAt, name: accounts.name })
      .from(handoffAccess)
      .innerJoin(handoffs, eq(handoffAccess.handoffId, handoffs.id))
      .leftJoin(accounts, eq(handoffs.accountId, accounts.id))
      .where(
        and(
          eq(handoffAccess.workspaceId, m.workspaceId),
          eq(handoffAccess.granteeEmail, email.toLowerCase()),
          isNull(handoffAccess.revokedAt),
          eq(handoffs.state, "shared"),
        ),
      ),
  );
  // Reviewers / admins: partner replies to handoffs
  const repliesPromise = when(
    can("handoff"),
    db
      .select({ action: auditEvents.action, at: auditEvents.createdAt, accountId: handoffs.accountId, name: accounts.name })
      .from(auditEvents)
      .innerJoin(handoffs, eq(auditEvents.entityId, handoffs.id))
      .leftJoin(accounts, eq(handoffs.accountId, accounts.id))
      .where(
        and(
          eq(auditEvents.tenantId, m.tenantId),
          eq(auditEvents.workspaceId, m.workspaceId),
          inArray(auditEvents.action, ["handoff.acknowledged", "handoff.returned"]),
          gte(auditEvents.createdAt, since),
        ),
      )
      .orderBy(desc(auditEvents.createdAt)),
  );
  // Monitors found new changes: last week, and (except for the admin) only on my accounts
  const changeSince = new Date(Date.now() - CHANGE_DAYS * 86400000);
  const onMyAccounts =
    m.role === "tenant_admin"
      ? isNotNull(changeEvents.accountId)
      : or(
          eq(accounts.ownerUserId, m.userId),
          sql`exists (select 1 from ${tasks} where ${tasks.accountId} = ${changeEvents.accountId} and ${tasks.ownerUserId} = ${m.userId})`,
        );
  const changesPromise = when(
    can("view_accounts") && can("discover"),
    db
      .select({ at: changeEvents.discoveredAt, accountId: changeEvents.accountId, title: changeEvents.title, name: accounts.name })
      .from(changeEvents)
      .innerJoin(accounts, eq(changeEvents.accountId, accounts.id))
      .where(
        and(
          eq(changeEvents.tenantId, m.tenantId),
          eq(changeEvents.workspaceId, m.workspaceId),
          gte(changeEvents.discoveredAt, changeSince),
          eq(changeEvents.material, true),
          onMyAccounts,
        ),
      ),
  );
  // Tenant admin: accepted leads not yet in the CRM
  const sentIds = db
    .select({ id: crmMappings.entityId })
    .from(crmMappings)
    .where(
      and(
        eq(crmMappings.workspaceId, m.workspaceId),
        eq(crmMappings.entityType, "account"),
        inArray(crmMappings.syncStatus, ["queued", "synced"]),
      ),
    );
  const readyPromise = when(
    can("manage_integrations"),
    db
      .select({ accountId: accounts.id, name: accounts.name, at: accounts.updatedAt })
      .from(accounts)
      .where(and(accountScope(m), eq(accounts.acceptanceState, "accepted"), notInArray(accounts.id, sentIds))),
  );
  // Analysts: newly accepted briefs
  const acceptedPromise = when(
    can("view_reports") && !can("view_accounts"),
    db
      .select({ createdAt: acceptanceDecisions.createdAt })
      .from(acceptanceDecisions)
      .where(
        and(
          eq(acceptanceDecisions.tenantId, m.tenantId),
          eq(acceptanceDecisions.workspaceId, m.workspaceId),
          eq(acceptanceDecisions.toState, "accepted"),
          gte(acceptanceDecisions.createdAt, since),
        ),
      ),
  );
  const [mine, queueRows, decisions, shared, replies, changes, ready, accepted] = await Promise.all([
    minePromise,
    queuePromise,
    decisionsPromise,
    sharedPromise,
    repliesPromise,
    changesPromise,
    readyPromise,
    acceptedPromise,
  ]);

  // Work handed to me (review tasks have their own group below, so they're not counted twice)
  const assigned = mine.filter((t) => t.createdBy !== m.userId && !(t.type === "review" && can("accept")));
  if (assigned.length) {
    const research = assigned.filter((t) => t.type === "research").length;
    items.push({
      key: "tasks_assigned",
      kind: "tasks",
      label: assigned.length === 1 ? "A task was assigned to you" : `${assigned.length} tasks assigned to you`,
      detail: research ? `${research} research ${plural(research, "lead")} to qualify` : null,
      href: research && can("submit_review") ? "/accounts/qualify" : "/outreach/work",
      count: assigned.length,
      times: timesOf(assigned.map((t) => t.createdAt)),
      entries: entriesOf(
        assigned.map((t) => ({ ...t, at: t.createdAt })),
        (t) => `${TASK_LABELS[t.type] ?? t.type} · ${t.name ?? "Account"}`,
        (t) => (t.type === "research" && can("submit_review") ? `/accounts/qualify?account=${t.accountId}` : detail(t.accountId!, "tasks")),
      ),
    });
  }

  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const overdue = mine.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < startOfToday);
  if (overdue.length) {
    items.push({
      key: "tasks_overdue",
      kind: "tasks",
      label: `${overdue.length} of your tasks ${overdue.length === 1 ? "is" : "are"} overdue`,
      detail: null,
      href: "/outreach/tasks",
      count: overdue.length,
      times: timesOf(overdue.map((t) => t.dueAt)),
      entries: entriesOf(
        overdue.map((t) => ({ ...t, at: t.dueAt })),
        (t) => `${TASK_LABELS[t.type] ?? t.type} · ${t.name ?? "Account"}`,
        (t) => detail(t.accountId!, "tasks"),
      ),
    });
  }

  // Reviewers: briefs sent to me by name, then the rest of the team queue (quieter)
  if (can("accept")) {
    const toMe = mine.filter((t) => t.type === "review" && t.state === "ready_for_review");
    if (toMe.length) {
      items.push({
        key: "review_assigned",
        kind: "review",
        label: `${toMe.length} ${plural(toMe.length, "brief")} sent to you for review`,
        detail: "Accept, return or reject each one",
        href: "/accounts/review",
        count: toMe.length,
        times: timesOf(toMe.map((t) => t.createdAt)),
        entries: entriesOf(
          toMe.map((t) => ({ ...t, at: t.createdAt })),
          (t) => t.name ?? "Account",
          (t) => detail(t.accountId!, "decision"),
        ),
      });
    }
    const mineIds = new Set(toMe.map((t) => t.accountId));
    const queue = queueRows.filter((a) => !mineIds.has(a.accountId));
    if (queue.length) {
      items.push({
        key: "review_queue",
        kind: "review",
        label: `${queue.length} other ${plural(queue.length, "brief")} waiting in the team queue`,
        detail: "Sent to another reviewer, or to nobody in particular",
        href: "/accounts/sales-acceptance",
        count: queue.length,
        times: timesOf(queue.map((a) => a.at)),
        entries: entriesOf(queue, (a) => a.name, (a) => detail(a.accountId, "decision")),
        quiet: true,
      });
    }
  }

  // Researchers: what the reviewer decided on briefs I sent
  if (can("submit_review") && !can("accept")) {
    // A return only counts while the lead is still waiting on me
    const returned = decisions.filter((d) => d.toState === "needs_research" && d.state === "needs_research");
    const decided = decisions.filter((d) => d.toState !== "needs_research");
    if (returned.length) {
      items.push({
        key: "briefs_returned",
        kind: "returned",
        label: `${returned.length} ${plural(returned.length, "brief was", "briefs were")} returned to you`,
        detail: "The reviewer asked for more research",
        href: "/accounts/qualify",
        count: returned.length,
        times: timesOf(returned.map((d) => d.at)),
        entries: entriesOf(
          returned,
          (d) => `${d.name}${d.reason ? `: ${d.reason.slice(0, 60)}` : ""}`,
          (d) => detail(d.accountId, "evidence"),
        ),
      });
    }
    if (decided.length) {
      const accepted = decided.filter((d) => d.toState === "accepted").length;
      items.push({
        key: "briefs_decided",
        kind: "decided",
        label: `${decided.length} of your ${plural(decided.length, "brief")} got a decision`,
        detail: `${accepted} accepted, ${decided.length - accepted} rejected`,
        href: "/accounts/qualify",
        count: decided.length,
        times: timesOf(decided.map((d) => d.at)),
        entries: entriesOf(
          decided,
          (d) => `${d.toState === "accepted" ? "Accepted" : "Rejected"} · ${d.name}`,
          (d) => detail(d.accountId, "decision"),
        ),
      });
    }
  }

  // Partners: accounts shared with me that I haven't answered yet
  if (can("acknowledge_handoff") && !can("view_accounts")) {
    if (shared.length) {
      items.push({
        key: "handoffs_shared",
        kind: "shared",
        label: `${shared.length} ${plural(shared.length, "account was", "accounts were")} shared with you`,
        detail: "Acknowledge or return each one",
        href: "/shared",
        count: shared.length,
        times: timesOf(shared.map((h) => h.sharedAt)),
        entries: shared.slice(0, MAX_ENTRIES).map((h) => ({ label: h.name ?? "Shared account", href: `/shared/handoff?id=${h.id}` })),
      });
    }
  }

  // Reviewers / admins: partners acknowledged or returned a handoff
  if (can("handoff")) {
    if (replies.length) {
      const returnedCount = replies.filter((r) => r.action === "handoff.returned").length;
      items.push({
        key: "handoff_replies",
        kind: "handoff_reply",
        label: `${replies.length} partner ${plural(replies.length, "reply", "replies")} to handoffs`,
        detail: `${replies.length - returnedCount} acknowledged, ${returnedCount} returned`,
        href: detail(replies[0]!.accountId, "handoff"),
        count: replies.length,
        times: timesOf(replies.map((r) => r.at)),
        entries: entriesOf(
          replies,
          (r) => `${r.action === "handoff.returned" ? "Returned" : "Acknowledged"} · ${r.name ?? "Account"}`,
          (r) => detail(r.accountId!, "handoff"),
        ),
      });
    }
  }

  // Monitors found new changes
  if (can("view_accounts") && can("discover")) {
    if (changes.length) {
      items.push({
        key: "monitor_changes",
        kind: "changes",
        label: `${changes.length} new ${plural(changes.length, "change")} on ${m.role === "tenant_admin" ? "watched" : "your"} accounts`,
        detail: `Found by monitors in the last ${CHANGE_DAYS} days`,
        href: "/accounts/monitors",
        count: changes.length,
        times: timesOf(changes.map((c) => c.at)),
        entries: entriesOf(changes, (c) => `${c.name}: ${c.title.slice(0, 60)}`, (c) => detail(c.accountId!, "evidence")),
      });
    }
  }

  // Tenant admin: accepted leads waiting to be sent to the CRM
  if (can("manage_integrations")) {
    if (ready.length) {
      items.push({
        key: "crm_ready",
        kind: "accepted",
        label: `${ready.length} accepted ${plural(ready.length, "lead")} ready to send to the CRM`,
        detail: "Reviewed and accepted, not in the CRM yet",
        href: "/accounts/crm",
        count: ready.length,
        times: timesOf(ready.map((a) => a.at)),
        entries: entriesOf(ready, (a) => a.name, (a) => detail(a.accountId, "crm")),
      });
    }
  }

  // Analysts: newly accepted briefs (the result they report on)
  if (can("view_reports") && !can("view_accounts")) {
    if (accepted.length) {
      items.push({
        key: "accepted_recent",
        kind: "accepted",
        label: `${accepted.length} ${plural(accepted.length, "brief")} accepted in the last ${RECENT_DAYS} days`,
        detail: "See the outcomes report",
        href: "/reports/outcomes",
        count: accepted.length,
        times: timesOf(accepted.map((d) => d.createdAt)),
        entries: [],
      });
    }
  }

  return items;
}

/* ---------- read / cleared state, kept on the server ---------- */

export type NotificationState = { seenAt: Record<string, string>; clearedAt: Record<string, string> };

export async function notificationState(m: MembershipContext): Promise<NotificationState> {
  const rows = await getDb()
    .select()
    .from(notificationReads)
    .where(and(eq(notificationReads.workspaceId, m.workspaceId), eq(notificationReads.userId, m.userId)));
  const state: NotificationState = { seenAt: {}, clearedAt: {} };
  for (const r of rows) {
    if (r.seenAt) state.seenAt[r.key] = r.seenAt.toISOString();
    if (r.clearedAt) state.clearedAt[r.key] = r.clearedAt.toISOString();
  }
  return state;
}

/** Mark bell groups read, or clear them (clearing also marks them read) */
export async function markNotifications(m: MembershipContext, keys: string[], action: "read" | "clear") {
  const db = getDb();
  const now = new Date();
  for (const key of keys) {
    const set = action === "clear" ? { seenAt: now, clearedAt: now, updatedAt: now } : { seenAt: now, updatedAt: now };
    await db
      .insert(notificationReads)
      .values({ id: newId("ntr"), tenantId: m.tenantId, workspaceId: m.workspaceId, userId: m.userId, key, ...set })
      .onConflictDoUpdate({
        target: [notificationReads.workspaceId, notificationReads.userId, notificationReads.key],
        set,
      });
  }
  return notificationState(m);
}
