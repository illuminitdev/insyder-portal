"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Lightbulb, Loader2, Mail, Trash2 } from "lucide-react";
import { PortalLink } from "../layout/PortalLink";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { EvidenceItem } from "../../lib/api/accounts";
import {
  BUYING_ROLES,
  createContact,
  createRoleHypothesis,
  createStakeholderBrief,
  deleteContact,
  deleteRoleHypothesis,
  linkRoleHypothesis,
  listAccountPeople,
  type BuyingRole,
  type Contact,
  type RoleHypothesis,
} from "../../lib/api/contacts";
import { Button } from "../ui/Button";
import { FindContacts } from "./FindContacts";
import { Card } from "../ui/Card";
import { Field, FormError, humanize, inputClass } from "../ui/Field";

const EMPTY_CONTACT = {
  name: "",
  title: "",
  buyingRole: "unknown" as BuyingRole,
  email: "",
  phone: "",
  sourceType: "user_entered" as "user_entered" | "evidence",
  evidenceId: "",
  sourceNote: "",
};
const EMPTY_HYPOTHESIS = { roleTitle: "", buyingRole: "unknown" as BuyingRole, rationale: "", evidenceIds: [] as string[] };

function evidenceLabel(e: EvidenceItem) {
  return e.sourceTitle || e.publisher || e.sourceUrl;
}

function deduplicateSourceNote(rawNote: string): string {
  const linkedinMatch = rawNote.match(/LinkedIn:\s*(https?:\/\/(?:[a-zA-Z0-9-]+\.)*linkedin\.com\/[^\s,;)]+)/i);
  if (linkedinMatch && linkedinMatch[1]) {
    const liUrl = linkedinMatch[1].replace(/[.,;)]+$/, "");
    const escaped = liUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1. If Sources only has this exact URL (e.g. ". Sources: <liUrl>"):
    const entireSourcesMatch = new RegExp(`[.,;]?\\s*Sources:\\s*${escaped}[.,;]?`, "gi");
    let cleaned = rawNote.replace(entireSourcesMatch, "");

    // 2. If Sources has other URLs too, remove just the duplicated LinkedIn URL from Sources
    cleaned = cleaned.replace(new RegExp(`(\\bSources:[^.]*?)\\s*${escaped}`, "gi"), "$1");
    return cleaned.trim();
  }
  return rawNote;
}

export function FormattedSourceNote({ note }: { note: string }) {
  const cleanedNote = deduplicateSourceNote(note);
  const urlRegex = /(https?:\/\/[^\s,;]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(cleanedNote)) !== null) {
    const rawMatch = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{cleanedNote.slice(lastIndex, startIndex)}</span>);
    }

    const trailingPunct = rawMatch.match(/[.,;)]+$/)?.[0] ?? "";
    const cleanUrl = rawMatch.slice(0, rawMatch.length - trailingPunct.length);
    const isLinkedIn = /linkedin\.com\//i.test(cleanUrl);

    if (isLinkedIn) {
      const displaySlug = cleanUrl.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*linkedin\.com\/(in\/)?/i, "in/");
      parts.push(
        <a
          key={`url-${startIndex}`}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-[#0a66c2]/10 px-2 py-0.5 text-[11.5px] font-semibold text-[#0a66c2] hover:bg-[#0a66c2]/20 hover:underline transition mx-0.5 align-middle shadow-2xs"
          title={`Open LinkedIn profile: ${cleanUrl}`}
        >
          <svg className="h-3 w-3 fill-current shrink-0" viewBox="0 0 24 24">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
          </svg>
          <span className="truncate max-w-[220px]">{displaySlug}</span>
          <ExternalLink size={10} className="shrink-0 opacity-70" />
        </a>
      );
    } else {
      let displayUrl = cleanUrl.replace(/^https?:\/\/(www\.)?/i, "");
      if (displayUrl.length > 34) {
        displayUrl = displayUrl.slice(0, 32) + "…";
      }
      parts.push(
        <a
          key={`url-${startIndex}`}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-[var(--foreground)] hover:bg-slate-200 hover:text-[var(--brand-active)] hover:underline transition mx-0.5 align-middle shadow-2xs"
          title={`Open source: ${cleanUrl}`}
        >
          <ExternalLink size={11} className="shrink-0 text-[var(--muted)]" />
          <span className="truncate max-w-[220px]">{displayUrl}</span>
        </a>
      );
    }

    if (trailingPunct) {
      parts.push(<span key={`punct-${startIndex}`}>{trailingPunct}</span>);
    }

    lastIndex = startIndex + rawMatch.length;
  }

  if (lastIndex < cleanedNote.length) {
    parts.push(<span key="text-end">{cleanedNote.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

/**
 * People at the account (spec §7 Contact / RoleHypothesis). Sourced contacts and role
 * guesses are separate lists, so a hypothesis is never presented as a real person.
 */
export function PeoplePanel({
  accountId,
  workspaceId,
  evidence,
  onLoaded,
}: {
  accountId: string;
  workspaceId: string;
  evidence: EvidenceItem[];
  /** Told the number of sourced contacts each time the list loads */
  onLoaded?: (contactCount: number) => void;
}) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const { can } = useWorkspace();
  const canEdit = can("qualify");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [hypotheses, setHypotheses] = useState<RoleHypothesis[]>([]);
  const [briefRoles, setBriefRoles] = useState<BuyingRole[]>(["decision_maker", "budget_holder"]);
  // A decision maker just added by hand: ask before writing a role hypothesis (it uses research units)
  const [askBrief, setAskBrief] = useState<{ id: string; name: string } | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<"contact" | "hypothesis" | null>(null);
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [hyp, setHyp] = useState(EMPTY_HYPOTHESIS);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listAccountPeople(accountId, workspaceId);
      setContacts(res.contacts);
      setHypotheses(res.roleHypotheses);
      if (res.briefRoles) setBriefRoles(res.briefRoles);
      onLoadedRef.current?.(res.contacts.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load people");
      setContacts([]);
    }
  }, [accountId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Role hypotheses are written in the background (a few minutes): refresh the cards until they are done
  const writing = (contacts ?? []).some((c) => ["queued", "running", "retrying"].includes(c.latestBrief?.status ?? ""));
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [writing, load]);

  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFormError(null);
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px]">People</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Contacts need a source. The contact search finds up to 2 people. Role hypotheses are on demand: click &ldquo;Run role hypothesis&rdquo; on a decision maker when you need one. &ldquo;Roles to find&rdquo; are roles that matter but have no person yet.
          </p>
        </div>
        {canEdit && !form ? (
          <div className="flex gap-2">
            <Button onClick={() => { setFormError(null); setForm("contact"); }}>Add contact</Button>
            <Button onClick={() => { setFormError(null); setForm("hypothesis"); }}>Add role to find</Button>
          </div>
        ) : null}
      </div>

      {error ? <FormError message={error} /> : null}

      <FindContacts accountId={accountId} workspaceId={workspaceId} canRun={can("research")} onFinished={() => void load()} />

      {form === "contact" ? (
        <form
          className="mt-4 space-y-3 rounded-[10px] border border-[var(--line)] p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            let created: Contact | null = null;
            const ok = await run(async () => {
              created = (await createContact(accountId, workspaceId, {
                name: contact.name,
                title: contact.title || null,
                buyingRole: contact.buyingRole,
                email: contact.email || null,
                phone: contact.phone || null,
                sourceType: contact.sourceType,
                evidenceId: contact.sourceType === "evidence" ? contact.evidenceId || null : null,
                sourceNote: contact.sourceNote || null,
              })).contact;
            });
            if (ok) {
              setContact(EMPTY_CONTACT);
              setForm(null);
              const c = created as Contact | null;
              if (c && briefRoles.includes(c.buyingRole) && can("research")) {
                setBriefError(null);
                setAskBrief({ id: c.id, name: c.name });
              }
            }
          }}
        >
          <h3 className="text-[14px]">Add a sourced contact</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <input className={inputClass} required value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            </Field>
            <Field label="Job title">
              <input className={inputClass} value={contact.title} onChange={(e) => setContact({ ...contact, title: e.target.value })} placeholder="e.g. Head of IT Infrastructure" />
            </Field>
            <Field label="Buying role">
              <select className={inputClass} value={contact.buyingRole} onChange={(e) => setContact({ ...contact, buyingRole: e.target.value as BuyingRole })}>
                {BUYING_ROLES.map((r) => (
                  <option key={r} value={r}>{humanize(r)}</option>
                ))}
              </select>
            </Field>
            <Field label="Where did these details come from?" required>
              <select
                className={inputClass}
                value={contact.sourceType}
                onChange={(e) => setContact({ ...contact, sourceType: e.target.value as "user_entered" | "evidence" })}
              >
                <option value="user_entered">I know this person / told directly</option>
                <option value="evidence" disabled={!evidence.length}>
                  Named in cited evidence{evidence.length ? "" : " (no evidence yet)"}
                </option>
              </select>
            </Field>
            {contact.sourceType === "evidence" ? (
              <Field label="Evidence they appear in" required className="sm:col-span-2">
                <select className={inputClass} required value={contact.evidenceId} onChange={(e) => setContact({ ...contact, evidenceId: e.target.value })}>
                  <option value="">Choose a source…</option>
                  {evidence.map((ev) => (
                    <option key={ev.id} value={ev.id}>{evidenceLabel(ev)}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field
              label={contact.sourceType === "evidence" ? "Source note (optional)" : "Source note"}
              required={contact.sourceType === "user_entered"}
              hint="Who gave you these details, and when."
              className="sm:col-span-2"
            >
              <input
                className={inputClass}
                required={contact.sourceType === "user_entered"}
                value={contact.sourceNote}
                onChange={(e) => setContact({ ...contact, sourceNote: e.target.value })}
                placeholder="e.g. Introduced by our account manager on 14 Oct"
              />
            </Field>
            <Field label="Email (optional)">
              <input className={inputClass} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </Field>
            <Field label="Phone (optional)">
              <input className={inputClass} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Contacts are saved as unverified. Only add details from a real source; never guess an email or phone number.
          </p>
          <FormError message={formError} />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy ||
                !contact.name.trim() ||
                (contact.sourceType === "user_entered" && !contact.sourceNote.trim()) ||
                (contact.sourceType === "evidence" && !contact.evidenceId)
              }
            >
              {busy ? "Saving…" : "Save contact"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {form === "hypothesis" ? (
        <form
          className="mt-4 space-y-3 rounded-[10px] border border-[var(--line)] p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => createRoleHypothesis(accountId, workspaceId, hyp));
            if (ok) {
              setHyp(EMPTY_HYPOTHESIS);
              setForm(null);
            }
          }}
        >
          <h3 className="text-[14px]">Add a role to find</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role" required>
              <input className={inputClass} required value={hyp.roleTitle} onChange={(e) => setHyp({ ...hyp, roleTitle: e.target.value })} placeholder="e.g. Director of Digital Services" />
            </Field>
            <Field label="Buying role">
              <select className={inputClass} value={hyp.buyingRole} onChange={(e) => setHyp({ ...hyp, buyingRole: e.target.value as BuyingRole })}>
                {BUYING_ROLES.map((r) => (
                  <option key={r} value={r}>{humanize(r)}</option>
                ))}
              </select>
            </Field>
            <Field label="Why you think this role matters" required className="sm:col-span-2">
              <textarea
                className={inputClass}
                rows={2}
                required
                value={hyp.rationale}
                onChange={(e) => setHyp({ ...hyp, rationale: e.target.value })}
                placeholder="e.g. Data-centre projects at UK universities are usually owned by the digital services director"
              />
            </Field>
          </div>
          {evidence.length ? (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold text-[var(--muted)]">Supporting evidence (optional)</legend>
              {evidence.map((ev) => (
                <label key={ev.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={hyp.evidenceIds.includes(ev.id)}
                    onChange={(e) =>
                      setHyp({
                        ...hyp,
                        evidenceIds: e.target.checked ? [...hyp.evidenceIds, ev.id] : hyp.evidenceIds.filter((i) => i !== ev.id),
                      })
                    }
                  />
                  <span>{evidenceLabel(ev)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <FormError message={formError} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || !hyp.roleTitle.trim() || !hyp.rationale.trim()}>
              {busy ? "Saving…" : "Save hypothesis"}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {!form && formError ? <div className="mt-3"><FormError message={formError} /></div> : null}

      {askBrief ? (
        <div role="dialog" aria-label="Run role hypothesis" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--card-line)] bg-[#f8f7fd] p-4 text-sm">
          <div className="flex min-w-0 items-start gap-2.5">
            <FileText size={18} className="mt-0.5 shrink-0 text-[#4f46c8]" aria-hidden />
            <div>
              <p className="font-semibold">Run a role hypothesis for {askBrief.name}?</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Researches them in public sources and writes how to approach them: what to lead with, questions and
                objections. Takes a few minutes and uses 2 research units.
              </p>
              {briefError ? <div className="mt-1.5"><FormError message={briefError} /></div> : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="primary"
              disabled={briefBusy}
              onClick={async () => {
                setBriefBusy(true);
                setBriefError(null);
                try {
                  await createStakeholderBrief(accountId, workspaceId, askBrief.id);
                  setAskBrief(null);
                  await load();
                } catch (e) {
                  setBriefError(e instanceof Error ? e.message : "Could not start the role hypothesis");
                } finally {
                  setBriefBusy(false);
                }
              }}
            >
              {briefBusy ? "Starting…" : "Run role hypothesis"}
            </Button>
            <Button variant="ghost" disabled={briefBusy} onClick={() => setAskBrief(null)}>
              Not now
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <h3 className="text-[14px]">
            Contacts <span className="font-normal text-[var(--muted)]">({contacts?.length ?? 0})</span>
          </h3>
          {contacts === null ? (
            <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
          ) : contacts.length ? (
            <ul className="mt-3 space-y-3">
              {contacts.map((c) => {
                const ev = c.evidenceId ? evidenceById.get(c.evidenceId) : undefined;
                return (
                  <li key={c.id} className="flex items-start gap-3 rounded-[16px] border border-[var(--card-line)] bg-white p-4 text-sm shadow-[var(--card-shadow)]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--lilac)] text-[13px] font-semibold text-[#4f46c8]" aria-hidden>
                      {c.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight">{c.name}</p>
                      {c.title ? <p className="mt-0.5 text-[13px] text-[var(--muted)]">{c.title}</p> : null}
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                        <span className="rounded bg-[var(--chip-bg)] px-1.5 py-0.5">{humanize(c.buyingRole)}</span>
                        <span className="rounded bg-[var(--badge-amber-bg)] px-1.5 py-0.5 text-[var(--badge-amber-fg)]">Unverified</span>
                        {c.suppressed ? (
                          <span className="rounded bg-[var(--brand-tint)] px-1.5 py-0.5 font-semibold text-[var(--brand-active)]">Suppressed: do not contact</span>
                        ) : null}
                      </p>
                      {briefRoles.includes(c.buyingRole) && !c.suppressed ? (
                        <StakeholderBriefLink
                          accountId={accountId}
                          workspaceId={workspaceId}
                          contact={c}
                          // While the "Run a role hypothesis for X?" banner above asks about this contact, don't ask twice
                          canGenerate={can("research") && askBrief?.id !== c.id}
                          onStarted={load}
                        />
                      ) : null}
                      {c.email || c.phone ? (
                        <p className="mt-2 flex items-center gap-1.5 text-[13px]">
                          <Mail size={14} className="shrink-0 text-[var(--muted)]" aria-hidden />
                          <span className="min-w-0 break-all">
                            {c.email ? (
                              <>
                                <a
                                  href={`mailto:${c.email}`}
                                  className="text-[var(--foreground)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
                                  title="Open in your mail app"
                                >
                                  {c.email}
                                </a>
                                <a
                                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-2 inline-flex items-center gap-0.5 text-xs text-[var(--muted)] hover:text-[var(--brand)] hover:underline"
                                  title="Write in Gmail"
                                >
                                  Gmail <ExternalLink size={11} aria-hidden />
                                </a>
                              </>
                            ) : null}
                            {c.email && c.phone ? " · " : null}
                            {c.phone ? (
                              <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="hover:text-[var(--brand)] hover:underline">
                                {c.phone}
                              </a>
                            ) : null}
                          </span>
                        </p>
                      ) : null}
                      <div className="mt-3 flex border-t border-[var(--line)] pt-3 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--muted)] leading-relaxed">
                        <span className="font-medium text-[var(--foreground)]">Source:</span>{" "}
                        {ev ? (
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-tint)] px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--brand-active)] hover:bg-[var(--brand)] hover:text-white transition shadow-2xs"
                            title={`Open evidence source: ${ev.sourceUrl}`}
                          >
                            <span>{evidenceLabel(ev)}</span>
                            <ExternalLink size={10} className="shrink-0 opacity-70" />
                          </a>
                        ) : c.sourceType === "evidence" ? (
                          <span>cited evidence</span>
                        ) : null}
                        {c.sourceNote ? (
                          <>
                            {ev || c.sourceType === "evidence" ? <span className="text-[var(--muted)]">·</span> : null}
                            <FormattedSourceNote note={c.sourceNote} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Remove ${c.name}`}
                        title="Remove contact"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Remove ${c.name} from this account?`)) void run(() => deleteContact(accountId, workspaceId, c.id));
                        }}
                        className="shrink-0 rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">No sourced contacts yet.</p>
          )}
        </section>

        <section className="rounded-[16px] border border-[var(--card-line)] bg-[#f8f7fd] p-4">
          <h3 className="flex items-center gap-2 text-[14px]">
            <Lightbulb size={15} className="text-[#4f46c8]" aria-hidden />
            Roles to find <span className="font-normal text-[var(--muted)]">({hypotheses.length})</span>
          </h3>
          {hypotheses.length ? (
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {hypotheses.map((h) => {
                const linked = h.contactId ? contactById.get(h.contactId) : undefined;
                return (
                  <li key={h.id} className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {h.roleTitle}
                        <span className="ml-1.5 rounded bg-[var(--badge-blue-bg)] px-1.5 py-0.5 text-xs font-normal text-[var(--badge-blue-fg)]">
                          Hypothesis
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{humanize(h.buyingRole)} · {h.rationale}</p>
                      {h.evidenceIds.length ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Supported by{" "}
                          {h.evidenceIds
                            .map((id) => evidenceById.get(id))
                            .filter((e): e is EvidenceItem => Boolean(e))
                            .map(evidenceLabel)
                            .join(", ") || "cited evidence"}
                        </p>
                      ) : null}
                      {canEdit && contacts?.length ? (
                        <label className="mt-1.5 flex items-center gap-2 text-xs text-[var(--muted)]">
                          Filled by
                          <select
                            className="rounded border border-[var(--input-border)] bg-white px-1.5 py-0.5 text-xs text-[var(--foreground)]"
                            value={h.contactId ?? ""}
                            disabled={busy}
                            onChange={(e) => void run(() => linkRoleHypothesis(accountId, workspaceId, h.id, e.target.value || null))}
                          >
                            <option value="">Nobody found yet</option>
                            {contacts.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </label>
                      ) : linked ? (
                        <p className="mt-1 text-xs">Filled by {linked.name}</p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Remove hypothesis ${h.roleTitle}`}
                        title="Remove hypothesis"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Remove the "${h.roleTitle}" hypothesis?`)) void run(() => deleteRoleHypothesis(accountId, workspaceId, h.id));
                        }}
                        className="shrink-0 rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--brand-tint)] hover:text-[var(--brand-active)]"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-[var(--muted)]">No roles to find yet. Add one when you think a role matters but have no person for it.</p>
          )}
        </section>
      </div>
    </Card>
  );
}

/**
 * Contact card action for a decision maker. With a role hypothesis (ready or being written) it links to it.
 * Without one (they are on demand only, or the last one failed) it asks the user and
 * offers a "Run role hypothesis" button that starts it right here.
 */
function StakeholderBriefLink({
  accountId,
  workspaceId,
  contact,
  canGenerate,
  onStarted,
}: {
  accountId: string;
  workspaceId: string;
  contact: Contact;
  canGenerate: boolean;
  onStarted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = contact.latestBrief?.status;
  const writing = status === "queued" || status === "running" || status === "retrying";
  const ready = status === "completed" || status === "completed_refreshing";
  if (!status && !canGenerate) return null;
  if (!writing && !ready && canGenerate) {
    const failed = status === "failed";
    const href = `/accounts/stakeholder?accountId=${accountId}&contactId=${contact.id}`;
    return (
      <div className="mt-2.5 rounded-[10px] border border-dashed border-[#c9c4f0] bg-[#f8f7fd] px-3 py-2.5 text-xs">
        <p className="flex items-center gap-1.5 font-semibold text-[#4f46c8]">
          <FileText size={13} aria-hidden />
          {failed ? "The last role hypothesis failed. Run it again?" : "No role hypothesis yet. Run one for this contact?"}
        </p>
        <p className="mt-0.5 text-[var(--muted)]">Takes a few minutes and uses 2 research units.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await createStakeholderBrief(accountId, workspaceId, contact.id);
                await onStarted();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not start the role hypothesis");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Starting…" : "Run role hypothesis"}
          </Button>
          <PortalLink href={href} className="font-semibold text-[#4f46c8] hover:underline">
            Add a meeting note first
          </PortalLink>
        </div>
        {err ? <div className="mt-1.5"><FormError message={err} /></div> : null}
      </div>
    );
  }
  return (
    <PortalLink
      href={`/accounts/stakeholder?accountId=${accountId}&contactId=${contact.id}`}
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--card-line)] bg-[#f8f7fd] px-2.5 py-1 text-xs font-semibold text-[#4f46c8] hover:border-[#4f46c8]"
      title="Role hypothesis: who they are, how they likely evaluate ideas, what to lead with and what to ask"
    >
      {writing ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileText size={13} aria-hidden />}
      {writing ? "Writing role hypothesis…" : ready ? "View role hypothesis" : "Generate role hypothesis"}
    </PortalLink>
  );
}
