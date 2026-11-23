"use client";

import { useCallback, useEffect, useState } from "react";
import { BASIS_LABELS, FactEditor, FIELD_KEYS } from "./FactEditor";
import { ErrorState } from "../common/ErrorState";
import { LoadingState } from "../common/LoadingState";
import { StatusBadge } from "../common/StatusBadge";
import { useWorkspace } from "../../hooks/useWorkspace";
import { api } from "../../lib/api/client";
import type { Brief, Fact } from "../../lib/api/accounts";
import { formatDate } from "../../lib/utils/dates";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { humanize } from "../ui/Field";

type QualResponse = {
  qualification: { version: number; rationale: string | null };
  facts: Fact[];
  history: Fact[];
};

/**
 * The qualification brief: current facts with their basis and sources, the editor, and
 * superseded values. Used on the Qualification page and inside the account's step 4.
 */
export function QualificationBrief({
  workspaceId,
  accountId,
  brief,
  onSaved,
}: {
  workspaceId: string;
  accountId: string;
  /** The account brief (for evidence titles and acceptance state) */
  brief: Brief;
  onSaved?: () => void;
}) {
  const { can } = useWorkspace();
  const [data, setData] = useState<QualResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<QualResponse>(`/v1/accounts/${accountId}/qualification?workspaceId=${workspaceId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [accountId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading qualification…" />;

  const evidenceTitle = new Map(brief.evidence.map((e) => [e.id, e.sourceTitle || e.sourceUrl]));

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px]">Current brief</h2>
          <StatusBadge status={brief.account.acceptanceState} />
        </div>
        <p className="mt-2 text-sm">
          <span className="font-semibold">Rationale: </span>
          {data.qualification.rationale ?? <span className="text-[var(--muted)]">Not written yet</span>}
        </p>
        <dl className="mt-4 divide-y divide-[var(--line)] text-sm">
          {FIELD_KEYS.map((key) => {
            const f = data.facts.find((x) => x.fieldKey === key);
            const refs = f ? (JSON.parse(f.evidenceIdsJson) as string[]) : [];
            return (
              <div key={key} className="grid gap-1 py-2.5 sm:grid-cols-[220px_1fr]">
                <dt className="font-semibold">{humanize(key)}</dt>
                <dd>
                  <span>{f?.value ?? <span className="text-[var(--muted)]">Unknown</span>}</span>{" "}
                  <Badge tone={f?.basis === "prospect_confirmed" ? "green" : f?.basis === "source_observed" ? "blue" : f?.basis === "research_hypothesis" ? "amber" : "default"}>
                    {BASIS_LABELS[f?.basis ?? "unknown"]}
                  </Badge>
                  {refs.length ? (
                    <span className="block text-xs text-[var(--muted)]">
                      Sources: {refs.map((id) => evidenceTitle.get(id) ?? id).join("; ")}
                    </span>
                  ) : null}
                  {f?.confirmationNote ? (
                    <span className="block text-xs text-[var(--muted)]">
                      Confirmation: {f.confirmationNote} ({formatDate(f.confirmedAt)})
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      {can("qualify") ? (
        <FactEditor
          accountId={accountId}
          workspaceId={workspaceId}
          version={data.qualification.version}
          rationale={data.qualification.rationale}
          facts={data.facts}
          evidence={brief.evidence}
          onSaved={() => {
            void load();
            onSaved?.();
          }}
        />
      ) : null}

      {data.history.length ? (
        <Card>
          <h2 className="text-[16px]">Superseded values</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-[var(--muted)]">
            {[...data.history]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((h) => (
                <li key={h.id}>
                  {formatDate(h.createdAt)} · {humanize(h.fieldKey)}: {h.value ?? "Unknown"} ({BASIS_LABELS[h.basis]})
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
