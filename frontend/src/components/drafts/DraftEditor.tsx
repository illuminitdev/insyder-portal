"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useEffect, useState } from "react";
import { Copy, Download, RefreshCw, Trash2 } from "lucide-react";
import { approveDraft, deleteDraft, regenerateDraft, saveDraft, type Draft } from "../../lib/api/drafts";
import { downloadFile } from "../../lib/api/accounts";
import { useWorkspace } from "../../hooks/useWorkspace";
import { formatDate } from "../../lib/utils/dates";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, FormError, FormNotice, inputClass } from "../ui/Field";

export function DraftEditor({
  draft,
  workspaceId,
  onSaved,
}: {
  draft: Draft;
  workspaceId: string;
  onSaved: () => void;
}) {
  const { can } = useWorkspace();
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSubject(draft.subject ?? "");
    setBody(draft.body);
  }, [draft.subject, draft.body, draft.version]);

  const dirty = subject !== (draft.subject ?? "") || body !== draft.body;
  const hypotheses = JSON.parse(draft.hypothesesJson || "[]") as string[];
  const citations = (JSON.parse(draft.evidenceIdsJson || "[]") as string[]).length;
  const editable = can("drafts");

  const isLinkedIn = draft.channel === "linkedin_note";
  const words = body.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const charCount = body.length;

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(body);
      setNotice(
        isLinkedIn
          ? "Copied to clipboard. Paste it into your LinkedIn connection request — Insyder never sends messages."
          : "Copied to clipboard. Send it from your mailbox — Insyder never sends messages.",
      );
    } catch {
      setError("Could not copy to clipboard. Please copy manually.");
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={`/accounts/detail?id=${draft.accountId}`} className="text-sm font-semibold hover:text-[var(--brand-active)]">
            {draft.accountName}
          </Link>
          <span className="font-normal text-xs text-[var(--muted)]">
            · updated {formatDate(draft.updatedAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isLinkedIn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0a66c2]/10 px-2.5 py-0.5 text-xs font-bold text-[#0a66c2]">
              <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
              </svg>
              LinkedIn Note
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
              Email
            </span>
          )}
          {isLinkedIn ? (
            <Badge tone={charCount <= 300 ? "green" : "amber"}>
              {charCount} / 300 chars
            </Badge>
          ) : (
            <Badge tone={wordCount >= 80 && wordCount <= 140 ? "green" : "default"}>
              {wordCount} words
            </Badge>
          )}
          {citations > 0 ? (
            <Badge tone="blue">{citations} cited source{citations === 1 ? "" : "s"}</Badge>
          ) : (
            <Badge tone="amber">Uncited</Badge>
          )}
          {draft.approvedAt ? <Badge tone="green">Reviewed & approved</Badge> : <Badge tone="amber">Needs review</Badge>}
        </div>
      </div>
      {draft.staleWarning ? (
        <p role="alert" className="rounded-[7px] bg-[var(--badge-amber-bg)] px-3 py-2 text-sm text-[var(--badge-amber-fg)]">
          At least one cited source is stale. Re-check it before using this draft.
        </p>
      ) : null}
      {hypotheses.length ? (
        <p className="text-xs text-[var(--muted)]">
          Contains {hypotheses.length} hypothesis line{hypotheses.length === 1 ? "" : "s"} in metadata — confirm them with the prospect, don&apos;t state them as fact.
        </p>
      ) : null}
      {!isLinkedIn ? (
        <Field label="Subject">
          <input className={inputClass} value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      ) : null}
      <Field label={isLinkedIn ? "LinkedIn Connection Note (max 300 chars)" : "Message"}>
        <textarea
          className={`${inputClass} font-sans leading-relaxed text-[14px]`}
          rows={isLinkedIn ? 5 : 11}
          maxLength={isLinkedIn ? 300 : undefined}
          value={body}
          disabled={!editable}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">
          {isLinkedIn ? (
            <span>Personalized connection request for LinkedIn. Keep under 300 characters to fit LinkedIn&apos;s invitation limit.</span>
          ) : body.includes("{{first_name}}") ? (
            <span>Template placeholder <code className="rounded bg-[var(--chip-bg)] px-1 py-0.5 text-xs text-[var(--foreground)]">&#123;&#123;first_name&#125;&#125;</code> will be preserved and personalized upon export.</span>
          ) : (() => {
            const greetingMatch = body.match(/^Hi\s+([A-Za-z]+),/i);
            const name = greetingMatch ? greetingMatch[1] : null;
            return name ? (
              <span>Personalized directly for <strong>{name}</strong> (sourced decision maker). You can review or edit before approving.</span>
            ) : (
              <span>Personalized email draft. You can review or edit before approving.</span>
            );
          })()}
        </p>
      </Field>
      <FormError message={error} />
      <FormNotice message={notice} />
      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() =>
                act(
                  () => saveDraft(draft.id, { workspaceId, expectedVersion: draft.version, subject, body }),
                  "Saved. Edits need a fresh review before export.",
                )
              }
            >
              Save edits
            </Button>
            {!draft.approvedAt ? (
              <Button
                disabled={busy || dirty}
                onClick={() => act(() => approveDraft(draft.id, workspaceId, draft.version), "Approved for export.")}
              >
                I&apos;ve reviewed it — approve
              </Button>
            ) : null}
            {can("export") ? (
              <>
                <Button
                  variant="ghost"
                  disabled={busy || !draft.approvedAt || dirty}
                  onClick={() =>
                    act(
                      () => downloadFile(`/v1/drafts/${draft.id}/export?workspaceId=${workspaceId}`, `draft-${draft.accountName}.txt`),
                      isLinkedIn
                        ? "Downloaded. Paste it into your LinkedIn connection request — Insyder never sends messages."
                        : "Downloaded. Send it from your own mailbox — Insyder never sends messages.",
                    )
                  }
                  title={isLinkedIn ? "Download approved note as a text file" : "Download approved email as a text file"}
                >
                  <Download size={14} className="mr-1.5" />
                  Export text
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !draft.approvedAt || dirty}
                  onClick={() => void copyText()}
                  title={isLinkedIn ? "Copy approved LinkedIn note to clipboard" : "Copy approved email to clipboard"}
                >
                  <Copy size={14} className="mr-1.5" />
                  Copy text
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                act(
                  () => regenerateDraft(draft.id, workspaceId),
                  "Draft regenerated from latest reviewed evidence.",
                )
              }
              title="Regenerate this draft using the latest reviewed evidence and contact details"
            >
              <RefreshCw size={14} className="mr-1.5" />
              Regenerate
            </Button>
          </div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Are you sure you want to delete this draft?")) {
                void act(() => deleteDraft(draft.id, workspaceId), "Draft deleted.");
              }
            }}
            className="text-[var(--brand-active)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand)]"
            title="Delete this draft"
          >
            <Trash2 size={14} className="mr-1.5" />
            Delete draft
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
