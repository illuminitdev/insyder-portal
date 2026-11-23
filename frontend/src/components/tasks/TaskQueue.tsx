"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { usePagination } from "../ui/Pagination";
import { useEffect, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Mail,
  Phone,
  Play,
  RotateCw,
  Search,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { sendForReview, TASK_TYPE_LABELS, type Task } from "../../lib/api/tasks";
import { listPeople, type Account } from "../../lib/api/accounts";
import { useWorkspace } from "../../hooks/useWorkspace";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import { formatDate } from "../../lib/utils/dates";
import { StatusBadge } from "../common/StatusBadge";
import { EmptyState } from "../common/EmptyState";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FormError, humanize, inputClass } from "../ui/Field";

type Pending = { taskId: string; kind: "complete" | "cancel" } | null;

/** Icon and tile colour per task type, so a queue can be scanned at a glance */
const TYPE_LOOK: Record<Task["type"], { Icon: LucideIcon; tile: string }> = {
  research: { Icon: Search, tile: "bg-[var(--brand-tint)] text-[var(--brand-active)]" },
  review: { Icon: ClipboardCheck, tile: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" },
  call: { Icon: Phone, tile: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" },
  email: { Icon: Mail, tile: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" },
  follow_up: { Icon: RotateCw, tile: "bg-[var(--chip-bg)] text-[var(--navy)]" },
};

const DAY = 86_400_000;

/** "Overdue by 2 days", "Due today", "Due in 3 days" */
function dueText(dueAt: string, open: boolean, now: number) {
  const diff = new Date(dueAt).getTime() - now;
  if (!open) return `Due ${formatDate(dueAt)}`;
  if (diff < 0) {
    const days = Math.floor(-diff / DAY);
    return days >= 1 ? `Overdue by ${days} day${days === 1 ? "" : "s"}` : "Overdue today";
  }
  const days = Math.floor(diff / DAY);
  return days < 1 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`;
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

/** What the owner does for each task type, in order */
const STEPS: Record<Task["type"], string[]> = {
  research: [
    "Click “Open account brief”, read the evidence and click “Mark as reviewed” on the items that support it.",
    "Come back here, write a short note for the reviewer, choose the reviewer and click “Send to sales reviewer”. Your task then completes by itself.",
  ],
  review: [
    "Open the account brief and read the reviewed evidence and qualification.",
    "Under Sales acceptance, Accept (choose an owner and next action), or Return / Reject with a reason.",
    "Come back here and click “Complete…” with your decision.",
  ],
  call: [
    "Open the account brief for context.",
    "Make the call outside Insyder.",
    "Come back here and click “Complete…” with the outcome.",
  ],
  email: [
    "Open the account brief for context; approved drafts are under Outreach → Drafts.",
    "Send the email outside Insyder.",
    "Come back here and click “Complete…” with the outcome.",
  ],
  follow_up: [
    "Open the account brief and check the previous outcome.",
    "Follow up outside Insyder.",
    "Come back here and click “Complete…” with the outcome.",
  ],
};

/** The researcher's one-step hand-off: note + reviewer, and the server does the rest */
function SendForReviewForm({
  task,
  workspaceId,
  onSent,
}: {
  task: Task;
  workspaceId: string;
  onSent: (message: string) => void | Promise<void>;
}) {
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string; role: string }>>([]);
  const [reviewerUserId, setReviewerUserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPeople(workspaceId)
      .then((r) => {
        const list = r.people.filter((p) => p.role === "sales_reviewer" || p.role === "tenant_admin");
        setReviewers(list);
        setReviewerUserId((id) => id || (list.find((p) => p.role === "sales_reviewer") ?? list[0])?.userId || "");
      })
      .catch(() => setReviewers([]));
  }, [workspaceId]);

  return (
    <form
      className="space-y-2 border-t border-[var(--line)] pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await sendForReview(task.id, { workspaceId, note, reviewerUserId });
          const name = reviewers.find((r) => r.userId === reviewerUserId)?.name ?? "the reviewer";
          await onSent(`Sent to ${name} for review. Your research task is completed.`);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send for review");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Send to sales reviewer</p>
      <label className="block text-xs font-semibold text-[var(--muted)]">
        Note for the reviewer (required)
        <textarea
          className={inputClass}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Hiring cloud infrastructure engineers for a data centre migration — likely to need new servers soon."
        />
      </label>
      <label className="block text-xs font-semibold text-[var(--muted)]">
        Reviewer
        <select className={inputClass} value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)}>
          {reviewers.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name} ({ROLE_LABELS[r.role] ?? r.role})
            </option>
          ))}
        </select>
      </label>
      <FormError message={error} />
      <Button type="submit" variant="primary" disabled={busy || !note.trim() || !reviewerUserId}>
        {busy ? "Sending…" : "Send to sales reviewer"}
      </Button>
    </form>
  );
}

export function TaskQueue({
  tasks,
  accountNames,
  accounts,
  peopleNames,
  canEdit,
  onUpdate,
  workspaceId,
  onAccountChanged,
  onSent,
}: {
  tasks: Task[];
  accountNames: Map<string, string>;
  /** Shown in the task details when available */
  accounts?: Map<string, Account>;
  peopleNames: Map<string, string>;
  canEdit: boolean;
  onUpdate: (taskId: string, body: Record<string, unknown>) => Promise<void>;
  /** Enables “Send to sales reviewer” on research tasks */
  workspaceId?: string;
  onAccountChanged?: () => void;
  /** Called after a research task is sent for review (it is then completed) */
  onSent?: (message: string) => void | Promise<void>;
}) {
  const { can } = useWorkspace();
  const [pending, setPending] = useState<Pending>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Tasks in progress show details by default; this holds the ones flipped from their default
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { pageItems, pager, topRef } = usePagination(tasks);

  if (!tasks.length) {
    return <EmptyState title="No tasks match" detail="Change the filters or create a task." />;
  }

  async function submit(taskId: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await onUpdate(taskId, body);
      setPending(null);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  const now = Date.now();
  return (
    <div>
      <ul ref={topRef} className="scroll-mt-24 space-y-3">
        {pageItems.map((t) => {
          const open = t.status === "open" || t.status === "in_progress";
          const overdue = open && t.dueAt && new Date(t.dueAt).getTime() < now;
          const showDetails = (t.status === "in_progress") !== toggled.has(t.id);
          const account = accounts?.get(t.accountId);
          const look = TYPE_LOOK[t.type] ?? TYPE_LOOK.follow_up;
          const owner = peopleNames.get(t.ownerUserId) ?? "Unassigned";
          return (
            <li key={t.id}>
              <Card
                className={`!p-0 overflow-hidden transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(23,44,64,0.28)] ${
                  overdue ? "border-l-[3px] border-l-[var(--danger)]" : ""
                }`}
              >
                <div className="flex flex-wrap items-start gap-4 p-5">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] ${look.tile}`} aria-hidden>
                    <look.Icon size={19} strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                      {TASK_TYPE_LABELS[t.type] ?? humanize(t.type)}
                    </p>
                    <Link
                      href={`/accounts/detail?id=${t.accountId}`}
                      className="mt-0.5 block truncate text-[16.5px] font-semibold text-[var(--foreground)] hover:text-[var(--brand-active)]"
                    >
                      {accountNames.get(t.accountId) ?? "Account"}
                    </Link>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{t.instruction ?? "No instruction"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-[var(--muted)]">
                      <span className="inline-flex items-center gap-1.5" title="Owner">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--navy)] text-[9.5px] font-semibold text-white" aria-hidden>
                          {initialsOf(owner)}
                        </span>
                        <span className="font-medium text-[var(--foreground)]">{owner}</span>
                      </span>
                      {t.dueAt ? (
                        <span
                          className={`inline-flex items-center gap-1.5 ${overdue ? "font-semibold text-[var(--danger)]" : ""}`}
                          title={`${formatDate(t.dueAt)} (${t.timezone})`}
                        >
                          <CalendarClock size={14} aria-hidden />
                          {dueText(t.dueAt, open, now)} · {formatDate(t.dueAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarClock size={14} aria-hidden />
                          No due date
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5" title="Assigned by">
                        <UserRound size={14} aria-hidden />
                        Assigned by {peopleNames.get(t.createdBy) ?? "—"} · {formatDate(t.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {overdue ? <Badge tone="red">Overdue</Badge> : null}
                    {t.priority !== "normal" ? <Badge tone={t.priority === "urgent" || t.priority === "high" ? "amber" : "default"}>{humanize(t.priority)}</Badge> : null}
                    <StatusBadge status={t.status} />
                  </div>
                </div>
                {showDetails ? (
                  <div className="mx-5 mb-4 space-y-3 rounded-[10px] border border-[var(--line)] bg-[var(--chip-bg)] p-4 text-sm">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Account</p>
                      <p className="font-medium text-[var(--foreground)]">{accountNames.get(t.accountId) ?? "Account"}</p>
                      {account ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                          <span>{[account.domain, account.country].filter(Boolean).join(" · ") || "Website unknown"}</span>
                          <StatusBadge status={account.researchState} />
                          <StatusBadge status={account.acceptanceState} />
                          <span>Priority {account.fitScore ?? "—"} / 100</span>
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Instruction</p>
                      <p>{t.instruction ?? "No instruction — follow the steps below."}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">What to do</p>
                      <ol className="mt-1 list-decimal space-y-1 pl-5">
                        {(STEPS[t.type] ?? []).map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/accounts/detail?id=${t.accountId}`}>
                        <Button>
                          <span className="inline-flex items-center gap-1.5">
                            <FileText size={15} aria-hidden />
                            Open account brief
                          </span>
                        </Button>
                      </Link>
                    </div>
                    {t.type === "research" && open && workspaceId && can("submit_review") ? (
                      <SendForReviewForm
                        task={t}
                        workspaceId={workspaceId}
                        onSent={async (message) => {
                          await onSent?.(message);
                          onAccountChanged?.();
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
                {open && canEdit ? (
                  pending?.taskId === t.id ? (
                    <form
                      className="space-y-2 border-t border-[var(--line)] bg-[#fbfcfd] px-5 py-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit(
                          t.id,
                          pending.kind === "complete"
                            ? { status: "completed", outcome: text }
                            : { status: "cancelled", cancelReason: text },
                        );
                      }}
                    >
                      <label className="block text-xs font-semibold text-[var(--muted)]">
                        {pending.kind === "complete" ? "Outcome (required)" : "Cancellation reason (required)"}
                        <input
                          autoFocus
                          className={inputClass}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          placeholder={pending.kind === "complete" ? "e.g. Spoke to IT lead, meeting being arranged" : "e.g. Duplicate of another task"}
                        />
                      </label>
                      <FormError message={error} />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" disabled={!text.trim()}>
                          {pending.kind === "complete" ? "Complete task" : "Cancel task"}
                        </Button>
                        <Button variant="ghost" onClick={() => setPending(null)}>
                          Back
                        </Button>
                      </div>
                      {pending.kind === "complete" ? (
                        <p className="text-xs text-[var(--muted)]">
                          Completing records activity only. It does not change pipeline stage or log a meeting.
                        </p>
                      ) : null}
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] bg-[#fbfcfd] px-5 py-3">
                      <Button variant="ghost" onClick={() => toggle(t.id)} aria-expanded={showDetails}>
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronDown size={15} className={`transition-transform ${showDetails ? "rotate-180" : ""}`} aria-hidden />
                          {showDetails ? "Hide details" : "Details"}
                        </span>
                      </Button>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" onClick={() => setPending({ taskId: t.id, kind: "cancel" })}>
                          <span className="inline-flex items-center gap-1.5">
                            <X size={15} aria-hidden />
                            Cancel task
                          </span>
                        </Button>
                        {t.status === "open" ? (
                          <Button onClick={() => void submit(t.id, { status: "in_progress" })}>
                            <span className="inline-flex items-center gap-1.5">
                              <Play size={14} aria-hidden />
                              Start
                            </span>
                          </Button>
                        ) : null}
                        <Button variant="primary" onClick={() => setPending({ taskId: t.id, kind: "complete" })}>
                          <span className="inline-flex items-center gap-1.5">
                            <Check size={15} aria-hidden />
                            Complete
                          </span>
                        </Button>
                      </div>
                    </div>
                  )
                ) : !open ? (
                  <p className="border-t border-[var(--line)] bg-[#fbfcfd] px-5 py-3 text-[13px] text-[var(--muted)]">
                    <span className="font-semibold text-[var(--foreground)]">
                      {t.status === "completed" ? "Outcome: " : "Cancelled: "}
                    </span>
                    {t.status === "completed" ? t.outcome : t.cancelReason}
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
      {pager}
    </div>
  );
}
