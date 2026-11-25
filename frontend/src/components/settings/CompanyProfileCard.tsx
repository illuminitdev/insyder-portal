"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, ChevronUp, ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FormError, FormNotice, humanize, inputClass } from "@/components/ui/Field";
import { countryName } from "@/lib/countries";
import {
  analyzeWebsite,
  applyCompanyProfile,
  getCompanyProfile,
  type CompanyProfile,
  type CompanyProfileState,
  type ProfileSections,
} from "@/lib/api/settings";

const POLL_MS = 5000;

type SectionKey = Exclude<keyof ProfileSections, "makeDefault">;

/** The suggestions the user can tick, each with what it fills in and a preview of the values */
function suggestionRows(p: CompanyProfile): Array<{ key: SectionKey; label: string; target: string; value: string }> {
  const rows: Array<{ key: SectionKey; label: string; target: string; value: string }> = [
    { key: "companyName", label: "Company name", target: "Your company & products", value: p.companyName ?? "" },
    { key: "offering", label: "What you sell", target: "Your targeting", value: p.offering },
    { key: "industries", label: "Industries you sell to", target: "Your targeting", value: p.industries.join(", ") },
    { key: "buyerRoles", label: "Target buyer functions", target: "Your targeting", value: p.buyerRoles.join(", ") },
    { key: "territory", label: "Territory", target: "Your targeting", value: p.countries.map(countryName).join(", ") },
    { key: "companySizes", label: "Company sizes", target: "Your targeting", value: p.companySizes.join(", ") },
    {
      key: "products",
      label: `Products & services (${p.products.length})`,
      target: "Replaces your product list",
      value: p.products.map((x) => x.name).join(", "),
    },
    {
      key: "playbook",
      label: `Buying signals (${p.signals.length + p.customSignals.length})`,
      target: "Creates a new playbook",
      value: [...p.signals.map((s) => humanize(s.key)), ...p.customSignals.map((c) => c.label)].join(", "),
    },
  ];
  return rows.filter((r) => r.value.trim());
}

/**
 * Settings → Offer & targeting: "start here". The user gives their website, Insyder reads it
 * (one Exa agent run) and suggests their offer, targeting, products and buying signals. Nothing
 * changes until they tick what to use and click Apply.
 */
export function CompanyProfileCard({
  workspaceId,
  firstTime,
  onApplied,
}: {
  workspaceId: string;
  /** Nothing saved in Offer & targeting yet: show the card as the first step */
  firstTime: boolean;
  onApplied: () => void;
}) {
  const [state, setState] = useState<CompanyProfileState | null>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Partial<Record<SectionKey, boolean>>>({});
  const [makeDefault, setMakeDefault] = useState(true);
  const [reanalyse, setReanalyse] = useState(false);
  // Once the website is analysed the card stays compact (title + website); details open on request
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await getCompanyProfile(workspaceId);
      setState(s);
      setWebsite((w) => w || s.website || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the company profile");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While the website is being read, check back every few seconds
  const running = state?.status === "running";
  // A new analysis that finishes while the page is open opens its details, so the suggestions can be reviewed
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running && state?.profile) setExpanded(true);
    wasRunning.current = running;
  }, [running, state?.profile]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [running, load]);

  // A new profile: tick every suggestion it has by default
  const profile = state?.profile ?? null;
  const updatedAt = state?.updatedAt;
  useEffect(() => {
    if (!profile) return;
    setPicked(Object.fromEntries(suggestionRows(profile).map((r) => [r.key, true])));
  }, [profile, updatedAt]);

  async function analyse() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const s = await analyzeWebsite(workspaceId, website);
      setState(s);
      setReanalyse(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the analysis");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await applyCompanyProfile(workspaceId, { ...picked, makeDefault: Boolean(picked.playbook && makeDefault) });
      setNotice(
        `Applied to your settings${r.playbook ? `, and created the playbook “${r.playbook.name}”` : ""}. Check the details below and edit anything that isn't right.`,
      );
      setExpanded(false);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the suggestions");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return error ? (
      <Card>
        <FormError message={error} />
      </Card>
    ) : null;
  }

  const rows = profile ? suggestionRows(profile) : [];
  const anyPicked = rows.some((r) => picked[r.key]);
  const showForm = !running && (!profile || reanalyse);
  const compact = Boolean(profile) && !running && !reanalyse;
  const site = state.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <Card className={firstTime && !profile ? "!border-[var(--brand)] shadow-[0_0_0_1px_var(--brand)]" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]">
            <Globe size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            {firstTime && !profile ? <Badge tone="red">Start here</Badge> : null}
            <h2 className="mt-1 text-[17px] font-semibold">Your company profile</h2>
            {compact ? (
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Website:{" "}
                {state.website ? (
                  <a
                    href={state.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[var(--brand-active)] hover:underline"
                  >
                    {site} <ExternalLink size={12} aria-hidden />
                  </a>
                ) : (
                  "not set"
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Give us your website and Insyder reads it to understand your company: what you sell, who buys it and
                which buying signals to watch. You review every suggestion before it is used.
              </p>
            )}
          </div>
        </div>
        {compact ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
              <span className="inline-flex items-center gap-1.5">
                {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                {expanded ? "Hide details" : "View details"}
              </span>
            </Button>
            <Button onClick={() => setReanalyse(true)}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={15} aria-hidden /> Analyse again
              </span>
            </Button>
          </div>
        ) : null}
      </div>

      {!state.available ? (
        <p className="mt-4 rounded-[8px] bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--muted)]">
          Website analysis needs the Exa research provider, which isn&apos;t set up here. Fill in the settings below by hand.
        </p>
      ) : showForm ? (
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void analyse();
          }}
        >
          <label className="block min-w-[260px] flex-1 text-xs font-semibold text-[var(--muted)]">
            Your company website
            <span className="relative mt-1 block">
              <Globe size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
              <input
                className={`${inputClass} !mt-0 !pl-10`}
                inputMode="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="e.g. yourcompany.com"
              />
            </span>
          </label>
          <Button type="submit" variant="primary" disabled={busy || !website.trim()}>
            {busy ? "Starting…" : "Analyse website"}
          </Button>
          {reanalyse ? (
            <Button variant="ghost" onClick={() => setReanalyse(false)}>
              Cancel
            </Button>
          ) : null}
          <p className="w-full text-xs text-[var(--muted)]">
            Uses {state.units} research unit{state.units === 1 ? "" : "s"}. Usually takes 1 to 3 minutes; you can leave
            this page and come back.
          </p>
        </form>
      ) : null}

      {running ? (
        <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-3 text-sm" aria-live="polite">
          <Loader2 size={18} className="shrink-0 animate-spin text-[var(--brand)]" aria-hidden />
          <span>
            Reading <span className="font-semibold">{state.website}</span> and building your profile… This usually takes 1 to 3
            minutes.
          </span>
        </div>
      ) : null}

      {state.status === "failed" && state.error && !running ? (
        <p className="mt-4 rounded-[8px] border border-[var(--brand)] bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand-active)]">
          {state.error} No research units were used.
        </p>
      ) : null}

      {profile && !running && expanded ? (
        <div className="mt-5 space-y-5 border-t border-[var(--line)] pt-5">
          {/* What we learned */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 size={16} className="text-[var(--brand)]" aria-hidden />
              <span className="font-semibold">{profile.companyName ?? "Your company"}</span>
              {state.website ? (
                <a
                  href={state.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--brand-active)] hover:underline"
                >
                  {state.website.replace(/^https?:\/\//, "")} <ExternalLink size={11} aria-hidden />
                </a>
              ) : null}
            </div>
            {profile.summary ? <p className="text-sm leading-relaxed text-[var(--foreground)]">{profile.summary}</p> : null}
            <div className="grid gap-4 text-sm md:grid-cols-2">
              {profile.differentiators.length ? (
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)]">What sets you apart</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {profile.differentiators.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {profile.customers.length ? (
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)]">Customers and case studies</p>
                  <p className="mt-1">{profile.customers.join(", ")}</p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Suggestions to apply */}
          <div>
            <p className="text-[14px] font-semibold">Use these in your settings?</p>
            <p className="text-xs text-[var(--muted)]">Untick anything that isn&apos;t right. You can still edit everything afterwards.</p>
            <ul className="mt-3 divide-y divide-[var(--line)] rounded-[12px] border border-[var(--line)] bg-white">
              {rows.map((r) => (
                <li key={r.key}>
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                      checked={Boolean(picked[r.key])}
                      onChange={(e) => setPicked((p) => ({ ...p, [r.key]: e.target.checked }))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{r.label}</span>
                        <span className="text-[11px] text-[var(--muted)]">→ {r.target}</span>
                      </span>
                      <span className="mt-0.5 block text-sm text-[var(--muted)] break-words">{r.value}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {picked.playbook ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--brand)]"
                  checked={makeDefault}
                  onChange={(e) => setMakeDefault(e.target.checked)}
                />
                Make the new playbook the default for searches
              </label>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={busy || !anyPicked} onClick={() => void apply()}>
                {busy ? "Applying…" : "Apply selected"}
              </Button>
              {!anyPicked ? <span className="text-xs text-[var(--muted)]">Tick at least one suggestion</span> : null}
            </div>
          </div>

          {profile.sources.length ? (
            <details className="text-xs text-[var(--muted)]">
              <summary className="cursor-pointer">Pages this profile is based on ({profile.sources.length})</summary>
              <ul className="mt-2 space-y-1">
                {profile.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--brand-active)] hover:underline break-all">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />
      <FormNotice message={notice} />
    </Card>
  );
}
