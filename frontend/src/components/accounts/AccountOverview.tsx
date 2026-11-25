"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Gauge,
  Globe,
  History,
  Inbox,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  Network,
  Phone,
  RadioTower,
  Target,
  UserRound,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Brief, EvidenceItem, Signal } from "../../lib/api/accounts";
import type { Contact } from "../../lib/api/contacts";
import { CRM_PROVIDER_LABELS, type CrmAccountStatus } from "../../lib/api/crm";
import { formatMoney, OPPORTUNITY_STAGE_LABELS, type Opportunity } from "../../lib/api/opportunities";
import type { Task } from "../../lib/api/tasks";
import { formatDate } from "../../lib/utils/dates";
import { BASIS_LABELS } from "../qualification/FactEditor";
import { humanize } from "../ui/Field";

/* ---------- shared bits ---------- */

/** Rounded white panel used across the account page */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[20px] border border-[var(--card-line)] bg-white p-6 shadow-[var(--card-shadow)] sm:p-7 ${className}`}
    >
      {children}
    </div>
  );
}

const TAG_TONES = [
  "bg-[var(--brand-tint)] text-[var(--brand-active)]",
  "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]",
  "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]",
  "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]",
];

function Tag({ children, tone = 0 }: { children: ReactNode; tone?: number }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.08em] ${TAG_TONES[tone % TAG_TONES.length]}`}
    >
      {children}
    </span>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--plum)]">{children}</p>;
}

function IconTile({ Icon, tone }: { Icon: LucideIcon; tone: "red" | "blue" | "green" | "plum" }) {
  const cls = {
    red: "bg-[var(--brand-tint)] text-[var(--brand-active)]",
    blue: "bg-[var(--lilac)] text-[var(--link)]",
    green: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]",
    plum: "bg-[var(--lilac)] text-[var(--plum)]",
  }[tone];
  return (
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${cls}`}>
      <Icon size={22} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

export function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

/** "today", "3 days ago", or a date once it's more than a month old */
export function ago(iso: string | null | undefined) {
  if (!iso) return "date unknown";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "date unknown";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - t) / 3_600_000);
    if (hours <= 0) return "just now";
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  return formatDate(iso);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ACCEPTANCE_PILL: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft lead", cls: "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]" },
  ready_for_review: { label: "Waiting for sales review", cls: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" },
  accepted: { label: "Accepted by sales", cls: "bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" },
  needs_research: { label: "Returned for research", cls: "bg-[var(--badge-amber-bg)] text-[var(--badge-amber-fg)]" },
  rejected: { label: "Rejected", cls: "bg-[var(--danger-tint)] text-[var(--danger)]" },
};

const RESEARCH_LABEL: Record<string, string> = {
  unresearched: "Not researched yet",
  researching: "Research running",
  researched: "Researched",
  failed: "Research failed",
};

const BUYING_ROLE_ORDER = [
  "decision_maker",
  "budget_holder",
  "technical_evaluator",
  "influencer",
  "procurement",
  "user",
  "unknown",
];

/* ---------- hero ---------- */

export function AccountHero({
  brief,
  crm,
  actions,
  menu,
}: {
  brief: Brief;
  crm: CrmAccountStatus | null;
  actions: ReactNode;
  /** Overflow menu pinned to the card's top-right corner. */
  menu?: ReactNode;
}) {
  const { account, owner } = brief;
  const pill = ACCEPTANCE_PILL[account.acceptanceState] ?? {
    label: humanize(account.acceptanceState),
    cls: "bg-[var(--badge-default-bg)] text-[var(--badge-default-fg)]",
  };
  const facts: Array<{ Icon: LucideIcon; text: string }> = [
    account.country ? { Icon: MapPin, text: account.country } : null,
    account.playbookTemplateKey
      ? { Icon: Target, text: `Playbook: ${humanize(account.playbookTemplateKey.replace(/^custom_/, ""))}` }
      : null,
    account.legalName && account.legalName !== account.name ? { Icon: Building2, text: account.legalName } : null,
    { Icon: UserRound, text: `Owner: ${owner?.name ?? "unassigned"}` },
    { Icon: Inbox, text: `Added via ${humanize(account.source)}` },
    { Icon: CalendarClock, text: `Updated ${ago(account.updatedAt)}` },
  ].filter((f): f is { Icon: LucideIcon; text: string } => Boolean(f));
  const crmLabel = crm ? (CRM_PROVIDER_LABELS[crm.provider] ?? crm.provider) : null;
  const crmState = !crm?.status
    ? "Not sent yet"
    : crm.status === "synced"
      ? "Synced"
      : crm.status === "failed"
        ? "Sync failed"
        : "Queued";

  return (
    <Panel className="relative">
      {menu ? <div className="absolute right-5 top-5 z-10">{menu}</div> : null}

      {/* Identity: logo, name, website, overview, status */}
      <div className={`flex min-w-0 gap-5 ${menu ? "pr-14" : ""}`}>
        <div className="relative shrink-0">
          <span className="flex h-[68px] w-[68px] items-center justify-center rounded-[18px] bg-gradient-to-br from-[var(--lilac)] to-[#e8e6fb] text-[21px] font-semibold text-[var(--foreground)] shadow-[0_6px_18px_rgba(13,27,42,0.12)]">
            {initialsOf(account.name)}
          </span>
          {account.acceptanceState === "accepted" ? (
            <span
              className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--badge-green-fg)] text-white ring-4 ring-white"
              title="Accepted by sales"
            >
              <BadgeCheck size={17} aria-label="Accepted by sales" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="break-words text-[26px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">{account.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {account.domain ? (
                <a
                  href={`https://${account.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[15px] font-medium text-[var(--plum)] hover:text-[var(--brand-active)]"
                >
                  {account.domain} <ArrowUpRight size={15} aria-hidden />
                </a>
              ) : (
                <span className="text-[14.5px] text-[var(--muted)]">No domain</span>
              )}
              <span className="text-[var(--line)]" aria-hidden>
                |
              </span>
              <span className={`rounded-lg px-2.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.08em] ${pill.cls}`}>
                {pill.label}
              </span>
              <span className="rounded-lg bg-[var(--lilac)] px-2.5 py-0.5 text-[13px] font-medium text-[var(--plum)]">
                {RESEARCH_LABEL[account.researchState] ?? humanize(account.researchState)}
              </span>
            </div>
          </div>
          {account.companySummary ? (
            <div className="max-w-4xl rounded-[12px] border border-[var(--card-line)] bg-[var(--soft)] px-4 py-3">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--plum)]">Company overview</span>
              <p className="mt-1 text-[15px] leading-relaxed text-[var(--foreground)]">{account.companySummary}</p>
            </div>
          ) : (
            <div className="max-w-4xl rounded-[12px] border border-dashed border-[var(--card-line)] px-4 py-2.5 text-[13.5px] italic text-[var(--plum-muted)]">
              Company overview will be generated when you run research.
            </div>
          )}
        </div>
      </div>

      {/* Footer: facts on the left, CRM status and the next actions side by side on the right */}
      <div className="mt-5 flex flex-col gap-4 border-t border-[var(--line)] pt-4 lg:flex-row lg:items-center lg:justify-between">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {facts.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2 text-[14px] text-[var(--plum)]">
              <Icon size={16} className="shrink-0 text-[var(--plum-muted)]" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 lg:flex-nowrap lg:justify-end">
          {crm?.configured ? (
            <div className="flex items-center gap-2.5 rounded-[12px] bg-[var(--lilac)] px-3.5 py-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  crm.status === "synced" ? "bg-[#22a35a]" : crm.status === "failed" ? "bg-[var(--danger)]" : "bg-[#b9b3c9]"
                }`}
                aria-hidden
              />
              <span className="leading-tight">
                <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">CRM sync</span>
                <span className="block whitespace-nowrap text-[13.5px] font-semibold text-[var(--foreground)]">
                  {crmLabel} · {crmState}
                </span>
              </span>
            </div>
          ) : null}
          {actions}
        </div>
      </div>
    </Panel>
  );
}

/* ---------- KPI cards ---------- */

function Kpi({
  label,
  Icon,
  tone,
  children,
}: {
  label: string;
  Icon: LucideIcon;
  tone: "red" | "blue" | "green" | "plum";
  children: ReactNode;
}) {
  return (
    <Panel className="relative overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        <IconTile Icon={Icon} tone={tone} />
      </div>
      <div className="mt-1">{children}</div>
    </Panel>
  );
}

const big = "text-[40px] font-bold leading-none tracking-[-0.03em] sm:text-[46px]";

export function AccountKpis({
  brief,
  contacts,
  opportunity,
}: {
  brief: Brief;
  contacts: Contact[];
  opportunity: Opportunity | null | undefined;
}) {
  const { account, signals, evidence, owner } = brief;
  const score = account.fitScore;
  const band = score == null ? null : score >= 70 ? "High priority" : score >= 40 ? "Medium priority" : "Low priority";
  const fresh = evidence.filter((e) => e.freshness === "fresh").length;
  const kinds = [...new Set(signals.map((s) => humanize(s.kind)))];
  const withEmail = contacts.filter((c) => c.email).length;
  const roleCounts = BUYING_ROLE_ORDER.map((r) => [r, contacts.filter((c) => c.buyingRole === r).length] as const).filter(
    ([, n]) => n > 0,
  );

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Kpi label="Priority score" Icon={Gauge} tone="red">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className={big}>{score ?? "—"}</span>
          <span className="text-[20px] text-[var(--plum)]">/100</span>
        </p>
        <p className="mt-3 flex items-center gap-2 text-[15px] text-[var(--plum)]">
          <span className={`h-2.5 w-2.5 rounded-full ${score != null && score >= 70 ? "bg-[var(--brand)]" : "bg-[#B8C3CF]"}`} aria-hidden />
          <span className="font-medium text-[var(--foreground)]">{band ?? "Not scored yet"}</span>
          {score == null ? <span>(run research to score it)</span> : null}
        </p>
      </Kpi>

      <Kpi label="Active signals" Icon={RadioTower} tone="blue">
        <p className="flex flex-wrap items-baseline gap-3">
          <span className={big}>{signals.length}</span>
          <span className="text-[16px] font-medium text-[var(--plum)]">
            {signals.length === 1 ? "signal" : "signals"} · {fresh} fresh
          </span>
        </p>
        <p className="mt-3 text-[15px] text-[var(--plum)]">
          {kinds.length ? kinds.join(" + ") : `${plural(evidence.length, "source")} found so far`}
        </p>
      </Kpi>

      <Kpi label="Decision makers" Icon={UsersRound} tone="green">
        <p className="flex flex-wrap items-baseline gap-3">
          <span className={big}>{contacts.length}</span>
          <span className="text-[16px] font-medium text-[var(--plum)]">sourced</span>
          {contacts.length ? (
            <span className="rounded-lg bg-[var(--lilac)] px-2.5 py-1 text-[13.5px] font-semibold text-[var(--foreground)]">
              {withEmail} with email
            </span>
          ) : null}
        </p>
        <p className="mt-3 text-[15px] text-[var(--plum)]">
          {roleCounts.length
            ? roleCounts.map(([r, n]) => `${n} ${humanize(r).toLowerCase()}`).join(" · ")
            : "No sourced contacts yet"}
        </p>
      </Kpi>

      <Kpi label="Deal pipeline" Icon={Wallet} tone="plum">
        {opportunity ? (
          <>
            <p className="flex flex-wrap items-baseline gap-3">
              <span className={big}>{formatMoney(opportunity.valueAmount, opportunity.currency)}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[15px] text-[var(--plum)]">
              <span>Stage: {OPPORTUNITY_STAGE_LABELS[opportunity.stage]}</span>
              <span className="font-semibold text-[var(--foreground)]">Owner: {owner?.name ?? "unassigned"}</span>
            </div>
          </>
        ) : (
          <>
            <p className={`${big} text-[#B8C3CF]`}>—</p>
            <p className="mt-3 text-[15px] text-[var(--plum)]">
              {opportunity === undefined ? "Loading…" : "No deal recorded yet. It's added after outreach."}
            </p>
          </>
        )}
      </Kpi>
    </div>
  );
}

/* ---------- tabs ---------- */

export type AccountTab = "overview" | "workflow" | "people" | "activity";

export function AccountTabs({
  tab,
  onChange,
  progress,
  peopleCount,
}: {
  tab: AccountTab;
  onChange: (t: AccountTab) => void;
  progress: string;
  peopleCount: number;
}) {
  const tabs: Array<{ key: AccountTab; label: string; Icon: LucideIcon; count?: string }> = [
    { key: "overview", label: "Overview & signals", Icon: Target },
    { key: "workflow", label: "Lead workflow", Icon: ListChecks, count: progress },
    { key: "people", label: "Decision makers", Icon: Network, count: String(peopleCount) },
    { key: "activity", label: "Timeline & activity", Icon: History },
  ];
  return (
    <div role="tablist" aria-label="Account sections" className="grid gap-1.5 rounded-[18px] bg-[var(--lilac)] p-1.5 sm:grid-cols-2 xl:grid-cols-4">
      {tabs.map(({ key, label, Icon, count }) => {
        const active = key === tab;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`flex items-center justify-center gap-3 rounded-[14px] px-4 py-3.5 text-[15px] font-medium transition ${
              active
                ? "bg-white text-[var(--foreground)] shadow-[0_4px_14px_rgba(13,27,42,0.1)]"
                : "text-[var(--plum)] hover:bg-white/60"
            }`}
          >
            <Icon size={20} className={active ? "text-[var(--brand-active)]" : "text-[var(--plum)]"} aria-hidden />
            {label}
            {count ? (
              <span className="rounded-full bg-[#e6e3f7] px-2 py-0.5 text-[12.5px] font-semibold text-[var(--foreground)]">
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- signals ---------- */

type SignalItem = { evidence: EvidenceItem; signal: Signal | undefined };

export function SignalsPanel({
  brief,
  limit,
  onOpenEvidence,
}: {
  brief: Brief;
  limit?: number;
  onOpenEvidence: () => void;
}) {
  const bySource = new Map(brief.signals.filter((s) => s.evidenceId).map((s) => [s.evidenceId!, s]));
  const items: SignalItem[] = brief.evidence
    .map((e) => ({ evidence: e, signal: bySource.get(e.id) }))
    .sort((a, b) =>
      (b.evidence.eventDate ?? b.evidence.discoveredAt).localeCompare(a.evidence.eventDate ?? a.evidence.discoveredAt),
    );
  const shown = limit ? items.slice(0, limit) : items;
  const reviewed = brief.evidence.filter((e) => e.reviewedAt).length;
  const kindTone = new Map<string, number>();

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <IconTile Icon={Target} tone="red" />
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">Active buying signals & triggers</h2>
            <p className="mt-1 text-[15px] text-[var(--plum)]">
              Found by research across news, registries, tenders and job ads. Each one links to its source.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--lilac)] px-4 py-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">
          {reviewed} of {brief.evidence.length} reviewed
        </span>
      </div>

      {shown.length ? (
        <ul className="mt-6 space-y-4">
          {shown.map(({ evidence: e, signal }) => {
            const kind = signal?.kind ?? "web_signal";
            if (!kindTone.has(kind)) kindTone.set(kind, kindTone.size);
            const title = e.sourceTitle || signal?.observedFact || e.publisher || e.sourceUrl;
            const rawBody = signal?.hypothesis || e.excerpt || e.matchRationale;
            const body =
              rawBody && rawBody.trim() !== title?.trim() && !title?.includes(rawBody.trim())
                ? rawBody
                : null;
            return (
              <li key={e.id} className="rounded-[18px] bg-[var(--soft)] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-white text-[var(--brand-active)] shadow-[0_2px_8px_rgba(13,27,42,0.08)]">
                    <RadioTower size={21} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <Tag tone={kindTone.get(kind)}>{humanize(kind)}</Tag>
                        <span className="text-[14.5px] text-[var(--plum)]">
                          {e.eventDate ? `Happened ${ago(e.eventDate)}` : `Found ${ago(e.discoveredAt)}`}
                        </span>
                      </div>
                      <a
                        href={e.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-[12px] bg-white px-3.5 py-2 text-[14px] font-semibold text-[var(--foreground)] shadow-[0_2px_8px_rgba(13,27,42,0.08)] hover:text-[var(--brand-active)]"
                      >
                        <ExternalLink size={15} aria-hidden /> Open source
                      </a>
                    </div>
                    <h3 className="mt-2.5 text-[18px] font-semibold leading-snug tracking-[-0.01em] sm:text-[20px]">{title}</h3>
                    {body ? <p className="mt-2 text-[15px] leading-relaxed text-[var(--plum)]">{body}</p> : null}
                    <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[12px] bg-white px-4 py-3 text-[14px]">
                      {e.reviewedAt ? (
                        <span className="inline-flex items-center gap-2 font-medium text-[var(--foreground)]">
                          <CircleCheck size={16} className="text-[var(--badge-green-fg)]" aria-hidden /> Reviewed by the team
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 font-medium text-[var(--badge-amber-fg)]">
                          <CircleDashed size={16} aria-hidden /> Not reviewed yet
                        </span>
                      )}
                      {e.publisher ? <span className="text-[var(--plum)]">{e.publisher}</span> : null}
                      {e.freshness !== "fresh" ? (
                        <span className="text-[var(--badge-amber-fg)]">
                          {e.freshness === "stale" ? "Stale" : "Event date unknown"}
                        </span>
                      ) : null}
                      {e.contradiction ? <span className="text-[var(--brand-active)]">Contradicts another source</span> : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-6 rounded-[16px] bg-[var(--soft)] px-5 py-6 text-[15px] text-[var(--plum)]">
          No signals yet. Run research to look for buying signals.
        </p>
      )}

      {items.length ? (
        <button
          type="button"
          onClick={onOpenEvidence}
          className="mt-5 inline-flex items-center gap-2 text-[14.5px] font-semibold text-[var(--brand-active)] hover:underline"
        >
          {limit && items.length > limit ? `See all ${items.length} sources and review them` : "Review evidence"}
          <ArrowRight size={16} aria-hidden />
        </button>
      ) : null}
    </Panel>
  );
}

/* ---------- decision makers ---------- */

export function DecisionMakersPanel({
  contacts,
  hypotheses,
  onSeeAll,
  onDraftContact,
  reviewedEvidenceCount = 0,
  onReviewEvidence,
}: {
  contacts: Contact[];
  hypotheses: number;
  onSeeAll: () => void;
  onDraftContact?: (contactId: string, channel: "email" | "linkedin_note") => void;
  reviewedEvidenceCount?: number;
  onReviewEvidence?: () => void;
}) {
  const sorted = [...contacts].sort(
    (a, b) => BUYING_ROLE_ORDER.indexOf(a.buyingRole) - BUYING_ROLE_ORDER.indexOf(b.buyingRole),
  );
  const shown = sorted.slice(0, 3);
  const locked = reviewedEvidenceCount === 0;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">
            Key decision makers ({contacts.length} sourced)
          </h2>
          <p className="mt-1 text-[15px] text-[var(--plum)]">
            Real people with a source showing where they were found
            {hypotheses ? `, plus ${hypotheses} ${hypotheses === 1 ? "role" : "roles"} to find` : ""}.
          </p>
        </div>
        {locked && contacts.length > 0 ? (
          onReviewEvidence ? (
            <button
              type="button"
              onClick={onReviewEvidence}
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 hover:bg-amber-100 transition cursor-pointer"
              title="Click to go to Check the evidence"
            >
              <Lock size={12} /> Drafts locked until evidence reviewed →
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
              <Lock size={12} /> Drafts locked until evidence reviewed
            </span>
          )
        ) : null}
      </div>
      <button
        type="button"
        onClick={onSeeAll}
        className="mt-4 inline-flex items-center gap-2 rounded-[12px] bg-[var(--lilac)] px-4 py-2.5 text-[15px] font-medium text-[var(--foreground)] hover:brightness-[0.98]"
      >
        {contacts.length ? "See all people" : "Add people"} <ArrowRight size={16} aria-hidden />
      </button>

      {shown.length ? (
        <>
          <ul className="mt-5 space-y-3">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-col gap-4 rounded-[18px] bg-[var(--soft)] p-5 sm:flex-row sm:items-center">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#e6e3f7] text-[17px] font-semibold text-[var(--foreground)]">
                  {initialsOf(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[17px] font-semibold">{c.name}</span>
                    <span className="rounded-md bg-[#e6e3f7] px-2 py-0.5 text-[11.5px] font-bold uppercase tracking-[0.06em] text-[var(--foreground)]">
                      {humanize(c.buyingRole)}
                    </span>
                    {c.suppressed ? (
                      <span className="text-[12.5px] font-semibold text-[var(--brand-active)]">Do not contact</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[15px] text-[var(--plum)]">{c.title ?? "Title unknown"}</p>
                  <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[14.5px]">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="inline-flex items-center gap-2 hover:text-[var(--brand-active)]">
                        <Mail size={15} className="text-[var(--plum-muted)]" aria-hidden /> {c.email}
                      </a>
                    ) : null}
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="inline-flex items-center gap-2 hover:text-[var(--brand-active)]">
                        <Phone size={15} className="text-[var(--plum-muted)]" aria-hidden /> {c.phone}
                      </a>
                    ) : null}
                    {(() => {
                      const liMatch = c.sourceNote?.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)*linkedin\.com\/(?:in|pub)\/[^\s,;)]+/i);
                      if (!liMatch) return null;
                      const cleanLiUrl = liMatch[0].replace(/[.,;)]+$/, "");
                      return (
                        <a
                          href={cleanLiUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-medium text-[#0a66c2] hover:underline"
                          title="Open LinkedIn profile"
                        >
                          <svg className="h-3.5 w-3.5 fill-[#0a66c2]" viewBox="0 0 24 24">
                            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
                          </svg>
                          LinkedIn profile
                        </a>
                      );
                    })()}
                    <span className="text-[var(--muted)]">
                      {c.sourceType === "evidence" ? "Sourced from evidence" : "Added by the team"}
                    </span>
                  </p>
                </div>
                {onDraftContact && !c.suppressed ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 sm:pt-0">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onDraftContact(c.id, "email")}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition ${
                        locked
                          ? "cursor-not-allowed border-[var(--line)] bg-[#eeeef6] text-[var(--muted)] opacity-60"
                          : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--brand)] hover:text-[var(--brand-active)]"
                      }`}
                      title={
                        locked
                          ? "Review at least one evidence item to unlock outreach drafts"
                          : `Draft email for ${c.name}`
                      }
                    >
                      {locked ? (
                        <Lock size={12} className="text-[var(--muted)]" />
                      ) : (
                        <Mail size={13} className="text-[var(--brand-active)]" />
                      )}
                      Email draft
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onDraftContact(c.id, "linkedin_note")}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition ${
                        locked
                          ? "cursor-not-allowed border-[var(--line)] bg-[#eeeef6] text-[var(--muted)] opacity-60"
                          : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[#0a66c2] hover:text-[#0a66c2]"
                      }`}
                      title={
                        locked
                          ? "Review at least one evidence item to unlock outreach drafts"
                          : `Draft LinkedIn note for ${c.name}`
                      }
                    >
                      {locked ? (
                        <Lock size={12} className="text-[var(--muted)]" />
                      ) : (
                        <svg className="h-3 w-3 fill-[#0a66c2]" viewBox="0 0 24 24">
                          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
                        </svg>
                      )}
                      LinkedIn note
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {locked ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--lilac)]/60 px-4 py-3 text-[13px] text-[var(--plum)]">
              <div className="flex items-center gap-2">
                <Lock size={14} className="shrink-0 text-[var(--plum-muted)]" />
                <span>
                  Review at least one evidence source in the{" "}
                  {onReviewEvidence ? (
                    <button
                      type="button"
                      onClick={onReviewEvidence}
                      className="font-bold underline hover:text-[var(--brand-active)] cursor-pointer"
                    >
                      Check the evidence
                    </button>
                  ) : (
                    <strong>Check the evidence</strong>
                  )}{" "}
                  step to unlock outreach drafts.
                </span>
              </div>
              {onReviewEvidence ? (
                <button
                  type="button"
                  onClick={onReviewEvidence}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-tint)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-active)] hover:bg-[var(--brand)] hover:text-[var(--on-brand)] transition shadow-2xs cursor-pointer"
                >
                  <span>Go to evidence</span>
                  <ArrowRight size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-5 rounded-[16px] bg-[var(--soft)] px-5 py-6 text-[15px] text-[var(--plum)]">
          No sourced contacts yet. Add a person with a source, or a role to find if you only know the role.
        </p>
      )}
    </Panel>
  );
}

/* ---------- facts ---------- */

export function AccountFactsPanel({ brief }: { brief: Brief }) {
  const facts = brief.facts.filter((f) => !f.supersededBy && f.value && f.basis !== "unknown");
  const rationale = brief.qualification?.rationale?.trim();
  return (
    <Panel>
      <h2 className="text-[22px] font-semibold tracking-[-0.02em] sm:text-[26px]">Qualification facts</h2>
      {rationale ? <p className="mt-2 text-[15px] leading-relaxed text-[var(--plum)]">{rationale}</p> : null}
      {facts.length ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {facts.map((f) => (
            <div key={f.id} className="rounded-[16px] bg-[var(--soft)] p-5">
              <Eyebrow>{humanize(f.fieldKey)}</Eyebrow>
              <p className="mt-2 text-[17px] font-semibold leading-snug">{f.value}</p>
              <p
                className={`mt-2 text-[13.5px] ${
                  f.basis === "prospect_confirmed"
                    ? "text-[var(--badge-green-fg)]"
                    : f.basis === "source_observed"
                      ? "text-[var(--badge-blue-fg)]"
                      : "text-[var(--badge-amber-fg)]"
                }`}
              >
                {BASIS_LABELS[f.basis] ?? humanize(f.basis)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-[16px] bg-[var(--soft)] px-5 py-6 text-[15px] text-[var(--plum)]">
          No facts filled in yet. They are added in the qualification brief.
        </p>
      )}
    </Panel>
  );
}

/* ---------- CRM ---------- */

export function CrmPanel({
  crm,
  brief,
  onSendToCrm,
}: {
  crm: CrmAccountStatus | null;
  brief: Brief;
  onSendToCrm: (() => void) | null;
}) {
  const provider = crm ? (CRM_PROVIDER_LABELS[crm.provider] ?? crm.provider) : "CRM";
  const accepted = [...brief.decisions]
    .filter((d) => d.toState === "accepted")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const status = !crm?.configured
    ? { label: "Not connected", cls: "text-[var(--muted)]", dot: "bg-[#B8C3CF]" }
    : crm.status === "synced"
      ? { label: "Synced", cls: "text-[var(--badge-green-fg)]", dot: "bg-[#22a35a]" }
      : crm.status === "failed"
        ? { label: "Sync failed", cls: "text-[var(--danger)]", dot: "bg-[var(--danger)]" }
        : crm.status
          ? { label: "Queued", cls: "text-[var(--badge-amber-fg)]", dot: "bg-[#d99a1e]" }
          : { label: "Not sent yet", cls: "text-[var(--muted)]", dot: "bg-[#B8C3CF]" };
  const rows: Array<[string, ReactNode]> = [
    ["CRM", crm?.configured ? provider : "No CRM connected"],
    ["Last sync", crm?.syncedAt ? ago(crm.syncedAt) : "Never"],
    ["Contacts synced", crm ? `${crm.contactsSynced} of ${crm.contactsTotal}` : "—"],
    ["Assigned owner", brief.owner?.name ?? "Unassigned"],
    [
      "Next action",
      accepted?.nextAction ? <span className="font-semibold text-[var(--brand-active)]">{accepted.nextAction}</span> : "—",
    ],
  ];
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">CRM integration</h2>
        <span className={`inline-flex items-center gap-1.5 text-[14px] font-semibold ${status.cls}`}>
          <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden />
          {status.label}
        </span>
      </div>
      <dl className="mt-4 divide-y divide-[var(--line)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 py-3.5 text-[14.5px]">
            <dt className="text-[var(--plum)]">{k}</dt>
            <dd className="text-right font-medium text-[var(--foreground)]">{v}</dd>
          </div>
        ))}
      </dl>
      {crm?.lastError && crm.status === "failed" ? (
        <p className="mt-2 text-[13.5px] text-[var(--danger)]">{crm.lastError}</p>
      ) : null}
      {crm?.companyUrl ? (
        <a
          href={crm.companyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-[14px] bg-[var(--lilac)] px-4 py-3 text-[15px] font-medium text-[var(--foreground)] hover:brightness-[0.98]"
        >
          <ExternalLink size={17} aria-hidden /> Open in {provider}
        </a>
      ) : onSendToCrm ? (
        <button
          type="button"
          onClick={onSendToCrm}
          className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-[14px] bg-[var(--lilac)] px-4 py-3 text-[15px] font-medium text-[var(--foreground)] hover:brightness-[0.98]"
        >
          <Globe size={17} aria-hidden /> Go to Send to CRM
        </button>
      ) : null}
    </Panel>
  );
}

/* ---------- timeline ---------- */

type TimelineEvent = { at: string; title: string; body?: string | null; tone: "red" | "blue" | "green" | "grey" };

const DECISION_TITLES: Record<string, string> = {
  ready_for_review: "Sent for sales review",
  accepted: "Accepted by sales",
  needs_research: "Returned for more research",
  rejected: "Rejected by sales",
  draft: "Moved back to draft",
};

export function buildTimeline(
  brief: Brief,
  opts: { opportunity: Opportunity | null | undefined; crm: CrmAccountStatus | null; tasks: Task[] },
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const d of brief.decisions) {
    events.push({
      at: d.createdAt,
      title: DECISION_TITLES[d.toState] ?? `Moved to ${humanize(d.toState)}`,
      body: [d.reasonDetail, d.nextAction ? `Next: ${d.nextAction}` : null, `By ${d.actorName}`].filter(Boolean).join(" · "),
      tone: "red",
    });
  }
  // One entry per day research found sources, not one per source
  const byDay = new Map<string, EvidenceItem[]>();
  for (const e of brief.evidence) {
    const day = e.discoveredAt.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  for (const items of byDay.values()) {
    const latest = items.map((e) => e.discoveredAt).sort().at(-1)!;
    events.push({
      at: latest,
      title: `Research found ${plural(items.length, "source")}`,
      body: items
        .slice(0, 2)
        .map((e) => e.sourceTitle || e.publisher)
        .filter(Boolean)
        .join(" · "),
      tone: "blue",
    });
  }
  if (brief.account.whyNowAt) {
    events.push({ at: brief.account.whyNowAt, title: "AI why-now summary written", tone: "blue" });
  }
  if (opts.opportunity) {
    events.push({
      at: opts.opportunity.stageChangedAt,
      title: `Deal moved to ${OPPORTUNITY_STAGE_LABELS[opts.opportunity.stage]}`,
      body: formatMoney(opts.opportunity.valueAmount, opts.opportunity.currency),
      tone: "green",
    });
  }
  if (opts.crm?.syncedAt) {
    events.push({
      at: opts.crm.syncedAt,
      title: `Sent to ${CRM_PROVIDER_LABELS[opts.crm.provider] ?? opts.crm.provider}`,
      body: `${opts.crm.contactsSynced} of ${plural(opts.crm.contactsTotal, "contact")} synced`,
      tone: "green",
    });
  }
  for (const t of opts.tasks) {
    events.push({ at: t.createdAt, title: `Task created: ${humanize(t.type)}`, body: t.instruction, tone: "grey" });
    if (t.status === "completed") {
      events.push({ at: t.updatedAt, title: `Task completed: ${humanize(t.type)}`, body: t.outcome, tone: "grey" });
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

const DOT: Record<TimelineEvent["tone"], string> = {
  red: "bg-[var(--brand)]",
  blue: "bg-[var(--link)]",
  green: "bg-[#22a35a]",
  grey: "bg-[#d6d1e6]",
};

export function TimelinePanel({
  events,
  limit,
  onSeeAll,
}: {
  events: TimelineEvent[];
  limit?: number;
  onSeeAll?: () => void;
}) {
  const shown = limit ? events.slice(0, limit) : events;
  return (
    <Panel>
      <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Activity timeline</h2>
      {shown.length ? (
        <ol className="mt-5">
          {shown.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="relative flex gap-4 pb-6 last:pb-0">
              {i < shown.length - 1 ? (
                <span className="absolute left-[6px] top-4 h-full w-px bg-[var(--line)]" aria-hidden />
              ) : null}
              <span className={`relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-white ${DOT[ev.tone]}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold uppercase tracking-[0.06em] text-[var(--plum)]" title={formatDate(ev.at)}>
                  {ago(ev.at)}
                </p>
                <p className="mt-1 text-[16px] font-semibold leading-snug">{ev.title}</p>
                {ev.body ? <p className="mt-1 text-[14.5px] leading-relaxed text-[var(--plum)]">{ev.body}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-[15px] text-[var(--plum)]">Nothing has happened on this account yet.</p>
      )}
      {onSeeAll && limit && events.length > limit ? (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-5 inline-flex items-center gap-2 text-[14.5px] font-semibold text-[var(--brand-active)] hover:underline"
        >
          See full timeline ({events.length}) <ArrowRight size={16} aria-hidden />
        </button>
      ) : null}
    </Panel>
  );
}
