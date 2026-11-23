"use client";

import { Radar } from "lucide-react";
import { Badge } from "../ui/Badge";
import { formatDate } from "../../lib/utils/dates";
import { listChangeEvents, listMonitors, type ChangeEvent, type Monitor } from "../../lib/api/monitors";
import { Empty, Grid, List, ListRow, Loading, Panel, useSource } from "./DashboardKit";

const DAY = 86_400_000;

function cadenceLabel(hours: number) {
  if (hours <= 24) return "Daily";
  if (hours <= 168) return "Weekly";
  return "Monthly";
}

/**
 * Overview: active monitors and the latest signals they found, so activity shows at a glance.
 * Hidden when the monitors can't be loaded (e.g. the role can't see them).
 */
export function MonitorsSummary({ workspaceId }: { workspaceId: string }) {
  const data = useSource<{ monitors: Monitor[]; events: ChangeEvent[] }>(
    () =>
      Promise.all([listMonitors(workspaceId), listChangeEvents(workspaceId)]).then(([m, c]) => ({
        monitors: m.monitors,
        events: c.changeEvents,
      })),
    [workspaceId],
  );

  if (data === null) return null;

  const monitors = data?.monitors ?? [];
  const events = [...(data?.events ?? [])].sort(
    (a, b) => new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime(),
  );
  const active = monitors.filter((m) => m.status === "active");
  const paused = monitors.length - active.length;
  const lastWeek = events.filter((e) => Date.now() - new Date(e.discoveredAt).getTime() < 7 * DAY).length;
  const names = new Map(monitors.map((m) => [m.id, m.name]));

  return (
    <Grid cols="lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <Panel
        title="Monitors"
        subtitle="Saved searches that re-check the web on a schedule"
        href="/accounts/monitors"
        linkLabel="Manage monitors"
        className="min-w-0"
      >
        {data === undefined ? (
          <Loading />
        ) : !monitors.length ? (
          <Empty>No monitors yet. Monitor a playbook or chosen accounts from the Monitors page.</Empty>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { l: "Active", v: active.length },
                { l: "Paused", v: paused },
                { l: "Signals (7 days)", v: lastWeek },
              ].map((x) => (
                <div key={x.l} className="rounded-[10px] bg-[var(--chip-bg)] px-3 py-2.5 text-center">
                  <p className="text-[11.5px] text-[var(--muted)]">{x.l}</p>
                  <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{x.v}</p>
                </div>
              ))}
            </div>
            <List>
              {(active.length ? active : monitors).slice(0, 5).map((m) => (
                <ListRow
                  key={m.id}
                  href="/accounts/monitors"
                  title={m.name}
                  meta={`${cadenceLabel(m.cadenceHours)} · ${
                    m.lastAttemptAt ? `last checked ${formatDate(m.lastAttemptAt)}` : "not checked yet"
                  }`}
                  right={
                    m.status === "active" ? <Badge tone="green">Active</Badge> : <Badge>Paused</Badge>
                  }
                />
              ))}
            </List>
          </>
        )}
      </Panel>

      <Panel
        title="Recent signals"
        subtitle="Latest events your monitors found"
        href="/accounts/monitors"
        className="min-w-0"
      >
        {data === undefined ? (
          <Loading />
        ) : !events.length ? (
          <Empty>
            <span className="inline-flex items-center gap-1.5">
              <Radar size={15} aria-hidden /> No signals yet. They appear here after a monitor check finds something new.
            </span>
          </Empty>
        ) : (
          <List>
            {events.slice(0, 5).map((e) => (
              <ListRow
                key={e.id}
                href={e.accountId ? `/accounts/detail?id=${e.accountId}` : "/accounts/monitors"}
                title={
                  <span title={e.title} className="line-clamp-2 whitespace-normal break-words">
                    {e.title}
                  </span>
                }
                meta={[names.get(e.monitorId), formatDate(e.discoveredAt)].filter(Boolean).join(" · ")}
                right={e.accountId ? <Badge tone="blue">Your account</Badge> : <Badge>New company</Badge>}
              />
            ))}
          </List>
        )}
      </Panel>
    </Grid>
  );
}
