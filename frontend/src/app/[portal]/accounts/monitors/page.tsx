"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useEffect, useState, useCallback, useMemo } from "react";
import { CheckCircle2, ChevronDown, ExternalLink, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";
import { usePagination } from "@/components/ui/Pagination";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import {
  listMonitors,
  createMonitorFromPlaybook,
  updateMonitor,
  deleteMonitor,
  runMonitorCheck,
  listChangeEvents,
  type Monitor,
  type ChangeEvent,
} from "@/lib/api/monitors";
import { listPlaybooks, SIGNAL_LABELS, type PlaybookView } from "@/lib/api/playbooks";
import { listAccounts, type Account } from "@/lib/api/accounts";
import { formatDate } from "@/lib/utils/dates";
import { countryName } from "@/lib/countries";
import { MonitorCard } from "@/components/monitors/MonitorCard";
import { MonitorAccountsModal } from "@/components/monitors/MonitorAccountsModal";

const SIGNAL_PATTERNS: Array<{ key: string; label: string; regex: RegExp }> = [
  {
    key: "infra_hiring",
    label: "Infrastructure hiring",
    regex: /\b(hiring|hire|recruiting|recruit|director|engineer|manager|head of|lead|talent|job|vacancy|vacancies)\b/i,
  },
  {
    key: "expansion",
    label: "Expansion",
    regex: /\b(expansion|expand|expanding|expands|new facility|new site|new campus|data center|datacenter|broke ground|breaking ground|capex)\b/i,
  },
  {
    key: "refresh",
    label: "Hardware refresh",
    regex: /\b(refresh|hardware replacement|upgrade|lifecycle)\b/i,
  },
  {
    key: "compute",
    label: "Compute & capacity",
    regex: /\b(compute|storage capacity|megawatt|\bMW\b|GPU|AI cluster|servers|racks|high performance compute|hpc)\b/i,
  },
  {
    key: "procurement",
    label: "Tender / procurement",
    regex: /\b(tender|\bRFP\b|\bRFI\b|procurement|contract award|awarded|vendor contract|supplier agreement)\b/i,
  },
  {
    key: "cloud_migration",
    label: "Cloud migration",
    regex: /\b(cloud migration|hybrid cloud|public cloud|AWS|Azure|Google Cloud|\bGCP\b)\b/i,
  },
  {
    key: "leadership_change",
    label: "Leadership change",
    regex: /\b(appointed|appoints|new CEO|new CTO|new CIO|executive hire|joins as|stepping down)\b/i,
  },
  {
    key: "funding",
    label: "Funding round",
    regex: /\b(funding|raised|capital raise|\bseries [a-d]\b|venture capital|seed round)\b/i,
  },
  {
    key: "m_and_a",
    label: "M&A",
    regex: /\b(acquisition|acquires|acquired|merger|merges with|bought by)\b/i,
  },
  {
    key: "security_compliance",
    label: "Security & compliance",
    regex: /\b(cybersecurity|security compliance|\bISO\b|\bSOC 2\b|governance)\b/i,
  },
  {
    key: "cost_optimization",
    label: "Cost optimization",
    regex: /\b(cost optimization|cost reduction|efficiency|vendor consolidation)\b/i,
  },
  {
    key: "digital_transformation",
    label: "Digital transformation",
    regex: /\b(digital transformation|transformation program)\b/i,
  },
  {
    key: "technology_adoption",
    label: "Technology adoption",
    regex: /\b(adoption|technology stack|deployed|migrated to)\b/i,
  },
];

function resolveSignalInfo(
  c: ChangeEvent,
  monitorsMap: Record<string, Monitor>,
  playbooksMap: Record<string, PlaybookView>,
) {
  const textToScan = `${c.title} ${c.detail ?? ""}`;

  // 1. Try pattern match on title & detail text
  for (const p of SIGNAL_PATTERNS) {
    if (p.regex.test(textToScan)) {
      return { key: p.key, label: p.label };
    }
  }

  // 2. Fall back to monitor's configured signals
  const mon = monitorsMap[c.monitorId];
  if (mon) {
    let recipe: { signals?: string[]; templateKey?: string } = {};
    try {
      recipe = JSON.parse(mon.recipeJson);
    } catch {
      recipe = {};
    }
    const sigs = Array.isArray(recipe.signals) && recipe.signals.length ? recipe.signals : [];
    if (sigs.length === 1) {
      const k = sigs[0];
      return { key: k, label: SIGNAL_LABELS[k] ?? humanize(k) };
    }
    if (sigs.length > 1) {
      for (const s of sigs) {
        const p = SIGNAL_PATTERNS.find((item) => item.key === s);
        if (p && p.regex.test(textToScan)) {
          return { key: p.key, label: p.label };
        }
      }
      const first = sigs[0];
      return { key: first, label: SIGNAL_LABELS[first] ?? humanize(first) };
    }

    const pbKey = mon.playbookTemplateKey || recipe.templateKey;
    if (pbKey && playbooksMap[pbKey]) {
      const pbSigs = playbooksMap[pbKey].rules.signals;
      if (pbSigs && pbSigs.length > 0) {
        const first = pbSigs[0];
        return { key: first, label: SIGNAL_LABELS[first] ?? humanize(first) };
      }
    }
  }

  return { key: "signal", label: "Buying signal" };
}

function extractCompanyAndHeadline(title: string, matchedAccount?: Account | null) {
  if (matchedAccount) {
    return {
      companyName: matchedAccount.name,
      headline: title,
    };
  }
  // Try pattern: "Role / Headline at Company"
  const atMatch = title.match(/^(.*?)\s+(?:at|@)\s+([A-Z0-9][A-Za-z0-9&.,' -]{1,40})$/i);
  if (atMatch && atMatch[1].trim() && atMatch[2].trim()) {
    return { companyName: atMatch[2].trim(), headline: atMatch[1].trim() };
  }
  // Try pattern: "Company: Headline" or "Company - Headline"
  const colonMatch = title.match(/^([A-Z0-9][A-Za-z0-9&.,' -]{1,35})\s*[:–—\-]\s*(.+)$/i);
  if (colonMatch && colonMatch[1].trim() && colonMatch[2].trim()) {
    return { companyName: colonMatch[1].trim(), headline: colonMatch[2].trim() };
  }
  // Try pattern: "Company announces / secures / opens / expands ..."
  const verbMatch = title.match(
    /^([A-Z0-9][A-Za-z0-9&.,' -]{1,35})\s+(announces|expands|opens|secures|hires|appoints|launches|raises|breaks ground)\s+(.+)$/i,
  );
  if (verbMatch && verbMatch[1].trim()) {
    return { companyName: verbMatch[1].trim(), headline: `${verbMatch[2]} ${verbMatch[3]}` };
  }
  return { companyName: title, headline: title };
}

function parseChangeEventDetail(detail: string | null) {
  if (!detail) return { excerpt: null, sourceUrl: null };
  const sourceMatch = detail.match(/Source:\s*(https?:\/\/[^\s]+)/i);
  const sourceUrl = sourceMatch ? sourceMatch[1] : null;
  const excerpt = sourceMatch ? detail.replace(/Source:\s*https?:\/\/[^\s]+/i, "").trim() : detail.trim();
  return { excerpt: excerpt || null, sourceUrl };
}

function renderDetailWithLinks(detail: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = detail.split(urlRegex);

  return parts.map((part, i) => {
    if (part.match(/^https?:\/\//i)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--brand-active)] underline underline-offset-2 hover:opacity-80 break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

function MonitorsView({ workspaceId }: { workspaceId: string }) {
  const [monitorsList, setMonitorsList] = useState<Monitor[] | null>(null);
  const [changeEventsList, setChangeEventsList] = useState<ChangeEvent[]>([]);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<PlaybookView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ monitorId: string; summary: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add Playbook modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("");
  const [selectedCadence, setSelectedCadence] = useState<number>(168);
  const [modalError, setModalError] = useState<string | null>(null);

  // Filters for Detected Signals feed: signal type, monitor, account target status, and search query
  const [selectedSignalFilter, setSelectedSignalFilter] = useState<string>("all");
  const [selectedMonitorFilter, setSelectedMonitorFilter] = useState<string>("all");
  const [selectedAccountFilter, setSelectedAccountFilter] = useState<"all" | "target" | "discovered">("all");
  const [searchFilter, setSearchFilter] = useState<string>("");

  const accountsMap = useMemo(() => {
    const map: Record<string, Account> = {};
    for (const a of accountsList) {
      map[a.id] = a;
    }
    return map;
  }, [accountsList]);

  const monitorsMap = useMemo(() => {
    const map: Record<string, Monitor> = {};
    for (const m of monitorsList ?? []) {
      map[m.id] = m;
    }
    return map;
  }, [monitorsList]);

  const playbooksMap = useMemo(() => {
    const map: Record<string, PlaybookView> = {};
    for (const p of playbooks) {
      map[p.templateKey] = p;
    }
    return map;
  }, [playbooks]);

  // Compute signal counts for the filter bar
  const signalCounts = useMemo(() => {
    const counts: Record<string, { label: string; count: number }> = {};
    for (const c of changeEventsList) {
      const sig = resolveSignalInfo(c, monitorsMap, playbooksMap);
      if (!counts[sig.key]) {
        counts[sig.key] = { label: sig.label, count: 0 };
      }
      counts[sig.key].count++;
    }
    return counts;
  }, [changeEventsList, monitorsMap, playbooksMap]);

  // Filter change events by signal filter, monitor, account status, and search query
  const filteredChangeEvents = useMemo(() => {
    return changeEventsList.filter((c) => {
      // 1. Signal type filter
      if (selectedSignalFilter !== "all") {
        const sig = resolveSignalInfo(c, monitorsMap, playbooksMap);
        if (sig.key !== selectedSignalFilter) return false;
      }
      // 2. Specific monitor filter
      if (selectedMonitorFilter !== "all") {
        if (c.monitorId !== selectedMonitorFilter) return false;
      }
      // 3. Target vs discovered accounts
      if (selectedAccountFilter === "target" && !c.accountId) {
        return false;
      }
      if (selectedAccountFilter === "discovered" && c.accountId) {
        return false;
      }
      // 4. Keyword search
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase().trim();
        const matched = c.accountId ? accountsMap[c.accountId]?.name.toLowerCase() : "";
        const title = c.title.toLowerCase();
        const detail = (c.detail ?? "").toLowerCase();
        if (!title.includes(q) && !detail.includes(q) && !matched.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [
    changeEventsList,
    selectedSignalFilter,
    selectedMonitorFilter,
    selectedAccountFilter,
    searchFilter,
    monitorsMap,
    playbooksMap,
    accountsMap,
  ]);

  const { pageItems: pagedChangeEvents, pager: changeEventsPager } = usePagination(filteredChangeEvents, 10);

  // Monitor search: by monitor name, the accounts it watches, or a company in its signals
  const [monitorSearch, setMonitorSearch] = useState("");
  const filteredMonitors = useMemo(() => {
    const list = monitorsList ?? [];
    const q = monitorSearch.toLowerCase().trim();
    if (!q) return list;
    return list.filter((m) => {
      if (m.name.toLowerCase().includes(q)) return true;
      let accountNames: string[] = [];
      let accountIds: string[] = [];
      try {
        const r = JSON.parse(m.recipeJson) as { accountNames?: unknown; accountIds?: unknown };
        if (Array.isArray(r.accountNames)) accountNames = r.accountNames.map(String);
        if (Array.isArray(r.accountIds)) accountIds = r.accountIds.map(String);
      } catch {
        // old monitors may hold an unreadable recipe
      }
      if (accountNames.some((n) => n.toLowerCase().includes(q))) return true;
      if (accountIds.some((id) => accountsMap[id]?.name.toLowerCase().includes(q))) return true;
      return changeEventsList.some(
        (c) =>
          c.monitorId === m.id &&
          ((c.accountId && accountsMap[c.accountId]?.name.toLowerCase().includes(q)) ||
            c.title.toLowerCase().includes(q)),
      );
    });
  }, [monitorsList, monitorSearch, changeEventsList, accountsMap]);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [mRes, cRes, pbRes, accRes] = await Promise.all([
        listMonitors(workspaceId),
        listChangeEvents(workspaceId),
        listPlaybooks(workspaceId).catch(() => ({ playbooks: [], activeTemplateKey: "infrastructure" })),
        listAccounts(workspaceId).catch(() => ({ accounts: [] })),
      ]);
      setMonitorsList(mRes.monitors);
      setChangeEventsList(cRes.changeEvents);
      setAccountsList(accRes.accounts);
      const activePbs = pbRes.playbooks.filter((p) => !p.archived);
      setPlaybooks(activePbs);
      setSelectedTemplateKey((curr) => {
        if (curr && activePbs.some((p) => p.templateKey === curr)) return curr;
        return pbRes.activeTemplateKey || activePbs[0]?.templateKey || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load monitors");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddPlaybook = async () => {
    if (!selectedTemplateKey) return;
    try {
      setCreating(true);
      setModalError(null);
      await createMonitorFromPlaybook(workspaceId, {
        templateKey: selectedTemplateKey,
        cadenceHours: selectedCadence,
      });
      setModalOpen(false);
      await loadData();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Could not add monitor from playbook");
    } finally {
      setCreating(false);
    }
  };

  const handleFrequencyChange = async (monitorId: string, cadenceHours: number) => {
    try {
      await updateMonitor(workspaceId, monitorId, { cadenceHours });
      setMonitorsList((prev) =>
        prev
          ? prev.map((m) => (m.id === monitorId ? { ...m, cadenceHours } : m))
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update frequency");
    }
  };

  const handleToggleStatus = async (monitorId: string, status: "active" | "paused") => {
    try {
      await updateMonitor(workspaceId, monitorId, { status });
      setMonitorsList((prev) =>
        prev
          ? prev.map((m) => (m.id === monitorId ? { ...m, status } : m))
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle status");
    }
  };

  const handleRemove = async (monitorId: string) => {
    try {
      setDeletingId(monitorId);
      setError(null);
      await deleteMonitor(workspaceId, monitorId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove monitor");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCheckNow = async (monitorId: string) => {
    try {
      setCheckingId(monitorId);
      setError(null);
      const result = await runMonitorCheck(workspaceId, monitorId);
      setLastResult({
        monitorId,
        summary: result.status === "already_running" ? "A check is already running for this monitor. Try again in a minute." : result.summary,
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setCheckingId(null);
    }
  };

  const chosenPlaybook = playbooks.find((p) => p.templateKey === selectedTemplateKey);
  const isAlreadyMonitored = monitorsList?.some((m) => m.playbookTemplateKey === selectedTemplateKey);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CONTINUOUS RESEARCH"
        title="Signal monitors"
        description="Saved targeting recipes that re-run live web research on a schedule, within your research quota, and record new changes."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setAccountModalOpen(true)}
            >
              Monitor accounts
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setModalError(null);
                setModalOpen(true);
              }}
            >
              Add playbook
            </Button>
          </div>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {!monitorsList || monitorsList.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center text-sm text-[var(--muted)]">
          <p>No monitors yet. Add any playbook or individual accounts to re-check automatically on a schedule.</p>
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => setAccountModalOpen(true)}
            >
              Monitor accounts
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setModalError(null);
                setModalOpen(true);
              }}
            >
              Add playbook
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-md">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <input
                type="text"
                value={monitorSearch}
                onChange={(e) => setMonitorSearch(e.target.value)}
                placeholder="Search monitors, accounts or leads..."
                aria-label="Search monitors"
                className="w-full rounded-[10px] border border-[var(--line)] bg-white py-2 pl-9 pr-8 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[var(--brand)] focus:outline-hidden focus:ring-1 focus:ring-[var(--brand)]"
              />
              {monitorSearch ? (
                <button
                  type="button"
                  onClick={() => setMonitorSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {monitorSearch.trim() ? (
              <span className="text-xs font-semibold text-[var(--muted)]">
                {filteredMonitors.length} of {monitorsList.length} monitors
              </span>
            ) : null}
          </div>

          {filteredMonitors.length === 0 ? (
            <Card className="py-10 text-center text-sm text-[var(--muted)]">
              No monitor matches &ldquo;{monitorSearch.trim()}&rdquo;.{" "}
              <button type="button" onClick={() => setMonitorSearch("")} className="font-semibold text-[var(--brand-text)] hover:underline">
                Clear search
              </button>
            </Card>
          ) : null}

          {filteredMonitors.map((m) => (
            <MonitorCard
              key={m.id}
              monitor={m}
              checking={checkingId === m.id}
              removing={deletingId === m.id}
              resultNote={lastResult?.monitorId === m.id ? lastResult.summary : null}
              onCadence={(hours) => void handleFrequencyChange(m.id, hours)}
              onToggle={(status) => void handleToggleStatus(m.id, status)}
              onCheck={() => void handleCheckNow(m.id)}
              onRemove={() => void handleRemove(m.id)}
            />
          ))}
        </div>
      )}

      {/* Change Events Feed */}
      <div className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)]">Signals detected</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Fresh events discovered by your monitors across the web.
            </p>
          </div>
          {changeEventsList.length > 0 ? (
            <span className="text-xs font-semibold text-[var(--muted)]">
              {filteredChangeEvents.length === changeEventsList.length
                ? `${changeEventsList.length} ${changeEventsList.length === 1 ? "signal" : "signals"} detected`
                : `${filteredChangeEvents.length} of ${changeEventsList.length} signals`}
            </span>
          ) : null}
        </div>

        {/* Signal Filters & Search bar (like Discover filters) */}
        {changeEventsList.length > 0 ? (
          <div className="space-y-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-sunken)] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              {/* Filter selectors: Signal type, Monitor & Account target */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[var(--muted)]">Signals:</span>
                  <select
                    value={selectedSignalFilter}
                    onChange={(e) => setSelectedSignalFilter(e.target.value)}
                    aria-label="Filter by signal type"
                    className="rounded-[6px] border border-[var(--line)] bg-white px-2 py-1 text-xs text-[var(--foreground)] focus:outline-hidden focus:border-[var(--brand)]"
                  >
                    <option value="all">All signals ({changeEventsList.length})</option>
                    {Object.entries(signalCounts).map(([key, item]) => (
                      <option key={key} value={key}>
                        {item.label} ({item.count})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[var(--muted)]">Monitor:</span>
                  <select
                    value={selectedMonitorFilter}
                    onChange={(e) => setSelectedMonitorFilter(e.target.value)}
                    className="rounded-[6px] border border-[var(--line)] bg-white px-2 py-1 text-xs text-[var(--foreground)] focus:outline-hidden focus:border-[var(--brand)]"
                  >
                    <option value="all">All monitors ({monitorsList?.length ?? 0})</option>
                    {monitorsList?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[var(--muted)]">Accounts:</span>
                  <select
                    value={selectedAccountFilter}
                    onChange={(e) => setSelectedAccountFilter(e.target.value as "all" | "target" | "discovered")}
                    className="rounded-[6px] border border-[var(--line)] bg-white px-2 py-1 text-xs text-[var(--foreground)] focus:outline-hidden focus:border-[var(--brand)]"
                  >
                    <option value="all">All accounts</option>
                    <option value="target">Target watchlist only</option>
                    <option value="discovered">Discovered leads only</option>
                  </select>
                </div>
              </div>

              {/* Quick Search Input */}
              <div className="relative min-w-[200px] max-w-xs flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter signals or company..."
                  className="w-full rounded-[8px] border border-[var(--line)] bg-white pl-8 pr-7 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-hidden focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
                />
                {searchFilter ? (
                  <button
                    type="button"
                    onClick={() => setSearchFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>

            {selectedSignalFilter !== "all" ||
            selectedMonitorFilter !== "all" ||
            selectedAccountFilter !== "all" ||
            searchFilter.trim() ? (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--muted)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>Active filters:</span>
                  {selectedSignalFilter !== "all" ? (
                    <Badge tone="blue">
                      Signal: {signalCounts[selectedSignalFilter]?.label ?? selectedSignalFilter}
                    </Badge>
                  ) : null}
                  {selectedMonitorFilter !== "all" ? (
                    <Badge tone="default">
                      Monitor: {monitorsMap[selectedMonitorFilter]?.name ?? selectedMonitorFilter}
                    </Badge>
                  ) : null}
                  {selectedAccountFilter !== "all" ? (
                    <Badge tone="green">
                      {selectedAccountFilter === "target" ? "Target accounts" : "Discovered leads"}
                    </Badge>
                  ) : null}
                  {searchFilter.trim() ? (
                    <Badge tone="amber">
                      Search: &ldquo;{searchFilter}&rdquo;
                    </Badge>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSignalFilter("all");
                    setSelectedMonitorFilter("all");
                    setSelectedAccountFilter("all");
                    setSearchFilter("");
                  }}
                  className="text-[var(--brand-active)] font-medium hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {changeEventsList.length === 0 ? (
          <Card className="py-12 text-center text-sm text-[var(--muted)]">
            No signals recorded yet. When a scheduled monitor check runs and discovers new events,
            they will show up here.
          </Card>
        ) : filteredChangeEvents.length === 0 ? (
          <Card className="py-12 text-center text-sm text-[var(--muted)]">
            No signals match the current filter.
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedSignalFilter("all");
                  setSelectedMonitorFilter("all");
                  setSelectedAccountFilter("all");
                  setSearchFilter("");
                }}
              >
                Reset filters
              </Button>
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-[var(--line)] rounded-[14px] border border-[var(--line)] bg-white shadow-2xs overflow-hidden">
              {pagedChangeEvents.map((c) => {
                const matchedAccount = c.accountId ? accountsMap[c.accountId] : null;
                const { excerpt, sourceUrl } = parseChangeEventDetail(c.detail);
                const { companyName, headline } = extractCompanyAndHeadline(c.title, matchedAccount);
                const signal = resolveSignalInfo(c, monitorsMap, playbooksMap);
                const mon = monitorsMap[c.monitorId];
                const monitorName = mon?.name ?? "Monitor";
                const open = expandedId === c.id;

                return (
                  <li key={c.id} className="transition-colors hover:bg-slate-50/70">
                    <div className="flex items-start gap-3.5 px-4 py-3.5 sm:px-5">
                      {/* Clickable scan row (matches Discover leads layout) */}
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpandedId(open ? null : c.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          {/* Header row: Account name · Domain · Signal Name Badge · Account status · Date */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-[var(--foreground)] text-[14.5px]">
                              {companyName}
                            </span>
                            {matchedAccount?.domain ? (
                              <span className="text-xs text-[var(--muted)]">
                                · {matchedAccount.domain}
                              </span>
                            ) : null}
                            {/* Prominent Signal Name Badge */}
                            <Badge tone="blue">{signal.label}</Badge>
                            {matchedAccount ? (
                              <Badge tone="green">Target account</Badge>
                            ) : (
                              <Badge tone="default">Discovered</Badge>
                            )}
                            <span className="text-xs text-[var(--muted)] ml-auto sm:ml-0">
                              {formatDate(c.discoveredAt)}
                            </span>
                          </div>

                          {/* Trigger headline on the account (Discover style: clamped, clean, no massive text blocks) */}
                          <p className="mt-1 text-sm text-[var(--muted)] line-clamp-1">
                            <span className="font-medium text-[var(--foreground)]/90">{headline}</span>
                            {excerpt && excerpt !== headline ? ` · ${excerpt}` : ""}
                          </p>

                          {/* Metadata row */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                            {sourceUrl ? (
                              <a
                                href={sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-medium text-[var(--brand-active)] hover:underline"
                              >
                                Open source <ExternalLink size={11} aria-hidden />
                              </a>
                            ) : null}
                            <span className="text-[var(--muted)]">
                              Monitor: <strong className="font-medium text-[var(--foreground)]">{monitorName}</strong>
                            </span>
                            {c.accountId ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                <CheckCircle2 size={12} className="text-emerald-600" /> Saved as evidence on account
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Expand/Collapse Chevron */}
                        <div className="flex items-center gap-1.5 shrink-0 pt-1 text-[var(--muted)]">
                          <span className="text-xs hidden sm:inline">{open ? "Hide" : "Details"}</span>
                          <ChevronDown
                            size={17}
                            aria-hidden
                            className={`transition-transform duration-200 ${open ? "rotate-180 text-[var(--foreground)]" : ""}`}
                          />
                        </div>
                      </button>

                      {/* Action Button */}
                      {c.accountId ? (
                        <div className="shrink-0 pt-0.5">
                          <Link href={`/accounts/detail?id=${c.accountId}`}>
                            <Button className="!py-1.5 !px-3 text-xs">
                              Review →
                            </Button>
                          </Link>
                        </div>
                      ) : null}
                    </div>

                    {/* Accordion detail view: Styled exactly like Discover */}
                    {open ? (
                      <div className="mx-4 mb-4 rounded-[10px] border border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-4 text-sm">
                        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                          <div>
                            <dt className="text-xs font-semibold text-[var(--muted)]">Account</dt>
                            <dd className="mt-1 font-medium text-[var(--foreground)]">{companyName}</dd>
                            <dd className="text-xs text-[var(--muted)]">
                              {[matchedAccount?.domain, matchedAccount?.country && countryName(matchedAccount.country)].filter(Boolean).join(" · ") || "Website unconfirmed"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold text-[var(--muted)]">Signal</dt>
                            <dd className="mt-1 flex items-center gap-1.5 font-medium text-[var(--foreground)]">
                              <Badge tone="blue">{signal.label}</Badge>
                            </dd>
                            <dd className="mt-0.5 text-xs text-[var(--muted)]">Detected by {monitorName}</dd>
                          </div>
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-semibold text-[var(--muted)]">Trigger</dt>
                            <dd className="mt-1 font-medium text-[var(--foreground)]">{c.title}</dd>
                            <dd className="mt-1 text-xs text-[var(--muted)]">
                              Discovered {formatDate(c.discoveredAt)} ·{" "}
                              {sourceUrl ? (
                                <a
                                  href={sourceUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="inline-flex items-center gap-1 font-medium text-[var(--brand-active)] hover:underline"
                                >
                                  Open original source <ExternalLink size={12} aria-hidden />
                                </a>
                              ) : (
                                "Source link unavailable"
                              )}
                            </dd>
                          </div>
                          {excerpt ? (
                            <div className="sm:col-span-2">
                              <dt className="text-xs font-semibold text-[var(--muted)]">Evidence & Summary</dt>
                              <dd className="mt-1 rounded-lg border border-[var(--line)] bg-white p-3 text-xs leading-relaxed text-slate-700 break-words">
                                {renderDetailWithLinks(excerpt)}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {c.accountId ? (
                          <div className="mt-4 flex justify-end">
                            <Link href={`/accounts/detail?id=${c.accountId}`}>
                              <Button variant="primary" className="!py-1.5 !px-3.5 text-xs">
                                Open account brief →
                              </Button>
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {changeEventsPager}
          </div>
        )}
      </div>

      {/* Add Playbook Modal */}
      <Modal
        open={modalOpen}
        onClose={() => !creating && setModalOpen(false)}
        title="Add playbook monitor"
        description="Choose any playbook to schedule continuous automated research and detect buying signals."
        size="md"
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="quiet" disabled={creating} onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={creating || !selectedTemplateKey}
              onClick={() => void handleAddPlaybook()}
            >
              {creating ? "Adding monitor…" : "Start monitoring"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Choose playbook" hint="Select the playbook criteria you want to monitor">
            <select
              className={inputClass}
              value={selectedTemplateKey}
              onChange={(e) => setSelectedTemplateKey(e.target.value)}
            >
              {playbooks.map((p) => (
                <option key={p.templateKey} value={p.templateKey}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          {chosenPlaybook ? (
            <div className="rounded-[8px] bg-[var(--surface-sunken)] p-3 text-xs text-[var(--muted)] space-y-1.5">
              <div className="font-semibold text-[var(--foreground)]">
                {chosenPlaybook.name}
              </div>
              <div>
                <span className="font-medium text-[var(--foreground)]">Signals: </span>
                {chosenPlaybook.rules.signals.map((s) => humanize(s)).join(", ")}
              </div>
              {chosenPlaybook.rules.countries.length > 0 ? (
                <div>
                  <span className="font-medium text-[var(--foreground)]">Territory: </span>
                  {chosenPlaybook.rules.countries.join(", ")}
                </div>
              ) : null}
              {chosenPlaybook.rules.eventWindowDays ? (
                <div>
                  <span className="font-medium text-[var(--foreground)]">Event window: </span>
                  {chosenPlaybook.rules.eventWindowDays} days
                </div>
              ) : null}
              {chosenPlaybook.rules.description ? (
                <p className="text-[var(--foreground)]/80 italic mt-1">
                  &ldquo;{chosenPlaybook.rules.description}&rdquo;
                </p>
              ) : null}
            </div>
          ) : null}

          {isAlreadyMonitored ? (
            <div className="rounded-[7px] border border-[var(--badge-amber-border)] bg-[var(--badge-amber-bg)] px-3 py-2 text-xs text-[var(--badge-amber-fg)]">
              Note: This playbook is already being monitored. Adding another will run a concurrent check on its schedule.
            </div>
          ) : null}

          <Field label="Check frequency" hint="How often Insyder should re-check the web for new signals">
            <select
              className={inputClass}
              value={selectedCadence}
              onChange={(e) => setSelectedCadence(Number(e.target.value))}
            >
              <option value={24}>Daily (every 24 hours)</option>
              <option value={168}>Weekly (every 7 days - recommended)</option>
              <option value={720}>Monthly (every 30 days)</option>
            </select>
          </Field>

          <FormError message={modalError} />
        </div>
      </Modal>

      <MonitorAccountsModal
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        workspaceId={workspaceId}
        accounts={[]}
        onSuccess={async () => {
          await loadData();
        }}
      />
    </div>
  );
}

export default function MonitorsPage() {
  return (
    <RequireCap cap="view_accounts">
      {(wsId) => <MonitorsView workspaceId={wsId} />}
    </RequireCap>
  );
}
