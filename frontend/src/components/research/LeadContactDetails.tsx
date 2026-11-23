"use client";

import { ExternalLink, Mail, Phone } from "lucide-react";
import type { DiscoveryRow, LeadContact } from "../../lib/api/research";

/** A lead's contacts, including runs saved before leads could carry more than one. */
export function leadContacts(r: Pick<DiscoveryRow, "contacts" | "contact">): LeadContact[] {
  return r.contacts?.length ? r.contacts : r.contact ? [r.contact] : [];
}

const link = "inline-flex items-center gap-1 font-medium text-[var(--brand-active)] hover:underline";

function Person({ c, compact }: { c: LeadContact; compact: boolean }) {
  return (
    <li className={compact ? "space-y-0.5" : "space-y-0.5 rounded-[8px] border border-[var(--line)] px-3 py-2"}>
      {c.name ? (
        <p className="font-medium text-[var(--foreground)]">
          {c.name}
          {c.title ? <span className="font-normal text-[var(--muted)]"> · {c.title}</span> : null}
        </p>
      ) : (
        <p className="font-medium text-[var(--foreground)]">Company contact</p>
      )}
      <p className="flex flex-wrap gap-x-3 gap-y-0.5">
        {c.linkedinUrl ? (
          <a href={c.linkedinUrl} target="_blank" rel="noreferrer noopener" className={link}>
            LinkedIn <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
        {c.email ? (
          <a href={`mailto:${c.email}`} className={link}>
            <Mail size={12} aria-hidden /> {c.email}
            {c.emailIsGeneral && c.name ? <span className="font-normal text-[var(--muted)]">(company)</span> : null}
          </a>
        ) : null}
        {c.phone ? (
          <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={link}>
            <Phone size={12} aria-hidden /> {c.phone}
            {c.phoneIsGeneral && c.name ? <span className="font-normal text-[var(--muted)]">(company)</span> : null}
          </a>
        ) : null}
        {!compact && !c.linkedinUrl && c.sourceUrls[0] ? (
          <a href={c.sourceUrls[0]} target="_blank" rel="noreferrer noopener" className={link}>
            Source <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
      </p>
    </li>
  );
}

/**
 * People found at a lead from public profiles. Shown for research and review only: they are
 * never verified, so the reviewer checks them against the linked profile before reaching out.
 */
export function LeadContactDetails({ contacts, compact = false }: { contacts: LeadContact[]; compact?: boolean }) {
  if (!contacts.length) {
    return compact ? <p className="text-xs text-[var(--muted)]">No public contact found</p> : null;
  }
  const shown = compact ? contacts.slice(0, 2) : contacts;
  return (
    <div className={compact ? "text-xs" : "space-y-2"}>
      <ul className={compact ? "space-y-1.5" : "grid gap-2 sm:grid-cols-2"}>
        {shown.map((c, i) => (
          <Person key={`${c.name ?? c.email ?? ""}-${i}`} c={c} compact={compact} />
        ))}
      </ul>
      {compact && contacts.length > shown.length ? (
        <p className="mt-1 text-[var(--muted)]">+{contacts.length - shown.length} more</p>
      ) : null}
      {!compact ? (
        <p className="text-xs text-[var(--muted)]">
          Unverified — found on public profiles and the company&apos;s website for research and review. Check before reaching out.
        </p>
      ) : null}
    </div>
  );
}
