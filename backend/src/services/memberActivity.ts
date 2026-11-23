import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "../db/client.js";
import { acceptanceDecisions, accounts, activities, evidence, memberships, researchRuns, tasks, users } from "../db/schema/index.js";
import type { MembershipContext } from "../middleware/requireMembership.js";
import { notFound } from "../utils/errors.js";

const OPEN_TASK = ["open", "in_progress"] as const;
const TIMELINE_LIMIT = 30;

export type TimelineEvent = {
  at: string;
  kind:
    | "research_run"
    | "evidence_reviewed"
    | "brief_submitted"
    | "accepted"
    | "returned"
    | "rejected"
    | "task_completed"
    | "task_cancelled";
  accountId: string | null;
  accountName: string | null;
  detail: string | null;
  status?: string;
};

/**
 * What one member of the workspace is working on, for the tenant admin's Reports page:
 * their open tasks, the research they're running, and a timeline of recent work. Workspace-scoped only.
 */
export async function memberActivity(m: MembershipContext, workspaceId: string, userId: string) {
  const db = getDb();
  const scope = (t: { workspaceId: AnyPgColumn; tenantId: AnyPgColumn }) =>
    and(eq(t.workspaceId, workspaceId), eq(t.tenantId, m.tenantId));

  const roleRows = await db
    .select({ role: memberships.role, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId), isNull(memberships.revokedAt)));
  if (!roleRows.length) throw notFound("That person isn't a member of this workspace");

  const [openTasks, runs, reviewed, decisions, acts] = await Promise.all([
    db
      .select({
        id: tasks.id,
        type: tasks.type,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        instruction: tasks.instruction,
        accountId: tasks.accountId,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(and(scope(tasks), eq(tasks.ownerUserId, userId), inArray(tasks.status, [...OPEN_TASK])))
      .orderBy(tasks.dueAt),
    db
      .select({
        id: researchRuns.id,
        mode: researchRuns.mode,
        status: researchRuns.status,
        query: researchRuns.query,
        brief: researchRuns.brief,
        accountId: researchRuns.accountId,
        progressPct: researchRuns.progressPct,
        createdAt: researchRuns.createdAt,
      })
      .from(researchRuns)
      .where(and(scope(researchRuns), eq(researchRuns.createdBy, userId)))
      .orderBy(desc(researchRuns.createdAt))
      .limit(TIMELINE_LIMIT),
    db
      .select({ accountId: evidence.accountId, at: evidence.reviewedAt })
      .from(evidence)
      .where(and(scope(evidence), eq(evidence.reviewedBy, userId)))
      .orderBy(desc(evidence.reviewedAt))
      .limit(TIMELINE_LIMIT),
    db
      .select({
        accountId: acceptanceDecisions.accountId,
        toState: acceptanceDecisions.toState,
        reason: acceptanceDecisions.reasonDetail,
        reasonCategory: acceptanceDecisions.reasonCategory,
        at: acceptanceDecisions.createdAt,
      })
      .from(acceptanceDecisions)
      .where(and(scope(acceptanceDecisions), eq(acceptanceDecisions.actorUserId, userId)))
      .orderBy(desc(acceptanceDecisions.createdAt))
      .limit(TIMELINE_LIMIT),
    db
      .select({ accountId: activities.accountId, kind: activities.kind, note: activities.note, at: activities.createdAt })
      .from(activities)
      .where(
        and(scope(activities), eq(activities.actorUserId, userId), inArray(activities.kind, ["task_completed", "task_cancelled"])),
      )
      .orderBy(desc(activities.createdAt))
      .limit(TIMELINE_LIMIT),
  ]);

  // Account names for everything above, in one query
  const ids = [
    ...new Set(
      [...openTasks, ...runs, ...reviewed, ...decisions, ...acts].map((r) => r.accountId).filter((x): x is string => Boolean(x)),
    ),
  ];
  const names = new Map(
    ids.length
      ? (
          await db
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(and(scope(accounts), inArray(accounts.id, ids)))
        ).map((a) => [a.id, a.name])
      : [],
  );
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const timeline: TimelineEvent[] = [];
  for (const r of runs) {
    timeline.push({
      at: r.createdAt.toISOString(),
      kind: "research_run",
      accountId: r.accountId,
      accountName: nameOf(r.accountId),
      detail: r.mode === "account" ? "Account research" : (r.brief || r.query || null),
      status: r.status,
    });
  }
  // Evidence reviews come in bursts; one entry per account per day reads better than ten identical lines
  const reviewGroups = new Map<string, { at: Date; accountId: string; n: number }>();
  for (const e of reviewed) {
    if (!e.at) continue;
    const key = `${e.accountId}|${e.at.toISOString().slice(0, 10)}`;
    const g = reviewGroups.get(key);
    if (g) g.n++;
    else reviewGroups.set(key, { at: e.at, accountId: e.accountId, n: 1 });
  }
  for (const g of reviewGroups.values()) {
    timeline.push({
      at: g.at.toISOString(),
      kind: "evidence_reviewed",
      accountId: g.accountId,
      accountName: nameOf(g.accountId),
      detail: `${g.n} source${g.n === 1 ? "" : "s"} reviewed`,
    });
  }
  for (const d of decisions) {
    const kind =
      d.toState === "ready_for_review"
        ? "brief_submitted"
        : d.toState === "accepted"
          ? "accepted"
          : d.toState === "needs_research"
            ? "returned"
            : d.toState === "rejected"
              ? "rejected"
              : null;
    if (!kind) continue;
    timeline.push({
      at: d.at.toISOString(),
      kind,
      accountId: d.accountId,
      accountName: nameOf(d.accountId),
      detail: d.reason || d.reasonCategory || null,
    });
  }
  for (const a of acts) {
    timeline.push({
      at: a.at.toISOString(),
      kind: a.kind === "task_completed" ? "task_completed" : "task_cancelled",
      accountId: a.accountId,
      accountName: nameOf(a.accountId),
      detail: a.note,
    });
  }
  timeline.sort((x, y) => y.at.localeCompare(x.at));

  const now = Date.now();
  const active = runs.filter((r) => r.status === "queued" || r.status === "running");
  return {
    member: {
      userId,
      name: roleRows[0]!.name,
      email: roleRows[0]!.email,
      roles: [...new Set(roleRows.map((r) => r.role))],
    },
    lastActiveAt: timeline[0]?.at ?? null,
    summary: {
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((t) => t.dueAt && t.dueAt.getTime() < now).length,
      inProgressTasks: openTasks.filter((t) => t.status === "in_progress").length,
      researchRunning: active.length,
    },
    openTasks: openTasks.map((t) => ({
      ...t,
      dueAt: t.dueAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      accountName: nameOf(t.accountId),
      overdue: Boolean(t.dueAt && t.dueAt.getTime() < now),
    })),
    researchInProgress: active.map((r) => ({
      id: r.id,
      mode: r.mode,
      status: r.status,
      progressPct: r.progressPct,
      accountId: r.accountId,
      accountName: nameOf(r.accountId),
      label: r.mode === "account" ? "Account research" : (r.brief || r.query || "Search"),
      createdAt: r.createdAt.toISOString(),
    })),
    timeline: timeline.slice(0, TIMELINE_LIMIT),
  };
}
