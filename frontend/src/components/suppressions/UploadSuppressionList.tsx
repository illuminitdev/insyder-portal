"use client";

import { useRef, useState } from "react";
import { CheckCircle2, ClipboardPaste, Download, FileText, Upload, UploadCloud } from "lucide-react";
import { bulkCreateSuppressions, type BulkSuppressionResult } from "@/lib/api/suppressions";
import { looksLikeDomainOrEmail, parseSuppressionList, type ParsedSuppressionRow } from "@/lib/utils/suppressionList";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";

const MAX_ROWS = 5000;

/** Upload a CSV/TXT list (or paste one) to suppress many domains and emails at once. */
export function UploadSuppressionList({
  workspaceId,
  reasons,
  onDone,
}: {
  workspaceId: string;
  reasons: string[];
  onDone: () => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<ParsedSuppressionRow[]>([]);
  const [reason, setReason] = useState("do_not_contact");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkSuppressionResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  const load = (text: string) => {
    setResult(null);
    setError(null);
    const parsed = parseSuppressionList(text, reasons);
    if (parsed.length > MAX_ROWS) setError(`This list has ${parsed.length} rows; upload at most ${MAX_ROWS} at a time.`);
    setRows(parsed);
  };

  const valid = rows.filter((r) => looksLikeDomainOrEmail(r.addressOrDomain));
  const invalidCount = rows.length - valid.length;

  const reset = () => {
    setRows([]);
    setPasted("");
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const readFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) {
      setError("Please choose a .csv or .txt file. From Excel, use File → Save As → CSV.");
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setError("File is too large (max 2 MB). Split it into smaller files.");
      return;
    }
    setFileName(f.name);
    setPasted("");
    load(await f.text());
  };

  const downloadTemplate = () => {
    const csv = "domain,reason\nexample.com,competitor\njane@example.org,opt_out\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "suppression-list-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[15px]">Upload a list</h2>
            <p className="text-sm text-[var(--muted)]">Suppress many domains or emails at once.</p>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-active)] hover:underline"
          >
            <Download size={14} aria-hidden /> Download template
          </button>
        </div>

        {/* Drop zone: click or drag a file in */}
        <input
          ref={fileRef}
          id="suppression-upload"
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => void readFile(e.target.files?.[0])}
        />
        <label
          htmlFor="suppression-upload"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void readFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragging || fileName
              ? "border-[var(--brand-active)] bg-[var(--brand-tint)]"
              : "border-[var(--line)] bg-[var(--table-head)] hover:border-[var(--brand-active)] hover:bg-[var(--brand-tint)]"
          }`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-[var(--brand-active)] shadow-sm">
            {fileName ? <FileText size={22} aria-hidden /> : <UploadCloud size={24} aria-hidden />}
          </span>
          {fileName ? (
            <>
              <span className="font-semibold text-[var(--foreground)]">{fileName}</span>
              <span className="text-xs text-[var(--muted)]">Click to choose a different file</span>
            </>
          ) : (
            <>
              <span className="text-sm text-[var(--foreground)]">
                <span className="font-semibold text-[var(--brand-active)]">Click to upload</span> or drag and drop
              </span>
              <span className="text-xs text-[var(--muted)]">
                CSV or TXT · one per line, or a &quot;domain&quot; / &quot;email&quot; column · up to {MAX_ROWS.toLocaleString()} entries
              </span>
            </>
          )}
        </label>

        {showPaste ? (
          <Field label="Paste domains or emails (one per line)">
            <textarea
              className={`${inputClass} min-h-[96px]`}
              rows={4}
              value={pasted}
              placeholder={"acme.com\njane@globex.com"}
              onChange={(e) => {
                setPasted(e.target.value);
                setFileName(null);
                if (fileRef.current) fileRef.current.value = "";
                load(e.target.value);
              }}
            />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            <ClipboardPaste size={14} aria-hidden /> Or paste a list instead
          </button>
        )}

        {rows.length ? (
          <div className="rounded-[10px] border border-[var(--line)] bg-white px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--foreground)]">
              <CheckCircle2 size={16} aria-hidden className="text-green-600" />
              {valid.length} {valid.length === 1 ? "entry" : "entries"} ready
              {invalidCount ? (
                <span className="font-normal text-[var(--muted)]">· {invalidCount} not a domain or email (will be skipped)</span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {valid.slice(0, 10).map((r, i) => (
                <span key={`${r.addressOrDomain}-${i}`} className="rounded-full bg-[var(--table-head)] px-2.5 py-0.5 text-xs text-[var(--foreground)]">
                  {r.addressOrDomain}
                </span>
              ))}
              {valid.length > 10 ? <span className="px-1 text-xs text-[var(--muted)]">+{valid.length - 10} more</span> : null}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Reason">
            <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {humanize(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expires (optional)">
            <input type="date" className={inputClass} value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-[var(--muted)]">A &quot;reason&quot; column in the file overrides this for that row.</p>

        {result ? (
          <p role="status" className="flex items-start gap-2 rounded-[10px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
            <CheckCircle2 size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              Added {result.added}. Skipped {result.duplicates} already on the list
              {result.invalid ? ` and ${result.invalid} invalid (${result.invalidSamples.join(", ")})` : ""}.
            </span>
          </p>
        ) : null}
        <FormError message={error} />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy || !valid.length || rows.length > MAX_ROWS}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await bulkCreateSuppressions(workspaceId, {
                  entries: valid.map((v) => ({ addressOrDomain: v.addressOrDomain, reason: v.reason })),
                  reason,
                  expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null,
                });
                setResult(r);
                reset();
                await onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Upload failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Upload size={14} aria-hidden className="mr-1.5 inline" />
            {busy ? "Uploading…" : valid.length ? `Suppress ${valid.length} ${valid.length === 1 ? "entry" : "entries"}` : "Suppress entries"}
          </Button>
          {rows.length ? (
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Clear
            </Button>
          ) : (
            <span className="text-xs text-[var(--muted)]">Choose a file or paste a list to continue.</span>
          )}
        </div>
      </div>
    </Card>
  );
}
