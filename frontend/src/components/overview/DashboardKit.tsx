"use client";

import { ArrowRight, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PortalLink as Link } from "../layout/PortalLink";
import { useWorkspace } from "../../hooks/useWorkspace";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import type { Task } from "../../lib/api/tasks";

/* ---------- data ---------- */

/** Loads one source; a failure just leaves it null so the rest of the dashboard still shows. */
export function useSource<T>(load: (() => Promise<T>) | null, deps: unknown[]): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!load) {
      setValue(null);
      return;
    }
    let live = true;
    setValue(undefined);
    load()
      .then((v) => live && setValue(v))
      .catch(() => live && setValue(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

const DAY = 86_400_000;
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();

export const isActive = (t: Task) => t.status === "open" || t.status === "in_progress";
export const isOverdue = (t: Task) => isActive(t) && t.dueAt != null && new Date(t.dueAt).getTime() < startOfToday();
export const isDueToday = (t: Task) =>
  isActive(t) && t.dueAt != null && new Date(t.dueAt).getTime() >= startOfToday() && new Date(t.dueAt).getTime() < startOfToday() + DAY;

/** Active tasks, overdue first, then by due date (no date last) */
export function byUrgency(tasks: Task[]) {
  return tasks
    .filter(isActive)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
}

export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

export function dueLabel(t: Task) {
  if (!t.dueAt) return "No due date";
  if (isOverdue(t)) {
    const d = daysSince(t.dueAt);
    return d <= 1 ? "Overdue since yesterday" : `Overdue ${d} days`;
  }
  if (isDueToday(t)) return "Due today";
  return `Due ${new Date(t.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/* ---------- layout ---------- */

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DashboardHeader({ subtitle, actions }: { subtitle: string; actions?: ReactNode }) {
  const { user, role, workspaceName } = useWorkspace();
  const first = user?.name?.split(" ")[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-50/90 border border-brand-100/90 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[var(--brand)] shadow-2xs">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
          <span>Overview · {ROLE_LABELS[role ?? ""] ?? "Member"}</span>
        </div>
        <h1 className="mt-0.5 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
          {greeting()}
          {first ? `, ${first}` : ""}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">
          {today}
          {workspaceName ? ` · ${workspaceName}` : ""} · {subtitle}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type Tone = "default" | "red" | "amber" | "green" | "blue";

/**
 * A headline number styled to match the intelligence KPI card design.
 */
export function StatTile({
  label,
  value,
  hint,
  Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
  Icon: LucideIcon;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <div className="group flex h-full min-w-0 flex-col rounded-2xl border border-slate-100 bg-white p-4 sm:p-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:border-slate-200 transition-all">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10.5px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-500 shadow-2xs">
          <Icon size={15} strokeWidth={2} aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-slate-900">
        {value === undefined ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-100" /> : value ?? "—"}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {hint ? (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold truncate ${
              tone === "red"
                ? "bg-brand-50 text-[var(--brand)] border border-brand-100/60"
                : "bg-slate-50 text-slate-500 border border-slate-100/60"
            }`}
          >
            {hint}
          </span>
        ) : (
          <span />
        )}
        {href ? (
          <ArrowRight size={14} className="shrink-0 text-slate-400 opacity-0 transition group-hover:opacity-100 group-hover:translate-x-0.5" aria-hidden />
        ) : null}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full min-w-0">
      {body}
    </Link>
  ) : (
    body
  );
}

/** The four headline numbers, always side by side on one line (two per line only on phones) */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">{children}</div>;
}

/** A dashboard card with a title, optional subtitle and a "see all" link */
export function Panel({
  title,
  subtitle,
  href,
  linkLabel = "View all",
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-2xl border border-slate-100 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.03)] ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="shrink-0 text-xs font-bold text-[var(--brand)] hover:underline flex items-center gap-1">
            {linkLabel} →
          </Link>
        ) : null}
      </header>
      <div className="flex-1 px-5 py-4">{children}</div>
    </section>
  );
}

export function Grid({ children, cols = "lg:grid-cols-2" }: { children: ReactNode; cols?: string }) {
  return <div className={`mb-5 grid gap-5 ${cols}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-[var(--muted)]">{children}</p>;
}

export function Loading() {
  return (
    <div className="space-y-3 py-1" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 animate-pulse rounded-[8px] bg-[var(--chip-bg)]" />
      ))}
    </div>
  );
}

/** One row in a list panel: title + meta on the left, a badge or value on the right */
export function ListRow({
  href,
  title,
  meta,
  right,
  marker,
}: {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  /** Small dot colour for urgency (red = overdue, amber = today) */
  marker?: "red" | "amber" | null;
}) {
  const inner = (
    <div className="flex items-center gap-3 rounded-[8px] px-2 py-2.5 transition hover:bg-[var(--chip-bg)]">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${
          marker === "red" ? "bg-[var(--brand)]" : marker === "amber" ? "bg-[#d99a1e]" : "bg-[var(--line)]"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-[var(--foreground)]">{title}</p>
        {meta ? <p className="truncate text-[12px] text-[var(--muted)]">{meta}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
  return <li>{href ? <Link href={href}>{inner}</Link> : inner}</li>;
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="-mx-2 divide-y divide-[var(--line)]">{children}</ul>;
}

/**
 * Horizontal bars for one measure across a few categories. Single hue (identity comes from
 * the text label, never colour), value printed beside each bar, hover shows the exact share.
 */
export function BarList({
  rows,
  total,
  format = (n) => String(n),
  empty = "Nothing to show yet.",
}: {
  rows: Array<{ label: string; value: number; href?: string; note?: string }>;
  /** Bars are drawn relative to this (default: the largest value) */
  total?: number;
  format?: (n: number) => string;
  empty?: string;
}) {
  if (!rows.length || rows.every((r) => r.value === 0)) return <Empty>{empty}</Empty>;
  const max = total ?? Math.max(...rows.map((r) => r.value), 1);
  const sum = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const pct = max ? (r.value / max) * 100 : 0;
        const share = total ? Math.round((r.value / Math.max(total, 1)) * 100) : sum ? Math.round((r.value / sum) * 100) : 0;
        const bar = (
          <div title={`${r.label}: ${format(r.value)} (${share}%)`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate text-[var(--foreground)]">
                {r.label}
                {r.note ? <span className="ml-1.5 text-[11.5px] text-[var(--muted)]">{r.note}</span> : null}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                {format(r.value)}
                <span className="ml-1.5 text-[11.5px] font-normal text-[var(--muted)]">{share}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--chip-bg)]">
              <div
                className="h-full rounded-full bg-[var(--navy)] transition-[width] duration-500"
                style={{ width: `${r.value > 0 ? Math.max(pct, 2) : 0}%` }}
              />
            </div>
          </div>
        );
        return <li key={r.label}>{r.href ? <Link href={r.href} className="block hover:opacity-80">{bar}</Link> : bar}</li>;
      })}
    </ul>
  );
}

/** Lead funnel: each stage as a bar relative to the first, with the drop-off between stages */
export function Funnel({ stages }: { stages: Array<{ label: string; value: number; href?: string }> }) {
  const top = Math.max(stages[0]?.value ?? 0, 1);
  if (!stages[0]?.value) return <Empty>No leads yet. Find prospects or import a list to start.</Empty>;
  return (
    <ol className="space-y-3.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 100) : null;
        const row = (
          <div title={`${s.label}: ${s.value} (${Math.round((s.value / top) * 100)}% of all leads)`}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium text-[var(--foreground)]">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-[var(--foreground)]">{s.value}</span>
                {conv != null ? <span className="ml-2 text-[11.5px] text-[var(--muted)]">{conv}% of previous</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-3 overflow-hidden rounded-[4px] bg-[var(--chip-bg)]">
              <div
                className="h-full rounded-[4px] bg-[var(--navy)] transition-[width] duration-500"
                style={{ width: `${s.value > 0 ? Math.max((s.value / top) * 100, 2) : 0}%`, opacity: 1 - i * 0.12 }}
              />
            </div>
          </div>
        );
        return <li key={s.label}>{s.href ? <Link href={s.href} className="block hover:opacity-80">{row}</Link> : row}</li>;
      })}
    </ol>
  );
}

/** Score pill for a lead's priority */
export function ScorePill({ score }: { score: number | null }) {
  const tone =
    score == null
      ? "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]"
      : score >= 70
        ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
        : score >= 50
          ? "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]"
          : "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]";
  return (
    <span className={`inline-flex min-w-[42px] justify-center rounded-[6px] px-2 py-1 text-[12px] font-semibold tabular-nums ${tone}`}>
      {score ?? "—"}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-[11.5px] font-semibold text-white">
      {initials || "?"}
    </span>
  );
}
