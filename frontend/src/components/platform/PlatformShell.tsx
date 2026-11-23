"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  Shapes,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { logout, me, type User } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/client";
import { ACCESS_REQUESTS_CHANGED, listAccessRequests } from "@/lib/api/platform";
import { LoadingState } from "@/components/common/LoadingState";
import { AccountMenu } from "@/components/layout/AppShell";
import { InsyderMark } from "@/components/common/InsyderLogo";
import { PlatformBell } from "./PlatformBell";

const NAV: Array<{ href: string; label: string; Icon: LucideIcon; exact?: boolean }> = [
  { href: "/platform", label: "Overview", Icon: LayoutDashboard, exact: true },
  { href: "/platform/companies", label: "Companies", Icon: Building2 },
  { href: "/platform/workspaces", label: "Workspaces", Icon: Shapes },
  { href: "/platform/users", label: "Users", Icon: Users },
  { href: "/platform/access-requests", label: "Access requests", Icon: UserPlus },
  { href: "/platform/settings", label: "Settings", Icon: Settings },
];

/** App owner's shell: the same look as the workspace AppShell, but outside any tenant. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Pending sign-up requests, shown as a count on the "Access requests" nav item
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    if (!user) return;
    const refresh = () =>
      void listAccessRequests("pending")
        .then((r) => setPendingRequests(r.counts.pending))
        .catch(() => undefined);
    refresh();
    const t = setInterval(refresh, 60_000);
    window.addEventListener(ACCESS_REQUESTS_CHANGED, refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener(ACCESS_REQUESTS_CHANGED, refresh);
    };
  }, [user]);

  useEffect(() => {
    me()
      .then(({ user: u }) => {
        if (u.mustChangePassword) return router.replace("/password");
        if (!u.isPlatformAdmin) return router.replace("/home");
        setUser(u);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setError(e instanceof Error ? e.message : "Could not load your account");
      });
  }, [router]);

  // Close the mobile drawer on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (!user) {
    return (
      <div className="app-canvas flex min-h-screen items-center justify-center">
        {error ? (
          <p className="text-sm text-[var(--danger)]" role="alert">
            {error}
          </p>
        ) : (
          <LoadingState label="Loading platform…" />
        )}
      </div>
    );
  }

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const signOut = () => {
    // Leave immediately; the session is ended on the server in the background
    void logout().catch(() => undefined);
    router.replace("/login");
  };
  const current = NAV.find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)));

  const brand = (size: "lg" | "sm") => (
    <span className="flex items-center gap-3">
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-b from-[#16304a] to-[#0D1B2A] text-white ${
          size === "lg" ? "h-12 w-12 rounded-[14px] ring-1 ring-white/15" : "h-8 w-8 rounded-[10px]"
        }`}
      >
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" aria-hidden />
        <InsyderMark size={size === "lg" ? 26 : 18} />
      </span>
      <span className="leading-none">
        <span className={`block font-[family-name:var(--font-heading)] font-bold lowercase tracking-[-0.045em] ${size === "lg" ? "text-[22px] text-white" : "text-[17px] text-[var(--foreground)]"}`}>
          Insyder
        </span>
        {size === "lg" ? (
          <span className="mt-1 block text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#7FD3CB]">Platform HQ</span>
        ) : null}
      </span>
    </span>
  );

  return (
    <div className="app-canvas min-h-screen">
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-xs lg:hidden" onClick={() => setMobileMenuOpen(false)} aria-hidden />
      ) : null}

      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-width)] flex-col border-r border-white/[0.06] transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex h-[84px] shrink-0 items-center justify-between px-5">
          <Link href="/platform" prefetch>
            {brand("lg")}
          </Link>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#8FA2B5] hover:bg-white/10 hover:text-white lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Scope card, in place of the workspace switcher */}
        <div className="px-4">
          <div className="flex w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.06] px-4 py-3">
            <ShieldCheck size={17} className="shrink-0 text-[#7FD3CB]" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#8FA2B5]">Scope</span>
              <span className="block truncate text-[15px] font-semibold leading-tight text-white">All companies</span>
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav aria-label="Primary" className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto px-4 pb-4">
          {NAV.map((item) => {
            const active = item === current;
            const Icon = item.Icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={`group flex h-12 items-center gap-4 rounded-[12px] px-3 text-[15px] font-medium transition-colors ${
                  active
                    ? "bg-[#223D50] font-semibold text-white"
                    : "text-[#C3CED9] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon
                  size={21}
                  strokeWidth={1.75}
                  aria-hidden
                  className={`shrink-0 ${active ? "text-[#7FD3CB]" : "text-[#8FA2B5] group-hover:text-white"}`}
                />
                {item.label}
                {item.href === "/platform/access-requests" && pendingRequests > 0 ? (
                  <span
                    className="ml-auto rounded-full bg-[var(--brand-active)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white"
                    aria-label={`${pendingRequests} pending`}
                  >
                    {pendingRequests}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Signed-in owner */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-[14px] bg-white/[0.06] px-3 py-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0E6B67] to-[#14857F] text-[13px] font-semibold text-white">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{user.name}</p>
              <p className="truncate text-[12px] text-[#8FA2B5]">Platform admin</p>
            </div>
          </div>
          <button
            type="button"
            className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] text-[13.5px] font-medium text-[#C3CED9] transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={signOut}
          >
            <LogOut size={15} strokeWidth={1.75} aria-hidden />
            Log out
          </button>
        </div>
      </aside>

      <div className="min-h-screen lg:ml-[var(--sidebar-width)]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-[var(--sidebar-line)] bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-9">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--foreground)] hover:bg-[var(--chip-bg)]"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={18} aria-hidden />
            </button>
            <Link href="/platform">{brand("sm")}</Link>
          </div>

          {/* Breadcrumb: Platform HQ › current page */}
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-3 text-[16px] lg:flex">
            <Link href="/platform" className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
              Platform HQ
            </Link>
            <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" aria-hidden />
            <span className="truncate font-medium text-[var(--foreground)]">{current?.label ?? "All companies"}</span>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <PlatformBell />
            <AccountMenu initials={initials} name={user.name} roleLabel="Platform admin" profileHref="/platform/settings" onLogout={signOut} />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6 lg:px-9 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
