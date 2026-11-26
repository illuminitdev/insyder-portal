"use client";

import { useEffect, useState } from "react";
import { Building2, Check, Globe, MapPin, Search, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";
import { listPlaybooks, type PlaybookView } from "@/lib/api/playbooks";
import { createMonitorFromAccounts, type Monitor } from "@/lib/api/monitors";
import { listAccounts, type Account } from "@/lib/api/accounts";
import { usePlan } from "@/hooks/usePlan";
import { CADENCE_TEXT } from "@/lib/api/billing";

export interface MonitorAccountItem {
  id: string;
  name: string;
  domain?: string | null;
  country?: string | null;
}

interface MonitorAccountsModalProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  accounts: MonitorAccountItem[];
  onSuccess: (monitor: Monitor, accountCount: number) => void;
}

export function MonitorAccountsModal({
  open,
  onClose,
  workspaceId,
  accounts: initialAccounts,
  onSuccess,
}: MonitorAccountsModalProps) {
  const [targetAccounts, setTargetAccounts] = useState<MonitorAccountItem[]>(initialAccounts);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [playbooks, setPlaybooks] = useState<PlaybookView[]>([]);
  const [activeTemplateKey, setActiveTemplateKey] = useState<string>("infrastructure");
  const { cadenceOptions, defaultCadence } = usePlan(workspaceId);
  const [selectedCadence, setSelectedCadence] = useState<number>(168);
  // Once the plan loads, start on a frequency it includes
  useEffect(() => {
    if (!cadenceOptions.find((c) => c.hours === selectedCadence)?.allowed) setSelectedCadence(defaultCadence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCadence]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync target accounts when modal opens with new accounts
  useEffect(() => {
    if (open) {
      setTargetAccounts(initialAccounts);
      setError(null);
      setShowAddAccount(initialAccounts.length === 0);
      setSearchQuery("");
    }
  }, [open, initialAccounts]);

  // Load playbooks and workspace accounts when open
  useEffect(() => {
    if (!open) return;
    let active = true;

    Promise.all([
      listPlaybooks(workspaceId).catch(() => ({ playbooks: [], activeTemplateKey: "infrastructure" })),
      listAccounts(workspaceId).catch(() => ({ accounts: [] })),
    ]).then(([pbRes, accRes]) => {
      if (!active) return;
      const activePbs = pbRes.playbooks.filter((p) => !p.archived);
      setPlaybooks(activePbs);
      setActiveTemplateKey(pbRes.activeTemplateKey || activePbs[0]?.templateKey || "infrastructure");
      setAllAccounts(accRes.accounts);
    });

    return () => {
      active = false;
    };
  }, [open, workspaceId]);

  const handleRemoveAccount = (id: string) => {
    setTargetAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  const handleStartMonitoring = async () => {
    if (targetAccounts.length === 0) {
      setError("Please select at least one account to monitor.");
      return;
    }
    try {
      setCreating(true);
      setError(null);
      // Automatically inherits the account's research playbook on the backend
      const res = await createMonitorFromAccounts(workspaceId, {
        accountIds: targetAccounts.map((a) => a.id),
        cadenceHours: selectedCadence,
      });
      onSuccess(res.monitor, targetAccounts.length);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create account monitor");
    } finally {
      setCreating(false);
    }
  };

  const activePlaybook = playbooks.find((p) => p.templateKey === activeTemplateKey);

  const availableAccounts = allAccounts.filter(
    (a) =>
      !targetAccounts.some((t) => t.id === a.id) &&
      (searchQuery.trim() === "" ||
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.domain && a.domain.toLowerCase().includes(searchQuery.toLowerCase()))),
  );

  return (
    <Modal
      open={open}
      onClose={() => !creating && onClose()}
      title="Monitor accounts"
      description="Schedule continuous automated research to detect new buying signals for these accounts."
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="quiet" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={creating || targetAccounts.length === 0}
            onClick={() => void handleStartMonitoring()}
          >
            {creating ? "Starting monitor…" : "Start monitoring"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Chosen Accounts Display */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">
              Accounts to monitor ({targetAccounts.length})
            </span>
            <span>Target account list</span>
          </div>

          {targetAccounts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] p-4 text-center text-xs text-[var(--muted)]">
              No accounts selected yet. Choose accounts below to monitor.
            </div>
          ) : (
            <div className="max-h-40 overflow-y-auto space-y-1.5 rounded-[12px] border border-[var(--card-line)] bg-[var(--surface-sunken)] p-2">
              {targetAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2 shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[11px] font-bold text-[var(--brand-text)]">
                      {acc.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[var(--foreground)]">
                        {acc.name}
                      </div>
                      {acc.domain ? (
                        <div className="flex items-center gap-1 text-[11px] text-[var(--muted)] truncate">
                          <Globe size={11} aria-hidden />
                          <span>{acc.domain}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {acc.country ? (
                      <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">
                        <MapPin size={10} aria-hidden /> {acc.country}
                      </span>
                    ) : null}
                    {targetAccounts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveAccount(acc.id)}
                        disabled={creating}
                        className="rounded p-1 text-[var(--muted)] hover:bg-slate-100 hover:text-slate-800 transition"
                        title="Remove from this monitor"
                        aria-label={`Remove ${acc.name}`}
                      >
                        <X size={13} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add more accounts picker */}
          {showAddAccount ? (
            <div className="rounded-[10px] border border-slate-200 bg-white p-2.5 space-y-2 shadow-xs">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" aria-hidden />
                  <input
                    type="text"
                    placeholder="Search accounts by name or domain…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:border-[var(--brand)]"
                  />
                </div>
                {targetAccounts.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddAccount(false);
                      setSearchQuery("");
                    }}
                    className="text-slate-400 hover:text-slate-600 p-1"
                    title="Done adding"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <div className="max-h-28 overflow-y-auto divide-y divide-slate-100">
                {availableAccounts.slice(0, 8).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setTargetAccounts((prev) => [
                        ...prev,
                        { id: a.id, name: a.name, domain: a.domain, country: a.country },
                      ]);
                      setSearchQuery("");
                    }}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-brand-50 hover:text-[var(--brand-text)] transition"
                  >
                    <span className="font-semibold truncate">{a.name}</span>
                    {a.domain ? <span className="text-[11px] text-slate-400 truncate">{a.domain}</span> : null}
                  </button>
                ))}
                {availableAccounts.length === 0 ? (
                  <div className="text-[11px] text-slate-400 px-2 py-1.5">No accounts found</div>
                ) : null}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAddAccount(true)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-text)] hover:underline pt-0.5"
            >
              + Add another account to this monitor
            </button>
          )}
        </div>

        {/* Inherited Signals / Criteria Banner */}
        <div className="rounded-[10px] bg-[var(--surface-sunken)] p-3 text-xs text-[var(--muted)] space-y-1.5 border border-[var(--line)]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--foreground)]">
              {activePlaybook?.name ?? "Research signals"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <Check size={10} aria-hidden /> Inherited from research
            </span>
          </div>
          <div>
            <span className="font-medium text-[var(--foreground)]">Signals to monitor: </span>
            {activePlaybook?.rules.signals
              ? activePlaybook.rules.signals.map((s) => humanize(s)).join(", ")
              : "Expansion, infrastructure hiring, cloud migration"}
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Continuous checks will automatically watch for these signals on the selected accounts.
          </p>
        </div>

        {/* Check Frequency */}
        <Field label="Check frequency" hint="How often Insyder should re-check the web for new signals">
          <select
            className={inputClass}
            value={selectedCadence}
            disabled={creating}
            onChange={(e) => setSelectedCadence(Number(e.target.value))}
          >
            {cadenceOptions.map((c) => (
              <option key={c.hours} value={c.hours} disabled={!c.allowed}>
                {CADENCE_TEXT[c.hours] ?? c.label}
                {c.hint ? ` (${c.hint})` : ""}
              </option>
            ))}
          </select>
        </Field>

        {error ? <FormError message={error} /> : null}
      </div>
    </Modal>
  );
}
