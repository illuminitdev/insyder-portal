"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RequireCap } from "@/components/common/RequireCap";
import { EvidenceList } from "@/components/research/EvidenceList";
import { ScoreBreakdown } from "@/components/research/ScoreBreakdown";
import { AcceptanceActions } from "@/components/qualification/AcceptanceActions";
import { ResearchRunStatus } from "@/components/research/ResearchRunStatus";
import { HandoffPanel } from "@/components/handoffs/HandoffPanel";
import { OpportunityPanel } from "@/components/accounts/OpportunityPanel";
import { PeoplePanel } from "@/components/accounts/PeoplePanel";
import { CrmSyncPanel } from "@/components/accounts/CrmSyncPanel";
import { TaskForm } from "@/components/tasks/TaskForm";
import { TaskQueue } from "@/components/tasks/TaskQueue";
import { usePortal } from "@/hooks/usePortal";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useSkipReview } from "@/hooks/useSkipReview";
import { deleteAccount, getBrief, listPeople, setAccountArchived, type Brief } from "@/lib/api/accounts";
import { listTasks, patchTask, type Task } from "@/lib/api/tasks";
import { listResearchRuns, startResearchRun, type DiscoveryRow } from "@/lib/api/research";
import { DiscoveryResults } from "@/components/research/DiscoveryResults";
import { WhyNowCard } from "@/components/research/WhyNowCard";
import { createDraft, listDrafts, type Draft } from "@/lib/api/drafts";
import { LeadStepper, type LeadExtra, type LeadStep } from "@/components/accounts/LeadProgress";
import { QualificationBrief } from "@/components/qualification/QualificationBrief";
import { getOpportunity, type Opportunity } from "@/lib/api/opportunities";
import { getCrmStatus, type CrmAccountStatus } from "@/lib/api/crm";
import { listAccountPeople, type Contact } from "@/lib/api/contacts";
import { Archive, ArchiveRestore, Building2, Check, ChevronRight, EllipsisVertical, ListChecks, Lock, Mail, Send, Share2, Trash2, Zap } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  AccountFactsPanel,
  AccountHero,
  AccountKpis,
  AccountTabs,
  buildTimeline,
  CrmPanel,
  DecisionMakersPanel,
  Panel,
  SignalsPanel,
  TimelinePanel,
  type AccountTab,
} from "@/components/accounts/AccountOverview";
import { formatDate } from "@/lib/utils/dates";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormNotice } from "@/components/ui/Field";

/** Pre-select this account in a guided flow (guides keep their choice under these keys). */
function rememberGuideAccount(
  userId: string | undefined,
  workspaceId: string,
  guide: "qualify" | "review" | "crm",
  accountId: string,
  step = 1,
) {
  // Same per-user keys usePersistentState reads
  const scope = userId ?? "anon";
  try {
    localStorage.setItem(`insyder:${scope}:${workspaceId}:${guide}:account`, JSON.stringify(accountId));
    localStorage.setItem(`insyder:${scope}:guide:${workspaceId}:${guide}:step`, JSON.stringify(step));
  } catch {
    // storage unavailable: the guide simply starts at step 1
  }
}

// The lead's 4 steps. Each holds one or more of the parts above, shown as sections in order;
// a part is locked only while it isn't done and something it depends on isn't done either.
const GROUPS: Array<{ key: string; title: string; phase: string; why: string; parts: string[] }> = [
  {
    key: "research",
    title: "Research",
    phase: "Research",
    why: "Find public signs this company is about to buy, check each source yourself, and note who at the company would buy.",
    parts: ["research", "evidence", "people"],
  },
  {
    key: "qualify",
    title: "Qualify & send",
    phase: "Review",
    why: "Summarise why this lead is worth sales time in a brief, then send it to a named sales reviewer.",
    parts: ["qualify", "send"],
  },
  {
    key: "decision",
    title: "Sales decision",
    phase: "Review",
    why: "The sales reviewer accepts the lead (naming an owner and next action), returns it for more research, or rejects it.",
    parts: ["decision"],
  },
  {
    key: "sell",
    title: "Sell",
    phase: "Sell",
    why: "Reach out using reviewed evidence, record the deal once you have a response, and send it to your CRM.",
    parts: ["drafts", "opportunity", "crm", "handoff"],
  },
];
// Workspaces that skip the separate sales review: 3 steps, the person who qualifies accepts
const SKIP_REVIEW_GROUPS: typeof GROUPS = [
  GROUPS[0],
  {
    key: "qualify",
    title: "Qualify & accept",
    phase: "Review",
    why: "Summarise why this lead is worth sales time, then accept it yourself and choose who works it. This workspace skips the separate sales review.",
    parts: ["qualify", "send"],
  },
  GROUPS[3],
];
/** The step that holds a part. "Sales decision" only moves under Qualify when review is skipped */
const partToGroup = (key: string | null, isSkipReview = false) => {
  if (!key) return null;
  if (isSkipReview && key === "decision") return "qualify";
  const activeGroups = isSkipReview ? SKIP_REVIEW_GROUPS : GROUPS;
  return activeGroups.find((g) => g.parts.includes(key))?.key ?? key;
};

function AccountBrief({ workspaceId, accountId }: { workspaceId: string; accountId: string }) {
  const { can, user, role } = useWorkspace();
  const skipReview = useSkipReview(workspaceId);
  const { href: portalHref } = usePortal();
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [similarRunId, setSimilarRunId] = useState<string | null>(null);
  const [similarRows, setSimilarRows] = useState<DiscoveryRow[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Research start feedback: the request in flight, and an error shown next to the run's progress
  const [startingResearch, setStartingResearch] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskNotice, setTaskNotice] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [peopleNames, setPeopleNames] = useState<Map<string, string>>(new Map());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const requestedStep = useSearchParams().get("step");
  // The step chosen when the page opened, so finishing part of a step doesn't jump away from it
  const openedOn = useRef<string | null>(null);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [hypothesisCount, setHypothesisCount] = useState(0);
  // undefined = still loading, null = no deal recorded
  const [opportunity, setOpportunity] = useState<Opportunity | null | undefined>(undefined);
  const hasOpportunity = opportunity === undefined ? null : Boolean(opportunity);
  const [crmStatus, setCrmStatus] = useState<CrmAccountStatus | null>(null);
  const crmSynced = crmStatus?.status === "synced";
  const [menuOpen, setMenuOpen] = useState(false);
  // The locked menu item last clicked, whose reason stays shown
  const [menuHint, setMenuHint] = useState<string | null>(null);
  // Open the "more actions" menu upward when there isn't room below the button.
  const [menuUp, setMenuUp] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    function place() {
      const btn = menuButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const menuHeight = (menuRef.current?.offsetHeight ?? 280) + 8;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      setMenuUp(below < menuHeight && above > below);
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const skipKey = `insyder:${user?.id ?? "anon"}:${workspaceId}:${accountId}:skipped-steps`;

  // Steps the user chose to skip (People, CRM) are remembered per account
  useEffect(() => {
    try {
      setSkipped(JSON.parse(localStorage.getItem(skipKey) ?? "{}") as Record<string, boolean>);
    } catch {
      setSkipped({});
    }
  }, [skipKey]);
  function toggleSkip(key: string) {
    setSkipped((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(skipKey, JSON.stringify(next));
      } catch {
        // storage unavailable: the skip lasts for this visit only
      }
      return next;
    });
  }

  // Tabs: ?tab=overview|workflow|people|activity. A link to a step (?step=…) opens the workflow.
  const requestedTab = useSearchParams().get("tab") as AccountTab | null;
  const tab: AccountTab =
    requestedTab && ["overview", "workflow", "people", "activity"].includes(requestedTab)
      ? requestedTab
      : requestedStep
        ? "workflow"
        : "overview";

  function selectStep(key: string) {
    openedOn.current = partToGroup(key, skipReview) ?? key;
    router.replace(portalHref(`/accounts/detail?id=${accountId}&tab=workflow&step=${key}`), { scroll: false });
    let tries = 0;
    const tick = () => {
      const el = document.getElementById(`part-${key}`) || document.getElementById(`step-${key}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (tries++ < 20) {
        setTimeout(tick, 50);
      }
    };
    setTimeout(tick, 60);
  }

  useEffect(() => {
    if (requestedStep && tab === "workflow") {
      let tries = 0;
      const tick = () => {
        const el = document.getElementById(`part-${requestedStep}`) || document.getElementById(`step-${requestedStep}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (tries++ < 20) {
          setTimeout(tick, 50);
        }
      };
      setTimeout(tick, 100);
    }
  }, [requestedStep, tab]);
  function selectTab(t: AccountTab) {
    if (t === "workflow" && openedOn.current) return selectStep(openedOn.current);
    router.replace(portalHref(`/accounts/detail?id=${accountId}&tab=${t}`), { scroll: false });
  }

  // Load what the later steps need to know they're done, before they're opened
  const refreshPeople = useCallback(async () => {
    try {
      const r = await listAccountPeople(accountId, workspaceId);
      setContacts(r.contacts);
      setHypothesisCount(r.roleHypotheses.length);
      setContactCount(r.contacts.length);
    } catch {
      setContactCount((n) => n ?? 0);
    }
  }, [accountId, workspaceId]);
  useEffect(() => {
    void refreshPeople();
    void getCrmStatus(accountId, workspaceId)
      .then(setCrmStatus)
      .catch(() => setCrmStatus(null));
  }, [accountId, workspaceId, refreshPeople]);
  const refreshOpportunity = useCallback(async () => {
    try {
      setOpportunity((await getOpportunity(accountId, workspaceId)).opportunity);
    } catch {
      setOpportunity(null);
    }
  }, [accountId, workspaceId]);
  useEffect(() => {
    void refreshOpportunity();
  }, [refreshOpportunity]);

  useEffect(() => {
    if (!can("view_drafts")) return;
    void listDrafts(workspaceId, accountId)
      .then((r) => setDrafts(r.drafts))
      .catch(() => setDrafts([]));
  }, [workspaceId, accountId, can]);

  const refreshTasks = useCallback(async () => {
    if (!can("view_tasks")) return;
    try {
      setTasks((await listTasks(workspaceId, { accountId })).tasks);
    } catch {
      setTasks([]);
    }
  }, [workspaceId, accountId, can]);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);
  useEffect(() => {
    void listPeople(workspaceId)
      .then((r) => setPeopleNames(new Map(r.people.map((p) => [p.userId, p.name]))))
      .catch(() => setPeopleNames(new Map()));
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    try {
      setBrief(await getBrief(accountId, workspaceId));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load account");
    }
  }, [accountId, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // After a refresh, show the progress of research that is still running
  useEffect(() => {
    void listResearchRuns(workspaceId, { accountId, mode: "account", limit: 1 })
      .then(({ runs }) => {
        const latest = runs[0];
        if (latest && ["queued", "running", "retrying"].includes(latest.status)) setRunId(latest.id);
      })
      .catch(() => undefined);
  }, [workspaceId, accountId]);

  if (loadError) return <ErrorState message={loadError} />;
  if (!brief) return <LoadingState label="Loading brief…" />;

  const { account } = brief;
  const reviewed = brief.evidence.filter((e) => e.reviewedAt).length;

  async function runResearch() {
    if (startingResearch) return;
    setResearchError(null);
    setRunId(null);
    setStartingResearch(true);
    const previousState = account.researchState;
    // Show "Research running" at once; the run's completion reloads the real state
    setBrief((b) => (b ? { ...b, account: { ...b.account, researchState: "researching" } } : b));
    scrollToResearchStatus();
    try {
      const { researchRunId } = await startResearchRun(workspaceId, {
        mode: "account",
        query: "infrastructure expansion, hiring, refresh or procurement",
        accountId,
        budget: 3,
      });
      setRunId(researchRunId);
    } catch (e) {
      setBrief((b) => (b ? { ...b, account: { ...b.account, researchState: previousState } } : b));
      setResearchError(e instanceof Error ? e.message : "Research could not be started");
    } finally {
      setStartingResearch(false);
    }
  }

  /** Bring the research progress card into view once the Research step has rendered. */
  function scrollToResearchStatus() {
    let tries = 0;
    const tick = () => {
      const el = document.getElementById("research-run-status");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (tries++ < 20) setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function findSimilar() {
    setLocalError(null);
    setSimilarRows(null);
    try {
      const { researchRunId } = await startResearchRun(workspaceId, {
        mode: "similar",
        accountId,
        budget: 5,
      });
      setSimilarRunId(researchRunId);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Find similar failed");
    }
  }

  async function newDraft(channel: "email" | "linkedin_note" = "email", contactId?: string) {
    setLocalError(null);
    try {
      await createDraft(accountId, workspaceId, channel, contactId);
      router.push(portalHref(`/outreach/drafts?account=${accountId}&channel=${channel}`));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not create draft");
    }
  }

  async function newBothDrafts(contactId?: string) {
    setLocalError(null);
    try {
      await Promise.all([
        createDraft(accountId, workspaceId, "email", contactId),
        createDraft(accountId, workspaceId, "linkedin_note", contactId),
      ]);
      router.push(portalHref(`/outreach/drafts?account=${accountId}`));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not create drafts");
    }
  }

  // --- The lead's steps: what each needs, what it shows, and what unlocks it ---
  const state = account.acceptanceState;
  const editable = state === "draft" || state === "needs_research";
  const accepted = state === "accepted";
  const knownFacts = brief.facts.filter((f) => f.basis !== "unknown").length;
  const rationale = brief.qualification?.rationale?.trim();
  const decisions = [...brief.decisions].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const lastTo = (to: string) => decisions.find((d) => d.toState === to);
  const sent = lastTo("ready_for_review");
  const decided = decisions.find((d) => ["accepted", "rejected", "needs_research"].includes(d.toState) && d !== sent);
  const pendingDrafts = drafts.filter((d) => !d.approvedAt);
  const approvedDrafts = drafts.filter((d) => d.approvedAt);
  const actionLink = "text-sm font-semibold text-[var(--brand-active)] hover:underline";
  const guide = (to: "qualify" | "review" | "crm", step: number) => () =>
    rememberGuideAccount(user?.id, workspaceId, to, accountId, step);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const skipControl = (key: string, question: string) =>
    skipped[key] ? (
      <p className="text-sm text-[var(--muted)]">
        You skipped this step.{" "}
        <button type="button" className={actionLink} onClick={() => toggleSkip(key)}>
          Undo
        </button>
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--muted)]">{question}</span>
        <Button onClick={() => toggleSkip(key)}>Skip this step</Button>
      </div>
    );

  const researchDone = account.researchState === "researched";
  const evidenceDone = reviewed > 0;
  const sendDone = !editable;
  // Sent for review already (e.g. from Qualify a lead): the steps before it count as done
  const peopleDone = (contactCount ?? 0) > 0 || Boolean(skipped.people) || sendDone;
  const qualifyDone = (Boolean(rationale) && knownFacts > 0) || sendDone;
  const decisionDone = accepted;
  const afterAcceptance = accepted
    ? null
    : state === "rejected"
      ? "Rejected by sales. This lead stops here unless a reviewer reopens it."
      : skipReview
        ? "Opens once the lead is accepted."
        : "Opens once sales accepts the brief.";

  // Whose job each step is. Your own steps count in your progress; the rest are read-only for you.
  const STEP_OWNERS: Record<string, { roles: string[]; label: string }> = {
    research: { roles: ["researcher"], label: "the researcher" },
    evidence: { roles: ["researcher"], label: "the researcher" },
    people: { roles: ["researcher"], label: "the researcher" },
    qualify: { roles: ["researcher"], label: "the researcher" },
    send: skipReview
      ? { roles: ["researcher", "sales_reviewer"], label: "the researcher" }
      : { roles: ["researcher"], label: "the researcher" },
    decision: { roles: ["sales_reviewer"], label: "the sales reviewer" },
    drafts: { roles: ["researcher", "sdr"], label: "the researcher or SDR" },
    opportunity: { roles: ["sales_reviewer", "sdr"], label: "sales" },
    crm: { roles: [], label: "the tenant admin" },
    handoff: { roles: ["sales_reviewer"], label: "the sales reviewer" },
  };
  const isMine = (key: string) => role === "tenant_admin" || Boolean(role && STEP_OWNERS[key]?.roles.includes(role));

  // Deal stage and value are only known after contact, so Opportunity follows outreach.
  // Skips are saved per person, so only people who do outreach themselves wait on it; a
  // sales reviewer (who can't draft or skip) is never stuck behind it.
  const outreachDone = approvedDrafts.length > 0 || Boolean(skipped.drafts);
  const opportunityWaitsOnOutreach = isMine("drafts") && !outreachDone;

  type StepDraft = Omit<LeadStep, "lockedReason"> & { blockedBy?: string | null };
  const stepDrafts: StepDraft[] = [
    {
      key: "research",
      phase: "Research",
      why: "Insyder searches public sources (news, tenders, job ads) for signs this company is about to buy: a new site, infrastructure hiring, a hardware refresh. Every finding is saved with its source so anyone can check it.",
      title: "Research the company",
      done: researchDone,
      status:
        account.researchState === "researching"
          ? "Research is running…"
          : researchDone
            ? `Researched · ${plural(brief.evidence.length, "source")} found`
            : "Not researched yet",
      content: (
        <>
          <Card>
            <p className="text-sm text-[var(--muted)]">
              {researchDone
                ? "Run it again to look for newer signals. It uses the workspace's active playbook."
                : "Start research to look for buying signals. It uses the workspace's active playbook."}
            </p>
            {can("research") ? (
              <div className="mt-3">
                <Button
                  variant={researchDone ? undefined : "primary"}
                  disabled={account.researchState === "researching" || startingResearch}
                  onClick={() => void runResearch()}
                >
                  {startingResearch
                    ? "Starting…"
                    : account.researchState === "researching"
                      ? "Research running…"
                      : account.researchState === "unresearched"
                        ? "Run research"
                        : "Re-research"}
                </Button>
              </div>
            ) : null}
          </Card>
          <div id="research-run-status" className="space-y-3">
            {researchError ? <ErrorState message={researchError} /> : null}
            {startingResearch && !runId ? (
              <Card className="!p-4 text-sm" aria-live="polite">
                <span className="font-semibold">Research run</span>
                <span className="ml-2 text-[var(--muted)]">Starting…</span>
              </Card>
            ) : null}
            <ResearchRunStatus runId={runId} workspaceId={workspaceId} onFinished={() => void refresh()} />
          </div>
          <WhyNowCard account={account} workspaceId={workspaceId} canGenerate={can("research")} onGenerated={() => void refresh()} />
          <ScoreBreakdown signals={brief.signals} />
          {can("discover") && account.domain ? (
            <Card>
              <p className="text-sm text-[var(--muted)]">
                Find companies whose websites look like {account.domain}. They are added as draft accounts with no
                buying signal yet, so research them before qualifying.
              </p>
              <div className="mt-3">
                <Button onClick={() => void findSimilar()}>Find similar companies</Button>
              </div>
            </Card>
          ) : null}
          <ResearchRunStatus
            runId={similarRunId}
            workspaceId={workspaceId}
            onFinished={(run) => setSimilarRows(run.result?.rows ?? [])}
          />
          {similarRunId && similarRows?.length ? (
            <DiscoveryResults rows={similarRows} runId={similarRunId} workspaceId={workspaceId} canExport={can("export")} />
          ) : null}
        </>
      ),
    },
    {
      key: "evidence",
      phase: "Research",
      why: "Web sources can be wrong, out of date or about a different company. You open each one and confirm it before the team relies on it. Only reviewed evidence counts for acceptance and outreach.",
      title: "Check the evidence",
      done: evidenceDone,
      blockedBy: researchDone ? null : "Run research first.",
      status: brief.evidence.length
        ? `${reviewed} of ${plural(brief.evidence.length, "source")} reviewed`
        : "No evidence yet",
      content: (
        <>
          <p className="text-xs text-[var(--muted)]">
            Sources are untrusted web data. Review each item before relying on it; only reviewed evidence counts for
            acceptance and drafts. Stale = outside the {brief.eventWindowDays}-day event window or not re-checked
            recently.
          </p>
          <EvidenceList items={brief.evidence} workspaceId={workspaceId} canReview={can("review_evidence")} onChanged={refresh} />
        </>
      ),
    },
    {
      key: "people",
      phase: "Research",
      why: "Who at this company would buy? Add a real person only with a source showing where you found them. If you only know the role (e.g. Head of IT), add it as a role to find instead. Never a made-up contact.",
      title: "People",
      done: peopleDone,
      blockedBy: evidenceDone ? null : "Review at least one evidence item first.",
      status: skipped.people
        ? "Skipped"
        : !contactCount && sendDone
          ? "No contacts added"
        : contactCount
          ? plural(contactCount, "sourced contact")
          : "No contacts yet. Add one with a source, or skip.",
      content: (
        <>
          <PeoplePanel
            accountId={accountId}
            workspaceId={workspaceId}
            evidence={brief.evidence}
            onLoaded={(n) => {
              setContactCount(n);
              void refreshPeople();
            }}
          />
        </>
      ),
      footer: !contactCount && !sendDone ? skipControl("people", "No contact with a source yet?") : null,
    },
    {
      key: "qualify",
      phase: "Review",
      why: "Summarise why this lead is worth sales time: the key facts, each marked as seen in a source, a guess or confirmed, plus a short rationale. The sales reviewer decides from this brief.",
      title: "Qualification brief",
      done: qualifyDone,
      blockedBy: peopleDone ? null : "Add a sourced contact, or skip People.",
      status: `${plural(knownFacts, "fact")} filled in · rationale ${rationale ? "written" : "not written yet"}`,
      content: <QualificationBrief workspaceId={workspaceId} accountId={accountId} brief={brief} onSaved={refresh} />,
    },
    {
      key: "send",
      phase: "Review",
      why: skipReview
        ? "Accept the lead and choose who works it: you or a teammate. They get an outreach task with the first step."
        : "Hand the brief to a named sales reviewer. They get a Sales review task with your note, so it is clearly theirs to decide.",
      title: skipReview ? "Accept the lead" : "Send for sales review",
      done: sendDone,
      blockedBy: qualifyDone ? null : "Fill in the brief facts and rationale first.",
      status: skipReview && editable
        ? state === "needs_research"
          ? "Returned for more research. Fix it, then accept it."
          : "Not accepted yet"
        : skipReview && accepted
          ? `Accepted${decided ? ` by ${decided.actorName} on ${formatDate(decided.createdAt)}` : ""}`
        : state === "draft"
          ? "Not sent yet"
          : state === "needs_research"
            ? "Returned by the reviewer. Fix what they asked, then send it again."
            : sent
              ? `Sent by ${sent.actorName} on ${formatDate(sent.createdAt)}`
              : "Sent for review",
      content: (
        <>
          {state === "needs_research" && decided ? (
            <Card className="!border-[var(--brand)]">
              <p className="text-sm">
                <span className="font-semibold">Returned by {decided.actorName}</span>
                {decided.reasonDetail ? `: ${decided.reasonDetail}` : "."} Update the evidence, people or brief, then send
                it again.
              </p>
            </Card>
          ) : null}
          <AcceptanceActions
            accountId={accountId}
            workspaceId={workspaceId}
            state={account.acceptanceState}
            version={account.version}
            currentOwnerId={account.ownerUserId}
            reviewedEvidenceCount={reviewed}
            decisions={brief.decisions}
            onDone={refresh}
          />
          {!skipReview && editable && can("qualify") && can("submit_review") ? (
            <Link href="/accounts/qualify" onClick={guide("qualify", 4)} className={actionLink}>
              Or send it with the step-by-step guide →
            </Link>
          ) : null}
        </>
      ),
    },
    {
      key: "decision",
      phase: "Review",
      why: "The sales reviewer accepts it (and names an owner and next action), returns it for more research with a reason, or rejects it. Only accepted leads move on to selling.",
      title: "Sales decision",
      done: decisionDone,
      blockedBy: sendDone ? null : "Send the brief for review first.",
      status:
        state === "ready_for_review"
          ? "Waiting for a sales reviewer"
          : state === "accepted" || state === "rejected" || state === "needs_research"
            ? `${accepted ? "Accepted" : state === "rejected" ? "Rejected" : "Returned"}${
                decided ? ` by ${decided.actorName} on ${formatDate(decided.createdAt)}` : ""
              }${decided?.reasonDetail ? `: ${decided.reasonDetail}` : ""}`
            : "Not sent yet",
      content: (
        <>
          <AcceptanceActions
            accountId={accountId}
            workspaceId={workspaceId}
            state={account.acceptanceState}
            version={account.version}
            currentOwnerId={account.ownerUserId}
            reviewedEvidenceCount={reviewed}
            decisions={brief.decisions}
            onDone={refresh}
          />
          {can("accept") && state === "ready_for_review" ? (
            <Link href="/accounts/review" onClick={guide("review", 1)} className={actionLink}>
              Or review it with the step-by-step guide →
            </Link>
          ) : null}
        </>
      ),
    },
    {
      key: "drafts",
      phase: "Sell",
      why: "Write a first message using only reviewed evidence. Insyder never sends anything: you check it, approve it, then use it yourself. Outreach comes before the deal, because stage and value are only known once you've been in touch.",
      title: "Draft outreach",
      done: outreachDone,
      blockedBy: afterAcceptance,
      status: approvedDrafts.length
        ? `${approvedDrafts.length} approved, ready to use`
        : skipped.drafts
          ? "Skipped"
          : pendingDrafts.length
            ? `${plural(pendingDrafts.length, "draft")} waiting for approval`
            : "No drafts yet",
      footer: approvedDrafts.length ? null : skipControl("drafts", "Already contacted them outside Insyder?"),
      content: (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Drafts use only reviewed evidence and never send anything. Approve a draft after checking it.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Waiting for approval</dt>
              <dd className="font-semibold">{pendingDrafts.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Approved</dt>
              <dd className="font-semibold">{approvedDrafts.length}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {can("drafts") ? (
              <>
                <Button
                  variant="primary"
                  disabled={reviewed === 0}
                  title={reviewed === 0 ? "Review at least one evidence item to unlock drafts" : undefined}
                  onClick={() => void newDraft("email")}
                >
                  {reviewed === 0 ? <Lock size={14} className="-ml-1 mr-1.5" /> : <Mail size={15} className="-ml-1 mr-1.5" />}
                  Email draft
                </Button>
                <Button
                  disabled={reviewed === 0}
                  title={reviewed === 0 ? "Review at least one evidence item to unlock drafts" : undefined}
                  onClick={() => void newDraft("linkedin_note")}
                >
                  {reviewed === 0 ? (
                    <Lock size={14} className="-ml-1 mr-1.5" />
                  ) : (
                    <svg className="-ml-1 mr-1.5 h-3.5 w-3.5 fill-[#0a66c2]" viewBox="0 0 24 24">
                      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
                    </svg>
                  )}
                  LinkedIn note
                </Button>
                <Button
                  variant="secondary"
                  disabled={reviewed === 0}
                  title={reviewed === 0 ? "Review at least one evidence item to unlock drafts" : undefined}
                  onClick={() => void newBothDrafts()}
                >
                  Generate both (Email + LinkedIn)
                </Button>
              </>
            ) : null}
            {pendingDrafts.length ? (
              <Link href={`/outreach/drafts?account=${accountId}`} className={actionLink}>
                Open drafts ({pendingDrafts.length}) →
              </Link>
            ) : null}
            {approvedDrafts.length ? (
              <Link href={`/outreach/drafts?tab=approved&account=${accountId}`} className={actionLink}>
                Open approved ({approvedDrafts.length}) →
              </Link>
            ) : null}
          </div>
          {reviewed === 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50/70 p-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20">
              <span className="flex items-center gap-1.5">
                <Lock size={12} className="shrink-0 text-amber-700" />
                <span>
                  Review at least one evidence source in the{" "}
                  <button
                    type="button"
                    onClick={() => selectStep("evidence")}
                    className="font-bold underline hover:text-[var(--brand-active)] cursor-pointer"
                  >
                    Check the evidence
                  </button>{" "}
                  step to unlock outreach drafts.
                </span>
              </span>
              <button
                type="button"
                onClick={() => selectStep("evidence")}
                className="inline-flex items-center gap-1 rounded bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-300 transition cursor-pointer"
              >
                Go to evidence →
              </button>
            </div>
          ) : null}
        </Card>
      ),
    },
    {
      key: "opportunity",
      phase: "Sell",
      why: "Once you've reached out and have a response, record the deal: its stage and value. It is kept separate from acceptance, so pipeline reports only count real deals.",
      title: "Opportunity",
      done: hasOpportunity === true,
      // A deal recorded before this order existed stays open to edit
      blockedBy:
        afterAcceptance ??
        (opportunityWaitsOnOutreach && !hasOpportunity ? "Approve an outreach draft first, or skip Draft outreach." : null),
      status: hasOpportunity ? "Deal recorded" : "No deal recorded yet",
      content: (
        <Card>
          <OpportunityPanel accountId={accountId} workspaceId={workspaceId} onSaved={() => void refreshOpportunity()} />
        </Card>
      ),
    },
    {
      key: "crm",
      phase: "Sell",
      why: "Copy the company, its sourced contacts and the deal into your CRM, so sales works from one system. Nothing is sent until you confirm.",
      title: "Send to CRM",
      done: crmSynced || Boolean(skipped.crm),
      blockedBy: afterAcceptance,
      status: skipped.crm ? "Skipped" : crmSynced ? "Synced" : "Not sent yet",
      content: (
        <>
          <CrmSyncPanel
            accountId={accountId}
            workspaceId={workspaceId}
            acceptanceState={account.acceptanceState}
            onStatus={setCrmStatus}
          />
        </>
      ),
      footer: !crmSynced ? skipControl("crm", "Not using a CRM for this lead?") : null,
    },
  ];
  if (can("handoff")) {
    stepDrafts.push({
      key: "handoff",
      phase: "Sell",
      why: "Share selected parts of the brief with a partner company. They see only the fields you choose, nothing else.",
      title: "Partner handoff",
      done: false,
      optional: true,
      blockedBy: afterAcceptance,
      status: "Share with a partner if needed",
      content: <HandoffPanel accountId={accountId} workspaceId={workspaceId} acceptanceState={account.acceptanceState} />,
    });
  }


  const steps: LeadStep[] = (skipReview ? SKIP_REVIEW_GROUPS : GROUPS).map((g) => {
    const parts = g.parts
      .map((k) => stepDrafts.find((p) => p.key === k))
      .filter((p): p is StepDraft => Boolean(p))
      .map(({ blockedBy, ...p }) => ({ ...p, locked: p.done ? null : (blockedBy ?? null), partMine: isMine(p.key) }));
    const required = parts.filter((p) => !p.optional);
    const done = required.every((p) => p.done);
    const next = required.find((p) => !p.done);
    const owners = [...new Set(parts.filter((p) => !p.optional).map((p) => STEP_OWNERS[p.key]?.label).filter(Boolean))];
    return {
      key: g.key,
      title: g.title,
      phase: g.phase,
      why: g.why,
      done,
      // The step opens once its first part can be worked on
      lockedReason: done ? null : (parts[0]?.locked ?? null),
      status:
        required.length === 1
          ? (required[0]?.status ?? "")
          : done
            ? `All ${required.length} parts done`
            : `${required.filter((p) => p.done).length} of ${required.length} done · next: ${next?.title}`,
      mine: parts.some((p) => p.partMine && !p.optional),
      ownerLabel: owners.join(", "),
      content: (
        <div className="space-y-6">
          {parts.map((p, i) => (
            <section key={p.key} id={`part-${p.key}`} className="space-y-3">
              {parts.length > 1 ? (
                <div
                  className={`flex items-start gap-3 rounded-[14px] border bg-white px-4 py-3.5 sm:px-5 ${
                    p.locked ? "border-dashed border-[var(--line)]" : "border-[var(--line)]"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                      p.done
                        ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
                        : p.locked
                          ? "border border-[var(--line)] text-[var(--muted)]"
                          : "bg-[var(--brand)] text-[var(--on-brand)]"
                    }`}
                    aria-hidden
                  >
                    {p.done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <div className={`min-w-0 flex-1 ${p.locked ? "opacity-60" : ""}`}>
                    <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold leading-snug text-[var(--foreground)]">
                      {p.title}
                      {p.done ? <Badge tone="green">Done</Badge> : null}
                      {p.optional ? <Badge>Optional</Badge> : null}
                      {!p.partMine ? (
                        <span className="text-[12px] font-normal text-[var(--muted)]">
                          Read only · {STEP_OWNERS[p.key]?.label ?? "another role"}
                        </span>
                      ) : null}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-[var(--muted)]">{p.locked ?? p.status}</p>
                    {p.why && !p.locked && !p.done ? (
                      <p className="mt-2 border-t border-[var(--line)] pt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">{p.why}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {p.locked ? null : (
                <>
                  {p.content}
                  {p.partMine && p.footer ? <div>{p.footer}</div> : null}
                </>
              )}
            </section>
          ))}
        </div>
      ),
    };
  });

  const extras: LeadExtra[] = can("view_tasks")
    ? [
        {
          key: "tasks",
          title: `Tasks on this account (${tasks.length})`,
          content: (
            <>
              {can("tasks") ? (
                <div>
                  <Button
                    onClick={() => {
                      setTaskNotice(null);
                      setShowTaskForm((s) => !s);
                    }}
                  >
                    {showTaskForm ? "Hide task form" : "Add a task for this account"}
                  </Button>
                  {showTaskForm ? (
                    <div className="mt-3">
                      <TaskForm
                        workspaceId={workspaceId}
                        accountId={accountId}
                        onCreated={(message) => {
                          setShowTaskForm(false);
                          setTaskNotice(message);
                          void refreshTasks();
                        }}
                      />
                    </div>
                  ) : null}
                  <FormNotice message={taskNotice} />
                </div>
              ) : null}
              {tasks.length ? (
                <TaskQueue
                  tasks={tasks}
                  accountNames={new Map([[accountId, account.name]])}
                  accounts={new Map([[accountId, account]])}
                  peopleNames={peopleNames}
                  canEdit={can("tasks")}
                  onUpdate={async (taskId, body) => {
                    await patchTask(taskId, { workspaceId, ...body });
                    await refreshTasks();
                  }}
                  workspaceId={workspaceId}
                  onAccountChanged={() => {
                    void refresh();
                    void refreshTasks();
                  }}
                  onSent={(message) => setTaskNotice(message)}
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">No tasks on this account yet.</p>
              )}
            </>
          ),
        },
      ]
    : [];

  // Which step to show: the one in the URL if it's open, else where the work is
  const isOpen = (key: string | null) =>
    key && (steps.some((s) => s.key === key && !s.lockedReason) || extras.some((e) => e.key === key)) ? key : null;
  const current = steps.find((s) => s.mine && !s.done && !s.lockedReason && !s.optional)?.key;
  const selected =
    // Links to an old step (e.g. ?step=evidence) open the step that now holds it
    isOpen(partToGroup(requestedStep, skipReview)) ??
    isOpen(openedOn.current) ??
    (state === "needs_research" && isMine("evidence") ? "research" : null) ??
    current ??
    [...steps].reverse().find((s) => s.mine && !s.lockedReason)?.key ??
    [...steps].reverse().find((s) => !s.lockedReason)?.key ??
    "research";
  openedOn.current = selected;

  // --- Page header: next step, quick actions and the overview's data ---
  const counted = steps.filter((s) => !s.optional);
  const progress = `${counted.filter((s) => s.done).length}/${counted.length}`;
  const nextStep = steps.find((s) => s.key === current);
  const researching = account.researchState === "researching";
  const timeline = buildTimeline(brief, { opportunity, crm: crmStatus, tasks });

  function startResearch() {
    void runResearch();
    selectStep("research");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      setLocalError("Could not copy the link. Copy it from the address bar instead.");
    }
  }

  const researchAction = {
    label: startingResearch ? "Starting…" : researching ? "Research running…" : researchDone ? "Re-run research" : "Run research",
    Icon: Zap,
    onClick: startResearch,
    disabled: researching || startingResearch,
  };
  const primary = nextStep
    ? { label: `Continue: ${nextStep.title}`, Icon: ListChecks, onClick: () => selectStep(nextStep.key), disabled: false }
    : can("research")
      ? researchAction
      : { label: "Open lead workflow", Icon: ListChecks, onClick: () => selectTab("workflow"), disabled: false };
  const secondary =
    accepted && can("drafts")
      ? { label: "Create draft", Icon: Send, onClick: () => void newDraft(), disabled: reviewed === 0 }
      : nextStep && can("research")
        ? researchAction
        : null;
  /** disabledReason: shown greyed out with this hint instead of being hidden */
  type MenuItem = { label: string; icon?: React.ReactNode; onClick: () => void; disabledReason?: string };

  async function setArchived(archived: boolean) {
    setArchiveBusy(true);
    setLocalError(null);
    try {
      await setAccountArchived(accountId, workspaceId, archived);
      await refresh();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : `Could not ${archived ? "archive" : "restore"} the account`);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(accountId, workspaceId);
      router.push(portalHref("/accounts/watchlist"));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete the account");
      setDeleting(false);
    }
  }
  const draftsLocked = reviewed === 0 ? "Review at least one evidence item first (Research step)" : undefined;
  const menuItems: MenuItem[] = (
    [
      can("discover")
        ? {
            label: "Find similar companies",
            disabledReason: account.domain ? undefined : "Needs the company's website (domain)",
            icon: <Building2 size={16} className="text-[var(--link)]" />,
            onClick: () => {
              void findSimilar();
              selectStep("research");
            },
          }
        : null,
      can("drafts")
        ? {
            label: "Create email draft",
            disabledReason: draftsLocked,
            icon: <Mail size={16} className="text-[var(--brand-active)]" />,
            onClick: () => void newDraft("email"),
          }
        : null,
      can("drafts")
        ? {
            label: "Create LinkedIn note",
            disabledReason: draftsLocked,
            icon: (
              <svg className="h-4 w-4 fill-[#0a66c2]" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
              </svg>
            ),
            onClick: () => void newDraft("linkedin_note"),
          }
        : null,
      can("drafts")
        ? {
            label: "Generate both (Email + LinkedIn)",
            disabledReason: draftsLocked,
            icon: <Send size={16} className="text-purple-600" />,
            onClick: () => void newBothDrafts(),
          }
        : null,
      can("tasks")
        ? {
            label: "Add a task",
            icon: <ListChecks size={16} className="text-[var(--plum)]" />,
            onClick: () => {
              setShowTaskForm(true);
              selectStep("tasks");
            },
          }
        : null,
      {
        label: "Copy link to this account",
        icon: <Share2 size={16} className="text-[var(--plum)]" />,
        onClick: () => void copyLink(),
      },
      can("import")
        ? account.archivedAt
          ? {
              label: "Restore account",
              icon: <ArchiveRestore size={16} className="text-[var(--plum)]" />,
              onClick: () => void setArchived(false),
            }
          : {
              label: "Archive account (not relevant)",
              icon: <Archive size={16} className="text-[var(--plum)]" />,
              onClick: () => void setArchived(true),
            }
        : null,
      can("manage_settings")
        ? {
            label: "Delete account",
            icon: <Trash2 size={16} className="text-[var(--danger)]" />,
            onClick: () => {
              setDeleteError(null);
              setDeleteOpen(true);
            },
          }
        : null,
    ] as Array<MenuItem | null>
  ).filter((i): i is MenuItem => Boolean(i));

  const actions = (
    <>
      {secondary ? (
        <button
          type="button"
          disabled={secondary.disabled}
          onClick={secondary.onClick}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[12px] border border-[var(--card-line)] bg-white px-4 py-2.5 text-[14.5px] font-semibold text-[var(--foreground)] shadow-[0_2px_8px_rgba(13,27,42,0.06)] transition hover:text-[var(--brand-active)] disabled:opacity-50"
        >
          <secondary.Icon size={17} className="text-[var(--link)]" aria-hidden />
          {secondary.label}
        </button>
      ) : null}
      <button
        type="button"
        disabled={primary.disabled}
        onClick={primary.onClick}
        className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[12px] bg-gradient-to-r from-[var(--brand-active)] to-[var(--brand)] px-4 py-2.5 text-[14.5px] font-semibold text-[var(--on-gradient)] transition hover:brightness-110 disabled:opacity-60"
      >
        <primary.Icon size={17} aria-hidden />
        {primary.label}
      </button>
    </>
  );

  const moreMenu = (
      <div className="relative">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuHint(null);
            setMenuOpen((o) => !o);
          }}
          className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-white text-[var(--foreground)] shadow-[0_4px_14px_rgba(13,27,42,0.1)] hover:text-[var(--brand-active)]"
        >
          <EllipsisVertical size={20} aria-hidden />
        </button>
        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
            <div
              ref={menuRef}
              role="menu"
              className={`absolute right-0 z-50 w-64 rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_16px_40px_rgba(13,27,42,0.18)] ${
                menuUp ? "bottom-full mb-2" : "top-full mt-2"
              }`}
            >
              {menuItems.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  role="menuitem"
                  // Not the disabled attribute: a locked item must still react to hover and click to explain itself
                  aria-disabled={Boolean(m.disabledReason)}
                  onClick={() => {
                    if (m.disabledReason) {
                      setMenuHint(m.label);
                      return;
                    }
                    setMenuHint(null);
                    setMenuOpen(false);
                    m.onClick();
                  }}
                  className={`group flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] font-medium text-[var(--plum)] transition-colors ${
                    m.disabledReason
                      ? "cursor-not-allowed"
                      : "hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]"
                  }`}
                >
                  {m.icon ? <span className={`mt-0.5 shrink-0 ${m.disabledReason ? "opacity-50" : ""}`}>{m.icon}</span> : null}
                  <span className="min-w-0">
                    <span className={`block ${m.disabledReason ? "opacity-50" : ""}`}>{m.label}</span>
                    {m.disabledReason ? (
                      <span
                        role="status"
                        className={`mt-0.5 text-[12px] font-normal text-[var(--brand-active)] ${
                          menuHint === m.label ? "block" : "hidden group-hover:block group-focus-visible:block"
                        }`}
                      >
                        {m.disabledReason}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-3 text-[16px]">
          <Link
            href="/accounts/pipeline"
            className="inline-flex items-center gap-2 text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
          >
            <Building2 size={18} aria-hidden /> Accounts
          </Link>
          <ChevronRight size={16} className="text-[var(--muted)]" aria-hidden />
          <span className="truncate font-semibold">{account.name}</span>
          <span
            className="rounded-full bg-[var(--lilac)] px-3 py-1 text-[13.5px] font-semibold text-[var(--foreground)]"
            title={account.id}
          >
            ID: {account.id.slice(0, 8).toUpperCase()}
          </span>
        </nav>
        {researching ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[14.5px] font-semibold text-[var(--badge-green-fg)] shadow-[0_2px_10px_rgba(13,27,42,0.06)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#22a35a]" aria-hidden /> Research running
          </span>
        ) : null}
      </div>

      <AccountHero brief={brief} crm={crmStatus} actions={actions} menu={moreMenu} />

      {account.archivedAt ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-line)] bg-white p-3.5 text-sm text-[var(--plum)]"
        >
          <span className="inline-flex items-center gap-2">
            <Archive size={16} className="text-[var(--brand-active)]" aria-hidden />
            Archived {formatDate(account.archivedAt)} as not relevant. It is hidden from your account lists and research
            doesn&apos;t add new results to it.
          </span>
          {can("import") ? (
            <Button onClick={() => void setArchived(false)} disabled={archiveBusy}>
              <span className="inline-flex items-center gap-1.5">
                <ArchiveRestore size={14} aria-hidden />
                {archiveBusy ? "Restoring…" : "Restore"}
              </span>
            </Button>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={deleteOpen}
        onClose={() => (deleting ? undefined : setDeleteOpen(false))}
        title={`Delete ${account.name}?`}
        description="The account, its evidence, people and drafts disappear for everyone in this workspace, open tasks on it are cancelled, and research won't add this company again. To keep it but hide it, archive it instead."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            {!account.archivedAt && can("import") ? (
              <Button
                onClick={() => {
                  setDeleteOpen(false);
                  void setArchived(true);
                }}
                disabled={deleting}
              >
                Archive instead
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-transparent bg-[var(--danger)] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              <Trash2 size={14} aria-hidden />
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
        }
      >
        {deleteError ? <p className="text-sm text-[var(--danger)]">{deleteError}</p> : null}
      </Modal>

      {localError ? <ErrorState message={localError} /> : null}

      <AccountKpis brief={brief} contacts={contacts} opportunity={opportunity} />

      <AccountTabs tab={tab} onChange={selectTab} progress={progress} peopleCount={contactCount ?? contacts.length} />

      {tab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            <SignalsPanel brief={brief} limit={5} onOpenEvidence={() => selectStep("evidence")} />
            <DecisionMakersPanel
              contacts={contacts}
              hypotheses={hypothesisCount}
              onSeeAll={() => selectTab("people")}
              onDraftContact={can("drafts") ? (contactId, channel) => void newDraft(channel, contactId) : undefined}
              reviewedEvidenceCount={reviewed}
              onReviewEvidence={() => selectStep("evidence")}
            />
            <AccountFactsPanel brief={brief} />
          </div>
          <div className="min-w-0 space-y-6">
            <WhyNowCard account={account} workspaceId={workspaceId} canGenerate={can("research")} onGenerated={() => void refresh()} />
            <CrmPanel
              crm={crmStatus}
              brief={brief}
              onSendToCrm={can("manage_integrations") && accepted ? () => selectStep("sell") : null}
            />
            <TimelinePanel events={timeline} limit={5} onSeeAll={() => selectTab("activity")} />
          </div>
        </div>
      ) : tab === "workflow" ? (
        <LeadStepper steps={steps} extras={extras} selected={selected} onSelect={selectStep} />
      ) : tab === "people" ? (
        <Panel>
          <PeoplePanel
            accountId={accountId}
            workspaceId={workspaceId}
            evidence={brief.evidence}
            onLoaded={(n) => {
              setContactCount(n);
              void refreshPeople();
            }}
          />
        </Panel>
      ) : (
        <TimelinePanel events={timeline} />
      )}
    </div>
  );
}

export default function AccountBriefPage() {
  const accountId = useSearchParams().get("id") ?? "";
  return (
    <RequireCap cap="view_accounts">
      {(workspaceId) => <AccountBrief workspaceId={workspaceId} accountId={accountId} />}
    </RequireCap>
  );
}
