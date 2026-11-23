"use client";

import { useResearchRun } from "../../hooks/useResearchRun";
import type { ResearchRun } from "../../lib/api/research";
import { StatusBadge } from "../common/StatusBadge";
import { Card } from "../ui/Card";

const ERROR_TEXT: Record<string, string> = {
  provider_timeout: "The research provider timed out.",
  provider_rate_limited: "The research provider is rate-limiting requests.",
  provider_unavailable: "The research provider is temporarily unavailable.",
  provider_auth: "The research provider rejected the configured API key. An admin needs to check it.",
  provider_plan:
    "Building lists isn't included in the current research plan. Use Quick search instead, or ask an admin to upgrade the plan.",
  suppressed: "This account is suppressed, so research was cancelled and not charged.",
};

/** Distinct queued / running / retrying / no-results / failed / completed states (spec §9). */
export function ResearchRunStatus({
  runId,
  workspaceId,
  onFinished,
}: {
  runId: string | null;
  workspaceId: string | null;
  onFinished?: (run: ResearchRun) => void;
}) {
  const { run, pollError } = useResearchRun(runId, workspaceId, onFinished);
  if (!runId) return null;
  const status = run?.status ?? "queued";
  const noResults = status === "completed" && run?.result?.noResults;

  return (
    <Card className="!p-4 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[var(--foreground)]">
          {run?.mode === "discovery"
            ? "Discovery run"
            : run?.mode === "similar"
              ? "Find similar"
              : run?.mode === "webset"
                ? "List build"
                : run?.mode === "contacts"
                  ? "Contact search"
                  : "Research run"}
        </span>
        <StatusBadge status={noResults ? "no_results" : status} />
        {run?.budgetActual != null ? (
          <span className="text-xs text-[var(--muted)]">{run.budgetActual} research units used</span>
        ) : run ? (
          <span className="text-xs text-[var(--muted)]">{run.budgetReserved} units reserved</span>
        ) : null}
      </div>
      {status === "queued" || status === "running" || status === "retrying" ? (
        <div className="mt-2 h-2 overflow-hidden rounded bg-[var(--chip-bg)]" role="progressbar" aria-valuenow={run?.progressPct ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--brand)] transition-all" style={{ width: `${run?.progressPct ?? 5}%` }} />
        </div>
      ) : null}
      {run?.mode === "webset" && (status === "queued" || status === "running") ? (
        <p className="mt-2 text-[var(--muted)]">
          Building the list and checking each company against your criteria. This usually takes a few minutes; you can
          leave this page and come back.
        </p>
      ) : null}
      {run?.mode === "contacts" && (status === "queued" || status === "running") ? (
        <p className="mt-2 text-[var(--muted)]">
          Looking for IT and technology decision makers and their work emails. This usually takes 1–3 minutes; you can
          leave this page and come back.
        </p>
      ) : null}
      {status === "retrying" ? (
        <p className="mt-2 text-[var(--badge-amber-fg)]">
          {ERROR_TEXT[run?.errorCode ?? ""] ?? "Temporary provider problem"} Retrying automatically — you will not be charged twice.
        </p>
      ) : null}
      {noResults ? (
        <p className="mt-2 text-[var(--muted)]">
          {run?.mode === "contacts"
            ? "No decision makers with a source were found. Add a person you know, or a role to find, instead."
            : "No sources found. This is not evidence that nothing is happening — try a broader query later."}
        </p>
      ) : null}
      {status === "completed" && run?.result && !noResults ? (
        <p className="mt-2 text-[var(--muted)]">
          {run.mode === "contacts"
            ? `${run.result.peopleFound ?? 0} people found · ${run.result.emailsFound ?? 0} with a personal work email · ${run.result.contactsCreated ?? 0} added, ${run.result.contactsUpdated ?? 0} updated${run.result.source === "search" ? " (basic people search — the agent search was unavailable)" : ""}. Unverified: check before use.${run.result.roleHypothesesQueued ? ` Writing ${run.result.roleHypothesesQueued === 1 ? "a role hypothesis" : `${run.result.roleHypothesesQueued} role hypotheses`} for the decision makers (a few minutes).` : ""}`
            : run.mode === "webset"
            ? `${run.result.rows?.length ?? 0} companies added to the list · ${run.result.skippedSuppressed ?? 0} suppressed skipped`
            : run.mode === "similar"
            ? `${run.result.rows?.length ?? 0} similar companies found · ${run.result.skippedSuppressed ?? 0} suppressed skipped`
            : run.mode === "discovery"
            ? `${run.result.rows?.length ?? 0} companies found · ${run.result.unmatched ?? 0} articles not tied to one company · ${run.result.skippedSuppressed ?? 0} suppressed skipped`
            : `${run.result.evidenceCreated ?? 0} new evidence items · ${run.result.duplicatesSkipped ?? 0} duplicates skipped`}
        </p>
      ) : null}
      {status === "failed" || status === "cancelled" ? (
        <p className="mt-2 text-[var(--brand-active)]">
          {ERROR_TEXT[run?.errorCode ?? ""] ?? run?.errorMessage ?? "Research failed."}
        </p>
      ) : null}
      {pollError ? <p className="mt-2 text-[var(--danger)]">{pollError}</p> : null}
    </Card>
  );
}
