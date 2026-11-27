"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Building2,
  CircleCheck,
  Info,
  Shapes,
  Link2,
  Users,
} from "lucide-react";
import { CrmChip } from "@/components/platform/CrmChip";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/overview/DashboardKit";
import { initials, toneFor } from "@/components/platform/CompanyCards";
import { ROLE_LABELS } from "@/lib/auth/capabilities";
import { formatDate } from "@/lib/utils/dates";
import { getPlatformOverview, type PlatformCompany, type PlatformOverview } from "@/lib/api/platform";

const ROLE_ORDER = ["tenant_admin", "researcher", "sales_reviewer", "sdr", "partner", "analyst"];

function usagePct(c: Pick<PlatformCompany, "researchUsedMonthly" | "researchQuotaMonthly">) {
  return c.researchQuotaMonthly ? Math.min(100, (c.researchUsedMonthly / c.researchQuotaMonthly) * 100) : 0;
}

function barTone(pct: number) {
  return pct >= 90 ? "bg-[var(--danger)]" : pct >= 70 ? "bg-[var(--badge-amber-fg)]" : "bg-[var(--brand)]";
}

const ROLE_COLORS: Record<string, string> = {
  tenant_admin: "#0D1B2A",
  researcher: "#0E6B67",
  sales_reviewer: "#3E9C94",
  sdr: "#7FD3CB",
  partner: "#CDEBE6",
  analyst: "#c4cad1",
};

function Avatar({ c, size = "h-8 w-8" }: { c: PlatformCompany; size?: string }) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold ${toneFor(c.id)}`}
      aria-hidden
    >
      {initials(c.name)}
    </span>
  );
}

function CardTitle({ title, info, action }: { title: string; info?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-[var(--foreground)]">
        {title}
        {info ? (
          <span title={info} aria-label={info} className="text-[var(--muted)]">
            <Info size={14} aria-hidden />
          </span>
        ) : null}
      </h2>
      {action}
    </div>
  );
}

function Bar({ pct, thick = false, label }: { pct: number; thick?: boolean; label?: string }) {
  return (
    <div
      className={`${thick ? "h-2.5" : "h-1.5"} overflow-hidden rounded-full bg-[var(--chip-bg)]`}
      {...(label
        ? { role: "progressbar", "aria-label": label, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct) }
        : { "aria-hidden": true })}
    >
      <div className={`h-full rounded-full ${barTone(pct)}`} style={{ width: `${pct ? Math.max(pct, 2) : 0}%` }} />
    </div>
  );
}

function Donut({ segments, total }: { segments: Array<{ key: string; value: number; color: string }>; total: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative h-[150px] w-[150px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--chip-bg)" strokeWidth="22" />
        {total
          ? segments.map((s) => {
              const len = (s.value / total) * circ;
              const el = (
                <circle
                  key={s.key}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="22"
                  strokeDasharray={`${Math.max(len - 1.5, 0)} ${circ}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })
          : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums text-[var(--foreground)]">{total}</span>
        <span className="text-xs text-[var(--muted)]">Members</span>
      </div>
    </div>
  );
}

/** Platform overview: totals across every company, research usage, role mix and newest companies. */
export default function PlatformOverviewPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlatformOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the overview"));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  const roleTotals: Record<string, number> = {};
  let used = 0;
  let quota = 0;
  for (const c of data.companies) {
    for (const [r, n] of Object.entries(c.membersByRole)) roleTotals[r] = (roleTotals[r] ?? 0) + n;
    used += c.researchUsedMonthly;
    quota += c.researchQuotaMonthly;
  }
  const totalPct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const roleSum = ROLE_ORDER.reduce((a, r) => a + (roleTotals[r] ?? 0), 0);

  const byUsage = [...data.companies].sort((a, b) => usagePct(b) - usagePct(a) || b.researchUsedMonthly - a.researchUsedMonthly);
  const topUsers = byUsage.filter((c) => c.researchUsedMonthly > 0).slice(0, 5);
  const nearLimit = byUsage.filter((c) => usagePct(c) >= 90);
  const watch = byUsage.filter((c) => usagePct(c) >= 70 && usagePct(c) < 90);
  const recent = [...data.companies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Every customer company on Insyder, as counts only. Their accounts, evidence and briefs stay private to each company."
        actions={
          <Link
            href="/platform/companies"
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-active)]"
          >
            <Building2 size={16} aria-hidden />
            Manage companies
          </Link>
        }
      />

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Link href="/platform/companies" className="block h-full min-w-0">
          <StatTile Icon={Building2} label="Companies" value={data.totals.companies} hint="Customer tenants" />
        </Link>
        <Link href="/platform/workspaces" className="block h-full min-w-0">
          <StatTile Icon={Shapes} label="Workspaces" value={data.totals.workspaces} hint="Across all companies" />
        </Link>
        <Link href="/platform/users" className="block h-full min-w-0">
          <StatTile Icon={Users} label="Active members" value={data.totals.members} hint="People with access" />
        </Link>
        <StatTile Icon={Briefcase} label="Accounts" value={data.totals.accounts} hint="Tracked target accounts" />
        <StatTile
          Icon={Link2}
          label="CRM connected"
          value={data.totals.crmConnected}
          hint={`of ${data.totals.companies} compan${data.totals.companies === 1 ? "y" : "ies"}`}
        />
      </div>

      {/* Research usage */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle
            title="Research units this month"
            info="Research units used by all companies this month, against the sum of their monthly limits."
          />
          <div className="mt-5 flex items-end justify-between gap-3">
            <p className="text-4xl font-semibold tabular-nums text-[var(--foreground)]">
              {used}
              <span className="ml-1.5 text-base font-normal text-[var(--muted)]">/ {quota} units</span>
            </p>
            <span
              className={`rounded-[6px] px-2 py-1 text-xs font-semibold tabular-nums ${
                totalPct >= 70 && totalPct < 90
                  ? "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]"
                  : "bg-[var(--brand-tint)] text-[var(--brand-active)]"
              }`}
            >
              {Math.round(totalPct)}% used
            </span>
          </div>
          <div className="mt-4">
            <Bar pct={totalPct} thick label="Total research usage" />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {Math.round(totalPct)}% of the combined monthly limit · {Math.max(0, quota - used)} units left
          </p>
        </Card>

        <Card>
          <CardTitle
            title="Top usage by company"
            action={
              <span className="rounded-[7px] border border-[var(--line)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)]">
                This month
              </span>
            }
          />
          {topUsers.length ? (
            <ul className="mt-4 space-y-3">
              {topUsers.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <Avatar c={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-semibold text-[var(--foreground)]" title={c.name}>
                        {c.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                        <span className="font-semibold text-[var(--foreground)]">{c.researchUsedMonthly}</span> /{" "}
                        {c.researchQuotaMonthly}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Bar pct={usagePct(c)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--muted)]">No research has been run this month yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Role mix */}
        <Card>
          <CardTitle title="Members by role" />
          <div className="mt-5 flex flex-wrap items-center gap-8">
            <Donut
              total={roleSum}
              segments={ROLE_ORDER.map((r) => ({ key: r, value: roleTotals[r] ?? 0, color: ROLE_COLORS[r] }))}
            />
            <ul className="min-w-[10rem] flex-1 space-y-2.5">
              {ROLE_ORDER.map((r) => (
                <li key={r} className="flex items-center gap-2.5 text-sm">
                  <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: ROLE_COLORS[r] }} aria-hidden />
                  <span className="flex-1 truncate text-[var(--foreground)]">{ROLE_LABELS[r]}</span>
                  <span className="font-semibold tabular-nums">{roleTotals[r] ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* Attention */}
        <Card>
          <CardTitle title="Needs attention" info="Companies at 70% or more of their monthly research limit." />
          {nearLimit.length || watch.length ? (
            <ul className="mt-4 space-y-2">
              {[...nearLimit, ...watch].map((c) => {
                const pct = usagePct(c);
                const critical = pct >= 90;
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 ${
                      critical
                        ? "border-[var(--brand-tint)] bg-[var(--brand-tint)]"
                        : "border-[var(--badge-amber-bg)] bg-[var(--badge-amber-bg)]"
                    }`}
                  >
                    <AlertTriangle
                      size={16}
                      className={`shrink-0 ${critical ? "text-[var(--brand-active)]" : "text-[var(--badge-amber-fg)]"}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">{c.name}</span>
                    <span
                      className={`shrink-0 text-xs font-semibold tabular-nums ${
                        critical ? "text-[var(--brand-active)]" : "text-[var(--badge-amber-fg)]"
                      }`}
                    >
                      {c.researchUsedMonthly} / {c.researchQuotaMonthly} · {Math.round(pct)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-6 flex items-center gap-3 rounded-[10px] bg-[var(--badge-green-bg)] px-4 py-4 text-sm text-[var(--foreground)]">
              <CircleCheck size={20} className="shrink-0 text-[var(--badge-green-fg)]" aria-hidden />
              All companies are well within their research limits.
            </div>
          )}
          {nearLimit.length ? (
            <Link
              href="/platform/companies"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-active)] hover:underline"
            >
              Reset usage on the Companies page
              <ArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </Card>
      </div>

      {/* Newest companies */}
      <Card>
        <CardTitle
          title="Newest companies"
          action={
            <Link
              href="/platform/companies"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand-active)] hover:underline"
            >
              View all companies
              <ArrowRight size={14} aria-hidden />
            </Link>
          }
        />
        {recent.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--muted)]">
                  <th className="py-2.5 pr-4 font-medium">Company</th>
                  <th className="py-2.5 pr-4 font-medium">Joined on</th>
                  <th className="py-2.5 pr-4 font-medium">Workspaces</th>
                  <th className="py-2.5 pr-4 font-medium">Members</th>
                  <th className="py-2.5 pr-4 font-medium">Accounts</th>
                  <th className="py-2.5 pr-4 font-medium">CRM</th>
                  <th className="py-2.5 text-right font-medium">Research units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {recent.map((c) => (
                  <tr key={c.id} className="tabular-nums">
                    <td className="py-3 pr-4">
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar c={c} />
                        <span className="truncate font-semibold text-[var(--foreground)]" title={c.name}>
                          {c.name}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-[var(--muted)]">{formatDate(c.createdAt)}</td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <Shapes size={14} className="text-[var(--muted)]" aria-hidden />
                        {c.workspaces}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <Users size={14} className="text-[var(--muted)]" aria-hidden />
                        {c.members}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase size={14} className="text-[var(--muted)]" aria-hidden />
                        {c.accounts}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <CrmChip crm={c.crm} />
                    </td>
                    <td className="w-36 py-3">
                      <span className="block text-right text-xs text-[var(--muted)]">
                        <span className="font-semibold text-[var(--foreground)]">{c.researchUsedMonthly}</span> /{" "}
                        {c.researchQuotaMonthly}
                      </span>
                      <span className="mt-1 block">
                        <Bar pct={usagePct(c)} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No companies yet.{" "}
            <Link href="/platform/companies" className="text-[var(--brand-active)] hover:underline">
              Add the first one
            </Link>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
