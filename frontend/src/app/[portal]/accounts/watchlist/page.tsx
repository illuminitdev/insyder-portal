"use client";

import { useCallback, useEffect, useState } from "react";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import { canQueueResearch } from "@/components/accounts/AccountTable";
import { AccountIntelligenceFeed, isTier1 } from "@/components/accounts/AccountIntelligenceFeed";
import { ImportCsvDialog } from "@/components/accounts/ImportCsvDialog";
import { ImportCrmDialog } from "@/components/accounts/ImportCrmDialog";
import { getCrmImportAvailability, startBatchResearch, type CrmImportAvailability } from "@/lib/api/crmImport";
import { Archive, ArchiveRestore, CircleCheck, CirclePlus, Download, FileUp, Radar, Search, X } from "lucide-react";
import { MergeCandidates } from "@/components/accounts/MergeCandidates";
import { RequireCap } from "@/components/common/RequireCap";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePersistentState } from "@/hooks/usePersistentState";
import {
  createAccount,
  downloadFile,
  getPipeline,
  listAccounts,
  listMergeCandidates,
  setAccountArchived,
  type Account,
  type MergeCandidate,
  type PipelineRow,
} from "@/lib/api/accounts";
import { listChangeEvents, type ChangeEvent } from "@/lib/api/monitors";
import { Button } from "@/components/ui/Button";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { MonitorAccountsModal } from "@/components/monitors/MonitorAccountsModal";

function Watchlist({ workspaceId }: { workspaceId: string }) {
  const { can, workspaceName } = useWorkspace();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [merges, setMerges] = useState<MergeCandidate[]>([]);
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [changeEvents, setChangeEvents] = useState<ChangeEvent[]>([]);
  const [researchState, setResearchState] = usePersistentState(`${workspaceId}:accounts:research`, "");
  const [acceptanceState, setAcceptanceState] = usePersistentState(`${workspaceId}:accounts:acceptance`, "");
  const [source, setSource] = usePersistentState(`${workspaceId}:accounts:source`, "");
  // "archived" lists only accounts the team set aside as not relevant
  const [view, setView] = usePersistentState(`${workspaceId}:accounts:view`, "");
  const archivedView = view === "archived";
  const [archiving, setArchiving] = useState(false);
  const [crmImport, setCrmImport] = useState<CrmImportAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
  const [monitorSuccessNote, setMonitorSuccessNote] = useState<string | null>(null);

  // Design View State
  const [tierFilter, setTierFilter] = useState<"all" | "tier1" | "tier2">("all");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);

  // Add target account form state
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountDomain, setNewAccountDomain] = useState("");
  const [newAccountCountry, setNewAccountCountry] = useState("United Kingdom");
  const [addingAccount, setAddingAccount] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);

  const canResearch = can("research");

  const loadCrmImport = useCallback(async () => {
    if (!can("import")) return;
    try {
      setCrmImport(await getCrmImportAvailability(workspaceId));
    } catch {
      setCrmImport(null);
    }
  }, [workspaceId, can]);

  useEffect(() => {
    void loadCrmImport();
  }, [loadCrmImport]);
  const crm = crmImport?.available ? crmImport : null;

  const refresh = useCallback(async () => {
    try {
      const [a, m, pipe, changes] = await Promise.all([
        listAccounts(workspaceId, { researchState, acceptanceState, source, archived: archivedView ? "only" : undefined }),
        can("import") ? listMergeCandidates(workspaceId) : Promise.resolve({ candidates: [] }),
        getPipeline(workspaceId).catch(() => ({ rows: [] })),
        listChangeEvents(workspaceId).catch(() => ({ changeEvents: [] })),
      ]);
      setAccounts(a.accounts);
      const ok = new Set(a.accounts.filter(canQueueResearch).map((x) => x.id));
      setSelected((cur) => cur.filter((id) => ok.has(id)));
      setMerges(m.candidates);
      setPipelineRows(pipe.rows);
      setChangeEvents(changes.changeEvents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load accounts");
    }
  }, [workspaceId, researchState, acceptanceState, source, archivedView, can]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const UNITS_PER_ACCOUNT = 3;
  const BATCH_MAX = 50;
  const unitsNeeded = selected.length * UNITS_PER_ACCOUNT;
  const unitsLeft = crm ? Math.max(0, crm.usage.quotaMonthly - crm.usage.usedMonthly) : null;
  const tooMany = selected.length > BATCH_MAX;
  const notEnough = unitsLeft != null && unitsNeeded > unitsLeft;

  async function researchSelected() {
    setResearching(true);
    setError(null);
    setResearchNote(null);
    try {
      const r = await startBatchResearch(workspaceId, selected, UNITS_PER_ACCOUNT);
      setResearchNote(
        `Researching ${r.queued.length} ${r.queued.length === 1 ? "account" : "accounts"} (${r.unitsReserved} units).` +
          (r.skipped.length ? ` ${r.skipped.length} skipped (${[...new Set(r.skipped.map((s) => s.reason.toLowerCase()))].join(", ")}).` : "") +
          " Results appear on each account as they finish.",
      );
      setSelected([]);
      await Promise.all([refresh(), loadCrmImport()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start research");
    } finally {
      setResearching(false);
    }
  }

  /** Archive the selected accounts (or restore them in the archived view) */
  async function archiveSelected(archived: boolean) {
    setArchiving(true);
    setError(null);
    setResearchNote(null);
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => setAccountArchived(id, workspaceId, archived)));
    const done = results.filter((r) => r.status === "fulfilled").length;
    const failed = ids.length - done;
    const noun = (n: number) => (n === 1 ? "account" : "accounts");
    setResearchNote(
      archived
        ? `Archived ${done} ${noun(done)}. They are hidden from this list and research won't add them again. Find them under Show → Archived.`
        : `Restored ${done} ${noun(done)} to your accounts.`,
    );
    if (failed) setError(`${failed} ${noun(failed)} could not be ${archived ? "archived" : "restored"}.`);
    setSelected([]);
    await refresh();
    setArchiving(false);
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!newAccountName.trim()) return;
    setAddingAccount(true);
    setAddAccountError(null);
    try {
      await createAccount(workspaceId, {
        name: newAccountName.trim(),
        domain: newAccountDomain.trim() || undefined,
        country: newAccountCountry.trim() || undefined,
      });
      setNewAccountName("");
      setNewAccountDomain("");
      setAddModalOpen(false);
      await refresh();
    } catch (err) {
      setAddAccountError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setAddingAccount(false);
    }
  }

  const filtersActive = [researchState, acceptanceState, source, view].filter(Boolean).length;
  const filters = (
    <div
      className={`grid gap-3 ${crm || source ? "max-w-4xl sm:grid-cols-4" : "max-w-3xl sm:grid-cols-3"}`}
      role="group"
      aria-label="Account filters"
    >
      <Field label="Show">
        <select
          className="w-full rounded-[12px] border border-[var(--card-line)] bg-white px-3 py-2.5 text-[14.5px] font-medium text-[var(--foreground)] focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-tint)]"
          value={view}
          onChange={(e) => {
            setView(e.target.value);
            setSelected([]);
          }}
        >
          <option value="">Active accounts</option>
          <option value="archived">Archived</option>
        </select>
      </Field>
      <Field label="Research">
        <select
          className="w-full rounded-[12px] border border-[var(--card-line)] bg-white px-3 py-2.5 text-[14.5px] font-medium text-[var(--foreground)] focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-tint)]"
          value={researchState}
          onChange={(e) => setResearchState(e.target.value)}
        >
          <option value="">All</option>
          <option value="unresearched">Unresearched</option>
          <option value="researching">Researching</option>
          <option value="researched">Researched</option>
          <option value="failed">Failed</option>
        </select>
      </Field>
      <Field label="Acceptance">
        <select
          className="w-full rounded-[12px] border border-[var(--card-line)] bg-white px-3 py-2.5 text-[14.5px] font-medium text-[var(--foreground)] focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-tint)]"
          value={acceptanceState}
          onChange={(e) => setAcceptanceState(e.target.value)}
        >
          <option value="">All</option>
          <option value="draft">Draft</option>
          <option value="ready_for_review">Ready for review</option>
          <option value="accepted">Accepted</option>
          <option value="needs_research">Needs research</option>
          <option value="rejected">Rejected</option>
        </select>
      </Field>
      {crm || source ? (
        <Field label="Source">
          <select
            className="w-full rounded-[12px] border border-[var(--card-line)] bg-white px-3 py-2.5 text-[14.5px] font-medium text-[var(--foreground)] focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-tint)]"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">All</option>
            <option value="crm_import">From {crm?.providerLabel ?? "CRM"}</option>
            <option value="import">CSV import</option>
            <option value="discovery">Discover</option>
            <option value="manual">Added by hand</option>
          </select>
        </Field>
      ) : null}
    </div>
  );

  // Filter accounts by tier pills if selected
  const displayedAccounts = (accounts ?? []).filter((a) => {
    if (tierFilter === "tier1") return isTier1(a);
    if (tierFilter === "tier2") return !isTier1(a);
    return true;
  });

  return (
    <div className="space-y-6 min-w-0 w-full max-w-full">
      {/* Page header */}
      <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <span className="inline-flex rounded-full bg-[var(--lilac)] px-3.5 py-1 text-[12.5px] font-bold uppercase tracking-[0.12em] text-[var(--brand-active)]">
            Active intelligence feed
          </span>
          <h1 className="mt-3 text-[34px] font-bold leading-tight tracking-[-0.03em] sm:text-[40px]">Account Intelligence</h1>
          <p className="mt-2 text-[16.5px] leading-relaxed text-[var(--plum)]">
            Your target accounts, their research status, buying signals and deals, in one place.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 xl:items-end">
          <div className="flex flex-wrap items-center gap-3">
            {can("import") || can("export") ? (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={importMenuOpen}
                  onClick={() => setImportMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-2.5 rounded-[14px] bg-white px-4 py-2.5 text-[15.5px] font-medium text-[var(--foreground)] shadow-[0_4px_14px_rgba(13,27,42,0.1)] transition hover:text-[var(--brand-active)]"
                >
                  <FileUp size={18} className="text-[var(--brand-active)]" aria-hidden />
                  Import accounts
                </button>

                {importMenuOpen ? (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setImportMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-30 mt-2 w-52 rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_16px_40px_rgba(13,27,42,0.14)]">
                      {can("import") && crm ? (
                        <ImportCrmDialog
                          workspaceId={workspaceId}
                          crm={crm}
                          onDone={() => {
                            setImportMenuOpen(false);
                            void refresh();
                          }}
                          onViewImported={() => {
                            setImportMenuOpen(false);
                            setResearchState("");
                            setAcceptanceState("");
                            setSource("crm_import");
                          }}
                        />
                      ) : null}
                      {can("import") ? (
                        <ImportCsvDialog
                          workspaceId={workspaceId}
                          onDone={() => {
                            setImportMenuOpen(false);
                            void refresh();
                          }}
                        />
                      ) : null}
                      {can("export") ? (
                        <button
                          type="button"
                          onClick={() => {
                            setImportMenuOpen(false);
                            void downloadFile(`/v1/workspaces/${workspaceId}/accounts/export`, "accounts.csv").catch((e) =>
                              setError(e instanceof Error ? e.message : "Export failed"),
                            );
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-[var(--plum)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]"
                        >
                          <Download size={15} aria-hidden />
                          Export CSV
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {/* Tier filter */}
            <div role="group" aria-label="Tier" className="flex items-center rounded-[14px] bg-[var(--lilac)] p-1">
              {(
                [
                  ["all", "All tiers"],
                  ["tier1", "Tier 1 only"],
                  ["tier2", "Tier 2"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tierFilter === key}
                  onClick={() => setTierFilter(key)}
                  className={`rounded-[10px] px-3.5 py-1.5 text-[15px] font-medium transition ${
                    tierFilter === key
                      ? "bg-[var(--brand)] font-semibold text-white"
                      : "text-[var(--plum)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {can("import") ? (
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--brand)] to-[#0E6B67] px-4 py-2 text-[14px] font-semibold text-white transition hover:brightness-110 active:scale-[0.99]"
              >
                <CirclePlus size={16} aria-hidden />
                Add target account
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {can("import") ? <MergeCandidates workspaceId={workspaceId} candidates={merges} onResolved={refresh} /> : null}

      {monitorSuccessNote ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-100 p-3.5 text-xs text-emerald-800 shadow-2xs">
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
          <p className="min-w-0 flex-1 font-medium">
            {monitorSuccessNote}{" "}
            <Link href="/accounts/monitors" className="font-semibold text-emerald-700 underline hover:text-emerald-900">
              View in Signal monitors →
            </Link>
          </p>
          <button type="button" onClick={() => setMonitorSuccessNote(null)} className="shrink-0 rounded p-0.5 hover:bg-white/60" aria-label="Dismiss">
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}

      {researchNote ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-emerald-50 border border-emerald-100 p-3.5 text-xs text-emerald-800 shadow-2xs">
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
          <p className="min-w-0 flex-1 font-medium">{researchNote}</p>
          <button type="button" onClick={() => setResearchNote(null)} className="shrink-0 rounded p-0.5 hover:bg-white/60" aria-label="Dismiss">
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}

      {archivedView ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--card-line)] bg-white p-3.5 text-sm text-[var(--plum)]">
          <span className="inline-flex items-center gap-2">
            <Archive size={16} className="text-[var(--brand-active)]" aria-hidden />
            Showing archived accounts. Research doesn&apos;t add results to them. Select some and restore them to bring them back.
          </span>
          <Button onClick={() => setView("")}>Back to active accounts</Button>
        </div>
      ) : null}

      <FormError message={error} />
      {accounts === null && !error ? <LoadingState label="Loading intelligence feed…" /> : null}

      {/* Main View: Account Intelligence Feed */}
      {accounts !== null ? (
        <AccountIntelligenceFeed
          accounts={displayedAccounts}
          selection={canResearch ? { selected, onChange: setSelected } : undefined}
          pipelineRows={pipelineRows}
          changeEvents={changeEvents}
          crmName={crm?.providerLabel}
          crmConnected={Boolean(crm)}
          canSendToCrm={can("manage_integrations")}
          workspaceName={workspaceName ?? "Workspace"}
          filters={filters}
          filtersActive={filtersActive}
        />
      ) : null}

      {/* Batch selection bar: sticks to the bottom of the screen so it never covers the page top */}
      {canResearch && selected.length ? (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl border border-brand-200 bg-white px-4 py-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.18)]">
          <p className="text-xs sm:text-sm text-slate-800">
            <strong className="text-[var(--brand)] font-bold text-sm sm:text-base">{selected.length}</strong> {selected.length === 1 ? "account" : "accounts"} selected
            {archivedView ? null : (
              <>
                {" · "}
                <span className="font-semibold text-slate-700">{unitsNeeded} research units</span>
                {unitsLeft != null ? <span className="text-slate-400"> · {unitsLeft} units left this month</span> : null}
                {tooMany ? <span className="block text-xs text-[var(--brand)] font-medium">At most {BATCH_MAX} at a time.</span> : null}
                {notEnough && !tooMany ? <span className="block text-xs text-[var(--brand)] font-medium">Not enough units left. Pick fewer accounts.</span> : null}
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button onClick={() => setSelected([])} disabled={researching || archiving}>
              <span className="inline-flex items-center gap-1.5">
                <X size={14} aria-hidden />
                Clear
              </span>
            </Button>
            {archivedView ? (
              can("import") ? (
                <Button variant="primary" onClick={() => void archiveSelected(false)} disabled={archiving}>
                  <span className="inline-flex items-center gap-1.5">
                    <ArchiveRestore size={14} aria-hidden />
                    {archiving ? "Restoring…" : `Restore ${selected.length} selected`}
                  </span>
                </Button>
              ) : null
            ) : (
              <>
                {can("import") ? (
                  <Button
                    onClick={() => void archiveSelected(true)}
                    disabled={researching || archiving}
                    title="Hide accounts that aren't relevant. You can restore them later."
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Archive size={14} aria-hidden />
                      {archiving ? "Archiving…" : "Archive"}
                    </span>
                  </Button>
                ) : null}
                <Button variant="primary" onClick={() => setMonitorModalOpen(true)} disabled={researching || archiving}>
                  <span className="inline-flex items-center gap-1.5">
                    <Radar size={14} aria-hidden />
                    Monitor accounts
                  </span>
                </Button>
                <Button onClick={() => void researchSelected()} disabled={researching || archiving || tooMany || notEnough}>
                  <span className="inline-flex items-center gap-1.5">
                    <Search size={14} aria-hidden />
                    {researching ? "Starting…" : `Research ${selected.length} selected`}
                  </span>
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {error && !accounts ? <ErrorState message={error} /> : null}

      {/* Add Target Account Modal */}
      {addModalOpen ? (
        <Modal
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title="Add Target Account"
          description="Add a new company to your target account directory to track buying signals."
        >
          <form onSubmit={handleAddAccount} className="space-y-4">
            <Field label="Company Name" required>
              <input
                type="text"
                required
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g. Hyperion Analytics"
                className={inputClass}
              />
            </Field>

            <Field label="Website Domain (optional)">
              <input
                type="text"
                value={newAccountDomain}
                onChange={(e) => setNewAccountDomain(e.target.value)}
                placeholder="e.g. hyperionanalytics.co.uk"
                className={inputClass}
              />
            </Field>

            <Field label="Country">
              <input
                type="text"
                value={newAccountCountry}
                onChange={(e) => setNewAccountCountry(e.target.value)}
                placeholder="e.g. United Kingdom"
                className={inputClass}
              />
            </Field>

            <FormError message={addAccountError} />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" onClick={() => setAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={addingAccount || !newAccountName.trim()}>
                {addingAccount ? "Adding…" : "Add Account"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* Monitor Accounts Modal */}
      <MonitorAccountsModal
        open={monitorModalOpen}
        onClose={() => setMonitorModalOpen(false)}
        workspaceId={workspaceId}
        accounts={(accounts ?? []).filter((a) => selected.includes(a.id))}
        onSuccess={(mon, count) => {
          setMonitorSuccessNote(
            `Started monitoring ${count} ${count === 1 ? "account" : "accounts"} ("${mon.name}"). Automated checks will detect signals on schedule.`,
          );
          setSelected([]);
        }}
      />
    </div>
  );
}

export default function WatchlistPage() {
  return <RequireCap cap="view_accounts">{(workspaceId) => <Watchlist workspaceId={workspaceId} />}</RequireCap>;
}