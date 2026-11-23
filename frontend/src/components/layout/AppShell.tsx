"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronRight, ChevronsUpDown, CircleHelp, LogOut, Menu, UserRound, X } from "lucide-react";
import { logout, type WorkspaceMembership } from "../../lib/auth/session";
import { ROLE_LABELS } from "../../lib/auth/capabilities";
import { useWorkspace } from "../../hooks/useWorkspace";
import { SubNav } from "../ui/SubNav";
import { AttentionBell } from "./AttentionBell";
import { CrmStatusChip } from "./CrmStatusChip";
import { ProductTour } from "../guide/ProductTour";
import { InsyderMark } from "../common/InsyderLogo";
import { PORTALS, portalForRole, portalHome, sectionOf, toPortalPath, visibleSections } from "./portals";

function getNavIconAnimation(key: string): string {
  switch (key) {
    case "overview":
      // Subtle tilt and pop
      return "group-hover:scale-110 group-hover:-rotate-6";
    case "discover":
      // Compass rotates clockwise
      return "group-hover:rotate-45 group-hover:scale-110 group-hover:duration-500";
    case "accounts":
      // Building lifts upward
      return "group-hover:-translate-y-1 group-hover:scale-110";
    case "monitors":
      // Upward trend pulse
      return "group-hover:-translate-y-1 group-hover:scale-110 group-hover:rotate-3";
    case "outreach":
      // Paper plane launch / fly forward-up
      return "group-hover:translate-x-1.5 group-hover:-translate-y-1 group-hover:-rotate-12 group-hover:scale-110";
    case "reports":
      // Spline curve lift & tilt
      return "group-hover:scale-110 group-hover:rotate-6 group-hover:-translate-y-0.5";
    case "members":
      // People bounce / step forward
      return "group-hover:scale-110 group-hover:-translate-y-0.5";
    case "workspaces":
      // Geometric shapes tilt
      return "group-hover:rotate-12 group-hover:scale-110";
    case "settings":
      // Gear spin
      return "group-hover:rotate-90 group-hover:scale-110 group-hover:duration-500";
    case "leads":
    case "shared":
      return "group-hover:-translate-y-1 group-hover:scale-110";
    case "review":
      return "group-hover:rotate-6 group-hover:scale-110";
    case "work":
      return "group-hover:-rotate-6 group-hover:scale-110";
    default:
      return "group-hover:scale-110";
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { can, role, user, workspaceName, workspaces, workspaceId, selectWorkspace } = useWorkspace();
  // Each role has its own portal and menu; links stay inside it
  const portal = portalForRole(role) ?? PORTALS.analyst;
  const sections = visibleSections(portal, can);
  const current = sectionOf(sections, toPortalPath(pathname));
  const subItems = (current?.items ?? []).map((i) => ({ href: portal.prefix + i.href, label: i.label }));
  const initials = (user?.name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Get every page in this menu ready ahead of time, so switching sections doesn't wait.
  const menuHrefs = [...new Set(sections.flatMap((s) => s.items.map((i) => portal.prefix + i.href)))].join("|");
  useEffect(() => {
    const hrefs = menuHrefs.split("|").filter(Boolean);
    if (process.env.NODE_ENV === "development") {
      // `next dev` compiles a page the first time it is opened (seconds). Ask for each page once in
      // the background, one at a time, so the first click on a section finds it already compiled.
      let cancelled = false;
      const timer = setTimeout(async () => {
        for (const href of hrefs) {
          if (cancelled) return;
          try {
            await fetch(href, { credentials: "same-origin" });
          } catch {
            // dev server busy or restarting: the page just compiles on first click instead
          }
        }
      }, 2000);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
    // Production: load each page's code now (it is small and cached), so clicks are instant
    for (const href of hrefs) router.prefetch(href);
  }, [menuHrefs, router]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const brand = (size: "lg" | "sm") => (
    <span className="flex items-center gap-3">
      <span
        className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-b from-[#16304a] to-[#0D1B2A] text-white ${
          size === "lg" ? "h-12 w-12 rounded-[14px] ring-1 ring-white/15" : "h-8 w-8 rounded-[10px]"
        }`}
      >
        {/* soft gloss on the top half */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" aria-hidden />
        <InsyderMark size={size === "lg" ? 26 : 18} />
      </span>
      <span className="leading-none">
        <span className={`block font-[family-name:var(--font-heading)] font-bold lowercase tracking-[-0.045em] ${size === "lg" ? "text-[22px] text-white" : "text-[17px] text-[var(--foreground)]"}`}>
          Insyder
        </span>
        {size === "lg" ? (
          <span className="mt-1 block text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#7FD3CB]">
            Intelligence HQ
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <div className="app-canvas min-h-screen">
      {/* Mobile backdrop */}
      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-xs transition-opacity lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* Sidebar: slide-over drawer on mobile/tablet, fixed on lg+ */}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-50 flex w-[var(--sidebar-width)] flex-col border-r border-white/[0.06] transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0 print:hidden ${
          mobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        {/* Brand & Mobile Close button */}
        <div className="flex h-[84px] shrink-0 items-center justify-between px-5">
          <Link href={portalHome(portal, can)} prefetch onClick={() => setMobileMenuOpen(false)}>
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

        {/* Workspace switcher */}
        <div className="px-4">
          <WorkspaceSwitcher
            current={workspaceId}
            currentName={workspaceName ?? "Insyder"}
            workspaces={workspaces}
            onSelect={selectWorkspace}
          />
        </div>

        {/* Navigation */}
        <nav aria-label="Primary" className="mt-5 flex flex-1 flex-col gap-1 overflow-y-auto px-4 pb-4">
          {sections.map((item) => {
            const active = item.key === current?.key;
            const Icon = item.Icon;
            return (
              <Link
                key={item.key}
                data-tour={`nav-${item.key}`}
                href={portal.prefix + item.items[0]!.href}
                onClick={() => setMobileMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`group flex h-12 items-center gap-4 rounded-[12px] px-3 text-[15px] font-medium transition-all duration-200 active:scale-[0.98] ${
                  active
                    ? "bg-[#223D50] font-semibold text-white"
                    : "text-[#C3CED9] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon
                  size={21}
                  strokeWidth={1.75}
                  aria-hidden
                  className={`shrink-0 transition-transform duration-300 ease-out will-change-transform group-active:scale-85 group-active:duration-75 ${getNavIconAnimation(
                    item.key
                  )} ${
                    active ? "text-[#7FD3CB]" : "text-[#8FA2B5] group-hover:text-white"
                  }`}
                />
                <span className="transition-transform duration-200 group-hover:translate-x-0.5">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Signed-in member: name, role, help and log out */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-[14px] bg-white/[0.06] px-3 py-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0E6B67] to-[#14857F] text-[13px] font-semibold text-white">
              {initials === "?" ? <UserRound size={18} aria-hidden /> : initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-white">{user?.name ?? "Signed in"}</p>
              <p className="truncate text-[12px] text-[#8FA2B5]">{ROLE_LABELS[role ?? ""] ?? role}</p>
            </div>
            <Link
              href={`${portal.prefix}/settings/how-it-works`}
              aria-label="Help: how it works"
              onClick={() => setMobileMenuOpen(false)}
              className="group/help relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#C3CED9] transition-all duration-200 hover:bg-white/10 hover:text-white active:scale-95"
            >
              <CircleHelp
                size={17}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 transition-transform duration-300 ease-out will-change-transform group-hover/help:rotate-12 group-hover/help:scale-115 group-active/help:scale-90 group-active/help:duration-75"
              />
              {/* Small "Help" tooltip above the icon, on hover and keyboard focus */}
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--navy)] px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/help:opacity-100 group-focus-visible/help:opacity-100"
              >
                Help
                <span
                  className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[var(--navy)]"
                  aria-hidden
                />
              </span>
            </Link>
          </div>
          <button
            type="button"
            className="group mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] text-[13.5px] font-medium text-[#C3CED9] transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-[0.98]"
            onClick={() => {
              void logout().catch(() => undefined);
              router.replace("/login");
            }}
          >
            <LogOut
              size={15}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 transition-transform duration-300 ease-out will-change-transform group-hover:translate-x-1 group-hover:scale-110 group-active:scale-90 group-active:duration-75"
            />
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">Log out</span>
          </button>
        </div>
      </aside>

      <ProductTour
        userId={user?.id ?? null}
        userName={user?.name ?? null}
        portalKey={portal.key}
        portalLabel={portal.label}
        sections={sections}
      />

      {/* Main content: full width on mobile/tablet, pushed right on lg+ */}
      <div className="min-h-screen lg:ml-[var(--sidebar-width)] print:ml-0">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b border-[var(--sidebar-line)] bg-white/85 px-4 backdrop-blur sm:px-6 lg:px-9 print:hidden">
          {/* Mobile hamburger button + mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--foreground)] hover:bg-[var(--chip-bg)] focus:outline-none"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={18} aria-hidden />
            </button>
            <Link href={portalHome(portal, can)}>{brand("sm")}</Link>
          </div>

          {/* Breadcrumb: Intelligence HQ › workspace */}
          <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-3 text-[16px] lg:flex">
            <Link href={portalHome(portal, can)} className="text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
              Intelligence HQ
            </Link>
            <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" aria-hidden />
            <span className="truncate font-medium text-[var(--foreground)]">{workspaceName ?? "Insyder"}</span>
          </nav>

          {/* Right actions: CRM status chip, Attention Bell, account menu */}
          <div className="ml-auto flex items-center gap-4">
            <span data-tour="crm-chip" className="contents">
              <CrmStatusChip />
            </span>
            <span data-tour="bell" className="inline-flex">
              <AttentionBell />
            </span>
            <AccountMenu
              initials={initials}
              name={user?.name ?? "Signed in"}
              roleLabel={ROLE_LABELS[role ?? ""] ?? role ?? ""}
              helpHref={`${portal.prefix}/settings/how-it-works`}
              profileHref={`${portal.prefix}/settings/profile`}
              onLogout={() => {
                void logout().catch(() => undefined);
                router.replace("/login");
              }}
            />
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 sm:py-6 lg:px-9 lg:py-8 print:max-w-none print:p-0">
          {subItems.length > 1 ? (
            <div className="print:hidden">
              <SubNav items={subItems} />
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

/** Round avatar in the top bar; opens profile, help and log out. */
export function AccountMenu({
  initials,
  name,
  roleLabel,
  helpHref,
  profileHref,
  onLogout,
}: {
  initials: string;
  name: string;
  roleLabel: string;
  /** Omitted: no "How it works" link (e.g. the platform console) */
  helpHref?: string;
  profileHref: string;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium text-[var(--plum)] transition-colors hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-tour="help"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[var(--brand)] to-[var(--brand-active)] text-white transition hover:brightness-110"
      >
        {initials === "?" ? <UserRound size={19} aria-hidden /> : <span className="text-[13px] font-semibold">{initials}</span>}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_16px_40px_rgba(13,27,42,0.14)]"
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-[14px] font-semibold text-[var(--foreground)]">{name}</p>
            <p className="truncate text-[12px] text-[var(--muted)]">{roleLabel}</p>
          </div>
          <div className="my-1 h-px bg-[var(--line)]" />
          <Link role="menuitem" href={profileHref} className={item}>
            <UserRound size={16} aria-hidden /> Profile
          </Link>
          {helpHref ? (
            <Link role="menuitem" href={helpHref} className={item}>
              <CircleHelp size={16} aria-hidden /> How it works
            </Link>
          ) : null}
          <button role="menuitem" type="button" onClick={onLogout} className={item}>
            <LogOut size={16} aria-hidden /> Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Workspace card in the sidebar; opens a list of the member's workspaces when they have more than one. */
function WorkspaceSwitcher({
  current,
  currentName,
  workspaces,
  onSelect,
}: {
  current: string | null;
  currentName: string;
  workspaces: WorkspaceMembership[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const canSwitch = workspaces.length > 1;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, workspaces.findIndex((w) => w.id === current)));
    listRef.current?.focus();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, workspaces, current]);

  function choose(id: string) {
    setOpen(false);
    if (id !== current) onSelect(id);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setActive((i) => (i + 1) % workspaces.length);
    else if (e.key === "ArrowUp") setActive((i) => (i - 1 + workspaces.length) % workspaces.length);
    else if (e.key === "Enter" || e.key === " ") {
      const w = workspaces[active];
      if (w) choose(w.id);
    } else return;
    e.preventDefault();
  }

  const card = (
    <>
      <span className="h-2 w-2 shrink-0 rounded-full bg-[#7FD3CB]" aria-hidden />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#8FA2B5]">Workspace</span>
        <span className="block truncate text-[15px] font-semibold leading-tight text-white">{currentName}</span>
      </span>
    </>
  );
  const cardClass =
    "flex w-full items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.06] px-4 py-3";

  if (!canSwitch) {
    return (
      <div data-tour="workspace" className={cardClass}>
        {card}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative" data-tour="workspace">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Workspace: ${currentName}. Switch workspace`}
        onClick={() => setOpen((o) => !o)}
        className={`${cardClass} transition hover:bg-white/10 ${open ? "ring-2 ring-[#7FD3CB]/40" : ""}`}
      >
        {card}
        <ChevronsUpDown size={16} className="shrink-0 text-[#8FA2B5]" aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-[16px] border border-[var(--card-line)] bg-white p-2 shadow-[0_18px_40px_rgba(13,27,42,0.14)]">
          <p className="px-3 pb-1.5 pt-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--plum-muted)]">
            Switch workspace
          </p>
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-label="Workspaces"
            aria-activedescendant={workspaces[active] ? `ws-${workspaces[active].id}` : undefined}
            onKeyDown={onKey}
            className="max-h-72 overflow-y-auto outline-none"
          >
            {workspaces.map((w, i) => {
              const selected = w.id === current;
              return (
                <li
                  key={w.id}
                  id={`ws-${w.id}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => choose(w.id)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors ${
                    i === active ? "bg-[var(--brand-tint)]" : ""
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-bold ${
                      selected
                        ? "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-active)] text-white"
                        : "bg-[var(--lilac)] text-[var(--plum)]"
                    }`}
                  >
                    {w.name
                      .split(/\s+/)
                      .map((p) => p[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[14px] font-semibold ${
                        selected || i === active ? "text-[var(--brand-active)]" : "text-[var(--foreground)]"
                      }`}
                    >
                      {w.name}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--plum-muted)]">
                      {ROLE_LABELS[w.role] ?? w.role}
                    </span>
                  </span>
                  {selected ? <Check size={17} className="shrink-0 text-[var(--brand-active)]" aria-hidden /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Insyder mark: an open outer ring around a target (ring + centre dot). */
