"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, CircleDashed, ListFilter, RotateCcw } from "lucide-react";
import { RequireCap } from "@/components/common/RequireCap";
import { StatusBadge } from "@/components/common/StatusBadge";
import { PeoplePanel } from "@/components/accounts/PeoplePanel";
import { GuidedCard } from "@/components/guide/GuidedCard";
import { GuideHeader } from "@/components/guide/GuideHeader";
import { PickList } from "@/components/guide/PickList";
import { Stepper, type GuideStep } from "@/components/guide/Stepper";
import { TourHint } from "@/components/guide/TourHint";
import { FactEditor, FIELD_KEYS } from "@/components/qualification/FactEditor";
import { EvidenceList } from "@/components/research/EvidenceList";
import { ResearchRunStatus } from "@/components/research/ResearchRunStatus";
import { Button } from "@/components/ui/Button";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";
import { useGuidedFlow } from "@/hooks/useGuidedFlow";
import { usePersistentState } from "@/hooks/usePersistentState";
import { useWorkspace } from "@/hooks/useWorkspace";
import { api } from "@/lib/api/client";
import { getBrief, getPipeline, listAccounts, listPeople, type Brief, type PipelineRow } from "@/lib/api/accounts";
import { usePortal } from "@/hooks/usePortal";
import { startResearchRun } from "@/lib/api/research";
import { listTasks, sendForReview, sendLeadForReview, type Task } from "@/lib/api/tasks";
import { formatDate } from "@/lib/utils/dates";

const STEPS: GuideStep[] = [
  { key: "pick", label: "Pick a lead" },
  { key: "evidence", label: "Check evidence *" },
  { key: "brief", label: "Fill the brief" },
  { key: "people", label: "People" },
  { key: "submit", label: "Send for review" },
];

function Check({ ok, required, children }: { ok: boolean; required?: boolean; children: React.ReactNode }) {
  const missing = !ok && required;
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <CircleCheck size={17} className="mt-0.5 shrink-0 text-[var(--badge-green-fg)]" aria-hidden />
      ) : missing ? (
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden />
      ) : (
        <CircleDashed size={17} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
      )}
      <span className={ok ? "" : missing ? "font-semibold text-[var(--brand)]" : "text-[var(--muted)]"}>
        {children}
        {missing ? " — required" : ""}
      </span>
    </li>
  );
}

/** Red "must do" box, or green once it's done. */
function RequiredBox({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <div
      role={done ? "status" : "alert"}
      className={`mb-5 flex items-start gap-2.5 rounded-[10px] border px-4 py-3 text-sm ${
        done
          ? "border-transparent bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
          : "border-[var(--brand)] bg-[var(--brand-tint)] text-[var(--brand-active)]"
      }`}
    >
      {done ? <CircleCheck size={17} className="mt-0.5 shrink-0" aria-hidden /> : <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden />}
      <span>
        <strong>{done ? "Done: " : "Required: "}</strong>
        {title}
        {children ? <span className="mt-0.5 block font-normal">{children}</span> : null}
      </span>
    </div>
  );
}

/** Tag on a lead this researcher already sent: what the reviewer has done with it since. */
/** Where a lead stands for the researcher: one tab per status in "Pick a lead" */
type LeadStatus = "todo" | "progress" | "returned" | "sent" | "done";
const TABS: Array<{ key: "mine" | LeadStatus | "all"; label: string; hint: string }> = [
  { key: "mine", label: "My tasks", hint: "Leads someone asked you to research." },
  { key: "todo", label: "Not started", hint: "Not researched yet. Start by running research." },
  { key: "progress", label: "In progress", hint: "Researched, but not sent for review yet." },
  { key: "returned", label: "Returned", hint: "A reviewer sent these back. Fix what they asked, then send again." },
  { key: "sent", label: "Sent for review", hint: "Waiting for a sales reviewer. Nothing to do now." },
  { key: "done", label: "Completed", hint: "A reviewer accepted or rejected these." },
  { key: "all", label: "All", hint: "Every lead you can work on." },
];
type TabKey = (typeof TABS)[number]["key"];

const SENT_LABELS: Record<string, string> = {
  ready_for_review: "Sent for review",
  accepted: "Sent · Accepted",
  rejected: "Sent · Rejected",
};

function QualifyGuide({ workspaceId }: { workspaceId: string }) {
  const { can, user } = useWorkspace();
  const [accountId, setAccountId] = usePersistentState<string | null>(`${workspaceId}:qualify:account`, null);
  const [rows, setRows] = useState<PipelineRow[] | null>(null);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  // Research tasks this person already finished by sending the lead for review
  const [sentTasks, setSentTasks] = useState<Task[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string; role: string }>>([]);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState("");
  const [note, setNote] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researchState, setResearchState] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = usePersistentState<TabKey | null>(`${workspaceId}:qualify:tab`, null);
  const router = useRouter();
  const { href: portalHref } = usePortal();
  const requested = useSearchParams().get("account");

  useEffect(() => {
    void getPipeline(workspaceId).then((r) => setRows(r.rows)).catch(() => setRows([]));
    void listAccounts(workspaceId)
      .then((r) => setResearchState(new Map(r.accounts.map((a) => [a.id, a.researchState]))))
      .catch(() => setResearchState(new Map()));
    if (user) {
      void listTasks(workspaceId, { ownerUserId: user.id })
        .then((r) => {
          const research = r.tasks.filter((t) => t.type === "research");
          setMyTasks(research.filter((t) => t.status === "open" || t.status === "in_progress"));
          setSentTasks(research.filter((t) => t.status === "completed"));
        })
        .catch(() => {
          setMyTasks([]);
          setSentTasks([]);
        });
    }
    void listPeople(workspaceId)
      .then((r) =>
        setReviewers(
          r.people
            .filter((p) => p.role === "sales_reviewer" || p.role === "tenant_admin")
            .sort((a, b) => Number(a.role !== "sales_reviewer") - Number(b.role !== "sales_reviewer") || a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => setReviewers([]));
  }, [workspaceId, user]);

  const loadBrief = useCallback(async () => {
    if (!accountId) return setBrief(null);
    try {
      let b = await getBrief(accountId, workspaceId);
      // A new lead has no brief yet: opening it starts one, so the editor can show
      if (!b.qualification && ["draft", "needs_research"].includes(b.account.acceptanceState) && can("qualify")) {
        await api(`/v1/accounts/${accountId}/qualification?workspaceId=${workspaceId}`);
        b = await getBrief(accountId, workspaceId);
      }
      setBrief(b);
      setNote((n) => n || b.qualification?.rationale || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the account");
    }
  }, [accountId, workspaceId, can]);

  useEffect(() => {
    void loadBrief();
  }, [loadBrief]);

  const taskFor = new Map(myTasks.map((t) => [t.accountId, t]));
  const sentFor = new Map(sentTasks.map((t) => [t.accountId, t]));
  const isOpenState = (state: string) => state === "draft" || state === "needs_research";
  // Order: my open tasks, then new or returned leads, then leads I already sent for review (kept so I can see they're done)
  const rank = (r: PipelineRow) => (taskFor.has(r.accountId) ? 0 : isOpenState(r.acceptanceState) ? 1 : 2);
  const candidates = (rows ?? [])
    .filter((r) => taskFor.has(r.accountId) || isOpenState(r.acceptanceState) || sentFor.has(r.accountId))
    .sort((a, b) => rank(a) - rank(b));
  const task = accountId ? taskFor.get(accountId) : undefined;
  const editable = brief ? ["draft", "needs_research"].includes(brief.account.acceptanceState) : false;
  const reviewed = brief?.evidence.filter((e) => e.reviewedAt).length ?? 0;
  const known = brief?.facts.filter((f) => f.basis !== "unknown").length ?? 0;
  const returned = brief?.decisions.find((d) => d.toState === "needs_research");
  // Someone (e.g. the tenant admin) already moved this lead past qualifying: say who and when
  const lastDecision = brief?.decisions.reduce<(typeof brief.decisions)[number] | undefined>(
    (latest, d) => (!latest || d.createdAt > latest.createdAt ? d : latest),
    undefined,
  );
  const alreadyDone = brief && !editable && !submitted ? lastDecision : undefined;

  // Sales review needs at least one reviewed source (spec R5): the steps after "Check evidence" open once one is reviewed
  const evidenceOk = reviewed > 0 || !editable;
  const reachable = submitted ? 4 : brief ? (evidenceOk ? 4 : 1) : 0;
  const flow = useGuidedFlow(`${workspaceId}:qualify`, STEPS.length, reachable);

  // Opened from a task elsewhere (e.g. Work my tasks): start on that lead's evidence step
  useEffect(() => {
    if (!requested) return;
    setAccountId(requested);
    setSubmitted(false);
    setNote("");
    flow.goTo(1);
    router.replace(portalHref("/accounts/qualify"), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per requested lead
  }, [requested]);

  const statusOf = (r: PipelineRow): LeadStatus =>
    r.acceptanceState === "needs_research"
      ? "returned"
      : r.acceptanceState === "ready_for_review"
        ? "sent"
        : r.acceptanceState === "accepted" || r.acceptanceState === "rejected"
          ? "done"
          : researchState.get(r.accountId) === "researched"
            ? "progress"
            : "todo";
  const inTab = (r: PipelineRow, k: TabKey) => (k === "all" ? true : k === "mine" ? taskFor.has(r.accountId) : statusOf(r) === k);
  const count = (k: TabKey) => candidates.filter((r) => inTab(r, k)).length;
  // First visit: open on the most useful non-empty tab
  const activeTab: TabKey =
    tab ?? (["mine", "returned", "progress", "todo"] as TabKey[]).find((k) => count(k) > 0) ?? "all";
  const tabRows = candidates.filter((r) => inTab(r, activeTab));

  async function submit() {
    if (!brief || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      if (!reviewerId) throw new Error("Choose a reviewer");
      if (task) {
        await sendForReview(task.id, { workspaceId, note: note.trim(), reviewerUserId: reviewerId });
      } else {
        await sendLeadForReview(accountId, { workspaceId, note: note.trim(), reviewerUserId: reviewerId });
      }
      setSentTo(reviewers.find((r) => r.userId === reviewerId)?.name ?? null);
      setSubmitted(true);
      await loadBrief();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send for review");
    } finally {
      setBusy(false);
    }
  }

  const total = STEPS.length;
  const name = brief?.account.name ?? "this lead";

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <GuideHeader
        eyebrow="Guided · Qualify a lead"
        title="Turn a lead into a brief the sales team can trust, then send it for review."
        fullPage={accountId ? { href: `/accounts/detail?id=${accountId}`, label: "Open the full account page" } : undefined}
      />
      <Stepper steps={STEPS} current={flow.current} reachable={reachable} onSelect={flow.goTo} />
      {alreadyDone && brief ? (
        <div role="status" className="flex items-start gap-2.5 rounded-[10px] bg-[var(--badge-green-bg)] px-4 py-3 text-sm text-[var(--badge-green-fg)]">
          <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong>Already done.</strong>{" "}
            {alreadyDone.actorName === user?.name ? "You" : alreadyDone.actorName} moved {brief.account.name} to{" "}
            <strong>{humanize(alreadyDone.toState).toLowerCase()}</strong> on {formatDate(alreadyDone.createdAt)}. There&apos;s nothing
            more to do here unless a reviewer returns it.
          </span>
        </div>
      ) : null}

      {flow.current === 0 ? (
        <GuidedCard
          index={0}
          total={total}
          eyebrow="Pick a lead"
          title="Which lead are you working on?"
          why="Use the tabs to see what's new, what you're working on, what came back from a reviewer and what's finished."
          onNext={flow.next}
          nextDisabledReason={brief ? null : "Pick a lead"}
        >
          <TourHint id="qualify.pick">Choose one lead. You can come back here any time to switch to another.</TourHint>
          {rows === null ? (
            <p className="text-sm text-[var(--muted)]">Loading leads…</p>
          ) : (
            <>
            <PickList
              label="leads"
              pageSize={8}
              toolbar={
                <label className="relative block">
                  <span className="sr-only">Filter leads by status</span>
                  <ListFilter
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
                    aria-hidden
                  />
                  <select
                    value={activeTab}
                    onChange={(e) => setTab(e.target.value as TabKey)}
                    title={TABS.find((t) => t.key === activeTab)?.hint}
                    className="rounded-[9px] border border-[var(--input-border)] bg-white py-2 pl-9 pr-8 text-sm font-medium text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
                  >
                    {TABS.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label} ({count(t.key)})
                      </option>
                    ))}
                  </select>
                </label>
              }
              items={tabRows.map((r) => {
                const t = taskFor.get(r.accountId);
                const sent = !t && !isOpenState(r.acceptanceState) ? sentFor.get(r.accountId) : undefined;
                return {
                  id: r.accountId,
                  title: r.name,
                  badge: (
                    <>
                      <StatusBadge status={r.acceptanceState} />
                      {sent ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[var(--badge-green-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--badge-green-fg)]">
                          <CircleCheck size={12} aria-hidden /> {SENT_LABELS[r.acceptanceState] ?? "Sent for review"}
                        </span>
                      ) : !isOpenState(r.acceptanceState) ? (
                        <span className="rounded bg-[var(--badge-green-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--badge-green-fg)]">Already done</span>
                      ) : null}
                      {t ?<span className="rounded bg-[var(--badge-blue-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--badge-blue-fg)]">Your task</span> : null}
                    </>
                  ),
                  subtitle: sent
                    ? "You sent this to a sales reviewer. Nothing more to do unless they return it."
                    : (t?.instruction ?? (r.nextAction ? `Next: ${r.nextAction}` : undefined)),
                  meta: sent?.updatedAt
                    ? `Sent ${formatDate(sent.updatedAt)}`
                    : t?.dueAt
                      ? `Due ${formatDate(t.dueAt)}`
                      : undefined,
                };
              })}
              selectedId={accountId}
              onSelect={(id) => {
                setAccountId(id);
                setSubmitted(false);
                setNote("");
              }}
              empty={
                activeTab === "mine"
                  ? "No research tasks assigned to you right now."
                  : activeTab === "all"
                    ? "Nothing to qualify right now. New leads and research tasks assigned to you appear here."
                    : `Nothing in "${TABS.find((t) => t.key === activeTab)?.label}" right now.`
              }
            />
            </>
          )}
        </GuidedCard>
      ) : null}

      {flow.current === 1 && brief ? (
        <GuidedCard
          index={1}
          total={total}
          eyebrow={name}
          title="Check the evidence"
          why="Each source is untrusted web data. Open it, check it really is about this company, then mark it reviewed. Only reviewed evidence counts when the brief is accepted."
          onBack={flow.back}
          onNext={flow.next}
          nextDisabledReason={
            !brief.evidence.length
              ? "This lead has no evidence yet. Run research first"
              : !evidenceOk
                ? "Mark at least one source as reviewed to continue"
                : null
          }
        >
          <RequiredBox
            done={evidenceOk}
            title={
              evidenceOk
                ? `${reviewed} source${reviewed === 1 ? "" : "s"} reviewed. You can continue.`
                : "mark at least one source as reviewed before you can continue."
            }
          >
            {evidenceOk
              ? null
              : brief.evidence.length
                ? `Open a source below, check it's really about ${name}, then press "Mark reviewed". A sales reviewer can only accept a brief with reviewed evidence.`
                : "There's no evidence yet. Press \"Run research\" below to find sources first."}
          </RequiredBox>
          {returned ? (
            <div className="mb-5 flex items-start gap-2.5 rounded-[10px] bg-[var(--badge-amber-bg)] px-4 py-3 text-sm text-[var(--badge-amber-fg)]">
              <RotateCcw size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                <strong>Returned by {returned.actorName}</strong> on {formatDate(returned.createdAt)}
                {returned.reasonCategory ? ` · ${humanize(returned.reasonCategory)}` : ""}
                {returned.reasonDetail ? `: ${returned.reasonDetail}` : ""}
              </span>
            </div>
          ) : null}
          <TourHint id="qualify.evidence">
            Click a source title to read it, then press <strong>Mark reviewed</strong>. Need more? Use <strong>Run research</strong>.
          </TourHint>
          {can("research") ? (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || brief.account.researchState === "researching"}
                onClick={async () => {
                  setError(null);
                  try {
                    const { researchRunId } = await startResearchRun(workspaceId, {
                      mode: "account",
                      query: "infrastructure expansion, hiring, refresh or procurement",
                      accountId: brief.account.id,
                      budget: 3,
                    });
                    setRunId(researchRunId);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Research failed");
                  }
                }}
              >
                Run research on {name}
              </Button>
              <span className="text-sm text-[var(--muted)]">
                {reviewed} of {brief.evidence.length} sources reviewed
              </span>
            </div>
          ) : null}
          <ResearchRunStatus runId={runId} workspaceId={workspaceId} onFinished={() => void loadBrief()} />
          <EvidenceList items={brief.evidence} workspaceId={workspaceId} canReview={can("review_evidence")} onChanged={() => void loadBrief()} />
          <div className="mt-3">
            <FormError message={error} />
          </div>
        </GuidedCard>
      ) : null}

      {flow.current === 2 && brief ? (
        <GuidedCard
          index={2}
          total={total}
          eyebrow={name}
          title="Fill in the qualification brief"
          why="Answer what you can: workload, current setup, why they'd buy now, timeframe, who decides. Unknown is a valid answer; never guess budget, vendors, people or intent."
          onBack={flow.back}
          onNext={flow.next}
        >
          <TourHint id="qualify.brief">
            Pick a field, choose how you know it (<strong>source</strong> needs evidence ticked, <strong>prospect confirmed</strong> needs a
            note of who said it), then <strong>Save fact</strong>.
          </TourHint>
          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            {FIELD_KEYS.slice(0, 7).map((k) => {
              const f = brief.facts.find((x) => x.fieldKey === k);
              const isKnown = Boolean(f && f.basis !== "unknown");
              return (
                <div key={k} className="flex items-center justify-between gap-2 rounded-[8px] bg-[var(--chip-bg)] px-3 py-2 text-sm">
                  <span className="font-medium">{humanize(k)}</span>
                  <span className={isKnown ? "truncate text-[var(--foreground)]" : "text-[var(--muted)]"}>{isKnown ? f!.value : "Unknown"}</span>
                </div>
              );
            })}
          </div>
          {editable && brief.qualification ? (
            <FactEditor
              accountId={brief.account.id}
              workspaceId={workspaceId}
              version={brief.qualification.version}
              rationale={brief.qualification.rationale}
              facts={brief.facts}
              evidence={brief.evidence}
              onSaved={() => void loadBrief()}
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              {editable
                ? "Preparing the brief… If this doesn't change, reload the page."
                : `This brief is ${humanize(brief.account.acceptanceState).toLowerCase()} and can't be edited here.`}
            </p>
          )}
        </GuidedCard>
      ) : null}

      {flow.current === 3 && brief ? (
        <GuidedCard
          index={3}
          total={total}
          eyebrow={name}
          title="Who are the people involved?"
          why="Add real contacts only with a source. If you only think a role matters (e.g. the IT director), add it as a role to find instead of guessing a name."
          onBack={flow.back}
          onNext={flow.next}
        >
          <TourHint id="qualify.people">Optional, but it helps the SDR later. Nobody is contacted from here.</TourHint>
          <PeoplePanel accountId={brief.account.id} workspaceId={workspaceId} evidence={brief.evidence} />
        </GuidedCard>
      ) : null}

      {flow.current === 4 && brief ? (
        <GuidedCard
          index={4}
          total={total}
          eyebrow={name}
          title={submitted || brief.account.acceptanceState === "ready_for_review" ? "Sent for review" : "Send it to a sales reviewer"}
          why={
            submitted || brief.account.acceptanceState === "ready_for_review"
              ? "A sales reviewer will accept it, return it with a reason, or reject it. Returned leads come back to your list with their reason."
              : "Write why this account is worth sales time. The reviewer reads this first."
          }
          onBack={flow.back}
        >
          {submitted || brief.account.acceptanceState === "ready_for_review" ? (
            <div className="space-y-5">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--badge-green-fg)]">
                <CircleCheck size={20} aria-hidden /> {name} is waiting for review{sentTo ? ` by ${sentTo}` : ""}.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={() => {
                    setAccountId(null);
                    setSubmitted(false);
                    setNote("");
                    flow.goTo(0);
                  }}
                >
                  Qualify the next lead
                </Button>
                <Link href="/accounts/pipeline">
                  <Button>Open the pipeline</Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              <TourHint id="qualify.submit">Check the list, write the rationale, choose a reviewer and press <strong>Send for review</strong>.</TourHint>
              <ul className="mb-5 space-y-2">
                <Check ok={brief.evidence.length > 0} required>{brief.evidence.length} source{brief.evidence.length === 1 ? "" : "s"} collected</Check>
                <Check ok={reviewed > 0} required>
                  {reviewed} source{reviewed === 1 ? "" : "s"} reviewed (a reviewer needs at least one to accept)
                </Check>
                <Check ok={known > 0}>{known} brief fact{known === 1 ? "" : "s"} filled in (the rest stay Unknown)</Check>
              </ul>
              {reviewed === 0 ? (
                <RequiredBox done={false} title="mark at least one evidence source as reviewed.">
                  <button type="button" onClick={() => flow.goTo(1)} className="mt-1 font-semibold underline">
                    Go to Check the evidence →
                  </button>
                </RequiredBox>
              ) : null}
              <div className="grid gap-4">
                <Field label="Why is this account worth sales time?" required>
                  <textarea
                    className={inputClass}
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Announced a new Leeds data centre for Q1; current servers are five years old"
                  />
                </Field>
                <Field
                  label="Send to"
                  required
                  hint={
                    task
                      ? "They get a Sales review task with your note. Your research task is completed."
                      : "They get a Sales review task with your note."
                  }
                >
                  {reviewers.length ? (
                    <select className={inputClass} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                      <option value="">Choose a reviewer…</option>
                      {reviewers.some((p) => p.role === "sales_reviewer") ? (
                        <optgroup label="Sales reviewers">
                          {reviewers
                            .filter((p) => p.role === "sales_reviewer")
                            .map((p) => (
                              <option key={p.userId} value={p.userId}>
                                {p.name}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                      {reviewers.some((p) => p.role === "tenant_admin") ? (
                        <optgroup label="Tenant admins">
                          {reviewers
                            .filter((p) => p.role === "tenant_admin")
                            .map((p) => (
                              <option key={p.userId} value={p.userId}>
                                {p.name}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                    </select>
                  ) : (
                    <p className="rounded-[8px] border border-[var(--brand)] bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand-active)]">
                      There are no sales reviewers in this workspace yet. Ask your workspace admin to add one under Members.
                    </p>
                  )}
                </Field>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  disabled={busy || !editable || reviewed === 0 || !note.trim() || !reviewerId || !can("submit_review")}
                  onClick={() => void submit()}
                >
                  {busy ? "Sending…" : "Send for review"}
                </Button>
                {!editable ? (
                  <span className="text-sm text-[var(--muted)]">This lead is {humanize(brief.account.acceptanceState).toLowerCase()}.</span>
                ) : reviewed === 0 ? (
                  <span className="text-sm font-medium text-[var(--brand)]">Review at least one source first</span>
                ) : !note.trim() ? (
                  <span className="text-sm text-[var(--muted)]">Write why it&apos;s worth sales time</span>
                ) : !reviewerId ? (
                  <span className="text-sm text-[var(--muted)]">Choose a reviewer</span>
                ) : null}
              </div>
              <div className="mt-3">
                <FormError message={error} />
              </div>
            </>
          )}
        </GuidedCard>
      ) : null}
    </div>
  );
}

export default function QualifyGuidePage() {
  return <RequireCap cap="qualify">{(workspaceId) => <QualifyGuide workspaceId={workspaceId} />}</RequireCap>;
}
