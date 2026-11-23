"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  ExternalLink,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { PortalLink as Link } from "@/components/layout/PortalLink";
import { RequireCap } from "@/components/common/RequireCap";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FormError, humanize, inputClass } from "@/components/ui/Field";
import { formatDate } from "@/lib/utils/dates";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  MEETING_TYPES,
  createStakeholderBrief,
  listStakeholderBriefs,
  type BriefMeeting,
  type BriefOfferPick,
  type StakeholderBrief,
  type StakeholderBriefContent,
} from "@/lib/api/contacts";

type PageData = Awaited<ReturnType<typeof listStakeholderBriefs>>;

const ACTIVE = ["queued", "running", "retrying"];
const EMPTY_MEETING: BriefMeeting = { meetingType: "first_meeting", meetingDate: "", purpose: "", knownContext: "" };

// ---------- Small building blocks ----------

function Section({ n, title, children }: { n?: number; title: string; children: React.ReactNode }) {
  return (
    <section className="brief-section rounded-[16px] border border-[var(--card-line)] bg-white p-5 shadow-[var(--card-shadow)] print:shadow-none">
      <h2 className="brief-section-head text-[17px] font-semibold">
        {n ? <span className="mr-2 text-[var(--brand)]">{n}.</span> : null}
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Para({ label, text }: { label?: string; text: string }) {
  if (!text) return null;
  return (
    <p>
      {label ? <span className="font-semibold">{label}: </span> : null}
      {text}
    </p>
  );
}

function Bullets({ title, items, icon: Icon }: { title?: string; items: string[]; icon?: LucideIcon }) {
  if (!items.length) return null;
  return (
    <div>
      {title ? <h3 className="mb-1.5 text-[14px] font-semibold">{title}</h3> : null}
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            {Icon ? <Icon size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden /> : <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" aria-hidden />}
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Picks({ title, tone, items }: { title: string; tone: string; items: BriefOfferPick[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`mb-2 inline-block rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${tone}`}>{title}</h3>
      <ol className="space-y-2">
        {items.map((p, i) => (
          <li key={p.offer} className="brief-tile rounded-[10px] border border-[var(--line)] p-3">
            <p className="font-semibold">
              {i + 1}. {p.offer}
            </p>
            {p.why ? <p className="mt-0.5 text-[var(--muted)]">{p.why}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- The brief ----------

function BriefBody({ b }: { b: StakeholderBriefContent }) {
  const tb = b.tacticalBrief;
  return (
    <div className="space-y-5 print:space-y-3">
      <Section n={1} title="Meeting context">
        <Para text={b.meetingContext.opening} />
        <Para label="Posture" text={b.meetingContext.posture} />
        <Para label="Central tension" text={b.meetingContext.centralTension} />
      </Section>

      <Section n={2} title="Who you are talking to">
        <Para text={b.whoTheyAre.summary} />
        <Para label="Background" text={b.whoTheyAre.background} />
        <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
          <Bullets title="Likely controls or shapes" items={b.whoTheyAre.controls} />
          <Bullets title="Likely does not control directly" items={b.whoTheyAre.doesNotControl} />
        </div>
        <div className="brief-tile rounded-[12px] bg-[#f8f7fd] p-4">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            <Lightbulb size={15} className="text-[#4f46c8]" aria-hidden /> Cognitive &amp; commercial overlay
          </h3>
          <div className="mt-2 space-y-2">
            <Para label="Likely evaluation lens" text={b.overlay.evaluationLens} />
            <Para label="Likely engagement style" text={b.overlay.engagementStyle} />
            <Para label="Commercial implication" text={b.overlay.commercialImplication} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
          <Bullets title="Likely credibility builders" items={b.overlay.credibilityBuilders} icon={CheckCircle2} />
          <Bullets title="Likely credibility risks" items={b.overlay.credibilityRisks} icon={ShieldAlert} />
        </div>
        <Bullets title="How the seller should adapt" items={b.overlay.howToAdapt} />
      </Section>

      <Section n={3} title="Their world right now">
        <Para label="Commercial position" text={b.theirWorld.companyPosition} />
        <Para label="The gap" text={b.theirWorld.gap} />
        <Para label="Immediate opportunity" text={b.theirWorld.immediateOpportunity} />
        <Bullets title="Other openings" items={b.theirWorld.otherOpportunities} />
      </Section>

      <Section n={4} title="Our offer, ranked for this person">
        {b.offerRanking.leadWith.length + b.offerRanking.supportWith.length + b.offerRanking.holdInReserve.length === 0 ? (
          <p className="text-[var(--muted)]">
            No products were ranked. Add your products in Settings → Offer &amp; targeting, then regenerate.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3">
          <Picks title="Lead with" tone="bg-[var(--badge-green-bg)] text-[var(--badge-green-fg)]" items={b.offerRanking.leadWith} />
          <Picks title="Support with" tone="bg-[var(--badge-blue-bg)] text-[var(--badge-blue-fg)]" items={b.offerRanking.supportWith} />
          <Picks title="Hold in reserve" tone="bg-[var(--chip-bg)] text-[var(--muted)]" items={b.offerRanking.holdInReserve} />
        </div>
        <Bullets title="Avoid" items={b.offerRanking.avoid} icon={Ban} />
      </Section>

      <Section n={5} title="Recommended commercial shape">
        {b.commercialShape.name ? (
          <p className="font-semibold">
            {b.commercialShape.name}
            {b.commercialShape.duration ? <span className="font-normal text-[var(--muted)]"> · {b.commercialShape.duration}</span> : null}
          </p>
        ) : null}
        <Bullets items={b.commercialShape.steps} />
        <Para label="Commercial principle" text={b.commercialShape.principle} />
      </Section>

      <Section n={6} title="How to run the meeting">
        <Para label="Opening approach" text={b.meetingPlan.openingApproach} />
        <Bullets title="Conversation bridges" items={b.meetingPlan.bridges} icon={MessageSquareQuote} />
        {b.meetingPlan.questions.length ? (
          <div>
            <h3 className="mb-1.5 text-[14px] font-semibold">Questions that would move the opportunity forward</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {b.meetingPlan.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <Bullets title="Signals to listen for" items={b.meetingPlan.signalsToListenFor} />
        <Para label="The ask" text={b.meetingPlan.theAsk} />
      </Section>

      {b.objections.length ? (
        <Section n={7} title="Objections and how to handle them">
          {b.objections.map((o, i) => (
            <div key={i} className="brief-tile rounded-[10px] border border-[var(--line)] p-3.5">
              <p className="font-semibold">“{o.objection}”</p>
              <p className="mt-1">
                <span className="font-semibold">Response: </span>
                {o.response}
              </p>
              {o.whatNotToDo ? (
                <p className="mt-1 text-[var(--muted)]">
                  <span className="font-semibold">What not to do: </span>
                  {o.whatNotToDo}
                </p>
              ) : null}
            </div>
          ))}
        </Section>
      ) : null}

      {b.unknowns.length ? (
        <Section n={8} title="What you do not know yet">
          <Bullets items={b.unknowns} icon={HelpCircle} />
        </Section>
      ) : null}

      <Section n={9} title="Tactical brief">
        <Para label="The stakeholder" text={tb.stakeholder} />
        <Para label="The situation" text={tb.situation} />
        <Para label="Lead with" text={tb.leadWith} />
        <Para label="Support with" text={tb.supportWith} />
        <Para label="Do not lead with" text={tb.doNotLeadWith} />
        <Para label="Best next step" text={tb.bestNextStep} />
        {tb.demonstrationQuestion ? (
          <div className="brief-tile rounded-[12px] border-l-4 border-[var(--brand)] bg-[var(--brand-tint)] p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand-active)]">The question to leave them with</p>
            <p className="mt-1 font-semibold">{tb.demonstrationQuestion}</p>
          </div>
        ) : null}
      </Section>

      {b.messageGuide.length ? (
        <Section n={10} title="Message guide">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[var(--chip-bg)] text-left">
                <th className="px-3 py-2 font-semibold">Use</th>
                <th className="px-3 py-2 font-semibold">Avoid</th>
              </tr>
            </thead>
            <tbody>
              {b.messageGuide.map((m, i) => (
                <tr key={i} className="border-b border-[var(--line)] align-top">
                  <td className="px-3 py-2">“{m.use}”</td>
                  <td className="px-3 py-2 text-[var(--muted)]">{m.avoid ? `“${m.avoid}”` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {b.sources.length ? (
        <Section title="Sources">
          <ul className="space-y-1">
            {b.sources.map((s) => (
              <li key={s.url} className="flex items-start gap-1.5 break-all text-xs">
                <ExternalLink size={12} className="mt-0.5 shrink-0 text-[var(--muted)] print:hidden" aria-hidden />
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#4f46c8] hover:underline">
                  {s.title || s.url}
                </a>
                {s.title ? <span className="hidden text-[var(--muted)] print:inline"> ({s.url})</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

// ---------- Meeting form ----------

function MeetingForm({
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  initial: BriefMeeting;
  busy: boolean;
  error: string | null;
  onSubmit: (m: BriefMeeting) => void;
  onCancel?: () => void;
}) {
  const [m, setM] = useState<BriefMeeting>(initial);
  return (
    <Card>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            meetingType: m.meetingType,
            meetingDate: m.meetingDate?.trim() || null,
            purpose: m.purpose.trim(),
            knownContext: m.knownContext?.trim() || null,
          });
        }}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand)]">
            <Sparkles size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">Tell us about the meeting</h2>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              The brief researches this person in public sources and shapes everything around this meeting. It takes a few
              minutes and uses 2 research units.
            </p>
          </div>
        </div>
        <div className="grid gap-x-6 gap-y-4 border-t border-[var(--line)] pt-4 md:grid-cols-2">
          <Field label="Meeting type">
            <select className={inputClass} value={m.meetingType} onChange={(e) => setM({ ...m, meetingType: e.target.value as BriefMeeting["meetingType"] })}>
              {MEETING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Meeting date (optional)">
            <input className={inputClass} type="date" value={m.meetingDate ?? ""} onChange={(e) => setM({ ...m, meetingDate: e.target.value })} />
          </Field>
          <Field label="What is the meeting for? *" className="md:col-span-2">
            <textarea
              className={inputClass}
              rows={2}
              maxLength={600}
              required
              value={m.purpose}
              onChange={(e) => setM({ ...m, purpose: e.target.value })}
              placeholder="e.g. Lunch to follow up our first call and get permission to build one worked example for a partner"
            />
          </Field>
          <Field label="What do you already know? (optional)" hint="Notes from earlier calls, what they said, who introduced you" className="md:col-span-2">
            <textarea
              className={inputClass}
              rows={4}
              maxLength={2000}
              value={m.knownContext ?? ""}
              onChange={(e) => setM({ ...m, knownContext: e.target.value })}
              placeholder="e.g. She ran a 155-person training programme and asked how role-play would work. Interested in bringing back community events."
            />
          </Field>
        </div>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy || m.purpose.trim().length < 3}>
            {busy ? "Starting…" : "Generate role hypothesis"}
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

// ---------- Page ----------

function StakeholderBriefView({ workspaceId, accountId, contactId }: { workspaceId: string; accountId: string; contactId: string }) {
  const { workspaceName } = useWorkspace();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listStakeholderBriefs(accountId, workspaceId, contactId);
      setData(res);
      setError(null);
      return res;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the brief");
      return null;
    }
  }, [accountId, workspaceId, contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = data?.briefs[0];
  const running = latest && ACTIVE.includes(latest.status) ? latest : null;

  // Poll while a brief is being written
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [running, load]);

  if (!accountId || !contactId) return <ErrorState message="No contact chosen." />;
  if (!data) return error ? <ErrorState message={error} /> : <LoadingState />;

  const completed = data.briefs.filter((b) => b.status === "completed" && b.content);
  const shown: StakeholderBrief | undefined = completed.find((b) => b.id === selectedId) ?? completed[0];
  const lastFailed = latest && (latest.status === "failed" || latest.status === "cancelled") ? latest : null;
  const showForm = data.canGenerate && !running && (formOpen || (!completed.length && !lastFailed));
  const companyName = data.account?.name ?? "";

  async function generate(m: BriefMeeting) {
    setBusy(true);
    setFormError(null);
    try {
      await createStakeholderBrief(accountId, workspaceId, contactId, m);
      setFormOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not start the brief");
    } finally {
      setBusy(false);
    }
  }

  function exportPdf() {
    const previous = document.title;
    const day = new Date().toISOString().slice(0, 10);
    document.title = ["Role hypothesis", data!.contact.name, companyName, day].filter(Boolean).join(" - ");
    window.addEventListener("afterprint", () => (document.title = previous), { once: true });
    window.print();
  }

  return (
    <div className="brief-print space-y-5 print:space-y-3">
      <Link
        href={`/accounts/detail?id=${accountId}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] print:hidden"
      >
        <ArrowLeft size={15} aria-hidden /> Back to {companyName || "account"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">Contact role hypothesis</p>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight">
            {data.contact.name}
            {companyName ? <span className="font-normal text-[var(--muted)]">, {companyName}</span> : null}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {[data.contact.title, humanize(data.contact.buyingRole)].filter(Boolean).join(" · ")}
          </p>
          {shown ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {[
                shown.meeting.auto
                  ? "Prepared for a first conversation (no meeting note)"
                  : MEETING_TYPES.find((t) => t.value === shown.meeting.meetingType)?.label,
                shown.meeting.meetingDate ? `Meeting ${formatDate(shown.meeting.meetingDate)}` : null,
                `Generated ${formatDate(shown.completedAt ?? shown.createdAt)}`,
                workspaceName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {completed.length > 1 ? (
            <select
              aria-label="Brief version"
              className="rounded-xl border border-[var(--input-border)] bg-white px-2.5 py-2 text-sm"
              value={shown?.id ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {completed.map((b, i) => (
                <option key={b.id} value={b.id}>
                  {i === 0 ? "Latest" : `Version ${completed.length - i}`} · {formatDate(b.completedAt ?? b.createdAt)}
                </option>
              ))}
            </select>
          ) : null}
          {data.canGenerate && completed.length && !running && !formOpen ? (
            <Button onClick={() => setFormOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={15} aria-hidden /> Regenerate
              </span>
            </Button>
          ) : null}
          {shown ? (
            <Button variant="primary" onClick={exportPdf} title="Save this brief as a PDF">
              <span className="inline-flex items-center gap-1.5">
                <Download size={15} aria-hidden /> Export PDF
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="brief-tile rounded-[12px] border border-[var(--card-line)] bg-[#f8f7fd] p-3.5 text-xs leading-relaxed text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">How to read this: </span>
        built from public sources, the account research and what you told us about the meeting. It is preparation, not a
        personality diagnosis: every point is a working hypothesis to check in conversation and correct over time. Nothing
        here is verified.
      </p>

      {running ? (
        <Card>
          <div className="flex items-center gap-3 text-sm" role="status">
            <Loader2 size={20} className="animate-spin text-[var(--brand)]" aria-hidden />
            <div className="flex-1">
              <p className="font-semibold">Researching {data.contact.name} and writing the role hypothesis…</p>
              <p className="text-xs text-[var(--muted)]">This usually takes a few minutes. You can leave this page; it keeps going.</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip-bg)]">
                <div className="h-full rounded-full bg-[var(--brand)] transition-all" style={{ width: `${Math.max(5, running.progressPct)}%` }} />
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {lastFailed && !formOpen ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-[var(--badge-amber-bg)] p-3.5 text-sm text-[var(--badge-amber-fg)] print:hidden">
          <span>The last brief could not be written{lastFailed.errorMessage ? `: ${lastFailed.errorMessage}` : "."}</span>
          {data.canGenerate ? <Button onClick={() => setFormOpen(true)}>Try again</Button> : null}
        </div>
      ) : null}

      {shown?.meeting.auto && data.canGenerate && !running && !formOpen ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--card-line)] bg-white p-3.5 text-sm print:hidden">
          <span>Written without a meeting note. Have a meeting booked? Add what it is for and regenerate for a sharper version.</span>
          <Button onClick={() => setFormOpen(true)}>Add meeting note</Button>
        </div>
      ) : null}

      {showForm ? (
        <div className="print:hidden">
          <MeetingForm
            initial={latest ? { ...EMPTY_MEETING, ...latest.meeting } : EMPTY_MEETING}
            busy={busy}
            error={formError}
            onSubmit={(m) => void generate(m)}
            onCancel={completed.length || lastFailed ? () => setFormOpen(false) : undefined}
          />
        </div>
      ) : null}

      {!data.canGenerate && !completed.length && !running ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No brief yet.{" "}
            {data.contact.buyingRole === "decision_maker" || data.contact.buyingRole === "budget_holder"
              ? "Ask a researcher to generate one."
              : "Role hypotheses are written for decision makers and budget holders."}
          </p>
        </Card>
      ) : null}

      {shown?.content ? <BriefBody b={shown.content} /> : null}

      <p className="hidden text-center text-[10px] text-[var(--muted)] print:block">
        Confidential · Contact role hypothesis: {data.contact.name}
        {companyName ? `, ${companyName}` : ""} · working hypotheses, not verified
      </p>
    </div>
  );
}

export default function StakeholderBriefPage() {
  const params = useSearchParams();
  const accountId = params.get("accountId") ?? "";
  const contactId = params.get("contactId") ?? "";
  return (
    <RequireCap cap="view_accounts">
      {(workspaceId) => <StakeholderBriefView workspaceId={workspaceId} accountId={accountId} contactId={contactId} />}
    </RequireCap>
  );
}
