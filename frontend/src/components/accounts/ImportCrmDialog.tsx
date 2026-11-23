"use client";

import { useMemo, useState } from "react";
import { CheckSquare, CircleCheck, Download, Eye, Search, Square } from "lucide-react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { FormError } from "../ui/Field";
import { CrmLogo } from "../settings/CrmLogos";
import { downloadFile, listAccounts, type Account } from "../../lib/api/accounts";
import {
  getCrmImportJob,
  previewCrmImport,
  startBatchResearch,
  startCrmImport,
  type CrmImportAvailability,
  type CrmImportJob,
  type CrmImportOptions,
  type CrmImportPreview,
} from "../../lib/api/crmImport";

type Available = Extract<CrmImportAvailability, { available: true }>;
type Step = "choose" | "preview" | "importing" | "done";

const STEP_INDEX: Record<Step, number> = { choose: 1, preview: 2, importing: 3, done: 4 };
/** Units one account research run reserves (same as "Run research" on an account). */
const UNITS_PER_ACCOUNT = 3;
/** The batch research endpoint takes at most this many accounts per click. */
const BATCH_MAX = 50;

const OUTCOME_LABEL: Record<string, string> = {
  new: "New",
  linked: "Already in Insyder",
  already_imported: "Imported before",
  customer: "Customer → suppression",
  suppressed: "Suppressed",
  no_domain: "No website",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (v: number) => v.toLocaleString();

function Count({ label, value, hint, tone = "default" }: { label: string; value: number; hint: string; tone?: "default" | "green" | "amber" }) {
  const color = tone === "green" ? "text-[var(--badge-green-fg)]" : tone === "amber" ? "text-[var(--badge-amber-fg)]" : "text-[var(--foreground)]";
  return (
    <div className="rounded-[10px] border border-[var(--line)] p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{n(value)}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>
    </div>
  );
}

/**
 * "Import from HubSpot": only rendered once a CRM is connected (the watchlist decides). Four steps:
 * choose stages → preview → import in the background → done, with an optional research check.
 */
export function ImportCrmDialog({
  workspaceId,
  crm,
  onDone,
  onViewImported,
}: {
  workspaceId: string;
  crm: Available;
  onDone: () => void;
  /** Show the imported accounts in the watchlist (sets the Source filter) */
  onViewImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [stages, setStages] = useState<string[]>(() => crm.stages.filter((s) => s.default).map((s) => s.key));
  const [includeContacts, setIncludeContacts] = useState(true);
  const [preview, setPreview] = useState<CrmImportPreview | null>(null);
  const [job, setJob] = useState<CrmImportJob | null>(null);
  const [toResearch, setToResearch] = useState<Account[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [researched, setResearched] = useState<{ queued: number; skipped: number; units: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = crm.providerLabel;
  const options: CrmImportOptions = useMemo(() => ({ stages, includeContacts }), [stages, includeContacts]);
  const unitsLeft = Math.max(0, crm.usage.quotaMonthly - crm.usage.usedMonthly - (researched?.units ?? 0));

  function reset() {
    setStep("choose");
    setPreview(null);
    setJob(null);
    setToResearch(null);
    setPicked([]);
    setResearched(null);
    setError(null);
  }

  const close = () => {
    if (busy) return;
    setOpen(false);
    // Keep following an import that's still running in the background
    if (step !== "importing") reset();
  };

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewCrmImport(workspaceId, options));
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read companies from the CRM");
    } finally {
      setBusy(false);
    }
  }

  async function follow(importJobId: string) {
    for (let i = 0; i < 2400; i++) {
      const { import: j } = await getCrmImportJob(importJobId, workspaceId);
      setJob(j);
      if (j.status === "completed" || j.status === "failed") {
        onDone();
        if (j.status === "completed") {
          const { accounts } = await listAccounts(workspaceId, { source: "crm_import", researchState: "unresearched" });
          setToResearch(accounts);
          setPicked(accounts.slice(0, Math.min(BATCH_MAX, Math.floor(unitsLeft / UNITS_PER_ACCOUNT))).map((a) => a.id));
        }
        setStep("done");
        return;
      }
      await sleep(1500);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const { importJobId } = await startCrmImport(workspaceId, options);
      setStep("importing");
      setBusy(false);
      await follow(importJobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  }

  async function research() {
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await startBatchResearch(workspaceId, picked, UNITS_PER_ACCOUNT);
      setResearched({ queued: r.queued.length, skipped: r.skipped.length, units: r.unitsReserved });
      setToResearch((rows) => rows?.filter((a) => !r.queued.some((q) => q.accountId === a.id)) ?? null);
      setPicked([]);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start research");
    } finally {
      setBusy(false);
    }
  }

  const counts = preview?.counts;
  const summary = job?.summary;
  const pickable = toResearch ?? [];
  const maxPick = Math.min(BATCH_MAX, Math.floor(unitsLeft / UNITS_PER_ACCOUNT));
  const allPicked = pickable.length > 0 && pickable.slice(0, maxPick).every((a) => picked.includes(a.id)) && picked.length >= Math.min(pickable.length, maxPick);
  const unitsNeeded = picked.length * UNITS_PER_ACCOUNT;

  const title =
    step === "choose"
      ? `Bring in your ${label} companies`
      : step === "preview"
        ? "Here's what will happen"
        : step === "importing"
          ? `Importing from ${label}`
          : job?.status === "failed"
            ? "The import stopped"
            : summary?.added
              ? `${n(summary.added)} new ${summary.added === 1 ? "company is" : "companies are"} in your watchlist`
              : `No new companies to add`;

  const footer =
    step === "choose" ? (
      <>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={busy || !stages.length} onClick={() => void runPreview()}>
          {busy ? "Checking…" : "Next: preview"}
        </Button>
      </>
    ) : step === "preview" ? (
      <>
        <Button onClick={() => setStep("choose")} disabled={busy}>
          Back
        </Button>
        <Button variant="primary" disabled={busy || !preview?.total} onClick={() => void runImport()}>
          {busy ? "Starting…" : `Import ${n(preview?.willImport ?? 0)} companies`}
        </Button>
      </>
    ) : step === "importing" ? (
      <Button onClick={close}>Close (keeps running)</Button>
    ) : (
      <>
        <Button onClick={close} disabled={busy}>
          Close
        </Button>
        {crm.canResearch && pickable.length ? (
          <Button variant="primary" disabled={busy || !picked.length || unitsNeeded > unitsLeft} onClick={() => void research()}>
            <span className="inline-flex items-center gap-1.5">
              <Search size={15} aria-hidden />
              {busy ? "Starting…" : `Research ${picked.length} (${unitsNeeded} units)`}
            </span>
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <CrmLogo provider={crm.provider} size={14} tile={20} />
          {step === "importing" ? `Importing from ${label}…` : `Import from ${label}`}
        </span>
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="lg"
        icon={<CrmLogo provider={crm.provider} size={22} tile={38} />}
        title={title}
        description={<span className="text-xs font-semibold uppercase tracking-wide">Step {STEP_INDEX[step]} of 4</span>}
        footer={footer}
      >
        {step === "choose" ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              {crm.companyCount != null ? (
                <>
                  You have <strong className="text-[var(--foreground)]">{n(crm.companyCount)}</strong> companies in {label}
                  {crm.accountLabel ? ` (${crm.accountLabel})` : ""}.{" "}
                </>
              ) : null}
              Pick which ones to bring in. Insyder only reads from {label}; nothing there is changed.
            </p>
            <fieldset>
              <legend className="text-[13px] font-semibold">Lifecycle stage</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {crm.stages.map((s) => {
                  const on = stages.includes(s.key);
                  return (
                    <label
                      key={s.key}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-[8px] border px-3 py-2 text-sm ${
                        on ? "border-[var(--brand)] bg-[var(--brand-tint)]" : "border-[var(--line)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setStages((cur) => (on ? cur.filter((k) => k !== s.key) : [...cur, s.key]))}
                        className="accent-[var(--brand)]"
                      />
                      {s.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={includeContacts}
                onChange={(e) => setIncludeContacts(e.target.checked)}
                className="mt-0.5 accent-[var(--brand)]"
              />
              <span>
                Also import contacts at these companies
                <span className="block text-xs text-[var(--muted)]">Name, job title, email and phone. Never notes or emails.</span>
              </span>
            </label>
            <p className="rounded-[8px] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--muted)]">
              Customers are added to suppression, so nobody researches or contacts them. Companies without a website are
              skipped, because they can&apos;t be researched.
            </p>
          </div>
        ) : null}

        {step === "preview" && preview && counts ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              <strong className="text-[var(--foreground)]">{n(preview.total)}</strong> companies match.
              {preview.estimate ? ` Counts below are estimated from the first ${n(preview.sampled)}.` : ""}
              {preview.total > preview.max ? ` Only the first ${n(preview.max)} are imported per run; run it again for the rest.` : ""}
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              <Count label="New accounts" value={counts.added} hint="Not in Insyder yet" tone="green" />
              <Count label="Already in Insyder" value={counts.linked + counts.alreadyImported} hint="Linked, not duplicated" />
              <Count label="No website" value={counts.noDomain} hint="Skipped" tone="amber" />
              <Count label="Suppressed" value={counts.customers + counts.suppressed} hint="Customers or excluded" />
            </div>
            {counts.mergeReview ? (
              <p className="text-xs text-[var(--muted)]">
                {n(counts.mergeReview)} have the same name as an existing account with a different website. They&apos;ll be
                imported and shown in merge review, never merged automatically.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-[10px] border border-[var(--line)]">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-[var(--table-head)] text-left text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Website</th>
                    <th className="px-3 py-2 font-medium">Country</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">What happens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {preview.sample.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium">{c.name || "—"}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{c.domain ?? "—"}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{c.country ?? "—"}</td>
                      <td className="px-3 py-2 text-[var(--muted)]">{c.lifecycleStage ?? "—"}</td>
                      <td className="px-3 py-2">{OUTCOME_LABEL[c.outcome] ?? c.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.total > preview.sample.length ? (
              <p className="text-xs text-[var(--muted)]">Showing the first {preview.sample.length}.</p>
            ) : null}
          </div>
        ) : null}

        {step === "importing" ? (
          <div className="space-y-3" role="status">
            <p className="text-sm">
              Read {n(job?.totalRows ?? 0)}
              {preview ? ` of ${n(preview.willImport)}` : ""} companies…
            </p>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--chip-bg)]">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-all"
                style={{
                  width: `${preview?.willImport ? Math.min(100, ((job?.totalRows ?? 0) / preview.willImport) * 100) : 5}%`,
                }}
              />
            </div>
            <p className="text-xs text-[var(--muted)]">You can close this. The import keeps running and the watchlist updates when it&apos;s done.</p>
          </div>
        ) : null}

        {step === "done" && job ? (
          <div className="space-y-4">
            {job.status === "failed" ? (
              <FormError message={job.rowErrors[0] ?? "The import failed"} />
            ) : (
              <>
                <div className="flex items-start gap-2.5 rounded-[10px] bg-[var(--badge-green-bg)] px-3 py-2.5 text-sm text-[var(--badge-green-fg)]">
                  <CircleCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {n(summary?.added ?? 0)} added · {n((summary?.linked ?? 0) + (summary?.alreadyImported ?? 0))} linked ·{" "}
                    {n(summary?.noDomain ?? 0)} skipped · {n((summary?.customers ?? 0) + (summary?.suppressed ?? 0))} suppressed
                    {includeContacts ? ` · ${n(summary?.contacts ?? 0)} contacts` : ""}
                  </span>
                </div>
                {!summary?.added && (summary?.linked || summary?.alreadyImported) ? (
                  <p className="text-sm text-[var(--muted)]">
                    Every company {label} returned is already in Insyder, so nothing was duplicated. Linked companies keep
                    their original source (for example Discover), so they don&apos;t show under &quot;From {label}&quot;.
                    Only companies the import creates do.
                  </p>
                ) : null}
                {summary?.added ? (
                  <Button
                    className="border-[var(--brand)]! text-[var(--brand-active)]! hover:bg-[var(--brand-tint)]!"
                    disabled={busy}
                    onClick={() => {
                      onViewImported();
                      close();
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Eye size={15} aria-hidden />
                      View the {n(summary.added)} imported {summary.added === 1 ? "account" : "accounts"}
                    </span>
                  </Button>
                ) : null}
                {job.rowErrors.length ? (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void downloadFile(`/v1/imports/${job.id}/errors.csv?workspaceId=${workspaceId}`, `${crm.provider}-import-skipped.csv`).catch(
                        (e) => setError(e instanceof Error ? e.message : "Download failed"),
                      )
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Download size={15} aria-hidden />
                      Download the skipped list ({n(job.rowErrors.length)})
                    </span>
                  </Button>
                ) : null}
              </>
            )}

            {researched ? (
              <p className="rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-sm" role="status">
                Researching {researched.queued} {researched.queued === 1 ? "company" : "companies"} ({researched.units} units).
                {researched.skipped ? ` ${researched.skipped} skipped.` : ""} Results appear on each account as they finish.
              </p>
            ) : null}

            {job.status === "completed" && crm.canResearch && pickable.length ? (
              <section className="rounded-[12px] border border-[var(--line)] p-4">
                <h3 className="text-[15px] font-semibold">Check which ones are worth pursuing?</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Insyder researches each company on the web: is it still active, are its details right, and is there a
                  buying signal now. Each one uses {UNITS_PER_ACCOUNT} research units; you have{" "}
                  <strong className="text-[var(--foreground)]">{n(unitsLeft)}</strong> left this month. Up to {BATCH_MAX} at a time.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-[var(--muted)]">
                    {picked.length} of {n(pickable.length)} picked
                  </span>
                  <Button
                    className="border-[var(--brand)]! text-[var(--brand-active)]! hover:bg-[var(--brand-tint)]!"
                    disabled={!maxPick}
                    onClick={() => setPicked(allPicked ? [] : pickable.slice(0, maxPick).map((a) => a.id))}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {allPicked ? <Square size={15} aria-hidden /> : <CheckSquare size={15} aria-hidden />}
                      {allPicked ? "Unselect all" : `Select ${Math.min(maxPick, pickable.length)}`}
                    </span>
                  </Button>
                </div>
                <ul className="mt-3 max-h-64 divide-y divide-[var(--line)] overflow-y-auto rounded-[10px] border border-[var(--line)]">
                  {pickable.map((a) => {
                    const on = picked.includes(a.id);
                    const full = !on && picked.length >= maxPick;
                    return (
                      <li key={a.id}>
                        <label className={`flex items-center gap-3 px-3 py-2 text-sm ${full ? "opacity-50" : "cursor-pointer"}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={full}
                            onChange={() => setPicked((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                            className="accent-[var(--brand)]"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{a.domain}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {unitsNeeded > unitsLeft ? (
                  <p className="mt-2 text-xs text-[var(--brand-active)]">Not enough units left this month. Pick fewer companies.</p>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3">
          <FormError message={error} />
        </div>
      </Modal>
    </>
  );
}
