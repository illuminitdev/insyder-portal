"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
  Building2,
  Radio,
  RadioTower,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Target,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import type { Account, PipelineRow } from "@/lib/api/accounts";
import type { ChangeEvent } from "@/lib/api/monitors";
import { formatMoney, OPPORTUNITY_STAGE_LABELS } from "@/lib/api/opportunities";
import { humanize } from "@/components/ui/Field";
import { usePagination } from "@/components/ui/Pagination";
import { canQueueResearch } from "@/components/accounts/AccountTable";
import { ago, initialsOf, Panel } from "@/components/accounts/AccountOverview";

/** Priority 70+ (or accepted by sales) counts as Tier 1 */
export const isTier1 = (a: Account) => (a.fitScore ?? 0) >= 70 || a.acceptanceState === "accepted";

type FilterTab = "all" | "tier1" | "tier2" | "researched" | "accepted";

const SOURCE_LABELS: Record<string, string> = {
  import: "CSV import",
  discovery: "Discovered",
  manual: "Added by hand",
};

function statusLine(a: Account): { label: string; text: string; live: boolean } {
  if (a.whyNowText) return { label: "Buying signal:", text: a.whyNowText, live: true };
  switch (a.researchState) {
    case "researching":
      return { label: "Research running:", text: "searching public sources for buying signals…", live: true };
    case "researched":
      return { label: "Researched:", text: "open the account brief to review the sources found.", live: false };
    case "failed":
      return { label: "Research failed:", text: "run it again from the account brief.", live: false };
    default:
      return { label: "Not researched yet:", text: "queue research to look for buying signals.", live: false };
  }
}

function Kpi({
  label,
  Icon,
  tone,
  value,
  children,
}: {
  label: string;
  Icon: LucideIcon;
  tone: string;
  value: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="!p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 text-[11.5px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">{label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${tone}`}>
          <Icon size={19} strokeWidth={1.9} aria-hidden />
        </span>
      </div>
      <p className="mt-1 truncate text-[30px] font-bold leading-none tracking-[-0.03em] 2xl:text-[36px]" title={typeof value === "string" ? value : undefined}>{value}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13.5px] text-[var(--plum)]">{children}</div>
    </Panel>
  );
}

/** Intent score with a ring that fills to the score; red from 70 up */
function ScoreBadge({ score }: { score: number | null }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const high = score != null && score >= 70;
  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-[14px] bg-[#f6f5fc] py-1.5 pl-3.5 pr-2">
      <span className="text-right leading-tight">
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">Intent score</span>
        <span className="block text-[18px] font-bold">
          {score ?? "—"}
          <span className="text-[14px] font-normal text-[var(--plum)]"> /100</span>
        </span>
      </span>
      <span className="relative flex h-10 w-10 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-10 w-10 -rotate-90">
          <circle cx="18" cy="18" r={r} fill="none" stroke="#e6e3f0" strokeWidth="3" />
          {score != null ? (
            <circle
              cx="18"
              cy="18"
              r={r}
              fill="none"
              stroke={high ? "var(--brand)" : "#a99bb8"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - Math.min(100, Math.max(0, score)) / 100)}
            />
          ) : null}
        </svg>
        <Zap size={15} className={high ? "text-[var(--brand-text)]" : "text-[var(--plum-muted)]"} />
      </span>
    </div>
  );
}

const chip = "inline-flex items-center gap-1.5 rounded-lg bg-[var(--lilac)] px-2 py-0.5 text-[13px] font-semibold";

export function AccountIntelligenceFeed({
  accounts,
  selection,
  pipelineRows = [],
  changeEvents = [],
  crmName,
  crmConnected = false,
  canSendToCrm = false,
  workspaceName = "Workspace",
  filters,
  filtersActive = 0,
}: {
  accounts: Account[];
  selection?: { selected: string[]; onChange: (ids: string[]) => void };
  pipelineRows?: PipelineRow[];
  changeEvents?: ChangeEvent[];
  crmName?: string;
  crmConnected?: boolean;
  /** May this member send accounts to the CRM (tenant admin) */
  canSendToCrm?: boolean;
  workspaceName?: string;
  /** Extra filters, shown under the search bar when the filter button is on */
  filters?: ReactNode;
  filtersActive?: number;
}) {
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(filtersActive > 0);

  // Pipeline: deals recorded on these accounts
  const deals = pipelineRows.filter((r) => r.opportunity);
  const valued = deals.filter((r) => r.opportunity?.valueAmount != null);
  const currency = valued[0]?.opportunity?.currency ?? "GBP";
  const pipelineValue = valued
    .filter((r) => r.opportunity!.currency === currency)
    .reduce((sum, r) => sum + (r.opportunity!.valueAmount ?? 0), 0);
  const pipelineByAccount = new Map(pipelineRows.map((r) => [r.accountId, r]));

  const tier1 = accounts.filter(isTier1);
  const tier2 = accounts.filter((a) => !isTier1(a));
  const researched = accounts.filter((a) => a.researchState === "researched");
  const accepted = accounts.filter((a) => a.acceptanceState === "accepted");
  const updatedThisWeek = accounts.filter((a) => Date.now() - new Date(a.updatedAt).getTime() < 7 * 86_400_000).length;
  const qualified = accounts.filter((a) => a.researchState === "researched" || a.acceptanceState === "accepted").length;
  const coverage = accounts.length ? Math.round((qualified / accounts.length) * 100) : 0;
  const recentChanges = changeEvents.filter((e) => Date.now() - new Date(e.discoveredAt).getTime() < 30 * 86_400_000);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  const q = searchQuery.trim().toLowerCase();
  const filtered = accounts.filter((a) => {
    if (q && ![a.name, a.domain, a.country].some((v) => v?.toLowerCase().includes(q))) return false;
    if (filterTab === "tier1") return isTier1(a);
    if (filterTab === "tier2") return !isTier1(a);
    if (filterTab === "researched") return a.researchState === "researched";
    if (filterTab === "accepted") return a.acceptanceState === "accepted";
    return true;
  });

  const { pageItems, pager, topRef } = usePagination(filtered, 10);

  const pageIds = pageItems.filter(canQueueResearch).map((a) => a.id);
  const pageAllOn = pageIds.length > 0 && pageIds.every((id) => selection?.selected.includes(id));
  const togglePageAll = () => {
    if (!selection) return;
    selection.onChange(
      pageAllOn
        ? selection.selected.filter((id) => !pageIds.includes(id))
        : [...new Set([...selection.selected, ...pageIds])],
    );
  };
  const toggleOne = (id: string) => {
    if (!selection) return;
    selection.onChange(
      selection.selected.includes(id) ? selection.selected.filter((x) => x !== id) : [...selection.selected, id],
    );
  };

  const tabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: "all", label: "All accounts", count: accounts.length },
    { key: "tier1", label: "Tier 1", count: tier1.length },
    { key: "tier2", label: "Tier 2", count: tier2.length },
    { key: "researched", label: "Researched", count: researched.length },
    { key: "accepted", label: "Sales accepted", count: accepted.length },
  ];

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {/* KPI cards */}
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        <Kpi label="Total accounts" Icon={Building2} tone="bg-[var(--lilac)] text-[var(--link)]" value={accounts.length}>
          {updatedThisWeek ? (
            <span className={`${chip} text-[var(--foreground)]`}>
              <TrendingUp size={15} className="text-[var(--badge-green-fg)]" aria-hidden /> {updatedThisWeek} updated this week
            </span>
          ) : null}
          <span>{crmConnected && crmName ? `CRM: ${crmName}` : "In this workspace"}</span>
        </Kpi>
        <Kpi label="High intent tier 1" Icon={Target} tone="bg-[var(--brand-tint)] text-[var(--brand-active)]" value={tier1.length}>
          {tier1.length ? (
            <>
              <span className={`${chip} text-[var(--brand-active)]`}>
                <span className="h-2 w-2 rounded-full bg-[var(--brand)]" aria-hidden /> Priority 70+ or accepted
              </span>
              <span>Top priority</span>
            </>
          ) : (
            <span>Run research to score accounts</span>
          )}
        </Kpi>
        <Kpi label="Monitored changes" Icon={RadioTower} tone="bg-[var(--lilac)] text-[#7c3aed]" value={recentChanges.length}>
          <span className={`${chip} text-[var(--foreground)]`}>
            <Radio size={15} className="text-[var(--brand-active)]" aria-hidden />
            {recentChanges.filter((e) => e.material).length} material
          </span>
          <span>Found by monitors in the last 30 days</span>
        </Kpi>
        <Kpi
          label="Open pipeline value"
          Icon={Banknote}
          tone="bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
          value={valued.length ? formatMoney(pipelineValue, currency) : "—"}
        >
          <span className={`${chip} text-[var(--foreground)]`}>
            <span className="h-2 w-2 rounded-full bg-[var(--brand)]" aria-hidden />
            {deals.length} {deals.length === 1 ? "deal" : "deals"}
          </span>
          <span>{deals.length ? "Recorded after outreach" : "No deals recorded yet"}</span>
        </Kpi>
      </div>

      {/* Tabs + search */}
      <div className="rounded-[20px] border border-[var(--card-line)] bg-white p-2 shadow-[var(--card-shadow)]">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div role="tablist" aria-label="Account lists" className="flex min-w-0 gap-1 overflow-x-auto">
            {tabs.map((t) => {
              const active = t.key === filterTab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilterTab(t.key)}
                  className={`flex shrink-0 items-center gap-2.5 rounded-[14px] px-4 py-2.5 text-[15.5px] font-medium transition ${
                    active ? "bg-[var(--brand)] text-[var(--on-brand)] shadow-[0_4px_12px_rgba(13,27,42,0.25)]" : "text-[var(--plum)] hover:bg-[var(--lilac)]"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[12.5px] font-semibold ${
                      active ? "bg-white/20 text-white" : "bg-[var(--lilac)] text-[var(--foreground)]"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Filter accounts</span>
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--plum-muted)]" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter company, domain, country…"
                className="w-full rounded-[14px] bg-[var(--soft)] py-3 pl-11 pr-4 text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--plum-muted)] focus:ring-2 focus:ring-[var(--brand-tint)]"
              />
            </label>
            {filters ? (
              <button
                type="button"
                aria-label="More filters"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((s) => !s)}
                className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] transition ${
                  showFilters ? "bg-[var(--brand-tint)] text-[var(--brand-active)]" : "bg-[var(--soft)] text-[var(--plum)] hover:bg-[var(--lilac)]"
                }`}
              >
                <SlidersHorizontal size={19} aria-hidden />
                {filtersActive ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[11px] font-bold text-[var(--on-brand)]">
                    {filtersActive}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        </div>
        {filters && showFilters ? <div className="border-t border-[var(--line)] px-3 pb-2 pt-4">{filters}</div> : null}
      </div>

      {/* Feed + side column */}
      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div ref={topRef} className="min-w-0 scroll-mt-24 space-y-5">
          {selection && pageItems.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-white/80 px-5 py-3 text-[14px] text-[var(--plum)] shadow-[var(--card-shadow)]">
              <label className="flex cursor-pointer select-none items-center gap-3 font-semibold text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={pageAllOn}
                  disabled={!pageIds.length}
                  onChange={togglePageAll}
                  className="h-4 w-4 cursor-pointer accent-[var(--brand)]"
                />
                Select all on this page ({pageItems.length})
              </label>
              {selection.selected.length ? (
                <span className="font-semibold text-[var(--brand-active)]">
                  {selection.selected.length} {selection.selected.length === 1 ? "account" : "accounts"} selected
                </span>
              ) : (
                <span className="hidden sm:inline">Tick accounts to research them in one go</span>
              )}
            </div>
          ) : null}

          {!filtered.length ? (
            <Panel className="text-center">
              <p className="text-[17px] font-semibold">No accounts match</p>
              <p className="mt-1 text-[15px] text-[var(--plum)]">Clear the search or pick another tab.</p>
            </Panel>
          ) : null}

          {pageItems.map((acc) => {
            const selected = selection?.selected.includes(acc.id) ?? false;
            const canQueue = canQueueResearch(acc);
            const deal = pipelineByAccount.get(acc.id)?.opportunity;
            const status = statusLine(acc);
            const tier1Acc = isTier1(acc);
            const source = acc.source === "crm_import" ? `From ${crmName ?? "CRM"}` : (SOURCE_LABELS[acc.source] ?? humanize(acc.source));
            const meta = [acc.domain, acc.country, `Updated ${ago(acc.updatedAt)}`].filter(Boolean);
            const tag = "rounded-md bg-[#f3f2fb] px-2 py-0.5 text-[12.5px] font-medium text-[var(--plum)]";
            return (
              <div
                key={acc.id}
                className={`rounded-[18px] border bg-white p-4 shadow-[var(--card-shadow)] transition hover:shadow-[0_12px_32px_rgba(13,27,42,0.09)] sm:p-5 ${
                  selected ? "border-[var(--brand)] ring-2 ring-[var(--brand-tint)]" : "border-[var(--card-line)]"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  {selection ? (
                    <input
                      type="checkbox"
                      aria-label={`Select ${acc.name}`}
                      checked={selected}
                      disabled={!canQueue}
                      title={canQueue ? undefined : "Already being researched"}
                      onChange={() => toggleOne(acc.id)}
                      className="mt-6 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brand)] disabled:cursor-not-allowed"
                    />
                  ) : null}
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[var(--lilac)] to-[#e6e3f7] text-[17px] font-semibold text-[var(--foreground)]">
                    {initialsOf(acc.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/accounts/detail?id=${acc.id}`}
                        className="mr-1 truncate text-[19px] font-bold tracking-[-0.02em] hover:text-[var(--brand-active)]"
                      >
                        {acc.name}
                      </Link>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[12.5px] font-semibold ${
                          tier1Acc ? "bg-[#e6e3f7] text-[var(--foreground)]" : "bg-[#f3f2fb] text-[var(--plum)]"
                        }`}
                      >
                        {tier1Acc ? "Tier 1" : "Tier 2"}
                      </span>
                      <span className={tag}>{source}</span>
                      <span className={tag}>{humanize(acc.acceptanceState)}</span>
                      {deal ? (
                        <span className="rounded-md bg-[var(--badge-green-bg)] px-2 py-0.5 text-[12.5px] font-medium text-[var(--badge-green-fg)]">
                          {OPPORTUNITY_STAGE_LABELS[deal.stage]}
                          {deal.valueAmount != null ? ` · ${formatMoney(deal.valueAmount, deal.currency)}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-[14px] text-[var(--plum)]">{meta.join(" • ")}</p>
                  </div>
                  <ScoreBadge score={acc.fitScore} />
                </div>

                <p className="mt-3.5 flex gap-2.5 rounded-[12px] bg-[#f6f5fc] px-4 py-2.5 text-[14px] leading-relaxed">
                  <span
                    className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${status.live ? "bg-[var(--brand)]" : "bg-[#B8C3CF]"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 line-clamp-2">
                    <span className={`font-semibold ${status.live ? "text-[var(--brand-active)]" : "text-[var(--foreground)]"}`}>
                      {status.label}
                    </span>{" "}
                    {status.text}
                  </span>
                </p>

                <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
                  <Link
                    href={`/accounts/detail?id=${acc.id}`}
                    className="inline-flex items-center rounded-[12px] bg-[#e9e8fb] px-4 py-2 text-[14px] font-medium text-[var(--foreground)] transition hover:brightness-[0.97]"
                  >
                    View account brief
                  </Link>
                  {crmConnected && crmName && canSendToCrm && acc.acceptanceState === "accepted" ? (
                    <Link
                      href={`/accounts/detail?id=${acc.id}&tab=workflow&step=sell`}
                      className="inline-flex items-center gap-2 rounded-[12px] bg-[#f6f5fc] px-4 py-2 text-[14px] font-medium text-[var(--foreground)] transition hover:text-[var(--brand-active)]"
                    >
                      <RefreshCw size={15} className="text-[var(--brand-active)]" aria-hidden />
                      Send to {crmName}
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}

          {pager}
        </div>

        {/* Side column */}
        <div className="min-w-0 space-y-6">
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.02em]">
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" aria-hidden /> Signal activity log
              </h2>
              <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--brand-active)]">Monitors</span>
            </div>
            {changeEvents.length ? (
              <ol className="mt-5">
                {changeEvents.slice(0, 5).map((ev, i, list) => (
                  <li key={ev.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < list.length - 1 ? <span className="absolute left-[15px] top-9 h-[calc(100%-28px)] w-px bg-[var(--line)]" aria-hidden /> : null}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--lilac)] text-[var(--plum)]">
                      <Radio size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 text-[16px] font-semibold leading-snug">{ev.title}</p>
                        <span className="shrink-0 text-[13px] text-[var(--plum)]">{ago(ev.discoveredAt)}</span>
                      </div>
                      {ev.accountId && accountNames.get(ev.accountId) ? (
                        <p className="mt-0.5 text-[14px] font-medium text-[var(--foreground)]">{accountNames.get(ev.accountId)}</p>
                      ) : null}
                      {ev.detail ? <p className="mt-1 line-clamp-3 text-[14.5px] leading-relaxed text-[var(--plum)]">{ev.detail}</p> : null}
                      {ev.material ? (
                        <span className="mt-2 inline-flex rounded-md bg-[var(--brand-tint)] px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-[var(--brand-active)]">
                          Material change
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="py-8 text-center">
                <Radio size={24} className="mx-auto text-[#B8C3CF]" aria-hidden />
                <p className="mt-2 text-[15px] font-semibold">No changes found yet</p>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--plum)]">
                  Monitors record leadership moves and other buying triggers here as they run.
                </p>
              </div>
            )}
            <Link
              href="/accounts/monitors"
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--lilac)] px-4 py-3 text-[15px] font-medium text-[var(--foreground)] transition hover:brightness-[0.98]"
            >
              Open monitors <ArrowRight size={16} aria-hidden />
            </Link>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[20px] font-semibold tracking-[-0.02em]">{coverage}% qualified</p>
              <TrendingUp size={20} className="text-[var(--brand-active)]" aria-hidden />
            </div>
            <p className="mt-3 text-[18px] font-semibold tracking-[-0.01em]">{workspaceName} coverage</p>
            <p className="mt-1 text-[14.5px] leading-relaxed text-[var(--plum)]">
              {qualified} of {accounts.length} accounts are researched or accepted by sales.
            </p>
            <div className="mt-5 flex items-center justify-between text-[14.5px] font-semibold">
              <span className="text-[var(--plum)]">Qualified accounts</span>
              <span>{coverage}%</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[var(--lilac)]">
              <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-500" style={{ width: `${coverage}%` }} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
