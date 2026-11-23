"use client";

import { Check, ChevronDown, ChevronRight, Eye, Info, Lock, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";

export type LeadStep = {
  key: string;
  title: string;
  /** Where this step stands now, in plain words */
  status: string;
  done: boolean;
  /** Why the step can't be opened yet; set = locked */
  lockedReason?: string | null;
  /** Optional steps don't count towards progress and are never "next" */
  optional?: boolean;
  /** Phase the step belongs to; consecutive steps with the same phase are grouped */
  phase?: string;
  /** What this step is and why it's part of the process (shown above the step's work) */
  why?: string;
  /** What the step shows when it is selected */
  content: ReactNode;
  /** Extra controls shown in the step's footer, left of "Next" (e.g. Skip) */
  footer?: ReactNode;
  /** Your own step (default). Others' steps are read-only for you and don't count in your progress. */
  mine?: boolean;
  /** Who does this step, for others' steps, e.g. "the sales reviewer" */
  ownerLabel?: string;
};

const isMine = (s: LeadStep) => s.mine !== false;

/** Items listed under the steps that are open at any stage (e.g. tasks) */
export type LeadExtra = { key: string; title: string; content: ReactNode };

/** Small ring showing how much of the lead is done */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--chip-bg)" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute text-[10.5px] font-semibold tabular-nums text-[var(--foreground)]">
        {done}/{total}
      </span>
    </span>
  );
}

/** The "Lead progress" button and the window it opens with every step */
function ProgressPopover({
  steps,
  extras,
  selected,
  currentKey,
  doneCount,
  total,
  onSelect,
}: {
  steps: LeadStep[];
  extras: LeadExtra[];
  selected: string;
  currentKey?: string;
  doneCount: number;
  total: number;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number>(460);
  const box = useRef<HTMLDivElement>(null);

  const calculatePosition = useCallback(() => {
    if (!box.current) return;
    const rect = box.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;

    if (spaceBelow < 320 && spaceAbove > spaceBelow) {
      setDropUp(true);
      setMaxHeight(Math.min(480, Math.max(220, spaceAbove)));
    } else {
      setDropUp(false);
      setMaxHeight(Math.min(480, Math.max(220, spaceBelow)));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    calculatePosition();
    const onResize = () => calculatePosition();
    const onScroll = () => calculatePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, calculatePosition]);

  // Close on a click outside or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (key: string) => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 rounded-full border bg-white py-1 pl-1 pr-3.5 transition ${
          open ? "border-[var(--brand)] shadow-[0_0_0_3px_var(--brand-tint)]" : "border-[var(--line)] hover:border-[var(--input-border)]"
        }`}
      >
        <ProgressRing done={doneCount} total={total} />
        <span className="text-left">
          <span className="block text-[13px] font-semibold leading-tight text-[var(--foreground)]">Lead progress</span>
          <span className="block text-[11.5px] leading-tight text-[var(--muted)]">
            {doneCount} of {total} steps done
          </span>
        </span>
        <ChevronDown size={15} className={`text-[var(--muted)] transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open ? (
        <>
          {/* Backdrop on mobile */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <div
            role="dialog"
            aria-label="Lead progress"
            style={{
              maxHeight: `${maxHeight}px`,
            }}
            className={`fixed inset-x-2 bottom-2 z-50 flex flex-col overflow-hidden rounded-[18px] border border-[var(--line)] bg-white shadow-2xl sm:absolute sm:z-40 sm:w-[350px] sm:rounded-[14px] sm:shadow-[0_18px_48px_-12px_rgba(23,44,64,0.28)] ${
              dropUp
                ? "sm:bottom-[calc(100%+8px)] sm:top-auto sm:right-0 sm:left-auto"
                : "sm:top-[calc(100%+8px)] sm:bottom-auto sm:right-0 sm:left-auto"
            }`}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div className="min-w-0 pr-2">
                <p className="text-[14px] font-semibold text-[var(--foreground)]">Lead progress</p>
                <p className="truncate text-[11.5px] text-[var(--muted)]">Pick a step to open it. Locked steps open in order.</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--chip-bg)] hover:text-[var(--foreground)] transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <ol className="px-2 py-2">
                {steps.map((s, i, all) => {
                  const locked = Boolean(s.lockedReason);
                  const isSelected = s.key === selected;
                  const isCurrent = s.key === currentKey;
                  const newPhase = s.phase && s.phase !== all[i - 1]?.phase;
                  return (
                    <li key={s.key}>
                      {newPhase ? (
                        <p className={`px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] ${i ? "mt-3" : "mt-1"}`}>
                          {s.phase}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => pick(s.key)}
                        aria-current={isSelected ? "step" : undefined}
                        className={`flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition ${
                          isSelected ? "bg-[var(--brand-tint)]" : locked ? "cursor-not-allowed" : "hover:bg-[var(--chip-bg)]"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                            s.done
                              ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
                              : locked
                                ? "border border-[var(--line)] text-[var(--muted)]"
                                : isCurrent || isSelected
                                  ? "bg-[var(--brand)] text-white"
                                  : "border border-[var(--input-border)] text-[var(--foreground)]"
                          }`}
                        >
                          {s.done ? <Check size={13} strokeWidth={2.5} aria-label="Done" /> : locked ? <Lock size={11} aria-label="Locked" /> : i + 1}
                        </span>
                        <span className={`min-w-0 flex-1 ${locked ? "opacity-55" : ""}`}>
                          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--foreground)]">
                            <span className="truncate">{s.title}</span>
                            {isCurrent ? (
                              <span className="shrink-0 rounded bg-[var(--brand)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-white">Next</span>
                            ) : null}
                            {s.optional ? <span className="shrink-0 text-[10.5px] font-normal text-[var(--muted)]">optional</span> : null}
                          </span>
                          <span className="block truncate text-[11.5px] text-[var(--muted)]" title={locked ? (s.lockedReason ?? "") : s.status}>
                            {locked ? s.lockedReason : s.status}
                            {!isMine(s) ? ` · by ${s.ownerLabel || "another role"}` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {extras.length ? (
              <div className="shrink-0 border-t border-[var(--line)] px-2 py-1.5">
                {extras.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    onClick={() => pick(e.key)}
                    className={`flex w-full items-center justify-between rounded-[9px] px-2.5 py-2 text-left text-[13px] font-semibold transition ${
                      e.key === selected ? "bg-[var(--brand-tint)]" : "hover:bg-[var(--chip-bg)]"
                    }`}
                  >
                    {e.title}
                    <ChevronRight size={14} className="text-[var(--muted)]" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The account's journey as a step-by-step guide. The selected step's work fills the page; the
 * "Lead progress" button opens a small window listing every step, grouped by phase. A step opens
 * only once the steps it depends on are done; finished steps stay open to check or correct.
 */
export function LeadStepper({
  steps,
  extras = [],
  selected,
  onSelect,
}: {
  steps: LeadStep[];
  extras?: LeadExtra[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  // Progress is the whole lead's, the same for every role; others' steps are read-only for you
  const counted = steps.filter((s) => !s.optional);
  const doneCount = counted.filter((s) => s.done).length;
  const open = (s: LeadStep) => !s.done && !s.lockedReason && !s.optional;
  const currentKey = (steps.find((s) => isMine(s) && open(s)) ?? steps.find(open))?.key;

  const index = steps.findIndex((s) => s.key === selected);
  const step = index >= 0 ? steps[index] : null;
  const mine = step ? isMine(step) : false;
  const extra = step ? null : extras.find((e) => e.key === selected);
  const next = step ? steps.slice(index + 1).find((s) => !s.lockedReason) : undefined;

  const progress = (
    <ProgressPopover
      steps={steps}
      extras={extras}
      selected={selected}
      currentKey={currentKey}
      doneCount={doneCount}
      total={counted.length}
      onSelect={onSelect}
    />
  );

  return (
    <section aria-live="polite" className="min-w-0 space-y-5">
      {step ? (
        <>
          <header className="rounded-[14px] border border-[var(--line)] bg-white px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-active)]">
                  Step {index + 1} of {steps.length}
                  {step.optional ? " · optional" : ""}
                  {!mine ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-0.5 normal-case tracking-normal text-[var(--muted)]">
                      <Eye size={12} aria-hidden /> Read only · done by {step.ownerLabel || "another role"}
                    </span>
                  ) : null}
                </p>
                <h2 className="mt-1.5 flex flex-wrap items-center gap-2 text-[20px] sm:text-[22px] font-semibold leading-tight">
                  {step.title}
                  {step.done ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--badge-green-bg)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--badge-green-fg)]">
                      <Check size={13} strokeWidth={2.5} aria-hidden /> Done
                    </span>
                  ) : null}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{step.status}</p>
              </div>
              <div className="shrink-0">{progress}</div>
            </div>
            {step.why ? (
              <div className="mt-4 flex gap-3 rounded-[10px] bg-[var(--chip-bg)] px-4 py-3">
                <Info size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
                <p className="text-[13px] leading-relaxed text-[var(--foreground)]">
                  <span className="font-semibold">Why this step: </span>
                  {step.why}
                </p>
              </div>
            ) : null}
          </header>

          <div className="space-y-5">{step.content}</div>

          {(mine && step.footer) || (next && (step.done || !mine)) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--line)] bg-white px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">{mine ? step.footer : null}</div>
              {next && (step.done || !mine) ? (
                <Button variant="primary" onClick={() => onSelect(next.key)}>
                  Next: {next.title} →
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : extra ? (
        <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 rounded-[14px] border border-[var(--line)] bg-white px-4 py-4 sm:px-6 sm:py-5">
            <h2 className="text-[20px] sm:text-[22px] font-semibold">{extra.title}</h2>
            <div className="shrink-0">{progress}</div>
          </header>
          {extra.content}
        </>
      ) : null}
    </section>
  );
}
