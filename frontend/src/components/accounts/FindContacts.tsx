"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { findAccountContacts, listResearchRuns } from "../../lib/api/research";
import { ResearchRunStatus } from "../research/ResearchRunStatus";
import { Button } from "../ui/Button";
import { FormError } from "../ui/Field";

const ACTIVE = ["queued", "running", "retrying"];

/**
 * "Find decision makers": an Exa Agent search for the account's IT / technology decision makers
 * with work emails. Shows a search already running (e.g. the one started after research) and
 * reloads the people list when it finishes.
 */
export function FindContacts({
  accountId,
  workspaceId,
  canRun,
  onFinished,
}: {
  accountId: string;
  workspaceId: string;
  canRun: boolean;
  onFinished: () => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [lastSearched, setLastSearched] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up a search that is running or recently finished for this account
  useEffect(() => {
    let cancelled = false;
    void listResearchRuns(workspaceId, { accountId, mode: "contacts", limit: 1 })
      .then(({ runs }) => {
        if (cancelled) return;
        const latest = runs[0];
        if (!latest) return;
        if (ACTIVE.includes(latest.status)) {
          setRunId(latest.id);
          setActive(true);
        } else {
          setLastSearched(latest.completedAt ?? latest.createdAt);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accountId]);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const r = await findAccountContacts(workspaceId, accountId);
      setRunId(r.researchRunId);
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the contact search");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mt-4 rounded-[10px] border border-dashed border-[var(--line)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Find decision makers</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Searches the web for IT and technology decision makers with their work emails, each with a source.
            Uses 1 research unit. Results are unverified — check before use.
            {lastSearched && !active ? ` Last searched ${new Date(lastSearched).toLocaleDateString()}.` : ""}
          </p>
        </div>
        {canRun ? (
          <Button onClick={() => void start()} disabled={starting || active}>
            <Search
              size={15}
              className={`mr-1.5 inline ${starting || active ? "animate-search-sweep" : ""}`}
              aria-hidden
            />
            {starting ? "Starting…" : active ? "Searching…" : lastSearched ? "Search again" : "Find decision makers"}
          </Button>
        ) : null}
      </div>
      {error ? <FormError message={error} /> : null}
      {runId ? (
        <div className="mt-3">
          <ResearchRunStatus
            runId={runId}
            workspaceId={workspaceId}
            onFinished={(r) => {
              setActive(false);
              setLastSearched(new Date().toISOString());
              if (r.status === "completed") onFinished();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
