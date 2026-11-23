"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  ChevronDown,
  Eye,
  Layers,
  Pencil,
  Plus,
  Search,
  Shapes,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { DeleteCompanyModal, EditCompanyModal } from "@/components/platform/CompanyModals";
import { CrmChip } from "@/components/platform/CrmChip";
import { formatDate } from "@/lib/utils/dates";
import { getPlatformUsers, type PlatformUsersCompany } from "@/lib/api/platform";
import { usePagination } from "@/components/ui/Pagination";

type Data = Awaited<ReturnType<typeof getPlatformUsers>>;
type Tab = "all" | "with_admin" | "no_admin";
type Sort = "newest" | "oldest" | "name" | "users";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
  { value: "users", label: "Most users" },
];

/** Column layout shared by the heading row and every company row. */
const GRID = "md:grid-cols-[minmax(0,1fr)_96px_110px_150px_128px]";

/** Avatar colours, picked from the company name so each company keeps the same one. */
const AVATAR_TONES = [
  "bg-brand-50 text-brand-600",
  "bg-sky-50 text-sky-600",
  "bg-emerald-50 text-emerald-600",
  "bg-violet-50 text-violet-600",
  "bg-amber-50 text-amber-600",
  "bg-teal-50 text-teal-600",
  "bg-orange-50 text-orange-600",
  "bg-indigo-50 text-indigo-600",
];

function toneFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

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

const iconActionClass =
  "rounded-md p-1.5 text-[var(--muted)] transition hover:bg-[var(--chip-bg)] hover:text-[var(--foreground)]";

function IconAction({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={danger ? `${iconActionClass} hover:!bg-[var(--danger-tint)] hover:!text-[var(--danger)]` : iconActionClass}
    >
      {children}
    </button>
  );
}

function CompanyRow({ c, onEdit, onDelete }: { c: PlatformUsersCompany; onEdit: () => void; onDelete: () => void }) {
  const admin = c.admins[0];

  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-4 ${GRID}`}>
      {/* Company + tenant admin */}
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${toneFor(c.name)}`} aria-hidden>
          {initials(c.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{c.name}</p>
          {admin ? (
            <p className="truncate text-xs text-[var(--muted)]" title={c.admins.map((a) => `${a.name} · ${a.email}`).join("\n")}>
              {admin.email}
              {c.admins.length > 1 ? ` +${c.admins.length - 1}` : ""}
            </p>
          ) : (
            <p className="text-xs text-[var(--brand-active)]">No tenant admin</p>
          )}
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted)]">
            <CalendarDays size={11} aria-hidden /> Joined {formatDate(c.createdAt)}
          </p>
        </div>
      </div>

      {/* Counts */}
      <p className="hidden text-center text-base font-semibold tabular-nums md:block">{c.users}</p>
      <p className="hidden text-center text-base font-semibold tabular-nums md:block">{c.workspaces.length}</p>

      {/* CRM: its logo when connected, otherwise "No CRM" */}
      <div className="hidden justify-center md:flex">
        <CrmChip crm={c.crm} />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 md:justify-center">
        <Link href={`/platform/companies/detail?id=${encodeURIComponent(c.id)}&from=users`} aria-label={`View ${c.name}`} title={`View ${c.name}`} className={iconActionClass}>
          <Eye size={16} aria-hidden />
        </Link>
        <IconAction label={`Edit ${c.name}`} onClick={onEdit}>
          <Pencil size={15} aria-hidden />
        </IconAction>
        <IconAction label={`Delete ${c.name}`} onClick={onDelete} danger>
          <Trash2 size={15} aria-hidden />
        </IconAction>
      </div>
    </li>
  );
}

/** Users across companies: one row per company with its tenant admin and counts. */
export default function PlatformUsersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [editing, setEditing] = useState<PlatformUsersCompany | null>(null);
  const [deleting, setDeleting] = useState<PlatformUsersCompany | null>(null);

  const companies = data?.companies ?? [];
  const needle = q.trim().toLowerCase();
  const searched = companies.filter(
    (c) =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      c.admins.some((a) => a.name.toLowerCase().includes(needle) || a.email.toLowerCase().includes(needle)),
  );
  const counts = {
    all: searched.length,
    with_admin: searched.filter((c) => c.admins.length > 0).length,
    no_admin: searched.filter((c) => c.admins.length === 0).length,
  };
  const shown = searched
    .filter((c) => (tab === "all" ? true : tab === "with_admin" ? c.admins.length > 0 : c.admins.length === 0))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "users") return b.users - a.users || a.name.localeCompare(b.name);
      const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === "oldest" ? d : -d;
    });
  const { pageItems, pager, topRef } = usePagination(shown);

  const load = () =>
    getPlatformUsers()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load users"));

  useEffect(() => {
    void load();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "all", label: `All companies (${counts.all})` },
    { value: "with_admin", label: `With tenant admin (${counts.with_admin})` },
    { value: "no_admin", label: `No tenant admin (${counts.no_admin})` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Users"
        description="How many people each company has, by role and workspace. Only tenant admins are named; everyone else stays a count."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile Icon={Users} label="Users" value={data.totals.users} tone="bg-brand-50 text-brand-600" />
        <Tile Icon={ShieldCheck} label="Tenant admins" value={data.totals.admins} tone="bg-sky-50 text-sky-600" />
        <Tile Icon={Building2} label="Companies" value={data.totals.companies} tone="bg-emerald-50 text-emerald-600" />
        <Tile Icon={Shapes} label="Workspaces" value={data.totals.workspaces} tone="bg-violet-50 text-violet-600" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
          <input
            aria-label="Search companies or admins"
            className="w-full rounded-[10px] border border-[var(--input-border)] bg-white py-2.5 pl-10 pr-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--navy)] focus:ring-2 focus:ring-[var(--badge-blue-bg)]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, admin name or email..."
          />
        </div>
        <Link
          href="/platform/companies?add=1"
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-[var(--brand-active)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          title="Adds a company with its tenant admin; the tenant admin then adds their team"
        >
          <Plus size={16} aria-hidden /> Add user
        </Link>
      </div>

      <div ref={topRef} className="scroll-mt-24 rounded-[14px] border border-[var(--line)] bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line)] px-5 pt-3">
          <div role="tablist" className="flex flex-wrap gap-x-5">
            {tabs.map((t) => {
              const active = tab === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.value)}
                  className={`-mb-px whitespace-nowrap border-b-2 pb-3 text-sm transition ${
                    active
                      ? "border-[var(--brand-active)] font-semibold text-[var(--brand-active)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <label className="relative mb-2.5 flex items-center gap-1 text-xs text-[var(--muted)]">
            <span>Sort by:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="cursor-pointer appearance-none rounded-[8px] border border-[var(--line)] bg-white py-1.5 pl-2 pr-7 text-xs font-medium text-[var(--foreground)] outline-none focus:border-[var(--navy)]"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" aria-hidden />
          </label>
        </div>

        {/* Column headings */}
        <div
          className={`hidden items-center gap-x-4 border-b border-[var(--line)] bg-[var(--chip-bg)]/50 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] md:grid ${GRID}`}
        >
          <span>Company</span>
          <span className="text-center">Users</span>
          <span className="text-center">Workspaces</span>
          <span className="text-center">CRM</span>
          <span className="text-center">Actions</span>
        </div>

        {pageItems.length ? (
          <ul className="divide-y divide-[var(--line)]">
            {pageItems.map((c) => (
              <CompanyRow key={c.id} c={c} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-[var(--muted)]">
            <Layers size={20} aria-hidden />
            {q ? "Nothing matches that search." : tab === "all" ? "No companies yet." : "No companies in this tab."}
          </div>
        )}
      </div>
      {pager}

      <EditCompanyModal
        company={editing}
        onClose={() => setEditing(null)}
        onSaved={(id, name) => {
          setData((d) => (d ? { ...d, companies: d.companies.map((x) => (x.id === id ? { ...x, name } : x)) } : d));
          setEditing(null);
        }}
      />
      <DeleteCompanyModal
        company={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          void load();
        }}
      />
    </div>
  );
}
