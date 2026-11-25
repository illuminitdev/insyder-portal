"use client";

import { useEffect, useState } from "react";
import { Check, Palette, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { LoadingState } from "@/components/common/LoadingState";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FormError, FormNotice } from "@/components/ui/Field";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  DEFAULT_BRANDING,
  announceBranding,
  brandingVars,
  getBranding,
  isHex,
  isLight,
  saveBranding,
  type Branding,
} from "@/lib/branding";

const FIELDS: Array<{ key: keyof Branding; label: string; hint: string }> = [
  { key: "primary", label: "Primary colour", hint: "Buttons, headings and the main highlights" },
  { key: "accent", label: "Accent colour", hint: "Links, the menu item you are on, selected items and active states" },
  { key: "sidebar", label: "Menu colour", hint: "Background of the left-hand menu" },
];

function problem(value: string): string | null {
  return isHex(value) ? null : "Use a hex colour, e.g. #0d1b2a";
}

/**
 * Small mock of the app in the chosen colours. It uses the same theme variables as the real app,
 * so the text colours it picks (white or dark) are exactly what the team will see.
 */
function Preview({ b }: { b: Branding }) {
  // A half-typed hex falls back to the Insyder colour until it is complete
  const c = Object.fromEntries(FIELDS.map((f) => [f.key, isHex(b[f.key]) ? b[f.key] : DEFAULT_BRANDING[f.key]])) as Branding;
  const vars = brandingVars(c) as React.CSSProperties;
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[#f5f2ea]" style={vars} aria-label="Preview">
      <div className="flex h-[230px]">
        <div className="flex w-[150px] shrink-0 flex-col gap-1.5 bg-[var(--sidebar-bg)] p-3">
          <span className="mb-2 text-[13px] font-bold text-[var(--sidebar-strong)]">insyder</span>
          {["Overview", "Accounts", "Settings"].map((item) => (
            <span
              key={item}
              className={`flex items-center gap-2 rounded-md px-2 py-1 text-[11.5px] ${
                item === "Accounts"
                  ? "bg-[var(--sidebar-active)] font-semibold text-[var(--sidebar-active-text)]"
                  : "text-[var(--sidebar-text)]"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${item === "Accounts" ? "bg-[var(--sidebar-active-icon)]" : "bg-[var(--sidebar-muted)]"}`}
                aria-hidden
              />
              {item}
            </span>
          ))}
        </div>
        <div className="flex-1 space-y-3 p-4">
          <p className="text-[15px] font-semibold text-[var(--brand-text)]">Account Intelligence</p>
          <div className="rounded-[10px] bg-white p-3 text-[12px] shadow-sm">
            <p>
              New buying signal at <span className="font-semibold text-[var(--link)]">Acme Ltd</span>
            </p>
            <span className="mt-2 inline-block rounded bg-[var(--brand-tint)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--brand-active)]">
              Ready for review
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-block rounded-lg bg-[var(--brand)] px-3 py-1.5 text-[12px] font-semibold text-[var(--on-brand)]">
              Research account
            </span>
            <span className="inline-block rounded-lg bg-[var(--brand-active)] px-3 py-1.5 text-[12px] font-semibold text-[var(--on-accent)]">
              Selected
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandingView({ workspaceId }: { workspaceId: string }) {
  const { workspaceName } = useWorkspace();
  const [saved, setSaved] = useState<Branding | null | undefined>(undefined);
  const [draft, setDraft] = useState<Branding>(DEFAULT_BRANDING);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getBranding(workspaceId)
      .then((r) => {
        setSaved(r.branding);
        setDraft(r.branding ?? DEFAULT_BRANDING);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the colours"));
  }, [workspaceId]);

  if (saved === undefined) return error ? <FormError message={error} /> : <LoadingState />;

  const problems = Object.fromEntries(FIELDS.map((f) => [f.key, problem(draft[f.key])])) as Record<keyof Branding, string | null>;
  const valid = FIELDS.every((f) => !problems[f.key]);
  const current = saved ?? DEFAULT_BRANDING;
  const changed = FIELDS.some((f) => draft[f.key].toLowerCase() !== current[f.key]);

  async function save(next: Branding | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await saveBranding(workspaceId, next && { ...next, primary: next.primary.toLowerCase(), accent: next.accent.toLowerCase(), sidebar: next.sidebar.toLowerCase() });
      setSaved(r.branding);
      setDraft(r.branding ?? DEFAULT_BRANDING);
      announceBranding(workspaceId, r.branding);
      setNotice(
        r.branding
          ? `Saved. Everyone in ${workspaceName ?? "this workspace"} now sees these colours.`
          : "Back to the Insyder colours for everyone in this workspace.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the colours");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Branding"
        description={`Show Insyder in your company's colours. They apply to everyone in the ${workspaceName ?? "current"} workspace (you and your team); your other workspaces and other companies are not affected. Only tenant admins can change them.`}
      />

      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]">
            <Palette size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Your colours</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {saved ? "This workspace uses your own colours." : "This workspace uses the Insyder colours."} Pick any
              colours: text on them turns white or black automatically so it always stays readable.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-6 border-t border-[var(--line)] pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={`brand-${f.key}`} className="text-sm font-semibold">
                  {f.label}
                </label>
                <p className="text-xs text-[var(--muted)]">{f.hint}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${f.label} picker`}
                    className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-[var(--input-border)] bg-white p-1"
                    value={isHex(draft[f.key]) ? draft[f.key] : "#000000"}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                  <input
                    id={`brand-${f.key}`}
                    className="w-32 rounded-xl border border-[var(--input-border)] bg-white px-3 py-2 font-mono text-sm uppercase"
                    value={draft[f.key]}
                    maxLength={7}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setDraft((d) => ({ ...d, [f.key]: v.startsWith("#") ? v : `#${v}` }));
                    }}
                  />
                  {!problems[f.key] ? <Check size={16} className="text-[var(--badge-green-fg)]" aria-label="Valid colour" /> : null}
                </div>
                {problems[f.key] ? (
                  <p className="mt-1 text-xs text-[var(--danger)]">{problems[f.key]}</p>
                ) : isLight(draft[f.key]) ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">Light colour: text on it will be black so it stays readable.</p>
                ) : null}
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Preview</p>
            <Preview b={draft} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || !valid || !changed} onClick={() => void save(draft)}>
            {busy ? "Saving…" : "Save colours"}
          </Button>
          {changed ? (
            <Button variant="ghost" disabled={busy} onClick={() => setDraft(current)}>
              Undo changes
            </Button>
          ) : null}
          {saved ? (
            <Button disabled={busy} onClick={() => void save(null)}>
              <span className="inline-flex items-center gap-1.5">
                <RotateCcw size={14} aria-hidden /> Reset to Insyder colours
              </span>
            </Button>
          ) : null}
        </div>
        <FormError message={error} />
        <FormNotice message={notice} />
      </Card>
    </div>
  );
}

export default function BrandingPage() {
  return <RequireCap cap="manage_settings">{(workspaceId) => <BrandingView workspaceId={workspaceId} />}</RequireCap>;
}
