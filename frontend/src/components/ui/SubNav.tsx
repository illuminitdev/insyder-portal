"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SubNavItem = { href: string; label: string; exact?: boolean };

export function SubNav({ items }: { items: SubNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Section"
      className="mb-6 flex items-center gap-1.5 overflow-x-auto border-b border-slate-100/80 pb-3 scrollbar-none scroll-touch scroll-smooth overscroll-x-contain pr-4 sm:pr-0"
    >
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${
              active
                ? "bg-[var(--brand)] text-white shadow-2xs"
                : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-800"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
