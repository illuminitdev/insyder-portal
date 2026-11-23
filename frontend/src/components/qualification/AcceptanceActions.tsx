"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { PortalLink as Link } from "../layout/PortalLink";
import { listPeople, transitionAcceptance, type Decision } from "../../lib/api/accounts";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useSkipReview } from "../../hooks/useSkipReview";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import { formatDate } from "../../lib/utils/dates";
import { StatusBadge } from "../common/StatusBadge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, FormError, FormNotice, humanize, inputClass } from "../ui/Field";

const REASONS = [
  "incomplete_evidence",
  "stale_evidence",
  "not_a_fit",
  "wrong_territory",
  "duplicate",
  "timing",
  "existing_relationship",
  "other",
];

/** The three decisions, in plain words */
const CHOICES = [
  { key: "accept", title: "Accept", blurb: "Worth sales time. Give it to someone to work.", Icon: CircleCheck },
  { key: "return", title: "Send back", blurb: "Not ready yet. The researcher fixes it and sends it again.", Icon: RotateCcw },
  { key: "reject", title: "Reject", blurb: "Not worth pursuing. Close this lead.", Icon: CircleX },
] as const;
type Choice = (typeof CHOICES)[number]["key"];

const SUCCESS: Record<string, string> = {
  ready_for_review: "Submitted for review. A tenant admin or sales reviewer will see it under Accounts → Sales acceptance.",
  accepted: "Accepted. The owner has an outreach task with the first step.",
  needs_research: "Returned to research.",
  rejected: "Rejected.",
};

export function AcceptanceActions({
  accountId,
  workspaceId,
  state,
  version,
  currentOwnerId,
  reviewedEvidenceCount,
  decisions,
  onDone,
}: {
  accountId: string;
  workspaceId: string;
  state: string;
  version: number;
  currentOwnerId: string | null;
  reviewedEvidenceCount: number;
  decisions: Decision[];
  onDone: () => void;
}) {
  const { can, role, user } = useWorkspace();
  const [people, setPeople] = useState<Array<{ userId: string; name: string; role: string }>>([]);
  const [ownerUserId, setOwnerUserId] = useState(currentOwnerId ?? "");
  const [nextAction, setNextAction] = useState("");
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Don't carry one user's confirmation over to whoever signs in next in the same tab
  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [user?.id, accountId]);

  const isReviewer = can("accept");
  const skipReview = useSkipReview(workspaceId);
  const awaitingSubmit = state === "draft" || state === "needs_research";
  // One-person workflow: whoever qualifies the lead accepts it and picks the owner (no reviewer step)
  const canAcceptDirect = skipReview && awaitingSubmit && (can("submit_review") || isReviewer);
  const needsPeople = isReviewer || canAcceptDirect;
  useEffect(() => {
    if (!needsPeople) return;
    void listPeople(workspaceId)
      .then((r) => setPeople(r.people))
      .catch(() => setPeople([]));
  }, [workspaceId, needsPeople]);
  // Accepting it yourself: you are the owner unless you pick someone else
  useEffect(() => {
    if (canAcceptDirect && user?.id) setOwnerUserId((o) => o || user.id);
  }, [canAcceptDirect, user?.id]);

  async function transition(toState: string, extra: Record<string, string | undefined> = {}) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await transitionAcceptance(accountId, workspaceId, { toState, expectedVersion: version, ...extra });
      setReasonCategory("");
      setReasonDetail("");
      setNotice(SUCCESS[toState] ?? "Saved.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  // Admins hand qualification to researchers; submitting stays the researcher's step
  const canSubmit = !skipReview && can("submit_review") && role !== "tenant_admin" && awaitingSubmit;
  const canDecide = isReviewer && state === "ready_for_review";
  const canReopen = isReviewer && (state === "accepted" || state === "rejected");
  const ownerName = people.find((p) => p.userId === ownerUserId)?.name;

  // Owner + first step + accept: used by the reviewer's "Accept" choice and by direct acceptance
  const acceptForm = (
    <div className="space-y-4 rounded-[12px] border border-[var(--line)] bg-[var(--table-head)] p-5">
      {reviewedEvidenceCount === 0 ? (
        <p className="rounded-[8px] border border-[var(--brand)] bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand-active)]">
          You can&apos;t accept yet: no source has been reviewed. Review at least one source in the brief first{canAcceptDirect ? "." : ", or return it."}
        </p>
      ) : null}
      <Field
        label="1. Who will work this lead?"
        hint={canAcceptDirect ? "You, or anyone else in the workspace. They see it in their accounts and pipeline." : "They become the owner and see it in their accounts and pipeline."}
      >
        <select className={inputClass} value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
          <option value="">Choose a person…</option>
          {[...people]
            .sort((a, b) => Number(a.role !== "sdr") - Number(b.role !== "sdr") || a.name.localeCompare(b.name))
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.userId === user?.id ? `Me (${p.name})` : `${p.name} (${ROLE_LABELS[p.role] ?? p.role})`}
              </option>
            ))}
        </select>
      </Field>
      <Field label="2. What should they do first?" hint="One clear next step, e.g. who to call and about what.">
        <input
          className={inputClass}
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          placeholder="e.g. Call the Head of IT about the new data centre"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button
          variant="primary"
          disabled={busy || !ownerUserId || !nextAction.trim() || reviewedEvidenceCount === 0}
          onClick={() => transition("accepted", { ownerUserId, nextAction })}
        >
          {busy ? "Accepting…" : ownerUserId === user?.id ? "Accept and work it myself" : ownerName ? `Accept and give it to ${ownerName}` : "Accept lead"}
        </Button>
        <span className="text-xs text-[var(--muted)]">
          {!ownerUserId ? "Choose who will work it" : !nextAction.trim() ? "Write the first step" : "Ready to accept"}
        </span>
      </div>
    </div>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[16px]">{canAcceptDirect ? "Accept this lead" : "Sales decision"}</h2>
        <StatusBadge status={state} />
      </div>
      <p className="mt-1 text-[13px] text-[var(--muted)]">
        {canAcceptDirect
          ? "This workspace skips the separate sales review: check the brief, then accept the lead and choose who works it."
          : canDecide
          ? "Read the brief, then pick one of the three options below."
          : `${reviewedEvidenceCount} reviewed ${reviewedEvidenceCount === 1 ? "source" : "sources"} on this lead.`}
      </p>

      {canSubmit ? (
        <div className="mt-4">
          <Link href={`/accounts/qualify?account=${accountId}`}>
            <Button variant="primary">Choose a reviewer and send →</Button>
          </Link>
          <p className="mt-1 text-xs text-[var(--muted)]">You pick the sales reviewer it goes to; they get a Sales review task with your note.</p>
        </div>
      ) : null}

      {canAcceptDirect ? <div className="mt-5">{acceptForm}</div> : null}

      {canDecide ? (
        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="text-[14px] font-semibold text-[var(--foreground)]">What do you want to do with this lead?</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {CHOICES.map((c) => {
                const on = choice === c.key;
                return (
                  <label
                    key={c.key}
                    className={`flex cursor-pointer flex-col gap-1.5 rounded-[12px] border p-4 transition ${
                      on
                        ? "border-[var(--brand)] bg-[var(--brand-tint)] shadow-[0_0_0_1px_var(--brand)]"
                        : "border-[var(--line)] bg-white hover:border-[var(--input-border)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`decision-${accountId}`}
                      className="sr-only"
                      checked={on}
                      onChange={() => {
                        setChoice(c.key);
                        setError(null);
                      }}
                    />
                    <span className="flex items-center gap-2">
                      <c.Icon size={18} className={on ? "text-[var(--brand-active)]" : "text-[var(--foreground)]"} aria-hidden />
                      <span className="text-[14.5px] font-semibold text-[var(--foreground)]">{c.title}</span>
                    </span>
                    <span className="text-[12.5px] leading-snug text-[var(--muted)]">{c.blurb}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {choice === "accept" ? acceptForm : null}

          {choice === "return" || choice === "reject" ? (
            <div className="space-y-4 rounded-[12px] border border-[var(--line)] bg-[var(--table-head)] p-5">
              <Field label={choice === "return" ? "1. Why are you sending it back?" : "1. Why are you rejecting it?"}>
                <select className={inputClass} value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
                  <option value="">Choose a reason…</option>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {humanize(r)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={choice === "return" ? "2. What should the researcher fix? (optional)" : "2. Anything to add? (optional)"}
                hint={choice === "return" ? "The researcher sees this note next to the lead." : undefined}
              >
                <textarea
                  className={`${inputClass} min-h-[72px]`}
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  placeholder={choice === "return" ? "e.g. Find a source newer than 6 months about the new site" : "e.g. Already a customer of a competitor on a 5-year contract"}
                />
              </Field>
              {choice === "reject" ? (
                <p className="text-xs text-[var(--muted)]">
                  Rejecting closes this lead. It does not block contact with the company; for do-not-contact use Settings → Suppressions.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  disabled={busy || !reasonCategory}
                  onClick={() =>
                    transition(choice === "return" ? "needs_research" : "rejected", {
                      reasonCategory,
                      reasonDetail: reasonDetail || undefined,
                    })
                  }
                >
                  {busy ? "Saving…" : choice === "return" ? "Send back to the researcher" : "Reject this lead"}
                </Button>
                {!reasonCategory ? <span className="text-xs text-[var(--muted)]">Choose a reason</span> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canReopen ? (
        <div className="mt-4 space-y-3">
          <Field label="Reason for reopening">
            <input className={inputClass} value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} placeholder="e.g. New evidence of a refresh project" />
          </Field>
          <Button disabled={busy || !reasonDetail.trim()} onClick={() => transition("ready_for_review", { reasonDetail })}>
            Reopen for review
          </Button>
        </div>
      ) : null}

      {!canSubmit && !canAcceptDirect && !canDecide && !canReopen ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {state === "ready_for_review"
            ? "Waiting for a sales reviewer."
            : awaitingSubmit && role === "tenant_admin"
              ? "Waiting for a researcher to qualify and submit this account. Assign them a research task below."
              : "No acceptance actions are available for your role at this stage."}
        </p>
      ) : null}

      <FormError message={error} />
      <FormNotice message={notice} />

      {decisions.length ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="text-[13px] font-semibold">Decision history</h3>
          <ol className="mt-2 space-y-2 text-xs text-[var(--muted)]">
            {decisions.map((d) => (
              <li key={d.id}>
                <span className="font-semibold text-[var(--foreground)]">
                  {humanize(d.fromState)} → {humanize(d.toState)}
                </span>{" "}
                by {d.actorName === user?.name ? "you" : d.actorName} · {formatDate(d.createdAt)}
                {d.briefVersion ? ` · brief v${d.briefVersion}` : ""}
                {d.reasonCategory ? ` · ${humanize(d.reasonCategory)}` : ""}
                {d.reasonDetail ? ` — ${d.reasonDetail}` : ""}
                {d.nextAction ? ` · next: ${d.nextAction}` : ""}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
