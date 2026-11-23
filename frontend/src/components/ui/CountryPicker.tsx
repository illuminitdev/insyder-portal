"use client";

import { Check, ChevronDown, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COUNTRIES, countryName } from "@/lib/countries";

/**
 * Pick one or more countries by name: chosen ones show as chips inside the box, typing filters
 * the list, and only countries the search supports are offered (no codes, no typos).
 */
export function CountryPicker({
  value,
  onChange,
  suggested = [],
  labelledBy,
  placeholder = "Search countries…",
}: {
  /** Chosen ISO codes */
  value: string[];
  onChange: (codes: string[]) => void;
  /** Codes offered as one-click additions (e.g. found in the description) */
  suggested?: string[];
  /** id of the visible label */
  labelledBy?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) : COUNTRIES;
  }, [query]);
  const suggestions = suggested.filter((c) => !value.includes(c));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div ref={boxRef} className="relative mt-1.5 font-normal">
      <div
        className={`flex min-h-[40px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-[7px] border bg-white px-2 py-1.5 text-sm transition ${
          open ? "border-[var(--brand)] ring-2 ring-[var(--brand-tint)]" : "border-[var(--input-border)]"
        }`}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <MapPin size={15} className="ml-0.5 shrink-0 text-[var(--muted)]" aria-hidden />
        {value.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--brand-tint)] py-0.5 pl-2.5 pr-1 text-[13px] font-medium text-[var(--brand-active)]"
          >
            {countryName(code)}
            <button
              type="button"
              aria-label={`Remove ${countryName(code)}`}
              className="rounded-full p-0.5 hover:bg-[var(--brand)] hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((c) => c !== code));
              }}
            >
              <X size={12} strokeWidth={2.5} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelledBy}
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].code}` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted)]"
          placeholder={value.length ? "Add another…" : placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Never submit the surrounding form from here
              e.preventDefault();
              if (open && options[active]) toggle(options[active].code);
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Backspace" && !query && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "Tab") {
              setOpen(false);
            }
          }}
        />
        <ChevronDown
          size={16}
          className={`mr-0.5 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-[10px] border border-[var(--line)] bg-white p-1 shadow-lg"
        >
          {options.length ? (
            options.map((c, i) => {
              const selected = value.includes(c.code);
              return (
                <li
                  key={c.code}
                  id={`${listId}-${c.code}`}
                  role="option"
                  aria-selected={selected}
                  className={`flex cursor-pointer items-center justify-between rounded-[7px] px-3 py-2 text-sm ${
                    i === active ? "bg-[var(--chip-bg)]" : ""
                  } ${selected ? "font-semibold text-[var(--brand-active)]" : "text-[var(--foreground)]"}`}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus in the input so the list stays open for picking several
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(c.code)}
                >
                  {c.name}
                  {selected ? <Check size={15} strokeWidth={2.5} aria-hidden /> : null}
                </li>
              );
            })
          ) : (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--muted)]">
              <Search size={14} aria-hidden /> No supported country matches &ldquo;{query}&rdquo;
            </li>
          )}
        </ul>
      ) : null}

      {suggestions.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[var(--muted)]">Your description mentions:</span>
          {suggestions.map((code) => (
            <button
              key={code}
              type="button"
              className="rounded-full border border-dashed border-[var(--input-border)] px-2.5 py-0.5 font-medium text-[var(--foreground)] hover:border-[var(--brand)] hover:text-[var(--brand-active)]"
              onClick={() => onChange([...value, code])}
            >
              + {countryName(code)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
