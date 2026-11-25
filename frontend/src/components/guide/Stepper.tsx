"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type GuideStep = { key: string; label: string };

/**
 * Numbered step pills, like a checkout: the current step is highlighted, finished steps show a
 * tick and can be clicked to go back, later steps are muted until reached.
 * Highly responsive with smooth touch-scrolling, hidden native scrollbars, and edge fade cues on mobile.
 */
export function Stepper({
  steps,
  current,
  reachable,
  onSelect,
}: {
  steps: GuideStep[];
  /** Index of the step on screen */
  current: number;
  /** Highest index the user may jump to (everything before it is done) */
  reachable: number;
  onSelect: (index: number) => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const activeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const hasScroll = el.scrollWidth > el.clientWidth + 4;
    setCanScrollLeft(hasScroll && el.scrollLeft > 6);
    setCanScrollRight(hasScroll && el.scrollLeft + el.clientWidth < el.scrollWidth - 6);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll, steps]);

  // Auto-scroll the current active step into view on mobile/tablet
  useEffect(() => {
    if (activeBtnRef.current) {
      activeBtnRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
    const timer = setTimeout(checkScroll, 350);
    return () => clearTimeout(timer);
  }, [current, checkScroll]);

  return (
    <div className="relative w-full">
      {/* Left fade hint when scrolled right on mobile */}
      {canScrollLeft && (
        <div
          className="pointer-events-none absolute left-0 top-0 bottom-1.5 z-10 w-6 bg-gradient-to-r from-[var(--background)] to-transparent sm:hidden"
          aria-hidden
        />
      )}

      <nav
        ref={navRef}
        onScroll={checkScroll}
        aria-label="Progress"
        className="-mx-1 overflow-x-auto px-1 pb-1.5 scrollbar-none overscroll-x-contain scroll-smooth scroll-touch"
      >
        <ol className="flex min-w-max items-center gap-1.5 sm:gap-2 pr-6 sm:pr-0">
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const isDone = i < current || (i < reachable && !isCurrent);
            const clickable = i <= reachable && !isCurrent;
            return (
              <li key={s.key}>
                <button
                  ref={isCurrent ? activeBtnRef : undefined}
                  type="button"
                  disabled={!clickable}
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => onSelect(i)}
                  className={`inline-flex items-center gap-1.5 sm:gap-2 rounded-full border px-3 py-1.5 text-xs sm:px-3.5 sm:py-1.5 sm:text-sm transition-all whitespace-nowrap ${
                    isCurrent
                      ? "border-[var(--brand)] bg-[var(--brand-tint)] font-semibold text-[var(--foreground)] shadow-xs"
                      : isDone
                        ? "border-[var(--line)] bg-white font-medium text-[var(--foreground)] hover:border-[var(--muted)] hover:bg-[var(--chip-bg)]"
                        : "border-[var(--line)] bg-white text-[var(--muted)]"
                  } disabled:cursor-default`}
                >
                  <span
                    className={`flex h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-full text-[10px] sm:text-[11px] font-bold ${
                      isCurrent
                        ? "bg-[var(--brand)] text-[var(--on-brand)]"
                        : isDone
                          ? "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]"
                          : "bg-[var(--chip-bg)] text-[var(--muted)] font-medium"
                    }`}
                    aria-hidden
                  >
                    {isDone ? <Check size={11} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Right fade hint indicating more items to scroll to on mobile */}
      {canScrollRight && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-1.5 z-10 w-8 bg-gradient-to-l from-[var(--background)] to-transparent sm:hidden"
          aria-hidden
        />
      )}
    </div>
  );
}
