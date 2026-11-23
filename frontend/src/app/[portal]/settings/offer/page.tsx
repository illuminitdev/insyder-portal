"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import { useEffect, useState } from "react";
import {
  Ban,
  CalendarDays,
  FileText,
  Globe,
  Layers,
  MapPin,
  Pencil,
  ShieldCheck,
  Workflow,
  Tag,
  Target,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import {
  getAcceptanceGates,
  getOffer,
  saveAcceptanceGates,
  saveOffer,
  saveSkipReview,
} from "@/lib/api/settings";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FormError, FormNotice, humanize, inputClass } from "@/components/ui/Field";
import { CountryPicker } from "@/components/ui/CountryPicker";
import { countryName } from "@/lib/countries";
import { OfferProductsCard } from "@/components/settings/OfferProductsCard";
import { CompanyProfileCard } from "@/components/settings/CompanyProfileCard";

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Exclusions are one per line: company names can contain commas */
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

type OfferForm = {
  offering: string;
  website: string;
  buyerRoles: string;
  industries: string;
  companySizes: string;
  territory: string;
  exclusions: string;
  eventWindowDays: string;
  naturalLanguageBrief: string;
};

/** Card heading with a red-tinted icon, title and one-line description. */
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]">
          <Icon size={20} strokeWidth={1.75} aria-hidden />
        </span>
        <div>
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/** One saved answer: icon + label on the left, value on the right; empty reads "Not set". */
function SavedRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const empty = !value.trim();
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-start gap-3 border-b border-[var(--line)] py-3.5">
      <dt className="flex items-center gap-2.5 text-sm text-[var(--muted)]">
        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-[var(--brand)]" aria-hidden />
        {label}
      </dt>
      <dd
        className={`whitespace-pre-line text-sm ${empty ? "text-[var(--muted)]" : "font-semibold text-[var(--foreground)]"}`}
      >
        {empty ? "Not set" : value}
      </dd>
    </div>
  );
}

function OfferSettings({ workspaceId }: { workspaceId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState<number | undefined>();
  const [form, setForm] = useState<OfferForm>({
    offering: "",
    website: "",
    buyerRoles: "",
    industries: "",
    companySizes: "",
    territory: "",
    exclusions: "",
    eventWindowDays: "",
    naturalLanguageBrief: "",
  });
  // What is saved on the server: shown read-only, and restored when an edit is cancelled
  const [saved, setSaved] = useState<OfferForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [structured, setStructured] = useState<Record<string, unknown> | null>(null);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const [gates, setGates] = useState<string[]>([]);
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [skipReview, setSkipReview] = useState(false);
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  // Bumped when website suggestions are applied, so the forms below reload what was saved
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!savedOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSavedOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [savedOpen]);

  useEffect(() => {
    Promise.all([getOffer(workspaceId), getAcceptanceGates(workspaceId)])
      .then(([r, g]) => {
        const o = r.offer;
        if (o) {
          setVersion(o.version);
          const loadedForm: OfferForm = {
            offering: o.offering,
            website: o.sellerWebsite ?? "",
            buyerRoles: o.buyerRoles.join(", "),
            industries: o.industries.join(", "),
            companySizes: o.companySizes.join(", "),
            territory: o.territory.join(", "),
            exclusions: o.exclusions.join("\n"),
            eventWindowDays: String(o.eventWindowDays),
            naturalLanguageBrief: o.naturalLanguageBrief ?? "",
          };
          setForm(loadedForm);
          setStructured(o.structuredQuery);
          setUnsupported(o.unsupportedFilters);
          if (o.offering.trim()) {
            setSaved(loadedForm);
          } else {
            // Only a website analysis so far: targeting isn't set up yet, keep the form open
            setSaved(null);
            setEditing(true);
          }
        } else {
          // Nothing saved yet: start with the form open
          setEditing(true);
        }
        setGates(g.gates.requiredKnownFields);
        setSkipReview(Boolean(g.gates.skipReview));
        setFieldKeys(g.fieldKeys);
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load settings"));
  }, [workspaceId, reloadKey]);

  if (!loaded) return error ? <ErrorState message={error} /> : <LoadingState />;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Offer & targeting"
        description="What you sell and who to look for. Discovery and research use these as defaults; anything that can't be applied as a filter is listed rather than silently ignored."
      />
      <CompanyProfileCard
        workspaceId={workspaceId}
        firstTime={!saved}
        onApplied={() => {
          setEditing(false);
          setReloadKey((k) => k + 1);
        }}
      />
      <Card>
        {!editing && saved ? (
          <div>
            <SectionHeader
              icon={Target}
              title="Your targeting"
              description="Discovery and research use these as defaults."
              action={
                <Button
                  aria-label="Edit targeting"
                  title="Edit targeting"
                  onClick={() => {
                    setNotice(null);
                    setError(null);
                    setEditing(true);
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Pencil size={15} aria-hidden /> Edit
                  </span>
                </Button>
              }
            />
            <dl className="mt-5 grid gap-x-10 border-t border-[var(--line)] md:grid-cols-2">
              <div>
                <SavedRow icon={Tag} label="What do you sell?" value={saved.offering} />
                <SavedRow icon={Globe} label="Your website" value={saved.website} />
                <SavedRow icon={MapPin} label="Territory" value={list(saved.territory).map(countryName).join(", ")} />
                <SavedRow icon={Layers} label="Industries" value={saved.industries} />
                <SavedRow
                  icon={CalendarDays}
                  label="Event window"
                  value={saved.eventWindowDays ? `${saved.eventWindowDays} days` : ""}
                />
                <SavedRow icon={FileText} label="Natural-language brief" value={saved.naturalLanguageBrief} />
              </div>
              <div>
                <SavedRow icon={Users} label="Target buyer functions" value={saved.buyerRoles} />
                <SavedRow icon={Ban} label="Excluded accounts" value={saved.exclusions} />
                <SavedRow icon={UsersRound} label="Company sizes (employees)" value={saved.companySizes} />
              </div>
            </dl>
            <div className="mt-4">
              <FormNotice message={notice} />
            </div>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              setNotice(null);
              // Native `required` accepts "," or whitespace, which would save as an empty list
              const missing = (
                [
                  ["What do you sell?", form.offering.trim()],
                  ["Target buyer functions", list(form.buyerRoles).length],
                  ["Territory", list(form.territory).length],
                ] as const
              )
                .filter(([, ok]) => !ok)
                .map(([name]) => name);
              if (missing.length) {
                setError(`Please answer: ${missing.join(", ")}`);
                return;
              }
              try {
                const res = await saveOffer(workspaceId, {
                  offering: form.offering.trim(),
                  buyerRoles: list(form.buyerRoles),
                  industries: list(form.industries),
                  companySizes: list(form.companySizes),
                  territory: list(form.territory),
                  exclusions: lines(form.exclusions),
                  eventWindowDays: Number(form.eventWindowDays) || 90,
                  naturalLanguageBrief: form.naturalLanguageBrief || undefined,
                  sellerWebsite: form.website.trim() || null,
                  expectedVersion: version,
                });
                const firstSave = !saved;
                const savedForm: OfferForm = {
                  ...form,
                  website: res.sellerWebsite ?? "",
                  territory: res.territory.join(", "),
                  eventWindowDays: String(Number(form.eventWindowDays) || 90),
                };
                setVersion((v) => (v ?? 0) + 1);
                setForm(savedForm);
                setSaved(savedForm);
                setEditing(false);
                setStructured(res.structuredQuery);
                setUnsupported(res.unsupportedFilters);
                setNotice("Targeting saved.");
                // The "what next" prompt only after the very first save
                if (firstSave) setSavedOpen(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not save");
              }
            }}
          >
            <SectionHeader
              icon={Target}
              title={saved ? "Edit targeting" : "Set up targeting"}
              description="Discovery and research use these as defaults. Fields marked * are required."
            />
            {/* Same fields and order as the saved summary */}
            <div className="grid gap-x-6 gap-y-4 border-t border-[var(--line)] pt-5 md:grid-cols-2">
              <Field label="What do you sell? *">
                <input
                  className={inputClass}
                  value={form.offering}
                  onChange={set("offering")}
                  placeholder="e.g. Specialist technology recruitment"
                />
              </Field>
              <Field
                label="Your company website"
                hint="Optional. Role hypotheses read it to learn your services, sectors and case studies."
              >
                <input
                  className={inputClass}
                  type="text"
                  inputMode="url"
                  value={form.website}
                  onChange={set("website")}
                  placeholder="e.g. yourcompany.com"
                />
              </Field>
              <Field label="Target buyer functions *" hint="Separate with commas">
                <input
                  className={inputClass}
                  value={form.buyerRoles}
                  onChange={set("buyerRoles")}
                  placeholder="e.g. Hiring manager, talent acquisition, IT leadership"
                />
              </Field>
              {/* Not a <Field> (a <label>): clicking the label would trigger the first chip's remove button */}
              <div role="group" aria-labelledby="territory-label" className="block text-xs font-semibold text-[var(--muted)]">
                <span id="territory-label">Territory *</span>
                <CountryPicker
                  labelledBy="territory-label"
                  value={list(form.territory)}
                  onChange={(codes) => setForm((f) => ({ ...f, territory: codes.join(", ") }))}
                  placeholder="Choose the countries you sell into…"
                />
                <span className="mt-1 block font-normal">Pick one or more. Searches default to these countries.</span>
              </div>
              <Field label="Excluded accounts" hint="One company name or website domain per line">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.exclusions}
                  onChange={set("exclusions")}
                  placeholder={"e.g. Existing Client Ltd\ncompetitor.com"}
                />
              </Field>
              <Field label="Industries" hint="Separate with commas">
                <input
                  className={inputClass}
                  value={form.industries}
                  onChange={set("industries")}
                  placeholder="e.g. Financial Services, Healthcare"
                />
              </Field>
              <Field label="Company sizes (employees)" hint="Separate with commas">
                <input
                  className={inputClass}
                  value={form.companySizes}
                  onChange={set("companySizes")}
                  placeholder="e.g. 200-1000, 1000+"
                />
              </Field>
              <Field label="Event window (days)" hint="Signals older than this count as stale">
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={3650}
                  inputMode="numeric"
                  value={form.eventWindowDays}
                  onChange={set("eventWindowDays")}
                  placeholder="90"
                />
              </Field>
              <Field label="Natural-language brief" className="md:col-span-2">
                <textarea
                  className={inputClass}
                  rows={2}
                  value={form.naturalLanguageBrief}
                  onChange={set("naturalLanguageBrief")}
                  placeholder="e.g. UK banks and insurers expanding data centres or refreshing servers"
                />
              </Field>
            </div>

            <FormError message={error} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary">
                Save targeting
              </Button>
              {saved ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Discard unsaved changes
                    setForm(saved);
                    setError(null);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        )}

        {unsupported.length ? (
          <div role="alert" className="mt-4 rounded-[7px] bg-[var(--badge-amber-bg)] p-3 text-sm text-[var(--badge-amber-fg)]">
            <p className="font-semibold">Not applied as filters:</p>
            <ul className="mt-1 list-disc pl-5">
              {unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {structured && (structured as { fromBrief?: unknown }).fromBrief ? (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer font-semibold">How the brief was understood</summary>
            <pre className="mt-2 overflow-auto rounded bg-[var(--chip-bg)] p-3 text-xs">
              {JSON.stringify((structured as { fromBrief: unknown }).fromBrief, null, 2)}
            </pre>
          </details>
        ) : null}
      </Card>

      <OfferProductsCard key={reloadKey} workspaceId={workspaceId} />

      <Card>
        <SectionHeader
          icon={Workflow}
          title="Workflow"
          description="How a lead moves from research to selling. You can change this at any time; leads already waiting for a sales review stay there."
        />
        <fieldset className="mt-5 grid gap-3 md:grid-cols-2">
          <legend className="sr-only">Workflow</legend>
          {(
            [
              {
                value: false,
                title: "With sales review (4 steps)",
                steps: "Research → Qualify & send → Sales decision → Sell",
                blurb: "A researcher sends each lead to a named sales reviewer, who accepts it and picks the owner. Best for larger teams.",
              },
              {
                value: true,
                title: "Skip sales review (3 steps)",
                steps: "Research → Qualify & accept → Sell",
                blurb: "Whoever qualifies a lead accepts it and picks who works it: themselves or a teammate. Best for small teams or one person.",
              },
            ] as const
          ).map((o) => {
            const on = skipReview === o.value;
            return (
              <label
                key={String(o.value)}
                className={`flex cursor-pointer flex-col gap-1.5 rounded-[12px] border p-4 transition ${
                  on
                    ? "border-[var(--brand)] bg-[var(--brand-tint)] shadow-[0_0_0_1px_var(--brand)]"
                    : "border-[var(--line)] bg-white hover:border-[var(--input-border)]"
                } ${workflowSaving ? "pointer-events-none opacity-70" : ""}`}
              >
                <input
                  type="radio"
                  name="workflow"
                  className="sr-only"
                  checked={on}
                  onChange={async () => {
                    setWorkflowNotice(null);
                    setError(null);
                    setWorkflowSaving(true);
                    try {
                      const r = await saveSkipReview(workspaceId, o.value);
                      setSkipReview(Boolean(r.gates.skipReview));
                      setWorkflowNotice(
                        o.value
                          ? "Saved. Leads are now accepted by whoever qualifies them; no separate sales review."
                          : "Saved. Leads now go to a sales reviewer before selling.",
                      );
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Could not save the workflow");
                    } finally {
                      setWorkflowSaving(false);
                    }
                  }}
                />
                <span className="text-[14.5px] font-semibold text-[var(--foreground)]">{o.title}</span>
                <span className="text-xs font-semibold text-[var(--brand-active)]">{o.steps}</span>
                <span className="text-[12.5px] leading-snug text-[var(--muted)]">{o.blurb}</span>
              </label>
            );
          })}
        </fieldset>
        <FormNotice message={workflowNotice} />
      </Card>

      <Card>
        <SectionHeader
          icon={ShieldCheck}
          title="Acceptance gates"
          description="Brief fields that must be known (not “unknown”) before a reviewer can accept. Reviewed evidence, an owner, a next action and no active suppression are always required. Unknown budget doesn’t block acceptance unless you tick it here."
        />
        <div className="mt-5 grid gap-x-6 gap-y-3 rounded-[10px] border border-[var(--line)] p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {fieldKeys.map((k) => (
            <label key={k} className="flex items-center gap-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--brand)]"
                checked={gates.includes(k)}
                onChange={(e) => setGates((g) => (e.target.checked ? [...g, k] : g.filter((x) => x !== k)))}
              />
              {humanize(k)}
            </label>
          ))}
        </div>
        <Button
          variant="primary"
          className="mt-5 px-5 py-2.5"
          onClick={async () => {
            setGateNotice(null);
            try {
              await saveAcceptanceGates(workspaceId, gates);
              setGateNotice("Acceptance gates saved.");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save gates");
            }
          }}
        >
          Save gates
        </Button>
        <FormNotice message={gateNotice} />
      </Card>

      {savedOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setSavedOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="offer-saved-title"
            className="w-full max-w-md rounded-[10px] border-t-4 border-[var(--brand)] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="offer-saved-title" className="text-[18px]">
              Targeting saved
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Your offer and targeting are now the defaults for discovery. Next step: head to Discover to find prospects
              that match.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setSavedOpen(false)}>Stay here</Button>
              <Link
                href="/researcher/search"
                autoFocus
                className="inline-flex items-center justify-center rounded-[7px] border border-transparent bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-hover)]"
              >
                Go to Discover →
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function OfferSettingsPage() {
  return <RequireCap cap="manage_settings">{(workspaceId) => <OfferSettings workspaceId={workspaceId} />}</RequireCap>;
}
