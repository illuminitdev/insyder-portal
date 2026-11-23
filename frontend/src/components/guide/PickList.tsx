"use client";

import { Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { usePagination } from "../ui/Pagination";

export type PickItem = { id: string; title: string; subtitle?: ReactNode; badge?: ReactNode; meta?: ReactNode };

/** Searchable single-choice list for "pick the account / task to work on" steps. */
export function PickList({
  items,
  selectedId,
  onSelect,
  empty,
  label,
  pageSize,
  toolbar,
}: {
  items: PickItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: ReactNode;
  label: string;
  /** Show this many at a time with page buttons (default: all) */
  pageSize?: number;
  /** Controls shown right of the search box, e.g. a status filter (keeps the search box always visible) */
  toolbar?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const shown = items.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()));
  const { pageItems, pager } = usePagination(shown, pageSize ?? Math.max(shown.length, 1));
  const searchBox = (
    <div className={`relative ${toolbar ? "w-full sm:w-72" : "max-w-sm"}`}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
      <input
        aria-label={`Search ${label}`}
        className="w-full rounded-[9px] border border-[var(--input-border)] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--brand)]"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${label}`}
      />
    </div>
  );
  // With a toolbar: search + toolbar side by side on the right, always shown (even when the filter is empty)
  const controls = toolbar ? (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {searchBox}
      {toolbar}
    </div>
  ) : items.length > 6 ? (
    searchBox
  ) : null;

  if (!items.length) {
    return (
      <div className="space-y-3">
        {toolbar ? controls : null}
        <div className="rounded-[12px] border border-dashed border-[var(--input-border)] px-6 py-10 text-center text-sm text-[var(--muted)]">{empty}</div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {controls}
      <ul role="radiogroup" aria-label={label} className="divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)]">
        {pageItems.map((i) => {
          const on = i.id === selectedId;
          return (
            <li key={i.id}>
              <label className={`flex cursor-pointer items-start gap-3 px-4 py-3.5 ${on ? "bg-[var(--brand-tint)]" : "hover:bg-[var(--chip-bg)]"}`}>
                <input type="radio" name={label} className="mt-1 h-4 w-4" checked={on} onChange={() => onSelect(i.id)} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--foreground)]">{i.title}</span>
                    {i.badge}
                  </span>
                  {i.subtitle ? <span className="mt-0.5 block text-sm text-[var(--muted)]">{i.subtitle}</span> : null}
                </span>
                {i.meta ? <span className="shrink-0 text-sm text-[var(--muted)]">{i.meta}</span> : null}
              </label>
            </li>
          );
        })}
        {!shown.length ? <li className="px-4 py-4 text-sm text-[var(--muted)]">No match for “{q}”.</li> : null}
      </ul>
      {pager}
    </div>
  );
}
