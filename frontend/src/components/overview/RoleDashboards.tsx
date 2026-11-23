"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Inbox,
  ListTodo,
  Percent,
  RotateCcw,
  Search,
  Share2,
  TrendingUp,
  Users,
} from "lucide-react";
import { PortalLink as Link } from "../layout/PortalLink";
import { StatusBadge } from "../common/StatusBadge";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useWorkspace } from "../../hooks/useWorkspace";
import { getPipeline, listAccounts, listPeople, type Account, type PipelineRow } from "../../lib/api/accounts";
import { listTasks, TASK_TYPE_LABELS, type Task } from "../../lib/api/tasks";
import { listDrafts } from "../../lib/api/drafts";
import { getOutcomes } from "../../lib/api/settings";
import { listSharedHandoffs } from "../../lib/api/handoffs";
import { formatMoney, OPPORTUNITY_STAGE_LABELS, OPPORTUNITY_STAGES } from "../../lib/api/opportunities";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import { humanize } from "../ui/Field";
import { formatDate } from "../../lib/utils/dates";
import {
  Avatar,
  BarList,
  byUrgency,
  daysSince,
  DashboardHeader,
  dueLabel,
  Empty,
  Funnel,
  Grid,
  isActive,
  isDueToday,
  isOverdue,
  List,
  ListRow,
  Loading,
  Panel,
  ScorePill,
  StatRow,
  StatTile,
  useSource,
} from "./DashboardKit";

const accountHref = (id: string, step?: string) => `/accounts/detail?id=${id}${step ? `&step=${step}` : ""}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Count of a list (optionally filtered), keeping undefined = loading and null = unavailable */
function len<T>(xs: T[] | null | undefined, f?: (x: T) => boolean): number | null | undefined {
  return xs == null ? xs : f ? xs.filter(f).length : xs.length;
}
const pct = (r: number | null | undefined) => (r == null ? null : `${Math.round(r * 100)}%`);

function useAccounts(ws: string, enabled = true) {
  return useSource(enabled ? () => listAccounts(ws).then((r) => r.accounts) : null, [ws, enabled]);
}
function useTasks(ws: string, enabled = true) {
  return useSource(enabled ? () => listTasks(ws).then((r) => r.tasks) : null, [ws, enabled]);
}
function usePipeline(ws: string, enabled = true) {
  return useSource(enabled ? () => getPipeline(ws).then((r) => r.rows) : null, [ws, enabled]);
}
function useOutcomes(ws: string, enabled = true) {
  return useSource(enabled ? () => getOutcomes(ws) : null, [ws, enabled]);
}

/* ---------- shared panels ---------- */

function TaskList({
  tasks,
  accountNames,
  ownerNames,
  limit = 6,
  empty = "Nothing on your list. Nice.",
}: {
  tasks: Task[] | null | undefined;
  accountNames: Map<string, string>;
  ownerNames?: Map<string, string>;
  limit?: number;
  empty?: string;
}) {
  if (tasks === undefined) return <Loading />;
  const rows = byUrgency(tasks ?? []).slice(0, limit);
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <List>
      {rows.map((t) => (
        <ListRow
          key={t.id}
          href={accountHref(t.accountId, "tasks")}
          marker={isOverdue(t) ? "red" : isDueToday(t) ? "amber" : null}
          title={`${TASK_TYPE_LABELS[t.type]} · ${accountNames.get(t.accountId) ?? "Account"}`}
          meta={[
            dueLabel(t),
            ownerNames ? ownerNames.get(t.ownerUserId) : null,
            t.instruction,
          ]
            .filter(Boolean)
            .join(" · ")}
          right={
            t.priority === "urgent" || t.priority === "high" ? (
              <Badge tone={t.priority === "urgent" ? "red" : "amber"}>{t.priority === "urgent" ? "Urgent" : "High"}</Badge>
            ) : (
              <StatusBadge status={t.status} />
            )
          }
        />
      ))}
    </List>
  );
}

function LeadList({
  accounts,
  limit = 6,
  empty,
  step,
  meta,
}: {
  accounts: Account[] | null | undefined;
  limit?: number;
  empty: string;
  step?: string;
  meta?: (a: Account) => string;
}) {
  if (accounts === undefined) return <Loading />;
  const rows = (accounts ?? []).slice(0, limit);
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <List>
      {rows.map((a) => (
        <ListRow
          key={a.id}
          href={accountHref(a.id, step)}
          title={a.name}
          meta={meta ? meta(a) : [a.domain, a.country].filter(Boolean).join(" · ") || "No domain"}
          right={
            <span className="flex items-center gap-2">
              <StatusBadge status={a.acceptanceState} />
              <ScorePill score={a.fitScore} />
            </span>
          }
        />
      ))}
    </List>
  );
}

function PipelineStages({ rows }: { rows: PipelineRow[] | null | undefined }) {
  if (rows === undefined) return <Loading />;
  const counts = new Map<string, number>();
  for (const r of rows ?? []) if (r.opportunity) counts.set(r.opportunity.stage, (counts.get(r.opportunity.stage) ?? 0) + 1);
  return (
    <BarList
      rows={OPPORTUNITY_STAGES.map((s) => ({ label: OPPORTUNITY_STAGE_LABELS[s], value: counts.get(s) ?? 0 }))}
      empty="No deals recorded yet. Deals are added on accepted accounts."
    />
  );
}

const topLeads = (accounts: Account[] | null | undefined) =>
  accounts
    ? accounts
        .filter((a) => a.researchState === "researched" && a.acceptanceState !== "rejected")
        .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
    : accounts;

/* ---------- Tenant admin ---------- */

export function AdminDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const { currency } = useWorkspace();
  const accounts = useAccounts(ws);
  const tasks = useTasks(ws);
  const pipeline = usePipeline(ws);
  const outcomes = useOutcomes(ws);
  const people = useSource(() => listPeople(ws).then((r) => r.people), [ws]);

  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const ownerNames = new Map((people ?? []).map((p) => [p.userId, p.name]));
  const count = (f: (a: Account) => boolean) => (accounts ? accounts.filter(f).length : accounts);
  const active = tasks ? tasks.filter(isActive) : tasks;
  const overdue = tasks ? tasks.filter(isOverdue) : tasks;
  const waiting = count((a) => a.acceptanceState === "ready_for_review");
  const opp = outcomes?.metrics?.opportunities;
  const money = (n: number) => formatMoney(n, outcomes?.currency ?? currency);

  // Team workload: live task counts per member, plus their activity this period
  const report = new Map((outcomes?.admin?.team ?? []).map((m) => [m.userId, m]));
  const team = (people ?? [])
    .filter((p) => p.role !== "partner")
    .map((p) => {
      const mine = (tasks ?? []).filter((t) => t.ownerUserId === p.userId);
      const r = report.get(p.userId);
      return {
        ...p,
        open: mine.filter(isActive).length,
        overdue: mine.filter(isOverdue).length,
        done: r?.tasksCompleted ?? 0,
        briefs: r?.briefsSubmitted ?? 0,
        decisions: r?.reviewerDecisions ?? 0,
        evidence: r?.evidenceReviewed ?? 0,
      };
    })
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const maxOpen = Math.max(1, ...team.map((m) => m.open));

  // Things that need someone's attention now
  const attention = [
    ...(overdue ?? []).slice(0, 4).map((t) => ({
      key: t.id,
      href: accountHref(t.accountId, "tasks"),
      marker: "red" as const,
      title: `${TASK_TYPE_LABELS[t.type]} overdue · ${names.get(t.accountId) ?? "Account"}`,
      meta: `${ownerNames.get(t.ownerUserId) ?? "Unassigned"} · ${dueLabel(t)}`,
    })),
    ...(accounts ?? [])
      .filter((a) => a.acceptanceState === "ready_for_review")
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, 3)
      .map((a) => ({
        key: a.id,
        href: accountHref(a.id, "decision"),
        marker: daysSince(a.updatedAt) >= 3 ? ("red" as const) : ("amber" as const),
        title: `Waiting for sales review · ${a.name}`,
        meta: `Waiting ${plural(daysSince(a.updatedAt), "day")}`,
      })),
    ...(accounts ?? [])
      .filter((a) => a.acceptanceState === "needs_research")
      .slice(0, 3)
      .map((a) => ({
        key: `${a.id}-r`,
        href: accountHref(a.id, "evidence"),
        marker: "amber" as const,
        title: `Returned for more research · ${a.name}`,
        meta: "A reviewer asked for more evidence",
      })),
  ];

  const usage = outcomes?.admin?.usage;

  return (
    <div>
      <DashboardHeader
        subtitle="Everything happening in this workspace"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/members">
              <Button>
                <Users size={15} strokeWidth={1.75} className="mr-1.5" aria-hidden />
                Members
              </Button>
            </Link>
            <Link href="/discover/assign">
              <Button variant="primary">Find prospects</Button>
            </Link>
          </>
        }
      />

      <StatRow>
        <StatTile
          label="Leads in workspace"
          value={len(accounts)}
          hint={accounts ? `${count((a) => a.researchState === "researched")} researched` : undefined}
          Icon={Briefcase}
          href="/accounts/watchlist"
        />
        <StatTile
          label="Waiting for sales review"
          value={waiting}
          hint={waiting ? "Briefs need a decision" : "Queue is clear"}
          tone={waiting ? "amber" : "default"}
          Icon={ClipboardCheck}
          href="/accounts/sales-acceptance"
        />
        <StatTile
          label="Accepted leads"
          value={count((a) => a.acceptanceState === "accepted")}
          hint={pct(outcomes?.metrics?.acceptanceRate) ? `${pct(outcomes?.metrics?.acceptanceRate)} acceptance rate` : undefined}
          tone="green"
          Icon={BadgeCheck}
          href="/accounts/pipeline"
        />
        <StatTile
          label="Open tasks"
          value={len(active)}
          hint={overdue ? (overdue.length ? `${overdue.length} overdue` : "Nothing overdue") : undefined}
          tone={overdue?.length ? "red" : "default"}
          Icon={ListTodo}
          href="/outreach/tasks"
        />
      </StatRow>

      <Grid cols="lg:grid-cols-[1.25fr_1fr]">
        <Panel title="Lead funnel" subtitle="How far leads have moved, from added to accepted" href="/accounts/watchlist">
          {accounts === undefined ? (
            <Loading />
          ) : (
            <Funnel
              stages={[
                { label: "Added", value: accounts?.length ?? 0, href: "/accounts/watchlist" },
                { label: "Researched", value: count((a) => a.researchState === "researched") ?? 0 },
                { label: "Sent for review", value: count((a) => a.acceptanceState !== "draft") ?? 0, href: "/accounts/sales-acceptance" },
                { label: "Accepted", value: count((a) => a.acceptanceState === "accepted") ?? 0, href: "/accounts/pipeline" },
              ]}
            />
          )}
        </Panel>
        <Panel title="Pipeline" subtitle="Deals on accepted accounts" href="/accounts/pipeline">
          <div className="mb-4 grid grid-cols-3 gap-3">
            {[
              { l: "Open deals", v: opp ? String(opp.open) : "—" },
              { l: "Open value", v: opp ? money(opp.openValue) : "—" },
              { l: "Won", v: opp ? money(opp.wonValue) : "—" },
            ].map((x) => (
              <div key={x.l} className="rounded-[10px] bg-[var(--chip-bg)] px-3 py-2.5">
                <p className="text-[11.5px] text-[var(--muted)]">{x.l}</p>
                <p className="mt-0.5 truncate text-[16px] font-semibold tabular-nums">{x.v}</p>
              </div>
            ))}
          </div>
          <PipelineStages rows={pipeline} />
        </Panel>
      </Grid>

      <Grid cols="grid-cols-1">
        <Panel title="Team workload" subtitle="Live open tasks per member, with their activity this period" href="/members" linkLabel="Manage members">
          {people === undefined || tasks === undefined ? (
            <Loading />
          ) : !team.length ? (
            <Empty>No members yet. Invite your team from Members.</Empty>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-5 pb-2 font-semibold">Member</th>
                    <th className="px-3 pb-2 font-semibold">Open tasks</th>
                    <th className="px-3 pb-2 text-right font-semibold">Overdue</th>
                    <th className="px-3 pb-2 text-right font-semibold">Tasks done</th>
                    <th className="px-3 pb-2 text-right font-semibold">Evidence reviewed</th>
                    <th className="px-3 pb-2 text-right font-semibold">Briefs sent</th>
                    <th className="px-5 pb-2 text-right font-semibold">Decisions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {team.map((m) => (
                    <tr key={m.userId} className="hover:bg-[var(--table-head)]">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={m.name} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{m.name}</p>
                            <p className="text-[11.5px] text-[var(--muted)]">{ROLE_LABELS[m.role] ?? m.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2" title={`${m.open} open tasks`}>
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--chip-bg)]">
                            <div className="h-full rounded-full bg-[var(--navy)]" style={{ width: `${(m.open / maxOpen) * 100}%` }} />
                          </div>
                          <span className="font-semibold tabular-nums">{m.open}</span>
                        </div>
                      </td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${m.overdue ? "font-semibold text-[var(--danger)]" : "text-[var(--muted)]"}`}>
                        {m.overdue}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.done}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.evidence}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{m.briefs}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">{m.decisions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Needs attention" subtitle="Overdue work, briefs waiting on a decision and returned leads">
          {accounts === undefined || tasks === undefined ? (
            <Loading />
          ) : attention.length ? (
            <List>
              {attention.map(({ key, ...a }) => (
                <ListRow key={key} {...a} />
              ))}
            </List>
          ) : (
            <Empty>All clear. Nothing is overdue or waiting.</Empty>
          )}
        </Panel>
        <Panel title="Top leads" subtitle="Researched accounts ranked by priority" href="/discover/assign" linkLabel="Find more">
          <LeadList accounts={topLeads(accounts)} empty="No researched leads yet." />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Recent tasks across the team" href="/outreach/tasks">
          <TaskList tasks={tasks} accountNames={names} ownerNames={ownerNames} empty="No open tasks in the workspace." />
        </Panel>
        <Panel title="Research usage" subtitle="This month's research runs against the workspace limit" href="/settings/usage">
          {outcomes === undefined ? (
            <Loading />
          ) : usage ? (
            <div className="py-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[28px] font-semibold tabular-nums">
                  {usage.usedMonthly}
                  <span className="text-[15px] font-normal text-[var(--muted)]"> / {usage.quotaMonthly}</span>
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {Math.max(usage.quotaMonthly - usage.usedMonthly, 0)} left
                </p>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--chip-bg)]">
                <div
                  className={`h-full rounded-full ${usage.usedMonthly / Math.max(usage.quotaMonthly, 1) > 0.85 ? "bg-[var(--brand)]" : "bg-[var(--navy)]"}`}
                  style={{ width: `${Math.min((usage.usedMonthly / Math.max(usage.quotaMonthly, 1)) * 100, 100)}%` }}
                />
              </div>
              {usage.periodStart ? <p className="mt-2 text-xs text-[var(--muted)]">Since {formatDate(usage.periodStart)}</p> : null}
            </div>
          ) : (
            <Empty>Usage isn&apos;t available.</Empty>
          )}
        </Panel>
      </Grid>
    </div>
  );
}

/* ---------- Researcher ---------- */

export function ResearcherDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const accounts = useAccounts(ws);
  const tasks = useTasks(ws);
  const outcomes = useOutcomes(ws);
  const r = outcomes?.researcher;
  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const filter = (f: (a: Account) => boolean) => (accounts ? accounts.filter(f) : accounts);
  const returned = filter((a) => a.acceptanceState === "needs_research");
  const toQualify = filter((a) => a.researchState === "researched" && a.acceptanceState === "draft")?.sort(
    (a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0),
  );
  const toResearch = filter((a) => a.researchState === "unresearched");
  const active = tasks?.filter(isActive);
  const overdue = tasks?.filter(isOverdue);

  return (
    <div>
      <DashboardHeader
        subtitle="Your research and qualification work"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/outreach/work">
              <Button>Work my tasks</Button>
            </Link>
            <Link href="/discover/assign">
              <Button variant="primary">Find leads</Button>
            </Link>
          </>
        }
      />
      <StatRow>
        <StatTile
          label="My open tasks"
          value={len(active)}
          hint={overdue ? (overdue.length ? `${overdue.length} overdue` : "Nothing overdue") : undefined}
          tone={overdue?.length ? "red" : "default"}
          Icon={ListTodo}
          href="/outreach/work"
        />
        <StatTile
          label="Returned to research"
          value={len(returned)}
          hint={returned?.length ? "Reviewers asked for more" : "None returned"}
          tone={returned?.length ? "amber" : "default"}
          Icon={RotateCcw}
        />
        <StatTile
          label="Ready to qualify"
          value={len(toQualify)}
          hint="Researched, not sent yet"
          Icon={Search}
          href="/accounts/qualify"
        />
        <StatTile
          label="My briefs accepted"
          value={r ? r.submittedAccepted : outcomes === undefined ? undefined : null}
          hint={r ? `${r.submittedAwaitingDecision} waiting for a decision` : undefined}
          tone="green"
          Icon={BadgeCheck}
          href="/reports/outcomes"
        />
      </StatRow>

      <Grid>
        <Panel title="My tasks" subtitle="Overdue first, then by due date" href="/outreach/work" linkLabel="Work them">
          <TaskList tasks={tasks} accountNames={names} />
        </Panel>
        <Panel title="Returned for more research" subtitle="Fix what the reviewer asked, then send again">
          <LeadList accounts={returned} step="evidence" empty="Nothing returned. Good work." />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Ready to qualify" subtitle="Researched leads, best first" href="/accounts/qualify">
          <LeadList accounts={toQualify} step="qualify" empty="No researched leads waiting. Research a few from your watchlist." />
        </Panel>
        <Panel title="My results this period" href="/reports/outcomes" linkLabel="Full report">
          {outcomes === undefined ? (
            <Loading />
          ) : r ? (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                {[
                  { l: "Research runs", v: r.researchRuns },
                  { l: "Evidence reviewed", v: r.evidenceReviewed },
                  { l: "Briefs sent", v: r.briefsSubmitted },
                ].map((x) => (
                  <div key={x.l} className="rounded-[10px] bg-[var(--chip-bg)] px-3 py-2.5">
                    <p className="text-[11.5px] text-[var(--muted)]">{x.l}</p>
                    <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{x.v}</p>
                  </div>
                ))}
              </div>
              <BarList
                rows={[
                  { label: "Accepted", value: r.submittedAccepted },
                  { label: "Waiting for a decision", value: r.submittedAwaitingDecision },
                  { label: "Returned", value: r.submittedReturned },
                  { label: "Rejected", value: r.submittedRejected },
                ]}
                empty="Send your first brief to see how reviewers decide."
              />
            </>
          ) : (
            <Empty>Your report isn&apos;t available.</Empty>
          )}
        </Panel>
      </Grid>

      {toResearch?.length ? (
        <Grid cols="grid-cols-1">
          <Panel title="Not researched yet" subtitle="Leads on the watchlist with no research run" href="/accounts/watchlist">
            <LeadList accounts={toResearch} step="research" empty="" limit={5} />
          </Panel>
        </Grid>
      ) : null}
    </div>
  );
}

/* ---------- Sales reviewer ---------- */

export function ReviewerDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const accounts = useAccounts(ws);
  const tasks = useTasks(ws);
  const pipeline = usePipeline(ws);
  const outcomes = useOutcomes(ws);
  const r = outcomes?.reviewer;
  const names = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const queue = accounts
    ?.filter((a) => a.acceptanceState === "ready_for_review")
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const oldest = queue?.length ? daysSince(queue[0].updatedAt) : 0;

  return (
    <div>
      <DashboardHeader
        subtitle="Briefs to decide and the pipeline they feed"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/accounts/review">
            <Button variant="primary">Review a brief</Button>
          </Link>
          </>
        }
      />
      <StatRow>
        <StatTile
          label="Waiting for review"
          value={len(queue)}
          hint={queue?.length ? `Oldest waiting ${plural(oldest, "day")}` : "Queue is clear"}
          tone={oldest >= 3 ? "red" : queue?.length ? "amber" : "default"}
          Icon={Inbox}
          href="/accounts/sales-acceptance"
        />
        <StatTile label="Accepted" value={r?.accepted ?? (outcomes === undefined ? undefined : null)} hint="This period" tone="green" Icon={BadgeCheck} />
        <StatTile label="Returned or rejected" value={r ? r.returned + r.rejected : outcomes === undefined ? undefined : null} hint={r ? `${r.returned} returned · ${r.rejected} rejected` : undefined} Icon={RotateCcw} />
        <StatTile label="Acceptance rate" value={pct(r?.acceptanceRate) ?? (outcomes === undefined ? undefined : null)} hint={r ? `${plural(r.accountsDecided, "account")} decided` : undefined} Icon={Percent} href="/reports/outcomes" />
      </StatRow>

      <Grid>
        <Panel title="Review queue" subtitle="Oldest first" href="/accounts/sales-acceptance">
          {queue === undefined ? (
            <Loading />
          ) : queue?.length ? (
            <List>
              {queue.slice(0, 7).map((a) => (
                <ListRow
                  key={a.id}
                  href={accountHref(a.id, "decision")}
                  marker={daysSince(a.updatedAt) >= 3 ? "red" : "amber"}
                  title={a.name}
                  meta={`Waiting ${plural(daysSince(a.updatedAt), "day")}`}
                  right={<ScorePill score={a.fitScore} />}
                />
              ))}
            </List>
          ) : (
            <Empty>No briefs waiting. The queue is clear.</Empty>
          )}
        </Panel>
        <Panel title="Pipeline by stage" subtitle="Deals on accepted accounts" href="/accounts/pipeline">
          <PipelineStages rows={pipeline} />
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Why briefs were returned or rejected" subtitle="This period">
          {outcomes === undefined ? (
            <Loading />
          ) : (
            <BarList
              rows={Object.entries(r?.reasons ?? {})
                .map(([k, v]) => ({ label: humanize(k), value: v }))
                .sort((a, b) => b.value - a.value)}
              empty="No returns or rejections this period."
            />
          )}
        </Panel>
        <Panel title="My tasks" href="/outreach/work">
          <TaskList tasks={tasks} accountNames={names} />
        </Panel>
      </Grid>

      {r && r.handoffsPrepared ? (
        <Grid cols="grid-cols-1">
          <Panel title="Partner handoffs" subtitle="Where shared accounts stand">
            <BarList rows={Object.entries(r.handoffsByState).map(([k, v]) => ({ label: humanize(k), value: v }))} />
          </Panel>
        </Grid>
      ) : null}
    </div>
  );
}

/* ---------- SDR ---------- */

export function SdrDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const tasks = useTasks(ws);
  const pipeline = usePipeline(ws);
  const outcomes = useOutcomes(ws);
  const drafts = useSource(() => listDrafts(ws).then((r) => r.drafts), [ws]);
  const s = outcomes?.sdr;
  const names = new Map((pipeline ?? []).map((p) => [p.accountId, p.name]));
  const today = tasks?.filter((t) => isOverdue(t) || isDueToday(t));
  const pending = drafts?.filter((d) => !d.approvedAt);
  const approved = drafts?.filter((d) => d.approvedAt);

  return (
    <div>
      <DashboardHeader
        subtitle="Your calls, emails and follow-ups"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/outreach/work">
            <Button variant="primary">Start working</Button>
          </Link>
          </>
        }
      />
      <StatRow>
        <StatTile
          label="Overdue"
          value={len(tasks, isOverdue)}
          hint="Do these first"
          tone={tasks?.some(isOverdue) ? "red" : "default"}
          Icon={AlertTriangle}
          href="/outreach/work"
        />
        <StatTile label="Due today" value={len(tasks, isDueToday)} tone="amber" Icon={CalendarClock} href="/outreach/work" />
        <StatTile label="Open tasks" value={len(tasks, isActive)} hint={s ? `${s.inProgressTasks} in progress` : undefined} Icon={ListTodo} href="/outreach/tasks" />
        <StatTile label="Completed" value={outcomes === undefined ? undefined : (s?.completedTasks ?? null)} hint="This period" tone="green" Icon={CheckCircle2} />
      </StatRow>

      <Grid>
        <Panel title="Today's work" subtitle="Overdue and due today" href="/outreach/work" linkLabel="Work them">
          <TaskList tasks={today} accountNames={names} empty="Nothing due today. Check your upcoming tasks." />
        </Panel>
        <Panel title="My accounts" subtitle="Assigned accounts and their next action" href="/accounts/pipeline">
          {pipeline === undefined ? (
            <Loading />
          ) : pipeline?.length ? (
            <List>
              {pipeline.slice(0, 7).map((p) => (
                <ListRow
                  key={p.accountId}
                  href={accountHref(p.accountId)}
                  title={p.name}
                  meta={p.nextAction ?? "No next action set"}
                  right={
                    p.opportunity ? (
                      <span className="text-[12px] font-semibold text-[var(--muted)]">{OPPORTUNITY_STAGE_LABELS[p.opportunity.stage]}</span>
                    ) : (
                      <StatusBadge status={p.acceptanceState} />
                    )
                  }
                />
              ))}
            </List>
          ) : (
            <Empty>No accounts assigned to you yet.</Empty>
          )}
        </Panel>
      </Grid>

      <Grid>
        <Panel title="Drafts" subtitle="Drafts never send anything. Approve after checking." href="/outreach/drafts">
          {drafts === undefined ? (
            <Loading />
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-[10px] bg-[var(--chip-bg)] px-3 py-2.5">
                  <p className="text-[11.5px] text-[var(--muted)]">Waiting for approval</p>
                  <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{pending?.length ?? 0}</p>
                </div>
                <div className="rounded-[10px] bg-[var(--chip-bg)] px-3 py-2.5">
                  <p className="text-[11.5px] text-[var(--muted)]">Approved</p>
                  <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{approved?.length ?? 0}</p>
                </div>
              </div>
              {pending?.length ? (
                <List>
                  {pending.slice(0, 4).map((d) => (
                    <ListRow key={d.id} href={`/outreach/drafts?account=${d.accountId}`} title={d.subject || "Untitled draft"} meta={`${d.accountName} · ${d.channel}`} />
                  ))}
                </List>
              ) : null}
            </>
          )}
        </Panel>
        <Panel title="What I completed" subtitle="By task type, this period" href="/reports/outcomes">
          {outcomes === undefined ? (
            <Loading />
          ) : (
            <BarList
              rows={Object.entries(s?.completedByType ?? {}).map(([k, v]) => ({
                label: TASK_TYPE_LABELS[k as Task["type"]] ?? humanize(k),
                value: v,
              }))}
              empty="Complete a task to see your activity here."
            />
          )}
        </Panel>
      </Grid>
    </div>
  );
}

/* ---------- Analyst ---------- */

export function AnalystDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const { currency } = useWorkspace();
  const outcomes = useOutcomes(ws);
  const m = outcomes?.metrics;
  const b = outcomes?.breakdowns;
  const money = (n: number) => formatMoney(n, outcomes?.currency ?? currency);
  const wait = outcomes === undefined ? undefined : null;
  const bars = (rec: Record<string, number> | undefined, label = humanize) =>
    Object.entries(rec ?? {})
      .map(([k, v]) => ({ label: label(k), value: v }))
      .sort((x, y) => y.value - x.value);

  return (
    <div>
      <DashboardHeader
        subtitle="Workspace outcomes, read-only"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/reports/outcomes">
            <Button variant="primary">Open full report</Button>
          </Link>
          </>
        }
      />
      <StatRow>
        <StatTile label="Accounts reviewed" value={m?.uniqueResearchReviewedAccounts ?? wait} hint="With reviewed research" Icon={Search} />
        <StatTile label="Sales-accepted" value={m?.explicitSalesAccepted ?? wait} tone="green" Icon={BadgeCheck} />
        <StatTile label="Acceptance rate" value={pct(m?.acceptanceRate) ?? wait} hint={outcomes ? `${outcomes.denominators?.accountsWithReviewerDecision ?? 0} decided` : undefined} Icon={Percent} />
        <StatTile label="Open pipeline" value={m ? money(m.opportunities.openValue) : wait} hint={m ? `${m.opportunities.open} open · ${money(m.opportunities.wonValue)} won` : undefined} Icon={TrendingUp} />
      </StatRow>
      <Grid>
        <Panel title="Opportunity stages">
          {outcomes === undefined ? (
            <Loading />
          ) : (
            <BarList
              rows={OPPORTUNITY_STAGES.map((s) => ({ label: OPPORTUNITY_STAGE_LABELS[s], value: b?.opportunityStages?.[s] ?? 0 }))}
              empty="No deals recorded this period."
            />
          )}
        </Panel>
        <Panel title="Activity by task type">
          {outcomes === undefined ? (
            <Loading />
          ) : (
            <BarList rows={bars(b?.activityByTaskType, (k) => TASK_TYPE_LABELS[k as Task["type"]] ?? humanize(k))} empty="No completed activity this period." />
          )}
        </Panel>
      </Grid>
      <Grid>
        <Panel title="Rejection reasons">
          {outcomes === undefined ? <Loading /> : <BarList rows={bars(b?.rejectionReasons)} empty="No rejections this period." />}
        </Panel>
        <Panel title="Research quality">
          {outcomes === undefined ? <Loading /> : <BarList rows={bars(b?.researchQuality)} empty="No research this period." />}
        </Panel>
      </Grid>
      {outcomes?.notes?.length ? (
        <ul className="space-y-1 text-xs text-[var(--muted)]">
          {outcomes.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------- Partner ---------- */

export function PartnerDashboard({ workspaceId: ws }: { workspaceId: string }) {
  const handoffs = useSource(() => listSharedHandoffs(ws).then((r) => r.handoffs), [ws]);
  const by = (s: string) => len(handoffs, (h) => h.state === s);
  return (
    <div>
      <DashboardHeader
        subtitle="Accounts shared with you"
        actions={
          <>
            <Link href="/settings/how-it-works">
              <Button>How it works</Button>
            </Link>
            <Link href="/shared">
              <Button variant="primary">View shared handoffs</Button>
            </Link>
          </>
        }
      />
      <StatRow>
        <StatTile label="Shared with you" value={len(handoffs)} Icon={Share2} href="/shared" />
        <StatTile label="New, to acknowledge" value={by("shared")} tone={by("shared") ? "amber" : "default"} Icon={Clock} href="/shared" />
        <StatTile label="Acknowledged" value={by("acknowledged")} tone="green" Icon={CheckCircle2} />
        <StatTile label="Returned or closed" value={handoffs ? handoffs.filter((h) => h.state === "returned" || h.state === "closed").length : handoffs} Icon={Users} />
      </StatRow>
      <Panel title="Shared handoffs" href="/shared">
        {handoffs === undefined ? (
          <Loading />
        ) : handoffs?.length ? (
          <List>
            {handoffs.map((h) => (
              <ListRow
                key={h.id}
                href={`/shared/handoff?id=${h.id}`}
                marker={h.state === "shared" ? "amber" : null}
                title={h.accountName}
                meta={`${h.receivingOrg} · shared ${formatDate(h.sharedAt)}${h.dueAt ? ` · due ${formatDate(h.dueAt)}` : ""}`}
                right={<StatusBadge status={h.state} />}
              />
            ))}
          </List>
        ) : (
          <Empty>Nothing has been shared with you yet.</Empty>
        )}
      </Panel>
    </div>
  );
}
