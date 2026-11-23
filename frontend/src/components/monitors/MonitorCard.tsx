"use client";

import { useState } from "react";
import { Building2, CalendarClock, CheckCircle2, Clock, MapPin, Radar, RefreshCw, Trash2 } from "lucide-react";
import type { Monitor } from "@/lib/api/monitors";
import { humanize } from "@/components/ui/Field";
import { formatDate } from "@/lib/utils/dates";

const CADENCES = [
  { hours: 24, label: "Daily" },
  { hours: 168, label: "Weekly" },
  { hours: 720, label: "Monthly" },
] as const;

function recipeParts(recipeJson: string) {
  try {
    const r = JSON.parse(recipeJson) as {
      territory?: unknown;
      eventWindowDays?: unknown;
      signals?: unknown;
      accountNames?: unknown;
      accountIds?: unknown;
    };
    const accountNames = Array.isArray(r.accountNames) ? (r.accountNames as string[]) : [];
    return {
      accountNames,
      territory: Array.isArray(r.territory) && r.territory.length ? r.territory.join(", ") : (accountNames.length > 0 ? null : "Workspace territory"),
      windowDays: typeof r.eventWindowDays === "number" ? r.eventWindowDays : 180,
      signals: Array.isArray(r.signals) ? r.signals.map((s) => humanize(String(s))) : [],
    };
  } catch {
    return { accountNames: [] as string[], territory: "Workspace territory", windowDays: 180, signals: [] as string[] };
  }
}

/** Outcome of the last check, as a coloured pill */
function lastResult(status: string | null): { text: string; tone: string } | null {
  if (!status) return null;
  if (status === "success" || status === "fresh_signals") return { text: "Fresh signals found", tone: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" };
  if (status === "running") return { text: "Checking now…", tone: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" };
  if (status === "exhausted_budget") return { text: "Research quota used up", tone: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" };
  if (status === "kill_switch") return { text: "Stopped by kill switch", tone: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" };
  if (status === "not_configured") return { text: "Not set up (research or territory missing)", tone: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" };
  if (status === "provider_outage") return { text: "Web provider outage", tone: "bg-[var(--brand-tint)] text-[var(--brand-active)]" };
  return { text: "No new signals", tone: "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]" };
}

export function MonitorCard({
  monitor: m,
  checking,
  removing,
  resultNote,
  onCadence,
  onToggle,
  onCheck,
  onRemove,
}: {
  monitor: Monitor;
  checking: boolean;
  removing: boolean;
  resultNote: string | null;
  onCadence: (hours: number) => void;
  onToggle: (status: "active" | "paused") => void;
  onCheck: () => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const active = m.status === "active";
  const recipe = recipeParts(m.recipeJson);
  const result = lastResult(m.lastRunStatus);

  return (
    <article className="overflow-hidden rounded-[22px] border border-[var(--card-line)] bg-white shadow-[var(--card-shadow)]">
      {/* Header: icon, name, recipe chips and the on/off switch */}
      <div className="flex flex-wrap items-start gap-4 p-5 sm:p-6">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${
            active ? "bg-[var(--brand-tint)] text-[var(--brand-active)]" : "bg-[var(--lilac)] text-[var(--plum-muted)]"
          }`}
          aria-hidden
        >
          <Radar size={22} />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[var(--foreground)] sm:text-[21px]">{m.name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12.5px]">
            {recipe.accountNames.length > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-[var(--brand)] border border-brand-200"
                title={recipe.accountNames.join(", ")}
              >
                <Building2 size={13} aria-hidden />
                {recipe.accountNames.length === 1
                  ? recipe.accountNames[0]
                  : `${recipe.accountNames.length} accounts`}
              </span>
            ) : null}
            {recipe.territory ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--lilac)] px-2.5 py-1 font-medium text-[var(--plum)]">
                <MapPin size={13} aria-hidden /> {recipe.territory}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--lilac)] px-2.5 py-1 font-medium text-[var(--plum)]">
              <CalendarClock size={13} aria-hidden /> Last {recipe.windowDays} days
            </span>
            {recipe.signals.map((s) => (
              <span key={s} className="rounded-full border border-[var(--card-line)] px-2.5 py-1 text-[var(--plum-muted)]">
                {s}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={active}
          onClick={() => onToggle(active ? "paused" : "active")}
          className={`inline-flex shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3.5 text-[13.5px] font-semibold transition ${
            active
              ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
              : "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]"
          }`}
          title={active ? "Pause scheduled checks" : "Turn on scheduled checks"}
        >
          <span className={`relative h-5 w-9 rounded-full transition ${active ? "bg-[#22a35a]" : "bg-[#cbd5e1]"}`}>
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? "left-[18px]" : "left-0.5"}`}
            />
          </span>
          {active ? "Active" : "Paused"}
        </button>
      </div>

      {/* Controls: how often, check now, remove */}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--card-line)] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--plum)]">Checks</span>
          <div className="inline-flex rounded-[12px] bg-[var(--lilac)] p-1" role="radiogroup" aria-label="How often to check">
            {CADENCES.map((c) => {
              const on = m.cadenceHours === c.hours;
              return (
                <button
                  key={c.hours}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => !on && onCadence(c.hours)}
                  className={`rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold transition ${
                    on ? "bg-white text-[var(--brand-active)] shadow-[0_2px_8px_rgba(13,27,42,0.12)]" : "text-[var(--plum-muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            title="Runs live research now and uses up to 5 research units"
            className="inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-r from-[var(--brand-active)] to-[var(--brand)] px-4 py-2.5 text-[14px] font-semibold text-white shadow-[0_6px_16px_rgba(13,27,42,0.25)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw size={16} className={checking ? "animate-spin" : ""} aria-hidden />
            {checking ? "Checking…" : "Check now"}
          </button>

          {confirmRemove ? (
            <span className="inline-flex items-center gap-1.5 rounded-[12px] bg-[var(--brand-tint)] p-1 pl-3 text-[13px] font-medium text-[var(--brand-active)]">
              Remove this monitor?
              <button
                type="button"
                onClick={() => {
                  setConfirmRemove(false);
                  onRemove();
                }}
                className="rounded-[9px] bg-[var(--brand-active)] px-3 py-1.5 font-semibold text-white hover:brightness-110"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="rounded-[9px] px-3 py-1.5 font-semibold text-[var(--plum)] hover:bg-white"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={removing}
              className="inline-flex items-center gap-2 rounded-[12px] border border-[var(--card-line)] bg-white px-4 py-2.5 text-[14px] font-medium text-[var(--plum)] transition hover:border-[var(--brand-tint)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)] disabled:opacity-60"
            >
              <Trash2 size={16} aria-hidden />
              {removing ? "Removing…" : "Remove"}
            </button>
          )}
        </div>
      </div>

      {/* Last run */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-[#fcf9fb] px-5 py-3 text-[12.5px] text-[var(--plum-muted)] sm:px-6">
        <span className="inline-flex items-center gap-1.5">
          <Clock size={14} aria-hidden />
          {m.lastAttemptAt ? `Last checked ${formatDate(m.lastAttemptAt)}` : "Not checked yet"}
        </span>
        {m.lastSuccessAt ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} aria-hidden /> Last successful {formatDate(m.lastSuccessAt)}
          </span>
        ) : null}
        {result ? <span className={`rounded-full px-2.5 py-0.5 font-semibold ${result.tone}`}>{result.text}</span> : null}
        {!active ? <span className="italic">Paused: runs only when you click Check now</span> : null}
      </div>
      {resultNote ? (
        <p role="status" className="border-t border-[var(--card-line)] px-5 py-3 text-[13px] text-[var(--foreground)] sm:px-6">
          {resultNote}
        </p>
      ) : null}
    </article>
  );
}
