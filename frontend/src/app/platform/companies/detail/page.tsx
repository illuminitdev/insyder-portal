"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  CalendarDays,
  ExternalLink,
  Globe,
  Pencil,
  RotateCcw,
  Shapes,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/Button";
import { CrmChip } from "@/components/platform/CrmChip";
import { PlanBillingPanel } from "@/components/platform/PlanBillingPanel";
import { SHOW_PLANS } from "@/lib/features";
import { initials, toneFor } from "@/components/platform/CompanyCards";
import { DeleteCompanyModal, EditCompanyModal } from "@/components/platform/CompanyModals";
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/auth/capabilities";
import { formatDate } from "@/lib/utils/dates";
import { getPlatformCompany, resetCompanyResearch, type PlatformCompanyDetail } from "@/lib/api/platform";

function Tile({ Icon, label, value, tone }: { Icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-[var(--line)] bg-white px-4 py-3.5">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${tone}`} aria-hidden>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="text-xl font-semibold tabular-nums text-[var(--foreground)]">{value}</p>
      </div>
    </div>
  );
}

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[14px] border border-[var(--line)] bg-white p-5 ${className}`}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One company in full, for the platform admin: usage, website, CRM, users and workspaces. */
export default function PlatformCompanyDetailPage() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const from = params.get("from") === "users" ? "users" : "companies";
  const backHref = from === "users" ? "/platform/users" : "/platform/companies";
  const router = useRouter();

  const [c, setC] = useState<PlatformCompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setError("No company chosen.");
      return;
    }
    try {
      setC(await getPlatformCompany(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the company");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} />;
  if (!c) return <LoadingState />;

  const roles = ROLE_ORDER.filter((r) => c.usersByRole[r]);
  const pct = c.researchQuotaMonthly ? Math.min(100, (c.researchUsedMonthly / c.researchQuotaMonthly) * 100) : 0;
  const barTone = pct >= 90 ? "bg-[var(--brand)]" : pct >= 70 ? "bg-[var(--badge-amber-fg)]" : "bg-[var(--navy)]";

  return (
    <div className="space-y-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={15} aria-hidden /> Back to {from === "users" ? "Users" : "Companies"}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-[14px] border border-[var(--line)] bg-white p-5">
        <div className="flex min-w-0 items-center gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] text-lg font-bold ${toneFor(c.id)}`} aria-hidden>
            {initials(c.name)}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Company</p>
            <h1 className="truncate text-2xl font-semibold text-[var(--foreground)]">{c.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
              <span className="flex items-center gap-1">
                <CalendarDays size={13} aria-hidden /> Joined {formatDate(c.createdAt)}
              </span>
              {c.website ? (
                <a
                  href={c.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--navy)] hover:underline"
                >
                  <Globe size={13} aria-hidden /> {hostOf(c.website)} <ExternalLink size={11} aria-hidden />
                </a>
              ) : (
                <span className="flex items-center gap-1">
                  <Globe size={13} aria-hidden /> No website set
                </span>
              )}
              <CrmChip crm={c.crm} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing(true)}>
            <Pencil size={14} className="mr-1.5" aria-hidden /> Edit
          </Button>
          <Button onClick={() => setDeleting(true)} className="!border-[var(--danger-tint)] !text-[var(--danger)] hover:!bg-[var(--danger-tint)]">
            <Trash2 size={14} className="mr-1.5" aria-hidden /> Delete
          </Button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile Icon={Users} label="Users" value={c.users} tone="bg-brand-50 text-brand-600" />
        <Tile Icon={ShieldCheck} label="Tenant admins" value={c.admins.length} tone="bg-sky-50 text-sky-600" />
        <Tile Icon={Shapes} label="Workspaces" value={c.workspaces.length} tone="bg-violet-50 text-violet-600" />
        <Tile Icon={Briefcase} label="Accounts" value={c.accounts} tone="bg-emerald-50 text-emerald-600" />
      </div>

      {SHOW_PLANS && <PlanBillingPanel key={`${c.plan}-${c.billingStatus}`} c={c} onChanged={() => void load()} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Usage */}
        <Section title="Research usage this month">
          <div className="flex items-baseline justify-between gap-2">
            <p className="tabular-nums text-[var(--foreground)]">
              <span className="text-2xl font-semibold">{c.researchUsedMonthly}</span>
              <span className="text-sm text-[var(--muted)]"> / {c.researchQuotaMonthly} units</span>
            </p>
            <button
              type="button"
              disabled={resetting || c.researchUsedMonthly === 0}
              onClick={async () => {
                if (!confirm(`Reset ${c.name}'s research usage to 0 units?`)) return;
                setResetting(true);
                try {
                  await resetCompanyResearch(c.id);
                  await load();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Could not reset research units");
                } finally {
                  setResetting(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--line)] disabled:hover:bg-white disabled:hover:text-[var(--muted)]"
            >
              <RotateCcw size={11} className={resetting ? "animate-spin" : undefined} aria-hidden /> Reset
            </button>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--chip-bg)]"
            role="progressbar"
            aria-label={`${c.name} research usage`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
          >
            <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.max(pct, pct ? 2 : 0)}%` }} />
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            {Math.max(0, c.researchQuotaMonthly - c.researchUsedMonthly)} units left · period started {formatDate(c.researchQuotaPeriodStart)}
          </p>
        </Section>

        {/* Tenant admins */}
        <Section title="Tenant admins">
          <ul className="space-y-2 text-sm">
            {c.admins.map((a) => (
              <li key={a.userId} className="min-w-0">
                <p className="truncate font-medium text-[var(--foreground)]">{a.name}</p>
                <a href={`mailto:${a.email}`} className="truncate text-xs text-[var(--muted)] hover:underline">
                  {a.email}
                </a>
              </li>
            ))}
            {!c.admins.length ? <li className="text-[var(--brand-active)]">No tenant admin</li> : null}
          </ul>
        </Section>

        {/* Users by role */}
        <Section title="Users by role">
          <ul className="divide-y divide-[var(--line)] text-sm">
            {roles.map((r) => (
              <li key={r} className="flex justify-between gap-3 py-1.5">
                <span>{ROLE_LABELS[r] ?? r}</span>
                <span className="font-semibold tabular-nums">{c.usersByRole[r]}</span>
              </li>
            ))}
            {!roles.length ? <li className="py-1.5 text-[var(--muted)]">No users</li> : null}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">Only tenant admins are named; everyone else stays a count.</p>
        </Section>
      </div>

      {/* Workspaces */}
      <section className="rounded-[14px] border border-[var(--line)] bg-white">
        <h2 className="px-5 pb-3 pt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Workspaces ({c.workspaces.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-[var(--line)] bg-[var(--chip-bg)]/50 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-5 py-2.5 text-left">Workspace</th>
                <th className="px-3 py-2.5 text-center">Users</th>
                <th className="px-3 py-2.5 text-center">Accounts</th>
                <th className="px-3 py-2.5 text-left">Website</th>
                <th className="px-3 py-2.5 text-left">CRM</th>
                <th className="px-5 py-2.5 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {c.workspaces.map((w) => (
                <tr key={w.id}>
                  <td className="px-5 py-3 font-medium text-[var(--foreground)]">{w.name}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums">{w.users}</td>
                  <td className="px-3 py-3 text-center font-semibold tabular-nums">{w.accounts}</td>
                  <td className="px-3 py-3">
                    {w.website ? (
                      <a href={w.website} target="_blank" rel="noopener noreferrer" className="text-[var(--navy)] hover:underline">
                        {hostOf(w.website)}
                      </a>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {w.crm ? (
                      <CrmChip crm={w.crm} />
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[var(--muted)]">{formatDate(w.createdAt)}</td>
                </tr>
              ))}
              {!c.workspaces.length ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-[var(--muted)]">
                    No workspaces
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <EditCompanyModal
        company={editing ? c : null}
        onClose={() => setEditing(false)}
        onSaved={(_, name) => {
          setC({ ...c, name });
          setEditing(false);
        }}
      />
      <DeleteCompanyModal company={deleting ? c : null} onClose={() => setDeleting(false)} onDeleted={() => router.push(backHref)} />
    </div>
  );
}
