"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, FilePen, Mail, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DraftEditor } from "@/components/drafts/DraftEditor";
import { RequireCap } from "@/components/common/RequireCap";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { EmptyState } from "@/components/common/EmptyState";
import { listDrafts, type Draft } from "@/lib/api/drafts";
import { usePagination } from "@/components/ui/Pagination";

type Tab = "pending" | "approved";

function DraftsView({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = params.get("tab") === "approved" ? "approved" : "pending";
  const accountFilter = params.get("account");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDrafts((await listDrafts(workspaceId)).drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load drafts");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const channelFilter = params.get("channel"); // "email" | "linkedin_note" | null

  const forAccount = (drafts ?? []).filter((d) => !accountFilter || d.accountId === accountFilter);
  const byChannel = forAccount.filter((d) => !channelFilter || d.channel === channelFilter);
  const pending = byChannel.filter((d) => !d.approvedAt);
  const approved = byChannel.filter((d) => d.approvedAt);
  const shown = tab === "approved" ? approved : pending;
  const { pageItems, pager, topRef } = usePagination(shown);
  const accountName = accountFilter ? (drafts ?? []).find((d) => d.accountId === accountFilter)?.accountName : null;

  const emailCount = forAccount.filter((d) => d.channel === "email").length;
  const linkedinCount = forAccount.filter((d) => d.channel === "linkedin_note").length;

  // Tabs, channel, and account filter live in the address
  const go = (next: { tab?: Tab; account?: string | null; channel?: string | null }) => {
    const q = new URLSearchParams();
    const t = next.tab ?? tab;
    const a = next.account === undefined ? accountFilter : next.account;
    const c = next.channel === undefined ? channelFilter : next.channel;
    if (t === "approved") q.set("tab", "approved");
    if (a) q.set("account", a);
    if (c) q.set("channel", c);
    router.replace(`?${q.toString()}`, { scroll: false });
  };

  const tabs: Array<{ key: Tab; label: string; count: number; Icon: typeof FilePen; hint: string }> = [
    { key: "pending", label: "To review", count: pending.length, Icon: FilePen, hint: "Edit and check these, then approve them." },
    { key: "approved", label: "Approved", count: approved.length, Icon: CircleCheck, hint: "Checked and approved, ready to use. Still nothing is sent from here." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Outreach"
        title="Drafts"
        description="Drafts are built from your offer and reviewed, cited evidence. Hypotheses are marked separately and no contact details are invented. Creating or editing a draft never sends anything."
      />

      {/* Channel Filters */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-1">Channel:</span>
        <button
          type="button"
          onClick={() => go({ channel: null })}
          className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
            !channelFilter
              ? "bg-slate-900 text-white shadow-2xs"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          All Channels ({forAccount.length})
        </button>
        <button
          type="button"
          onClick={() => go({ channel: "email" })}
          className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition inline-flex items-center gap-1.5 ${
            channelFilter === "email"
              ? "bg-[var(--brand)] text-[var(--on-brand)] shadow-2xs"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Mail size={13} />
          Email ({emailCount})
        </button>
        <button
          type="button"
          onClick={() => go({ channel: "linkedin_note" })}
          className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition inline-flex items-center gap-1.5 ${
            channelFilter === "linkedin_note"
              ? "bg-[#0a66c2] text-white shadow-2xs"
              : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
          </svg>
          LinkedIn Note ({linkedinCount})
        </button>
      </div>

      <div role="tablist" aria-label="Draft status" className="grid gap-3 sm:grid-cols-2">
        {tabs.map(({ key, label, count, Icon, hint }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => go({ tab: key })}
              className={`flex items-start gap-3 rounded-[12px] border px-5 py-4 text-left transition-colors ${
                active
                  ? "border-[var(--brand)] bg-[var(--brand-tint)]"
                  : "border-[var(--line)] bg-white hover:bg-[var(--chip-bg)]"
              }`}
            >
              <Icon size={20} className={active ? "mt-0.5 text-[var(--brand-active)]" : "mt-0.5 text-[var(--muted)]"} aria-hidden />
              <span>
                <span className="flex items-center gap-2 text-[15px] font-semibold text-[var(--foreground)]">
                  {label}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-[var(--muted)] shadow-[0_0_0_1px_var(--line)]">
                    {drafts ? count : "…"}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {accountFilter ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-[var(--chip-bg)] px-3 py-1">
            Showing drafts for <strong>{accountName ?? "this account"}</strong>
          </span>
          <button
            type="button"
            onClick={() => go({ account: null })}
            className="inline-flex items-center gap-1 font-medium text-[var(--muted)] hover:text-[var(--brand-active)]"
          >
            <X size={14} aria-hidden /> Show all accounts
          </button>
        </div>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
      {drafts === null && !error ? <LoadingState label="Loading drafts…" /> : null}
      {drafts && !shown.length ? (
        tab === "approved" ? (
          <EmptyState title="No approved drafts yet" detail="Approve a draft in “To review” after checking it." />
        ) : (
          <EmptyState title="Nothing to review" detail="Open an account and choose “Draft outreach” to create one." />
        )
      ) : null}
      <div ref={topRef} className="scroll-mt-24 space-y-6" role="tabpanel">
        {pageItems.map((d) => <DraftEditor key={d.id} draft={d} workspaceId={workspaceId} onSaved={refresh} />)}
      </div>
      {pager}
    </div>
  );
}

export default function DraftsPage() {
  return <RequireCap cap="view_drafts">{(workspaceId) => <DraftsView workspaceId={workspaceId} />}</RequireCap>;
}
