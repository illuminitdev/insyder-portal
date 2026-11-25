"use client";

import { LeadContactDetails, leadContacts } from "@/components/research/LeadContactDetails";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  CheckSquare,
  ChevronDown,
  CircleCheck,
  Download,
  ExternalLink,
  History,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { RequireCap } from "@/components/common/RequireCap";
import { StatusBadge } from "@/components/common/StatusBadge";
import { GuidedCard } from "@/components/guide/GuidedCard";
import { GuideHeader } from "@/components/guide/GuideHeader";
import { Stepper, type GuideStep } from "@/components/guide/Stepper";
import { TourHint } from "@/components/guide/TourHint";
import { ResearchRunStatus } from "@/components/research/ResearchRunStatus";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { usePagination } from "@/components/ui/Pagination";
import { useGuidedFlow } from "@/hooks/useGuidedFlow";
import { usePersistentState } from "@/hooks/usePersistentState";
import { usePortal } from "@/hooks/usePortal";
import { useWorkspace } from "@/hooks/useWorkspace";
import { downloadFile, listPeople } from "@/lib/api/accounts";
import { savePlaybookFromRun } from "@/lib/api/playbooks";
import {
  deleteResearchRun,
  getResearchRun,
  listResearchRuns,
  parseBrief,
  startResearchRun,
  type DiscoveryRow,
  type ParsedBrief,
  type ResearchRunSummary,
} from "@/lib/api/research";
import { getOffer, type Offer, type Playbook } from "@/lib/api/settings";
import { createTask } from "@/lib/api/tasks";
import { formatDate } from "@/lib/utils/dates";
import { makeExclusionMatcher } from "@/lib/utils/exclusions";
import { ROLE_LABELS } from "@/lib/auth/capabilities";
import { CountryPicker } from "@/components/ui/CountryPicker";
import { countryName } from "@/lib/countries";

const ALL_STEPS: GuideStep[] = [
  { key: "find", label: "Find leads" },
  { key: "choose", label: "Choose leads" },
  { key: "assign", label: "Assign researcher" },
  { key: "done", label: "Done" },
];

const DEFAULT_INSTRUCTION =
  "Research and qualify this lead: check the evidence, fill in the qualification brief, then submit it for sales review.";

const SIGNALS = ["expansion", "infra_hiring", "refresh", "compute", "procurement"];

/** quick = articles found right now (web search); list = a larger, criteria-checked company list */
type SearchType = "quick" | "list";
const MAX_RESULTS: Record<SearchType, number> = { quick: 10, list: 25 };
const split = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type Person = { userId: string; name: string; email: string; role: string };
type Assigned = { researcherName: string; due: string; ok: string[]; failed: Array<{ name: string; error: string }> };

function inDays(n: number) {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function FindAndAssign({ workspaceId }: { workspaceId: string }) {
  const { can, user } = useWorkspace();
  const { portal } = usePortal();
  // Members who can't create tasks search and pick leads, but don't assign
  const canAssign = can("tasks");
  // Outside the admin portal (the researcher's own "Find leads"), chosen leads become your own tasks
  const selfOnly = portal.key !== "admin";
  const STEPS = (canAssign ? ALL_STEPS : ALL_STEPS.slice(0, 2)).map((s) =>
    selfOnly && s.key === "assign" ? { ...s, label: "Add to my leads" } : s,
  );

  const k = (s: string) => `${workspaceId}:assign:${s}`;
  const [brief, setBrief] = usePersistentState(k("brief"), "");
  const [runId, setRunId] = usePersistentState<string | null>(k("run"), null);
  const [selected, setSelected] = usePersistentState<string[]>(k("selected"), []);
  const [researcherId, setResearcherId] = usePersistentState(k("researcher"), "");
  const [due, setDue] = usePersistentState(k("due"), inDays(3));
  const [instruction, setInstruction] = usePersistentState(k("instruction"), DEFAULT_INSTRUCTION);
  const [assigned, setAssigned] = usePersistentState<Assigned | null>(k("assigned"), null);
  const [budget, setBudget] = usePersistentState(k("budget"), 5);
  const [searchType, setSearchType] = usePersistentState<SearchType>(k("searchType"), "quick");
  const maxResults = MAX_RESULTS[searchType];
  // The open run's kind and brief, so a list can be refreshed with the same description
  const [runInfo, setRunInfo] = useState<{ mode: string; brief: string | null } | null>(null);

  // Advanced filters: empty means "use what the brief says, else the workspace defaults"
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // ISO codes; the picker shows names only
  const [countries, setCountries] = useState<string[]>([]);
  const [industries, setIndustries] = useState("");
  const [signals, setSignals] = useState<string[]>([]);
  const [windowDays, setWindowDays] = useState("");
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState("");
  const selectedPlaybook = playbooks.find((p) => p.id === playbookId);
  const [offer, setOffer] = useState<Offer | null>(null);

  const [parsed, setParsed] = useState<ParsedBrief | null>(null);
  // Each search costs research units, so it runs only after the user has reviewed what will be searched
  const [reviewing, setReviewing] = useState(false);
  const [rows, setRows] = useState<DiscoveryRow[]>([]);
  const [recent, setRecent] = useState<ResearchRunSummary[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recentPages = usePagination(recent, 5);

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [playbookName, setPlaybookName] = useState("");
  const [playbookDesc, setPlaybookDesc] = useState("");
  const [discoveryQ, setDiscoveryQ] = useState("");
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [savePlaybookError, setSavePlaybookError] = useState<string | null>(null);
  const [playbookNotice, setPlaybookNotice] = useState<string | null>(null);

  // Results of the chosen search (also restores them after a refresh)
  const loadRun = useCallback(
    async (id: string) => {
      try {
        const { researchRun } = await getResearchRun(id, workspaceId);
        setRows(researchRun.result?.rows ?? []);
        setRunInfo({ mode: researchRun.mode, brief: researchRun.brief ?? null });
      } catch {
        setRows([]);
        setRunInfo(null);
      }
    },
    [workspaceId],
  );

  const loadPlaybooks = useCallback(async () => {
    try {
      const r = await getOffer(workspaceId);
      setOffer(r.offer);
      if (r.offer?.territory.length) setCountries((c) => (c.length ? c : r.offer!.territory));
      setPlaybooks(r.playbooks);
      return { playbooks: r.playbooks, activeKey: r.offer?.activePlaybookTemplateKey ?? "infrastructure" };
    } catch {
      setPlaybooks([]);
      return { playbooks: [], activeKey: "infrastructure" };
    }
  }, [workspaceId]);

  function handleOpenSavePlaybook() {
    const fallbackName = (brief || "Search Playbook").slice(0, 50).trim();
    setPlaybookName(fallbackName);
    setPlaybookDesc(brief.slice(0, 200));
    setDiscoveryQ(selectedPlaybook?.rules.discoveryQuestion ?? "");
    setSavePlaybookError(null);
    setSaveModalOpen(true);
  }

  async function handleSavePlaybook() {
    if (!runId) return;
    setSavingPlaybook(true);
    setSavePlaybookError(null);
    try {
      const res = await savePlaybookFromRun(workspaceId, runId, {
        name: playbookName.trim(),
        description: playbookDesc.trim() || undefined,
        discoveryQuestion: discoveryQ.trim() || undefined,
      });
      const { playbooks: updated } = await loadPlaybooks();
      if (res.playbook?.id) {
        setPlaybookId(res.playbook.id);
      } else if (updated.length > 0) {
        setPlaybookId(updated[0].id);
      }
      setSaveModalOpen(false);
      setPlaybookNotice(`Playbook "${res.playbook?.name || playbookName}" saved successfully. It is now available in searches and monitors.`);
    } catch (err) {
      setSavePlaybookError(err instanceof Error ? err.message : "Failed to save playbook");
    } finally {
      setSavingPlaybook(false);
    }
  }

  const loadRecent = useCallback(async () => {
    try {
      const { runs } = await listResearchRuns(workspaceId, { mode: ["discovery", "webset"], limit: 50 });
      setRecent(runs);
    } catch {
      setRecent([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (runId) void loadRun(runId);
  }, [runId, loadRun]);

  useEffect(() => {
    void loadRecent();
    if (canAssign && !selfOnly) {
      void listPeople(workspaceId)
        .then((r) => setPeople(r.people))
        .catch(() => setPeople([]));
    }
    void loadPlaybooks().then(({ playbooks: pbs, activeKey }) => {
      setPlaybookId((curr) => {
        if (curr === "none") return "none";
        if (curr && pbs.some((p) => p.id === curr)) return curr;
        return pbs.find((p) => p.templateKey === activeKey)?.id ?? pbs[0]?.id ?? "none";
      });
    });
  }, [workspaceId, canAssign, selfOnly, loadRecent, loadPlaybooks]);

  // Read the description as the user types (free, no units), so they see what it will search for
  useEffect(() => {
    const text = brief.trim();
    if (text.length < 5) {
      setParsed(null);
      return;
    }
    const t = setTimeout(() => {
      void parseBrief(workspaceId, text)
        .then(setParsed)
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(t);
  }, [brief, workspaceId]);

  // Any change after reviewing means the reviewed search is no longer the one that would run
  useEffect(() => {
    setReviewing(false);
  }, [brief, countries, industries, signals, windowDays, playbookId, budget, searchType]);

  const isNoPlaybook = playbookId === "none";

  // What the search will actually use: a filled-in field wins over what was read from the description
  const plan = useMemo(() => {
    const s = parsed?.structured;
    const planCountries = countries.length ? countries : (s?.countries ?? []);
    const planIndustries = industries.trim() ? split(industries) : (s?.industries ?? []);
    const planSignals = signals.length ? signals : (isNoPlaybook ? [] : (s?.signalKinds ?? []));
    const planWindow = windowDays
      ? Number(windowDays)
      : isNoPlaybook
        ? null
        : (s?.eventWindowDays ?? selectedPlaybook?.rules.eventWindowDays ?? offer?.eventWindowDays ?? 90);
    const words = brief.trim().split(/\s+/).filter(Boolean).length;
    const units = Math.min(budget, maxResults);
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (words < 4) blockers.push("Describe the companies in a few more words: who they are, where, and what they're doing.");
    if (!planCountries.length)
      blockers.push("Add at least one country. Without one the search runs worldwide (e.g. \"councils\" returns US results).");
    if (!planIndustries.length) warnings.push("No industry set. Results may cover any sector.");
    if (!isNoPlaybook && !planSignals.length && !selectedPlaybook?.rules.signals.length)
      warnings.push("No buying signal set. Results may not be showing any intent to buy.");
    return { planCountries, planIndustries, planSignals, planWindow, units, blockers, warnings };
  }, [parsed, countries, industries, signals, windowDays, offer, brief, budget, maxResults, selectedPlaybook, isNoPlaybook]);

  // How many of the "More filters" are set, shown on the button while it's closed
  const moreFiltersSet = (signals.length ? 1 : 0) + (windowDays ? 1 : 0);

  const isExcluded = useMemo(() => makeExclusionMatcher(offer?.exclusions ?? []), [offer]);
  const leads = useMemo(() => rows.filter((r) => !isExcluded(r)), [rows, isExcluded]);
  const chosen = leads.filter((r) => selected.includes(r.accountId));
  const researchers = people.filter((p) => p.role === "researcher");
  const others = people.filter((p) => p.role === "tenant_admin");
  const researcher = selfOnly
    ? user
      ? { userId: user.id, name: "you" }
      : undefined
    : people.find((p) => p.userId === researcherId);

  const reachable = Math.min(STEPS.length - 1, assigned ? 3 : chosen.length ? 2 : leads.length ? 1 : 0);
  const flow = useGuidedFlow(`${workspaceId}:assign`, STEPS.length, reachable);

  function openRun(id: string) {
    setRows([]);
    setSelected([]);
    setRunId(id);
  }

  /** Check the search before spending units: shows exactly what will run and what it costs */
  async function reviewSearch() {
    setError(null);
    try {
      setParsed(await parseBrief(workspaceId, brief.trim()));
    } catch {
      // The live reading is enough to review; the backend checks again when the search starts
    }
    setReviewing(true);
  }

  async function runSearch() {
    if (plan.blockers.length) return;
    setBusy(true);
    setError(null);
    try {
      // Exactly what the user reviewed (filled-in fields win over what was read from the brief)
      const { researchRunId } = await startResearchRun(workspaceId, {
        mode: searchType === "list" ? "webset" : "discovery",
        query: brief.trim(),
        brief: brief.trim(),
        budget: plan.units,
        playbookVersionId: isNoPlaybook ? "none" : (playbookId || undefined),
        filters: {
          countries: plan.planCountries,
          industries: plan.planIndustries.length ? plan.planIndustries : undefined,
          signalKinds: isNoPlaybook ? [] : (plan.planSignals.length ? plan.planSignals : undefined),
          eventWindowDays: windowDays ? Number(windowDays) : (isNoPlaybook ? null : (parsed?.structured.eventWindowDays ?? undefined)),
        },
      });
      setReviewing(false);
      openRun(researchRunId);
      void loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the search");
    } finally {
      setBusy(false);
    }
  }

  /** Add new matches to the open list (searches again and appends to the same list). */
  async function refreshList() {
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      const listBrief = runInfo?.brief ?? brief.trim();
      const { researchRunId } = await startResearchRun(workspaceId, {
        mode: "webset",
        query: listBrief,
        brief: listBrief,
        budget: Math.min(budget, MAX_RESULTS.list),
        refreshRunId: runId,
        playbookVersionId: isNoPlaybook ? "none" : (playbookId || undefined),
      });
      openRun(researchRunId);
      void loadRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh the list");
    } finally {
      setBusy(false);
    }
  }

  async function removeRun(id: string) {
    if (!confirm("Are you sure you want to delete this search?")) return;
    try {
      await deleteResearchRun(workspaceId, id);
      setRecent((prev) => prev.filter((r) => r.id !== id));
      if (runId === id) {
        setRunId(null);
        setRows([]);
        setSelected([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete search");
    }
  }

  async function assign() {
    if (!researcher) return;
    setBusy(true);
    setError(null);
    const ok: string[] = [];
    const failed: Assigned["failed"] = [];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const lead of chosen) {
      try {
        await createTask({
          workspaceId,
          accountId: lead.accountId,
          type: "research",
          ownerUserId: researcher.userId,
          dueAt: new Date(`${due}T17:00:00`).toISOString(),
          timezone,
          instruction: instruction.trim() || undefined,
          // Same search + lead + researcher never creates a second task, even if clicked twice
          idempotencyKey: `assign:${runId}:${lead.accountId}:${researcher.userId}`,
        });
        ok.push(lead.name);
      } catch (e) {
        failed.push({ name: lead.name, error: e instanceof Error ? e.message : "Could not create the task" });
      }
    }
    setAssigned({ researcherName: researcher.name, due, ok, failed });
    setBusy(false);
    flow.goTo(3);
  }

  function startOver() {
    setAssigned(null);
    setSelected([]);
    flow.goTo(0);
  }

  const total = STEPS.length;

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <GuideHeader
        eyebrow="Discover · Find & assign"
        title={
          canAssign && selfOnly
            ? "Find new leads and add them to your own list, step by step."
            : canAssign
            ? "Find new leads and hand them to a researcher, step by step."
            : "Find new leads and pick the ones worth researching."
        }
        actions={
          <Button onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            <span className="inline-flex items-center gap-1.5">
              <History size={15} aria-hidden /> History{recent.length ? ` (${recent.length})` : ""}
            </span>
          </Button>
        }
      />

      {showHistory ? (
        <section className="rounded-[16px] border border-[var(--line)] bg-white px-6 py-5 shadow-[0_10px_30px_-18px_rgba(23,44,64,0.25)] sm:px-9">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--foreground)]">Search history</h2>
              <p className="text-xs text-[var(--muted)]">
                Open a past search to see its results again. This doesn&apos;t use research units.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close history"
              onClick={() => setShowHistory(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--chip-bg)] hover:text-[var(--foreground)]"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">No searches yet in this workspace.</p>
          ) : (
            <>
              <ul className="divide-y divide-[var(--line)]">
                {recentPages.pageItems.map((r) => {
                  const current = r.id === runId;
                  return (
                    <li
                      key={r.id}
                      className={`flex items-center gap-2 rounded-lg p-1 ${current ? "bg-[var(--brand-tint)]" : "hover:bg-[var(--chip-bg)]"}`}
                    >
                      <span className="min-w-0 flex-1 px-2 py-2 text-sm">
                        <span className="block truncate font-medium text-[var(--foreground)]">{r.brief ?? r.query}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                          {r.mode === "webset" ? <Badge>List</Badge> : null}
                          {r.companies != null ? (
                            <span>
                              {r.companies} {r.companies === 1 ? "company" : "companies"}
                            </span>
                          ) : (
                            <StatusBadge status={r.status} />
                          )}
                          <span>· {formatDate(r.createdAt)}</span>
                        </span>
                      </span>
                      <Button
                        variant="quiet"
                        aria-current={current ? "true" : undefined}
                        disabled={current}
                        onClick={() => {
                          openRun(r.id);
                          setShowHistory(false);
                          flow.goTo(0);
                        }}
                      >
                        {current ? "Open now" : "Open results"}
                      </Button>
                      <button
                        type="button"
                        aria-label="Delete this search"
                        title="Delete this search"
                        onClick={() => void removeRun(r.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--muted)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]"
                      >
                        <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {recentPages.pager}
            </>
          )}
        </section>
      ) : null}

      <Stepper steps={STEPS} current={flow.current} reachable={reachable} onSelect={flow.goTo} />

      {flow.current === 0 ? (
        <GuidedCard
          index={0}
          total={total}
          eyebrow="Find leads"
          title="Describe the companies you're looking for"
          why="Insyder searches the web for companies showing a buying signal (expansion, hiring, hardware refresh, tenders) and saves each one as an account with its sources."
          onNext={flow.next}
          nextDisabledReason={leads.length ? null : runId ? "Waiting for the search to find companies…" : "Run a search first"}
        >
          <TourHint id="assign.find.brief">
            Each search uses research units, so be specific: say <strong>who</strong>, <strong>where</strong> and{" "}
            <strong>what they&apos;re doing</strong>, e.g. <em>UK universities upgrading data centres in the last 90 days</em>.
            Then press <strong>Review search</strong> to check it before anything is spent.
          </TourHint>
          <fieldset className="mb-3">
            <legend className="text-xs font-semibold text-[var(--muted)]">Search type</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["quick", "Quick search", "Finds recent articles about companies with a buying signal. Takes seconds, up to 10 results."],
                  ["list", "Build a list", "Builds a list of companies and checks each one against your signals, with sources. Takes a few minutes, up to 25 companies."],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-2.5 rounded-[8px] border px-3 py-2.5 text-sm transition ${
                    searchType === value ? "border-[var(--brand)] bg-[var(--brand-tint)]" : "border-[var(--line)] hover:border-[var(--input-border)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="search-type"
                    className="mt-0.5 accent-[var(--brand)]"
                    checked={searchType === value}
                    onChange={() => setSearchType(value)}
                  />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="block text-xs text-[var(--muted)]">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mb-3">
            <Field
              label="Playbook"
              hint={
                isNoPlaybook
                  ? "Open search without a playbook: finds companies matching your description and their key contacts directly, without filtering for buying signals."
                  : selectedPlaybook
                    ? `Signals: ${selectedPlaybook.rules.signals.map((s) => humanize(s)).join(", ")}${
                        selectedPlaybook.rules.countries.length
                          ? ` · Territory: ${selectedPlaybook.rules.countries.join(", ")}`
                          : ""
                      }`
                    : "Select a tailored playbook to guide buying signals, or choose 'No playbook' for an open search."
              }
            >
              <div className="flex items-center gap-2">
                <select
                  className={inputClass}
                  value={playbookId || "none"}
                  onChange={(e) => setPlaybookId(e.target.value)}
                  aria-label="Select playbook"
                >
                  <option value="none">No playbook (Open company & contact search)</option>
                  {playbooks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Link href="/discover/playbooks">
                  <Button variant="quiet" type="button" title="Manage or create playbooks">
                    Manage
                  </Button>
                </Link>
              </div>
            </Field>
          </div>

          <Field
            label="What kind of companies?"
            required
            hint="Want a specific city or region? Mention it in the description, e.g. “councils in Manchester”."
          >
            <textarea
              className={inputClass}
              rows={3}
              required
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={
                isNoPlaybook
                  ? "e.g. IT recruitment agencies in the UK to reach out to"
                  : selectedPlaybook?.rules.description
                    ? `e.g. ${selectedPlaybook.rules.description}`
                    : "e.g. UK universities announcing a new data centre or server refresh in the last 90 days"
              }
            />
          </Field>
          {parsed && brief.trim().length >= 5 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--muted)]">Read from your description:</span>
              {[
                ...parsed.structured.countries.map(countryName),
                ...parsed.structured.industries,
                ...parsed.structured.signalKinds.map(humanize),
              ].map(
                (c) => (
                  <span key={c} className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                    {c}
                  </span>
                ),
              )}
              {parsed.structured.eventWindowDays ? (
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">Last {parsed.structured.eventWindowDays} days</span>
              ) : null}
              {!parsed.structured.countries.length &&
              !parsed.structured.industries.length &&
              !parsed.structured.signalKinds.length &&
              !parsed.structured.eventWindowDays ? (
                <span className="text-[var(--muted)]">nothing specific yet</span>
              ) : null}
              {parsed.unsupported.length ? (
                <span className="text-[var(--badge-amber-fg)]">Not used: {parsed.unsupported.join(", ")}</span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div role="group" aria-labelledby="countries-label" className="text-xs font-semibold text-[var(--muted)]">
              <span id="countries-label" className="block">
                Countries
                <span aria-hidden="true" className="ml-0.5 text-[var(--brand-text)]">
                  *
                </span>
              </span>
              <CountryPicker
                value={countries}
                onChange={setCountries}
                suggested={parsed?.structured.countries ?? []}
                labelledBy="countries-label"
              />
              {!countries.length && parsed?.structured.countries.length ? (
                <span className="mt-1 block font-normal">
                  None chosen: the search uses {parsed.structured.countries.map(countryName).join(", ")} from your description.
                </span>
              ) : null}
            </div>
            <Field
              label="Industries"
              hint={
                industries.trim()
                  ? undefined
                  : parsed?.structured.industries.length
                    ? `Empty: uses ${parsed.structured.industries.join(", ")} from your description`
                    : "Recommended, e.g. Public Sector"
              }
            >
              <input
                className={inputClass}
                value={industries}
                onChange={(e) => setIndustries(e.target.value)}
                placeholder="e.g. Financial Services, Healthcare"
              />
            </Field>
            <Field label={`How many results? (1–${maxResults})`} hint="1 result = 1 research unit">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={maxResults}
                className={`${inputClass} w-24`}
                value={Math.min(budget, maxResults)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setBudget(Math.min(maxResults, Math.max(1, Math.round(n))));
                }}
              />
            </Field>
          </div>

          <Button
            aria-expanded={showAdvanced}
            title="Signals, time window and playbook"
            onClick={() => setShowAdvanced((v) => !v)}
            className={`mt-3 gap-2 ${showAdvanced ? "border-[var(--brand)] bg-[var(--brand-tint)] text-[var(--brand-active)]" : ""}`}
          >
            <SlidersHorizontal size={15} aria-hidden />
            More filters
            {moreFiltersSet ? (
              <span className="rounded-full bg-[var(--brand)] px-1.5 text-[11px] font-semibold leading-[18px] text-[var(--on-brand)]">
                {moreFiltersSet}
              </span>
            ) : null}
            <ChevronDown size={15} aria-hidden className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </Button>

          {showAdvanced ? (
            <div className="mt-3 space-y-4 rounded-[10px] border border-[var(--line)] p-4">
              <p className="text-xs text-[var(--muted)]">
                Leave a field empty to use what your description says, or else your playbook and workspace defaults.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Event window (days)">
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    placeholder={`e.g. 90 (default: ${offer?.eventWindowDays ?? 90})`}
                    value={windowDays}
                    onChange={(e) => setWindowDays(e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              </div>
              <fieldset>
                <legend className="text-xs font-semibold text-[var(--muted)]">Signals</legend>
                {!signals.length && selectedPlaybook ? (
                  <p className="text-xs text-[var(--muted)]">
                    None ticked: the search uses what your brief mentions, else the playbook&apos;s signals (
                    {selectedPlaybook.rules.signals.map((s) => humanize(s)).join(", ")}).
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  {SIGNALS.map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={signals.includes(s)}
                        onChange={(e) => setSignals((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))}
                      />
                      {humanize(s)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {plan.blockers.length && brief.trim() ? (
            <ul className="mt-4 space-y-1 text-sm text-[var(--brand-active)]">
              {plan.blockers.map((b) => (
                <li key={b}>• {b}</li>
              ))}
            </ul>
          ) : null}

          {reviewing && !plan.blockers.length ? (
            <section
              aria-label="Check your search"
              className="mt-4 rounded-[10px] border border-[var(--brand)] bg-[var(--brand-tint)] p-4 text-sm"
            >
              <h3 className="font-semibold">Check your search before it runs</h3>
              <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
                <dt className="text-[var(--muted)]">Looking for</dt>
                <dd>{brief.trim()}</dd>
                <dt className="text-[var(--muted)]">Countries</dt>
                <dd className="font-medium">{plan.planCountries.map(countryName).join(", ")}</dd>
                <dt className="text-[var(--muted)]">Industries</dt>
                <dd>{plan.planIndustries.length ? plan.planIndustries.join(", ") : "Any"}</dd>
                <dt className="text-[var(--muted)]">Signals</dt>
                <dd>
                  {isNoPlaybook
                    ? "None (open company & contact search)"
                    : plan.planSignals.length
                      ? plan.planSignals.map(humanize).join(", ")
                      : selectedPlaybook?.rules.signals.length
                        ? `${selectedPlaybook.rules.signals.map(humanize).join(", ")} (from the playbook)`
                        : "Any"}
                </dd>
                <dt className="text-[var(--muted)]">Time window</dt>
                <dd>{plan.planWindow ? `Last ${plan.planWindow} days` : "Anytime (unrestricted)"}</dd>
                <dt className="text-[var(--muted)]">Cost</dt>
                <dd className="font-semibold">
                  Up to {plan.units} research unit{plan.units === 1 ? "" : "s"}
                  <span className="font-normal text-[var(--muted)]">
                    {" "}
                    (unused units are given back
                    {parsed ? `; this month ${parsed.usage.usedMonthly} of ${parsed.usage.quotaMonthly} used` : ""})
                  </span>
                </dd>
              </dl>
              {plan.warnings.length || parsed?.unsupported.length ? (
                <ul className="mt-3 space-y-1 text-[var(--badge-amber-fg)]">
                  {plan.warnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                  {parsed?.unsupported.map((u) => (
                    <li key={u}>⚠ Not used: {u}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <Button variant="primary" disabled={busy} onClick={() => void runSearch()}>
                  {busy
                    ? "Starting…"
                    : `${searchType === "list" ? "Build list" : "Run search"} · ${plan.units} unit${plan.units === 1 ? "" : "s"}`}
                </Button>
                <Button disabled={busy} onClick={() => setReviewing(false)}>
                  Edit search
                </Button>
              </div>
            </section>
          ) : (
            <div className="mt-4">
              <Button
                variant="primary"
                disabled={busy || !brief.trim() || plan.blockers.length > 0}
                onClick={() => void reviewSearch()}
              >
                Review search
              </Button>
            </div>
          )}
          <div className="mt-4">
            <ResearchRunStatus
              runId={runId}
              workspaceId={workspaceId}
              onFinished={(run) => {
                setRows(run.result?.rows ?? []);
                void loadRecent();
              }}
            />
          </div>
          {runInfo?.mode === "webset" && runId ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <Button disabled={busy} onClick={() => void refreshList()}>
                Refresh list
              </Button>
              <span className="text-xs text-[var(--muted)]">
                Searches again and adds only companies that weren&apos;t in this list yet.
              </span>
            </div>
          ) : null}
          {leads.length ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--badge-green-border)]/50 bg-[var(--badge-green-bg)]/20 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-[var(--badge-green-fg)]">
                <CircleCheck size={16} aria-hidden /> {leads.length} compan{leads.length === 1 ? "y" : "ies"} found. Press Next to choose
                which ones to research.
              </p>
              {runId && (can("discover") || can("manage_settings")) ? (
                <Button
                  variant="primary"
                  onClick={handleOpenSavePlaybook}
                  title="Save this search's brief and filters as a reusable playbook"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BookmarkPlus size={15} aria-hidden />
                    Save as playbook
                  </span>
                </Button>
              ) : null}
            </div>
          ) : null}
          {playbookNotice ? (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-[8px] border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-xs text-[var(--badge-green-fg)]">
              <span className="flex items-center gap-1.5 font-medium">
                <CircleCheck size={14} aria-hidden />
                {playbookNotice}
              </span>
              <button
                type="button"
                className="text-xs font-semibold hover:underline"
                onClick={() => setPlaybookNotice(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <div className="mt-3">
            <FormError message={error} />
          </div>
        </GuidedCard>
      ) : null}

      {flow.current === 1 ? (
        <GuidedCard
          index={1}
          total={total}
          eyebrow="Choose leads"
          title="Pick the companies worth researching"
          why={
            canAssign
              ? "Tick the leads that look promising. Each one you pick becomes a research task for the person you choose next."
              : "Every company found is already saved as an account. Open the pipeline to start researching the promising ones."
          }
          onBack={flow.back}
          onNext={canAssign ? flow.next : undefined}
          nextLabel={chosen.length ? `Next: ${selfOnly ? "add" : "assign"} ${chosen.length}` : "Next"}
          nextDisabledReason={chosen.length ? null : "Pick at least one company"}
          hideDisabledReason
        >
          <TourHint id="assign.choose">
            Read the trigger under each company. <strong>New</strong> means it wasn&apos;t in your accounts before. Suppressed
            companies are already left out.
          </TourHint>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-[var(--muted)]">
              {canAssign ? `${chosen.length} of ${leads.length} selected` : `${leads.length} companies found`}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {runId && (can("discover") || can("manage_settings")) ? (
                <Button
                  variant="primary"
                  onClick={handleOpenSavePlaybook}
                  title="Save this search's brief and filters as a reusable playbook"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <BookmarkPlus size={15} aria-hidden />
                    Save as playbook
                  </span>
                </Button>
              ) : null}
              {can("export") && runId ? (
                <Button
                  onClick={() =>
                    void downloadFile(`/v1/research-runs/${runId}/results.csv?workspaceId=${workspaceId}`, "search-results.csv").catch((e) =>
                      setError(e instanceof Error ? e.message : "Export failed"),
                    )
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Download size={15} aria-hidden />
                    Export CSV
                  </span>
                </Button>
              ) : null}
              {canAssign ? (
                <>
                  {(() => {
                    const allOn = leads.length > 0 && leads.every((l) => selected.includes(l.accountId));
                    return (
                      <Button
                        className="border-[var(--brand)]! text-[var(--brand-active)]! hover:bg-[var(--brand-tint)]!"
                        disabled={!leads.length}
                        aria-pressed={allOn}
                        onClick={() => setSelected(allOn ? [] : leads.map((l) => l.accountId))}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {allOn ? <Square size={15} aria-hidden /> : <CheckSquare size={15} aria-hidden />}
                          {allOn ? "Unselect all" : "Select all"}
                        </span>
                      </Button>
                    );
                  })()}
                  <Button disabled={!selected.length} onClick={() => setSelected([])}>
                    <span className="inline-flex items-center gap-1.5">
                      <X size={15} aria-hidden />
                      Clear
                    </span>
                  </Button>
                </>
              ) : (
                <Link href="/accounts/pipeline" className="font-medium text-[var(--brand-active)] hover:underline">
                  Open the pipeline
                </Link>
              )}
            </div>
          </div>
          <FormError message={error} />
          <ul className="divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)]">
            {leads.map((r) => {
              const on = selected.includes(r.accountId);
              const open = expanded === r.accountId;
              return (
                <li key={r.accountId} className={on ? "bg-[var(--brand-tint)]" : undefined}>
                  <div className="flex items-start gap-3 px-4 py-3.5">
                    {canAssign ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                        checked={on}
                        onChange={(e) =>
                          setSelected((s) => (e.target.checked ? [...s, r.accountId] : s.filter((id) => id !== r.accountId)))
                        }
                      />
                    ) : null}
                    {/* Click the company to see its full details */}
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : r.accountId)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--foreground)]">{r.name}</span>
                          {r.domain ? <span className="text-xs text-[var(--muted)]">{r.domain}</span> : null}
                          {r.isNew ? <Badge tone="blue">New</Badge> : null}
                          {r.identityNeedsReview ? <Badge tone="amber">Check company</Badge> : null}
                          {leadContacts(r).length ? (
                            <Badge tone="blue">{leadContacts(r).length} {leadContacts(r).length === 1 ? "contact" : "contacts"}</Badge>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-sm text-[var(--muted)]">
                          {r.trigger.title ?? r.trigger.summary ?? "Signal found"}
                          {r.trigger.eventDate ? ` · ${formatDate(r.trigger.eventDate)}` : ""}
                          {` · ${r.sources} source${r.sources === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      {r.fitScore != null ? <span className="shrink-0 text-sm font-semibold tabular-nums">{r.fitScore}/100</span> : null}
                      <ChevronDown
                        size={18}
                        aria-hidden
                        className={`mt-0.5 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>

                  {open ? (
                    <div className={`mx-4 mb-4 rounded-[10px] border border-[var(--line)] bg-white px-5 py-4 text-sm ${canAssign ? "ml-11" : ""}`}>
                      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold text-[var(--muted)]">Account</dt>
                          <dd className="mt-1 font-medium text-[var(--foreground)]">{r.name}</dd>
                          <dd className="text-xs text-[var(--muted)]">
                            {[r.domain, r.country && countryName(r.country)].filter(Boolean).join(" · ") || "Website unknown"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-[var(--muted)]">Priority</dt>
                          <dd className="mt-1 font-medium text-[var(--foreground)]">{r.fitScore != null ? `${r.fitScore}/100` : "—"}</dd>
                          <dd className="text-xs text-[var(--muted)]">From fit, recency and source quality, not a purchase probability.</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-[var(--muted)]">Trigger</dt>
                          {r.trigger.title ? <dd className="mt-1 font-medium text-[var(--foreground)]">{r.trigger.title}</dd> : null}
                          {r.trigger.summary ? <dd className="mt-1 text-[var(--foreground)]">{r.trigger.summary}</dd> : null}
                          <dd className="mt-1 text-xs text-[var(--muted)]">
                            {r.trigger.eventDate ? formatDate(r.trigger.eventDate) : "Event date unknown"} ·{" "}
                            <a
                              href={r.trigger.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 font-medium text-[var(--brand-active)] hover:underline"
                            >
                              Open source <ExternalLink size={12} aria-hidden />
                            </a>
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-[var(--muted)]">Contacts</dt>
                          <dd className="mt-1">
                            {leadContacts(r).length ? (
                              <LeadContactDetails contacts={leadContacts(r)} />
                            ) : (
                              <span className="text-xs text-[var(--muted)]">No public contact details found for this company.</span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-[var(--muted)]">Evidence</dt>
                          <dd className="mt-1">
                            {r.identityNeedsReview ? <Badge tone="amber">Check company</Badge> : <Badge tone="blue">Needs review</Badge>}
                          </dd>
                          <dd className="mt-1 text-xs text-[var(--muted)]">
                            {r.sources} cited {r.sources === 1 ? "source" : "sources"}
                          </dd>
                        </div>
                        <div className="flex items-end sm:justify-end">
                          <Link href={`/accounts/detail?id=${r.accountId}`}>
                            <Button>Review account</Button>
                          </Link>
                        </div>
                      </dl>
                      {r.identityNeedsReview ? (
                        <p className="mt-4 text-xs text-[var(--muted)]">
                          <span className="font-semibold">Check company</span> = the article named the company but we couldn&apos;t
                          confirm its website, so make sure it&apos;s the right firm.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </GuidedCard>
      ) : null}

      {canAssign && flow.current === 2 ? (
        <GuidedCard
          index={2}
          total={total}
          eyebrow={selfOnly ? "Add to my leads" : "Assign researcher"}
          title={
            selfOnly
              ? `Add ${chosen.length === 1 ? "this lead" : `these ${chosen.length} leads`} to your list?`
              : `Who should research ${chosen.length === 1 ? "this lead" : `these ${chosen.length} leads`}?`
          }
          why={
            selfOnly
              ? "Each lead becomes a Research task for you. You'll find them under My leads → Qualify a lead, ready to check the evidence, fill in the brief and send for sales review."
              : "Each lead gets a Research task for this person. They will see it in their own portal, check the evidence, fill in the brief and send it for sales review."
          }
          onBack={flow.back}
          onNext={() => void assign()}
          nextLabel={`${selfOnly ? "Add" : "Assign"} ${chosen.length} lead${chosen.length === 1 ? "" : "s"}`}
          nextDisabledReason={!researcher ? "Choose a researcher" : !due ? "Pick a due date" : null}
          busy={busy}
        >
          <TourHint id={selfOnly ? "assign.self" : "assign.researcher"}>
            {selfOnly ? (
              <>
                Pick a due date and a reminder of what to check. Press <strong>Add</strong> to put the leads on your list.
              </>
            ) : (
              <>
                Pick the researcher, a due date and what you want checked. Press <strong>Assign</strong> to create the tasks.
              </>
            )}
          </TourHint>
          <div className="grid gap-4 sm:grid-cols-2">
            {selfOnly ? null : (
            <Field label="Researcher" required>
              <select className={inputClass} value={researcherId} onChange={(e) => setResearcherId(e.target.value)}>
                <option value="">Choose a person…</option>
                {researchers.length ? (
                  <optgroup label="Researchers">
                    {researchers.map((p) => (
                      <option key={p.userId} value={p.userId}>{p.name}</option>
                    ))}
                  </optgroup>
                ) : null}
                {others.length ? (
                  <optgroup label={ROLE_LABELS.tenant_admin}>
                    {others.map((p) => (
                      <option key={p.userId} value={p.userId}>{p.name}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {!researchers.length ? (
                <span className="mt-1 block font-normal">No researchers in this workspace yet. Add one under Members.</span>
              ) : null}
            </Field>
            )}
            <Field label="Due date" required>
              <input type="date" className={inputClass} value={due} min={inDays(0)} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label={selfOnly ? "Note to yourself" : "What should they do?"} className="sm:col-span-2">
              <textarea className={inputClass} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            </Field>
          </div>
          <div className="mt-5 rounded-[10px] bg-[var(--chip-bg)] px-4 py-3 text-sm">
            <p className="font-semibold">Leads to {selfOnly ? "add" : "assign"} ({chosen.length})</p>
            <p className="mt-1 text-[var(--muted)]">{chosen.map((c) => c.name).join(" · ")}</p>
          </div>
          {assigned ? (
            <p className="mt-3 rounded-[10px] bg-[var(--badge-amber-bg)] px-4 py-3 text-sm text-[var(--badge-amber-fg)]">
              {selfOnly ? (
                <>You already added these leads to your list. Adding them again won&apos;t create duplicate tasks.</>
              ) : (
                <>
                  You already sent {assigned.ok.length} lead{assigned.ok.length === 1 ? "" : "s"} to {assigned.researcherName}. Assigning
                  again to the same person won&apos;t create duplicate tasks; choosing someone else gives them their own task.
                </>
              )}
            </p>
          ) : null}
          <div className="mt-3">
            <FormError message={error} />
          </div>
        </GuidedCard>
      ) : null}

      {canAssign && flow.current === 3 && assigned ? (
        <GuidedCard
          index={3}
          total={total}
          eyebrow="Done"
          title={
            !assigned.ok.length
              ? "No tasks were created"
              : selfOnly
                ? `${assigned.ok.length} lead${assigned.ok.length === 1 ? "" : "s"} added to your list`
                : `${assigned.ok.length} lead${assigned.ok.length === 1 ? "" : "s"} sent to ${assigned.researcherName}`
          }
          why={
            selfOnly
              ? `You now have a Research task for each lead, due ${formatDate(`${assigned.due}T17:00:00`)}. Open Qualify a lead to work on them; each brief you send goes to a sales reviewer.`
              : `${assigned.researcherName} now has a Research task for each lead, due ${formatDate(`${assigned.due}T17:00:00`)}. When they submit a brief, it goes to a sales reviewer to accept, return or reject.`
          }
          onBack={flow.back}
        >
          {assigned.ok.length ? (
            <ul className="space-y-1.5 text-sm">
              {assigned.ok.map((n) => (
                <li key={n} className="flex items-center gap-2">
                  <CircleCheck size={16} className="text-[var(--badge-green-fg)]" aria-hidden /> {n}
                </li>
              ))}
            </ul>
          ) : null}
          {assigned.failed.length ? (
            <div className="mt-4 rounded-[10px] bg-[var(--brand-tint)] px-4 py-3 text-sm text-[var(--brand-active)]">
              <p className="font-semibold">Not assigned ({assigned.failed.length})</p>
              {assigned.failed.map((f) => (
                <p key={f.name} className="mt-1">
                  {f.name}: {f.error}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-7 flex flex-wrap gap-3">
            {selfOnly ? (
              <Link href="/accounts/qualify">
                <Button variant="primary">Qualify them now</Button>
              </Link>
            ) : null}
            <Link href="/outreach/tasks">
              <Button variant={selfOnly ? "secondary" : "primary"}>See the tasks</Button>
            </Link>
            <Link href="/accounts/pipeline">
              <Button>Open the pipeline</Button>
            </Link>
            <Button variant="ghost" onClick={startOver}>
              Find and assign more leads
            </Button>
          </div>
        </GuidedCard>
      ) : null}

      <Modal
        open={saveModalOpen}
        onClose={() => !savingPlaybook && setSaveModalOpen(false)}
        title="Save search as playbook"
        description="Save this search's brief and filter criteria as a reusable playbook for future discovery searches and scheduled monitors."
        icon={<BookmarkPlus className="h-5 w-5 text-[var(--brand-active)]" />}
        size="md"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="quiet" disabled={savingPlaybook} onClick={() => setSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={savingPlaybook || playbookName.trim().length < 2}
              onClick={() => void handleSavePlaybook()}
            >
              {savingPlaybook ? "Saving…" : "Save playbook"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Playbook name" hint="A concise name to identify this playbook in dropdowns and monitors">
            <input
              className={inputClass}
              value={playbookName}
              onChange={(e) => setPlaybookName(e.target.value)}
              placeholder="e.g. UK Cloud Migration & HPC Expansion"
              maxLength={80}
              required
            />
          </Field>
          <Field label="Description" hint="Optional summary of target companies or search context">
            <textarea
              className={`${inputClass} h-20 resize-none`}
              value={playbookDesc}
              onChange={(e) => setPlaybookDesc(e.target.value)}
              placeholder="Brief description of the search criteria"
              maxLength={200}
            />
          </Field>
          <Field label="Discovery question" hint="Contextual discovery question for leads generated by this playbook">
            <input
              className={inputClass}
              value={discoveryQ}
              onChange={(e) => setDiscoveryQ(e.target.value)}
              placeholder="e.g. Are you currently evaluating compute capacity or cloud infrastructure?"
              maxLength={400}
            />
          </Field>
          <div className="rounded-[8px] bg-[var(--surface-sunken)] p-3 text-xs text-[var(--muted)]">
            <div className="font-semibold text-[var(--foreground)] mb-1">Filters included in this playbook:</div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(signals.length ? signals : parsed?.structured.signalKinds?.length ? parsed.structured.signalKinds : ["expansion"]).map((s) => (
                <span key={s} className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Signal: {humanize(s)}
                </span>
              ))}
              {countries.length ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Countries: {countries.join(", ")}
                </span>
              ) : parsed?.structured.countries?.length ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Countries: {parsed.structured.countries.join(", ")}
                </span>
              ) : null}
              {industries ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Industries: {industries}
                </span>
              ) : parsed?.structured.industries?.length ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Industries: {parsed.structured.industries.join(", ")}
                </span>
              ) : null}
              {windowDays ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Window: {windowDays} days
                </span>
              ) : parsed?.structured.eventWindowDays ? (
                <span className="rounded bg-[var(--chip-bg)] px-2 py-0.5 font-medium text-[var(--foreground)]">
                  Window: {parsed.structured.eventWindowDays} days
                </span>
              ) : null}
            </div>
          </div>
          <FormError message={savePlaybookError} />
        </div>
      </Modal>
    </div>
  );
}

export default function FindAndAssignPage() {
  return <RequireCap cap="discover">{(workspaceId) => <FindAndAssign workspaceId={workspaceId} />}</RequireCap>;
}
