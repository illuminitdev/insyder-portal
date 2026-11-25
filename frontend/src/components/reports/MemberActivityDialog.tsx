"use client";

import { useEffect, useState } from "react";
import {
  AlarmClock,
  BadgeCheck,
  CircleSlash,
  ClipboardList,
  FileSearch,
  ListChecks,
  Loader,
  Search,
  Send,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import { FormError, humanize } from "../ui/Field";
import { StatusBadge } from "../common/StatusBadge";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import { TASK_TYPE_LABELS } from "../../lib/api/tasks";
import { formatDate } from "../../lib/utils/dates";
import { getMemberActivity, type MemberActivity, type MemberTimelineEvent } from "../../lib/api/memberActivity";

const EVENT_LOOK: Record<MemberTimelineEvent["kind"], { label: string; Icon: LucideIcon; tone: string }> = {
  research_run: { label: "Ran research", Icon: Search, tone: "bg-[var(--brand-tint)] text-[var(--brand-active)]" },
  evidence_reviewed: { label: "Reviewed evidence", Icon: FileSearch, tone: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" },
  brief_submitted: { label: "Sent a brief for review", Icon: Send, tone: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" },
  accepted: { label: "Accepted", Icon: BadgeCheck, tone: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" },
  returned: { label: "Returned for research", Icon: Undo2, tone: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" },
  rejected: { label: "Rejected", Icon: XCircle, tone: "bg-[var(--danger-tint)] text-[var(--danger)]" },
  task_completed: { label: "Completed a task", Icon: ListChecks, tone: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" },
  task_cancelled: { label: "Cancelled a task", Icon: CircleSlash, tone: "bg-[var(--chip-bg)] text-[var(--muted)]" },
};

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? "" : "s"} ago` : formatDate(iso);
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function Count({ label, value, Icon, tone }: { label: string; value: number; Icon: LucideIcon; tone: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--line)] px-3 py-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] ${tone}`} aria-hidden>
        <Icon size={15} strokeWidth={1.9} />
      </span>
      <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

/** Tenant admin's window onto one member: what they're working on now and what they did recently. */
export function MemberActivityDialog({
  workspaceId,
  member,
  onClose,
}: {
  workspaceId: string;
  member: { userId: string; name: string } | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemberActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    let live = true;
    setData(null);
    setError(null);
    getMemberActivity(workspaceId, member.userId)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load this member's work"));
    return () => {
      live = false;
    };
  }, [workspaceId, member]);

  const name = data?.member.name ?? member?.name ?? "";

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      size="lg"
      icon={
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-semibold text-[var(--on-brand)]" aria-hidden>
          {initialsOf(name)}
        </span>
      }
      title={name}
      description={
        data
          ? `${data.member.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")} · ${data.member.email} · ${
              data.lastActiveAt ? `Last active ${ago(data.lastActiveAt)}` : "No activity yet"
            }`
          : undefined
      }
    >
      <FormError message={error} />
      {!data && !error ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]" role="status">
          Loading their work…
        </p>
      ) : null}

      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Count label="Open tasks" value={data.summary.openTasks} Icon={ClipboardList} tone="bg-[var(--chip-bg)] text-[var(--brand-text)]" />
            <Count label="Overdue" value={data.summary.overdueTasks} Icon={AlarmClock} tone="bg-[var(--danger-tint)] text-[var(--danger)]" />
            <Count label="In progress" value={data.summary.inProgressTasks} Icon={Loader} tone="bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" />
            <Count label="Research running" value={data.summary.researchRunning} Icon={Search} tone="bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" />
          </div>

          <section>
            <h3 className="text-[14px] font-semibold">Working on now</h3>
            {data.openTasks.length || data.researchInProgress.length ? (
              <ul className="mt-2 divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)]">
                {data.researchInProgress.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <Search size={15} className="shrink-0 text-[var(--brand-active)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.accountName ?? r.label}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">
                        {r.accountName ? r.label : "Discovery search"} · started {ago(r.createdAt)}
                      </span>
                    </span>
                    <Badge tone="amber">{r.progressPct != null ? `Researching ${r.progressPct}%` : humanize(r.status)}</Badge>
                  </li>
                ))}
                {data.openTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <ClipboardList size={15} className="shrink-0 text-[var(--muted)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">
                        {TASK_TYPE_LABELS[t.type] ?? humanize(t.type)} ·{" "}
                        <Link href={`/accounts/detail?id=${t.accountId}`} className="hover:text-[var(--brand-active)] hover:underline" onClick={onClose}>
                          {t.accountName ?? "Account"}
                        </Link>
                      </span>
                      <span className={`block text-xs ${t.overdue ? "font-semibold text-[var(--danger)]" : "text-[var(--muted)]"}`}>
                        {t.dueAt ? `${t.overdue ? "Overdue · was due" : "Due"} ${formatDate(t.dueAt)}` : "No due date"}
                        {t.priority !== "normal" ? ` · ${humanize(t.priority)} priority` : ""}
                      </span>
                    </span>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-[10px] border border-dashed border-[var(--line)] px-4 py-4 text-center text-sm text-[var(--muted)]">
                Nothing open right now: no tasks and no research running.
              </p>
            )}
          </section>

          <section>
            <h3 className="text-[14px] font-semibold">Recent activity</h3>
            {data.timeline.length ? (
              <ol className="mt-3 space-y-0">
                {data.timeline.map((e, i) => {
                  const look = EVENT_LOOK[e.kind];
                  return (
                    <li key={`${e.kind}-${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < data.timeline.length - 1 ? (
                        <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[var(--line)]" aria-hidden />
                      ) : null}
                      <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${look.tone}`} aria-hidden>
                        <look.Icon size={14} strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="font-medium">{look.label}</span>
                          {e.accountId && e.accountName ? (
                            <>
                              {" · "}
                              <Link href={`/accounts/detail?id=${e.accountId}`} className="text-[var(--foreground)] hover:text-[var(--brand-active)] hover:underline" onClick={onClose}>
                                {e.accountName}
                              </Link>
                            </>
                          ) : null}
                          {e.status && e.kind === "research_run" && e.status !== "completed" ? (
                            <span className="ml-1.5 text-xs text-[var(--muted)]">({humanize(e.status)})</span>
                          ) : null}
                        </p>
                        {e.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{e.detail}</p> : null}
                        <p className="mt-0.5 text-[11.5px] text-[#9aa5b1]" title={formatDate(e.at)}>
                          {ago(e.at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 rounded-[10px] border border-dashed border-[var(--line)] px-4 py-4 text-center text-sm text-[var(--muted)]">
                No recorded work yet.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
