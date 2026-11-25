"use client";

import { useState } from "react";
import { generateWhyNow, type Account, type WhyNowCitation } from "../../lib/api/accounts";
import { formatDate } from "../../lib/utils/dates";
import { Lightbulb } from "lucide-react";
import { FormError } from "../ui/Field";

function parseCitations(json: string | null | undefined): WhyNowCitation[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as WhyNowCitation[]) : [];
  } catch {
    return [];
  }
}

/** A one-paragraph, cited "why now?" summary. AI-written, so it is labelled and never counts as evidence. */
export function WhyNowCard({
  account,
  workspaceId,
  canGenerate,
  onGenerated,
}: {
  account: Account;
  workspaceId: string;
  canGenerate: boolean;
  onGenerated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = account.whyNowText ?? null;
  const citations = parseCitations(account.whyNowCitationsJson);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await generateWhyNow(account.id, workspaceId);
      onGenerated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write the summary");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[20px] border border-[var(--card-line)] bg-white p-6 shadow-[var(--card-shadow)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--brand-tint)] text-[var(--brand-active)]">
            <Lightbulb size={20} aria-hidden />
          </span>
          <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.02em]">Why now? AI insight</h3>
        </div>
        <span className="rounded-md bg-[var(--lilac)] px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--plum)]">
          AI-written
        </span>
      </div>
      {text ? (
        <>
          <div className="mt-5 rounded-[16px] bg-[var(--soft)] p-5">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">Timing assessment</p>
            <p className="mt-2 text-[15.5px] leading-relaxed text-[var(--foreground)]">{text}</p>
          </div>
          {citations.length ? (
            <div className="mt-4 rounded-[16px] bg-[var(--soft)] p-5">
              <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--plum)]">Sources cited</p>
              <ul className="mt-2 space-y-1.5 text-[14px]">
                {citations.map((c) => (
                  <li key={c.url}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-active)] hover:underline">
                      {c.title || c.url}
                    </a>
                    {c.publishedDate ? <span className="text-[var(--muted)]"> · {formatDate(c.publishedDate)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-[13.5px] text-[var(--badge-amber-fg)]">No sources were cited, so don&apos;t rely on this summary.</p>
          )}
          <p className="mt-3 text-[13px] text-[var(--muted)]">
            AI-written summary{account.whyNowAt ? ` from ${formatDate(account.whyNowAt)}` : ""}. Check the sources; it
            doesn&apos;t count as reviewed evidence.
          </p>
        </>
      ) : (
        <p className="mt-4 text-[15px] leading-relaxed text-[var(--plum)]">
          Get a two-sentence, cited answer to “what is this company doing right now, and when?”. Uses 1 research unit.
        </p>
      )}
      {canGenerate ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-r from-[var(--brand)] to-[var(--brand-active)] px-4 py-3 text-[15px] font-semibold text-[var(--on-gradient)] transition hover:brightness-110 disabled:opacity-60"
        >
          <Lightbulb size={17} aria-hidden />
          {busy ? "Writing…" : text ? "Refresh summary" : "Summarise why now"}
        </button>
      ) : null}
      <FormError message={error} />
    </div>
  );
}
