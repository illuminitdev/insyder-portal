"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Copy, History, Pencil, Plus, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { setActivePlaybook, setEventWindow, getOffer } from "@/lib/api/settings";
import {
  archivePlaybook,
  createCustomSignal,
  createPlaybook,
  listPlaybooks,
  playbookVersions,
  SIGNAL_LABELS,
  updatePlaybook,
  type CustomSignal,
  type PlaybookInput,
  type PlaybookView,
} from "@/lib/api/playbooks";
import { formatDate } from "@/lib/utils/dates";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, FormNotice, inputClass } from "@/components/ui/Field";

const WINDOWS = [30, 60, 90, 180, 365];
const split = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function humanize(s: string) {
  const clean = s.replace(/^custom_/, "").replace(/_/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type Editing = { mode: "new" } | { mode: "copy"; from: PlaybookView } | { mode: "edit"; playbook: PlaybookView };

function PlaybookForm({
  workspaceId,
  editing,
  signalKinds,
  customSignals,
  onAddCustomSignal,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  editing: Editing;
  signalKinds: string[];
  customSignals: CustomSignal[];
  onAddCustomSignal: (sig: CustomSignal) => void;
  onClose: () => void;
  onSaved: (p: PlaybookView, message: string) => void;
}) {
  const source = editing.mode === "edit" ? editing.playbook : editing.mode === "copy" ? editing.from : null;
  const [name, setName] = useState(
    editing.mode === "edit" ? editing.playbook.name : editing.mode === "copy" ? `${editing.from.name} (copy)` : "",
  );
  const [description, setDescription] = useState(source?.rules.description ?? "");
  const [signals, setSignals] = useState<string[]>(source?.rules.signals ?? []);
  const [requiredEvidence, setRequiredEvidence] = useState(source?.rules.requiredEvidence ?? "");
  const [discoveryQuestion, setDiscoveryQuestion] = useState(source?.rules.discoveryQuestion ?? "");
  const [countries, setCountries] = useState((source?.rules.countries ?? []).join(", "));
  const [industries, setIndustries] = useState((source?.rules.industries ?? []).join(", "));
  const [windowDays, setWindowDays] = useState<string>(source?.rules.eventWindowDays ? String(source.rules.eventWindowDays) : "");
  const [requiredPhrase, setRequiredPhrase] = useState(source?.rules.requiredPhrase ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline custom signal creation under signals
  const [showInlineAdd, setShowInlineAdd] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [inlineBusy, setInlineBusy] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const customSignalsMap = useMemo(() => {
    const map = new Map<string, CustomSignal>();
    for (const cs of customSignals) map.set(cs.key, cs);
    if (source?.rules.customSignals) {
      for (const cs of source.rules.customSignals) {
        if (!map.has(cs.key)) map.set(cs.key, cs);
      }
    }
    return map;
  }, [customSignals, source]);

  // Combine all signal kinds: custom signals first, followed by others
  const allSignalKeys = useMemo(() => {
    const customKeys = Array.from(customSignalsMap.keys());
    const builtInKeys = signalKinds.filter((k) => !customSignalsMap.has(k) && !k.startsWith("custom_"));
    const set = new Set([...customKeys, ...signals.filter((s) => s.startsWith("custom_")), ...builtInKeys, ...signals]);
    return Array.from(set);
  }, [signalKinds, signals, customSignalsMap]);

  async function handleInlineAddCustomSignal() {
    if (customLabel.trim().length < 2) {
      setInlineError("Please enter a signal name (at least 2 characters).");
      return;
    }
    setInlineBusy(true);
    setInlineError(null);
    try {
      const res = await createCustomSignal(workspaceId, {
        label: customLabel.trim(),
        description: customDesc.trim(),
      });
      onAddCustomSignal(res.customSignal);
      setSignals((prev) => (prev.includes(res.customSignal.key) ? prev : [...prev, res.customSignal.key]));
      setCustomLabel("");
      setCustomDesc("");
      setShowInlineAdd(false);
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : "Failed to add signal");
    } finally {
      setInlineBusy(false);
    }
  }

  const title = editing.mode === "edit" ? `Edit ${editing.playbook.name}` : editing.mode === "copy" ? "Copy playbook" : "New playbook";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const badCountry = split(countries).find((c) => !/^[A-Za-z]{2}$/.test(c));
    if (badCountry) {
      setError(`Use 2-letter country codes, e.g. GB, US. "${badCountry}" isn't one.`);
      return;
    }
    if (requiredPhrase.trim().split(/\s+/).length > 5) {
      setError("The required phrase can be at most 5 words.");
      return;
    }

    const relevantCustomSignals = Array.from(customSignalsMap.values()).filter((cs) => signals.includes(cs.key));

    const body: PlaybookInput = {
      name: name.trim(),
      description: description.trim(),
      signals,
      customSignals: relevantCustomSignals,
      requiredEvidence: requiredEvidence.trim(),
      discoveryQuestion: discoveryQuestion.trim(),
      countries: split(countries).map((c) => c.toUpperCase()),
      industries: split(industries),
      eventWindowDays: windowDays ? Number(windowDays) : null,
      requiredPhrase: requiredPhrase.trim(),
    };
    setBusy(true);
    setError(null);
    try {
      if (editing.mode === "edit") {
        const { playbook } = await updatePlaybook(workspaceId, editing.playbook.templateKey, body);
        onSaved(playbook, `Changes to "${playbook.name}" saved. Research already run keeps the rules it used.`);
      } else {
        const { playbook } = await createPlaybook(workspaceId, body);
        onSaved(playbook, `"${playbook.name}" created. Choose "Use playbook" to make it the workspace default.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the playbook");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title={title}
      description={
        editing.mode === "edit"
          ? "Research already run keeps the rules it used. The earlier rules stay in History."
          : "A playbook decides which buying signals research looks for, and what evidence counts."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="playbook-form" variant="primary" disabled={busy || name.trim().length < 2 || !signals.length}>
            {busy ? "Saving…" : editing.mode === "edit" ? "Save changes" : "Create playbook"}
          </Button>
        </>
      }
    >
      <form id="playbook-form" onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Data centre builds" maxLength={80} />
          </Field>
          <Field label="Short description (optional)">
            <input
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. New data halls + facilities hiring"
              maxLength={200}
            />
          </Field>
        </div>

        <fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <legend className="text-sm font-semibold text-[var(--foreground)]">Signals to look for</legend>
              <p className="text-xs text-[var(--muted)]">Research searches for these. Choose at least one.</p>
            </div>
            {!showInlineAdd ? (
              <Button
                type="button"
                variant="primary"
                className="!py-1.5 !px-3 text-xs"
                onClick={() => setShowInlineAdd(true)}
              >
                <Plus size={14} className="mr-1.5" aria-hidden />
                Add custom signal
              </Button>
            ) : null}
          </div>

          {showInlineAdd ? (
            <div className="my-2.5 rounded-[8px] border border-[var(--line)] bg-[var(--surface-sunken)] p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--foreground)]">Create custom buying signal</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowInlineAdd(false);
                    setCustomLabel("");
                    setCustomDesc("");
                    setInlineError(null);
                  }}
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Cancel
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={`${inputClass} text-xs py-1.5`}
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Signal name (e.g. ERP Modernization)"
                  maxLength={80}
                  autoFocus
                />
                <input
                  className={`${inputClass} text-xs py-1.5`}
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  placeholder="Keywords / what to look for (optional)"
                  maxLength={200}
                />
              </div>
              {inlineError ? <p className="text-xs text-red-600">{inlineError}</p> : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  className="!py-1.5 !px-3 text-xs"
                  disabled={inlineBusy || customLabel.trim().length < 2}
                  onClick={handleInlineAddCustomSignal}
                >
                  <Plus size={13} className="mr-1" />
                  {inlineBusy ? "Adding…" : "Add signal"}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-2.5 grid gap-2 sm:grid-cols-2 max-h-[300px] overflow-y-auto pr-1">
            {allSignalKeys.map((s) => {
              const on = signals.includes(s);
              const isCustom = s.startsWith("custom_") || customSignalsMap.has(s);
              const customDef = customSignalsMap.get(s);
              const label = customDef?.label ?? SIGNAL_LABELS[s] ?? humanize(s);
              return (
                <label
                  key={s}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-[8px] border px-3 py-2 text-sm transition ${
                    on ? "border-[var(--brand)] bg-[var(--brand-tint)]" : "border-[var(--line)] hover:border-[var(--input-border)] bg-[var(--surface)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-[var(--brand)]"
                    checked={on}
                    onChange={(e) => setSignals((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-medium text-[var(--foreground)] truncate">{label}</span>
                      {isCustom ? (
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200 shrink-0">
                          Custom
                        </span>
                      ) : null}
                    </div>
                    {customDef?.description ? (
                      <p className="text-xs text-[var(--muted)] line-clamp-1 mt-0.5">{customDef.description}</p>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>

        <Field label="Required evidence (optional)" hint="What a source must show before the lead counts. Shown to researchers and reviewers.">
          <textarea
            className={`${inputClass} min-h-[70px]`}
            value={requiredEvidence}
            onChange={(e) => setRequiredEvidence(e.target.value)}
            placeholder="e.g. Dated announcement naming the company and the site location."
            maxLength={600}
          />
        </Field>
        <Field label="Discovery question (optional)" hint="The first question to ask the prospect.">
          <input
            className={inputClass}
            value={discoveryQuestion}
            onChange={(e) => setDiscoveryQuestion(e.target.value)}
            placeholder="e.g. Who is fitting out the new data hall?"
            maxLength={400}
          />
        </Field>

        <div className="rounded-[10px] border border-[var(--line)] p-4">
          <p className="text-sm font-semibold">Search defaults (optional)</p>
          <p className="text-xs text-[var(--muted)]">Leave empty to use the workspace targeting. A search can still override them.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Countries">
              <input className={inputClass} value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="e.g. GB, IE" />
            </Field>
            <Field label="Industries">
              <input className={inputClass} value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder="e.g. Healthcare" />
            </Field>
            <Field label="Maximum event age">
              <select className={inputClass} value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>
                <option value="">Workspace setting</option>
                {WINDOWS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4">
            <Field
              label="Required phrase"
              hint="Only results containing this exact phrase are kept (up to 5 words). Spelling matters: “data centre” won’t match “data center”."
            >
              <input
                className={inputClass}
                value={requiredPhrase}
                onChange={(e) => setRequiredPhrase(e.target.value)}
                placeholder="e.g. data centre"
                maxLength={60}
              />
            </Field>
          </div>
        </div>
        <FormError message={error} />
      </form>
    </Modal>
  );
}

function HistoryModal({
  workspaceId,
  playbook,
  customSignalsMap,
  onClose,
}: {
  workspaceId: string;
  playbook: PlaybookView;
  customSignalsMap: Map<string, CustomSignal>;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<PlaybookView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    playbookVersions(workspaceId, playbook.templateKey)
      .then((r) => setVersions(r.versions))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load history"));
  }, [workspaceId, playbook.templateKey]);
  return (
    <Modal open onClose={onClose} title={`${playbook.name} · history`} description="Every saved change, newest first. Research runs keep the rules they used.">
      {error ? <FormError message={error} /> : null}
      {!versions && !error ? <LoadingState /> : null}
      <ol className="space-y-3">
        {versions?.map((v) => (
          <li key={v.id} className="rounded-[10px] border border-[var(--line)] p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">
                {v.name}
              </p>
              <span className="text-xs text-[var(--muted)]">{formatDate(v.createdAt)}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {v.archived ? "Archived · " : ""}
              {v.rules.signals.map((s) => customSignalsMap.get(s)?.label ?? SIGNAL_LABELS[s] ?? humanize(s)).join(", ")}
            </p>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

function PlaybookCard({
  p,
  active,
  canManage,
  busy,
  customSignalsMap,
  onUse,
  onEdit,
  onCopy,
  onArchive,
  onHistory,
}: {
  p: PlaybookView;
  active: boolean;
  canManage: boolean;
  busy: boolean;
  customSignalsMap: Map<string, CustomSignal>;
  onUse: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onArchive: () => void;
  onHistory: () => void;
}) {
  const iconBtn =
    "flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--line)] text-[var(--muted)] hover:border-[var(--input-border)] hover:text-[var(--foreground)]";
  return (
    <Card className={`flex flex-col ${active ? "!border-[var(--brand)] ring-1 ring-[var(--brand)]" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className={`rounded-[5px] px-2 py-0.5 text-[11px] font-semibold ${
            active ? "bg-[var(--brand)] text-white" : "border border-[var(--line)] text-[var(--muted)]"
          }`}
        >
          {active ? "Active" : p.builtIn ? "Built-in" : "Custom"}
        </span>
        <div className="flex items-center gap-1.5">
          {canManage ? (
            <>
              {!p.builtIn ? (
                <button type="button" title="Edit" aria-label={`Edit ${p.name}`} className={iconBtn} onClick={onEdit}>
                  <Pencil size={14} />
                </button>
              ) : null}
              <button type="button" title="Copy" aria-label={`Copy ${p.name}`} className={iconBtn} onClick={onCopy}>
                <Copy size={14} />
              </button>
              {!p.builtIn ? (
                <button type="button" title="History" aria-label={`History of ${p.name}`} className={iconBtn} onClick={onHistory}>
                  <History size={14} />
                </button>
              ) : null}
              {!p.builtIn && !active ? (
                <button type="button" title="Archive" aria-label={`Archive ${p.name}`} className={iconBtn} onClick={onArchive}>
                  <Archive size={14} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <h2 className="text-[18px] font-semibold text-[var(--foreground)]">{p.name}</h2>
      {p.rules.description ? <p className="mt-1 text-sm text-[var(--muted)]">{p.rules.description}</p> : null}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {p.rules.signals.map((s) => {
          const isCustom = s.startsWith("custom_") || customSignalsMap.has(s);
          const label = customSignalsMap.get(s)?.label ?? SIGNAL_LABELS[s] ?? humanize(s);
          return (
            <span
              key={s}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] ${
                isCustom
                  ? "border-purple-200 bg-purple-50 text-purple-700 font-medium"
                  : "border-[var(--line)] text-[var(--foreground)]"
              }`}
            >
              {label}
              {isCustom ? " · custom" : ""}
            </span>
          );
        })}
      </div>

      {p.rules.requiredEvidence ? (
        <div className="mt-4">
          <h3 className="text-[13px] font-semibold">Required evidence</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--muted)]">{p.rules.requiredEvidence}</p>
        </div>
      ) : null}
      {p.rules.discoveryQuestion ? (
        <div className="mt-3">
          <h3 className="text-[13px] font-semibold">Discovery question</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--muted)]">{p.rules.discoveryQuestion}</p>
        </div>
      ) : null}
      {p.rules.countries.length || p.rules.industries.length || p.rules.eventWindowDays || p.rules.requiredPhrase ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Defaults:{" "}
          {[
            p.rules.countries.length ? p.rules.countries.join(", ") : null,
            p.rules.industries.length ? p.rules.industries.join(", ") : null,
            p.rules.eventWindowDays ? `${p.rules.eventWindowDays}-day events` : null,
            p.rules.requiredPhrase ? `must mention “${p.rules.requiredPhrase}”` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      <div className="mt-auto pt-5">
        {active ? (
          <Button disabled className="w-full cursor-default">
            In use
          </Button>
        ) : (
          <Button variant="primary" onClick={onUse} disabled={busy} className="w-full">
            {busy ? "Switching…" : "Use playbook"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Playbooks({ workspaceId }: { workspaceId: string }) {
  const [playbooks, setPlaybooks] = useState<PlaybookView[] | null>(null);
  const [activeKey, setActiveKey] = useState("infrastructure");
  const [signalKinds, setSignalKinds] = useState<string[]>([]);
  const [customSignals, setCustomSignals] = useState<CustomSignal[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [eventWindowDays, setEventWindowDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [history, setHistory] = useState<PlaybookView | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const [res, offer] = await Promise.all([listPlaybooks(workspaceId), getOffer(workspaceId)]);
      setPlaybooks(res.playbooks);
      setActiveKey(res.activeTemplateKey);
      setSignalKinds(res.signalKinds);
      setCanManage(res.canManage);
      if (res.customSignals) setCustomSignals(res.customSignals);
      if (offer.offer?.eventWindowDays) setEventWindowDays(offer.offer.eventWindowDays);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load playbooks");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const customSignalsMap = useMemo(() => {
    const map = new Map<string, CustomSignal>();
    for (const cs of customSignals) map.set(cs.key, cs);
    if (playbooks) {
      for (const p of playbooks) {
        if (p.rules.customSignals) {
          for (const cs of p.rules.customSignals) {
            if (!map.has(cs.key)) map.set(cs.key, cs);
          }
        }
        for (const s of p.rules.signals) {
          if (s.startsWith("custom_") && !map.has(s)) {
            map.set(s, { key: s, label: humanize(s) });
          }
        }
      }
    }
    return map;
  }, [customSignals, playbooks]);

  async function use(p: PlaybookView) {
    setSwitching(p.templateKey);
    setError(null);
    setNotice(null);
    try {
      await setActivePlaybook(workspaceId, p.templateKey);
      setActiveKey(p.templateKey);
      setNotice(`"${p.name}" is now the workspace playbook. New searches and monitors use its rules.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch playbook");
    } finally {
      setSwitching(null);
    }
  }

  async function archive(p: PlaybookView, archived: boolean) {
    setError(null);
    setNotice(null);
    try {
      await archivePlaybook(workspaceId, p.templateKey, archived);
      setNotice(archived ? `"${p.name}" archived. Its history is kept.` : `"${p.name}" restored.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the playbook");
    }
  }

  async function changeWindow(days: number) {
    setEventWindowDays(days);
    try {
      setError(null);
      await setEventWindow(workspaceId, days);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the event age");
    }
  }

  if (!playbooks) return error ? <ErrorState message={error} /> : <LoadingState />;
  const current = playbooks.filter((p) => !p.archived);
  const archived = playbooks.filter((p) => p.archived);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Repeatable research"
        title="Signal playbooks"
        description="A playbook decides which buying signals research looks for and what evidence counts. The active one is used by Find leads and by Monitors."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setEditing({ mode: "new" })}>
              <Plus size={16} className="mr-1.5" aria-hidden />
              New playbook
            </Button>
          ) : null
        }
      />
      <FormNotice message={notice} />
      <FormError message={error} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {current.map((p) => (
          <PlaybookCard
            key={p.templateKey}
            p={p}
            active={p.templateKey === activeKey}
            canManage={canManage}
            busy={switching === p.templateKey}
            customSignalsMap={customSignalsMap}
            onUse={() => void use(p)}
            onEdit={() => setEditing({ mode: "edit", playbook: p })}
            onCopy={() => setEditing({ mode: "copy", from: p })}
            onArchive={() => void archive(p, true)}
            onHistory={() => setHistory(p)}
          />
        ))}
      </div>

      {archived.length ? (
        <div>
          <button
            type="button"
            className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => setShowArchived((s) => !s)}
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived ? (
            <ul className="mt-3 divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)] bg-white">
              {archived.map((p) => (
                <li key={p.templateKey} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {p.rules.signals
                        .map((s) => customSignalsMap.get(s)?.label ?? SIGNAL_LABELS[s] ?? humanize(s))
                        .join(", ")}
                    </p>
                  </div>
                  {canManage ? (
                    <Button variant="ghost" onClick={() => void archive(p, false)}>
                      <RotateCcw size={14} className="mr-1.5" aria-hidden />
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-md">
            <label htmlFor="event-window" className="block text-sm font-semibold text-[var(--foreground)]">
              Maximum event age (workspace)
            </label>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
              Evidence older than this counts as stale. A playbook can set its own; this applies when it doesn&apos;t. Unknown
              hiring dates stay flagged for review.
            </p>
            <select
              id="event-window"
              value={eventWindowDays}
              onChange={(e) => void changeWindow(Number(e.target.value))}
              className={`${inputClass} mt-2 max-w-[200px]`}
            >
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
          <Link href="/discover/assign">
            <Button>Find leads with the active playbook →</Button>
          </Link>
        </div>
      </Card>

      {editing ? (
        <PlaybookForm
          workspaceId={workspaceId}
          editing={editing}
          signalKinds={signalKinds}
          customSignals={customSignals}
          onAddCustomSignal={(newSig) => {
            setCustomSignals((prev) => [...prev.filter((s) => s.key !== newSig.key), newSig]);
            setSignalKinds((prev) => (prev.includes(newSig.key) ? prev : [...prev, newSig.key]));
          }}
          onClose={() => setEditing(null)}
          onSaved={(_, message) => {
            setEditing(null);
            setNotice(message);
            void load();
          }}
        />
      ) : null}

      {history ? (
        <HistoryModal
          workspaceId={workspaceId}
          playbook={history}
          customSignalsMap={customSignalsMap}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </div>
  );
}

export default function PlaybooksPage() {
  return <RequireCap cap="discover">{(workspaceId) => <Playbooks workspaceId={workspaceId} />}</RequireCap>;
}
