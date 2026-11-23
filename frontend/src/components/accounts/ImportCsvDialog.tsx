"use client";

import { useEffect, useRef, useState } from "react";
import {
  downloadFile,
  getImport,
  listImports,
  previewImport,
  startImport,
  type ImportPreview,
} from "../../lib/api/accounts";
import { readFileAsText } from "../../lib/utils/csv";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Upload } from "lucide-react";
import { Field, FormError, inputClass } from "../ui/Field";

const MAX_BYTES = 2_000_000;
const FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "name", label: "Company name", required: true },
  { key: "domain", label: "Domain / website" },
  { key: "country", label: "Country" },
  { key: "legal_name", label: "Legal name" },
];

type Result = {
  id: string;
  status: string;
  totalRows: number;
  successRows: number;
  rowErrors: string[];
  createdAt?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Upload CSV" button: picks a file, then a dialog for column mapping, the queued import job
 * and its row report (R2).
 */
export function ImportCsvDialog({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // After a refresh: show the last import report, or keep following one still in progress
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { imports } = await listImports(workspaceId);
        // CRM imports have their own dialog and progress
        const last = imports.find((j) => !j.source || j.source === "csv");
        if (!last || cancelled) return;
        if (last.status === "completed" || last.status === "failed") return;
        setStatus("An import is still processing…");
        for (let i = 0; i < 120 && !cancelled; i++) {
          await sleep(1500);
          const { import: job } = await getImport(last.id, workspaceId);
          if (job.status === "completed" || job.status === "failed") {
            if (cancelled) return;
            setStatus(null);
            onDone();
            return;
          }
        }
      } catch {
        // no import history to show
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per workspace
  }, [workspaceId]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setOpen(true);
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setError("Please choose a .csv file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 2 MB. Split it into smaller files.");
      return;
    }
    setBusy(true);
    try {
      const text = await readFileAsText(file);
      const p = await previewImport(workspaceId, text);
      setCsvText(text);
      setFileName(file.name);
      setPreview(p);
      setMapping(
        Object.fromEntries(Object.entries(p.suggestedMapping).filter(([, v]) => v)) as Record<string, string>,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCsvText(null);
    setPreview(null);
    setMapping({});
    setFileName("");
  }

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
    setResult(null);
    reset();
  };
  const choose = () => fileInput.current?.click();
  const importing = Boolean(status);

  async function runImport() {
    if (!csvText || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const { importJobId } = await startImport(workspaceId, csvText, mapping);
      reset();
      setStatus(`Importing ${preview.rowCount} rows…`);
      for (let i = 0; i < 120; i++) {
        await sleep(1500);
        const { import: job } = await getImport(importJobId, workspaceId);
        if (job.status === "completed" || job.status === "failed") {
          setResult(job);
          setStatus(null);
          onDone();
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handleFile(file);
        }}
      />
      <Button variant="primary" disabled={busy || importing} onClick={choose}>
        <Upload size={15} className="mr-1.5" aria-hidden />
        {importing ? "Importing…" : busy && !open ? "Reading file…" : "Upload CSV"}
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={result ? "Import finished" : importing ? "Importing accounts" : "Import accounts from CSV"}
        description={
          result || importing
            ? undefined
            : "UTF-8 CSV, up to 2 MB and 5,000 rows. Imported accounts start unresearched; possible duplicates go to merge review instead of being merged automatically."
        }
        footer={
          result || (!preview && !importing) ? (
            <>
              <Button variant="ghost" onClick={choose} disabled={busy}>
                Upload another file
              </Button>
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </>
          ) : preview ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={choose}>
                Choose another file
              </Button>
              <Button variant="primary" disabled={busy || !mapping.name || preview.rowCount > preview.maxRows} onClick={() => void runImport()}>
                Import {preview.rowCount} rows
              </Button>
            </>
          ) : null
        }
      >
        {preview ? (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-semibold">{fileName}</span> · {preview.rowCount} rows · columns: {preview.headers.join(", ")}
            </p>
            {preview.rowCount > preview.maxRows ? (
              <FormError message={`This file has more than ${preview.maxRows} rows. Split it before importing.`} />
            ) : null}
            {preview.errors.length ? (
              <div className="rounded-[7px] bg-[var(--badge-amber-bg)] p-3 text-xs text-[var(--badge-amber-fg)]">
                <p className="font-semibold">Rows that can&apos;t be read ({preview.errors.length}):</p>
                <ul className="mt-1 list-disc pl-5">
                  {preview.errors.slice(0, 5).map((er) => (
                    <li key={er}>{er}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[13px] font-semibold">Match your columns</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " (required)" : ""}`}>
                  <select
                    className={inputClass}
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  >
                    <option value="">Not in this file</option>
                    {preview.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </div>
        ) : null}

        {busy && !preview && !importing ? (
          <p className="text-sm text-[var(--muted)]" role="status">
            Reading file…
          </p>
        ) : null}
        {importing ? (
          <p className="text-sm" role="status">
            {status} You can close this; the import keeps running.
          </p>
        ) : null}
        <FormError message={error} />

        {result ? (
          <div className="text-sm" role="status">
            <p className="font-semibold">
              {result.status === "completed" ? "Completed" : "Failed"}: {result.successRows} of {result.totalRows} rows imported
            </p>
            {result.rowErrors.length ? (
              <>
                <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-xs text-[var(--muted)]">
                  {result.rowErrors.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <Button
                  variant="quiet"
                  className="mt-1 !px-0"
                  onClick={() =>
                    void downloadFile(`/v1/imports/${result.id}/errors.csv?workspaceId=${workspaceId}`, "import-report.csv")
                  }
                >
                  Download row report
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
