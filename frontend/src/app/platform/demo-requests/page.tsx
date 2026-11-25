"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, Building2, CalendarCheck, Check, Globe, Inbox, Mail, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils/dates";
import {
  DEMO_REQUESTS_CHANGED,
  listDemoRequests,
  setDemoRequestStatus,
  type DemoRequest,
  type DemoRequestStatus,
} from "@/lib/api/platform";

const TABS: Array<{ key: DemoRequestStatus; label: string }> = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "closed", label: "Closed" },
];

const STATUS_BADGE: Record<DemoRequestStatus, { tone: "amber" | "blue" | "default"; label: string }> = {
  new: { tone: "amber", label: "New" },
  contacted: { tone: "blue", label: "Contacted" },
  closed: { tone: "default", label: "Closed" },
};

const EMPTY: Record<DemoRequestStatus, string> = {
  new: "No new demo requests. Submissions from the website's “Book a demo” form will appear here.",
  contacted: "No requests marked as contacted yet.",
  closed: "No closed requests yet.",
};

function formatDateTime(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Platform admin: "Book a demo" submissions from the marketing website. */
export default function DemoRequestsPage() {
  const [tab, setTab] = useState<DemoRequestStatus>("new");
  const [data, setData] = useState<Awaited<ReturnType<typeof listDemoRequests>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listDemoRequests(tab));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load demo requests");
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(r: DemoRequest, status: DemoRequestStatus) {
    setBusyId(r.id);
    setNotice(null);
    try {
      await setDemoRequestStatus(r.id, status);
      setNotice(`${r.name} moved to ${STATUS_BADGE[status].label}.`);
      window.dispatchEvent(new Event(DEMO_REQUESTS_CHANGED));
      await load();
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : "Could not update the request");
    } finally {
      setBusyId(null);
    }
  }

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Demo requests"
        description="People who filled in “Book a demo” on the Insyder website. Reach out, then mark each one as contacted or closed."
      />

      <div className="flex gap-1 border-b border-[var(--line)]" role="tablist" aria-label="Request status">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setNotice(null);
            }}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === t.key ? "border-[var(--brand-active)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
            <span className="rounded-full bg-[var(--chip-bg)] px-2 py-0.5 text-xs tabular-nums">{data.counts[t.key]}</span>
          </button>
        ))}
      </div>

      {notice ? (
        <p role="status" className="text-sm font-medium text-[var(--badge-green-fg)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {data.requests.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Inbox size={28} className="text-[var(--muted)]" aria-hidden />
          <p className="text-sm text-[var(--muted)]">{EMPTY[tab]}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => {
            const busy = busyId === r.id;
            return (
              <Card key={r.id} className="!p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px]">{r.name}</h3>
                      <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                      <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1.5 text-[var(--brand-active)] hover:underline">
                        <Mail size={14} aria-hidden />
                        {r.email}
                      </a>
                      {r.company ? (
                        <span className="inline-flex items-center gap-1.5 text-[var(--foreground)]">
                          <Building2 size={14} className="text-[var(--muted)]" aria-hidden />
                          {r.company}
                        </span>
                      ) : null}
                      {r.role ? (
                        <span className="inline-flex items-center gap-1.5 text-[var(--foreground)]">
                          <Briefcase size={14} className="text-[var(--muted)]" aria-hidden />
                          {r.role}
                        </span>
                      ) : null}
                      {r.website ? (
                        <a
                          href={r.website}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex items-center gap-1.5 text-[var(--brand-active)] hover:underline"
                        >
                          <Globe size={14} aria-hidden />
                          {r.website.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                        </a>
                      ) : null}
                    </div>

                    {r.message ? (
                      <p className="whitespace-pre-line rounded-[10px] bg-[var(--chip-bg)] px-3.5 py-2.5 text-sm text-[var(--foreground)]">
                        {r.message}
                      </p>
                    ) : null}

                    <p className="text-xs text-[var(--muted)]">
                      Received {formatDateTime(r.createdAt)}
                      {r.status !== "new" && r.updatedByName ? ` · Marked ${STATUS_BADGE[r.status].label.toLowerCase()} by ${r.updatedByName} on ${formatDate(r.updatedAt)}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {r.status === "new" ? (
                      <>
                        <Button disabled={busy} onClick={() => void move(r, "closed")}>
                          Close
                        </Button>
                        <Button variant="primary" disabled={busy} onClick={() => void move(r, "contacted")}>
                          <CalendarCheck size={15} className="mr-1.5" aria-hidden />
                          Mark contacted
                        </Button>
                      </>
                    ) : null}
                    {r.status === "contacted" ? (
                      <Button variant="primary" disabled={busy} onClick={() => void move(r, "closed")}>
                        <Check size={15} className="mr-1.5" aria-hidden />
                        Close
                      </Button>
                    ) : null}
                    {r.status === "closed" ? (
                      <Button disabled={busy} onClick={() => void move(r, "new")}>
                        <RotateCcw size={15} className="mr-1.5" aria-hidden />
                        Reopen
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
