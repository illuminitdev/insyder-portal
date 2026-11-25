"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type SubNavItem = { href: string; label: string; exact?: boolean };

const isOn = (item: SubNavItem, pathname: string) =>
  item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

/**
 * Tabs for the pages of one menu section. On a page that isn't a tab itself (an account brief, a
 * qualification), the tab the user came from stays highlighted, so it's always clear where they are.
 */
export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();
  const storageKey = `insyder:subnav:${items.map((i) => i.href).join("|")}`;
  const matched = items.find((i) => isOn(i, pathname))?.href ?? null;
  const [remembered, setRemembered] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (matched) sessionStorage.setItem(storageKey, matched);
      else setRemembered(sessionStorage.getItem(storageKey));
    } catch {
      // storage unavailable: fall back to the first tab
    }
  }, [matched, storageKey]);

  const activeHref =
    matched ?? (remembered && items.some((i) => i.href === remembered) ? remembered : items[0]?.href);

  return (
    <nav aria-label="Section" className="mb-6 max-w-full overflow-x-auto scrollbar-none scroll-touch overscroll-x-contain">
      <div className="inline-flex min-w-max items-center gap-1 rounded-[14px] border border-[var(--card-line)] bg-white p-1 shadow-[var(--card-shadow)]">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={matched === item.href ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-[10px] px-4 py-2 text-[13.5px] font-semibold transition-colors ${
                active
                  ? "bg-[var(--brand)] text-[var(--on-brand)] shadow-[0_2px_8px_rgba(13,27,42,0.18)]"
                  : "text-[var(--plum)] hover:bg-[var(--soft)] hover:text-[var(--foreground)]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
