"use client";

import { PortalLink as Link } from "@/components/layout/PortalLink";
import type { Account } from "../../lib/api/accounts";
import { formatDate } from "../../lib/utils/dates";
import { StatusBadge } from "../common/StatusBadge";
import { TableWrap } from "../ui/TableWrap";
import { usePagination } from "../ui/Pagination";
import { ExternalLink } from "lucide-react";

/** "datum.co.uk" → "https://datum.co.uk". Only plain host names become links, nothing else. */
function websiteUrl(domain: string | null) {
  const d = domain?.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? `https://${d}` : null;
}

/** Accounts that can be sent to research right now (one already researching can't be queued twice). */
export const canQueueResearch = (a: Account) => a.researchState !== "researching";

export function AccountTable({
  accounts,
  selection,
}: {
  accounts: Account[];
  /** When set, rows get checkboxes (used by "Research selected" on the watchlist) */
  selection?: { selected: string[]; onChange: (ids: string[]) => void };
}) {
  const { pageItems, pager, topRef } = usePagination(accounts);
  const pageIds = pageItems.filter(canQueueResearch).map((a) => a.id);
  const pageAllOn = pageIds.length > 0 && pageIds.every((id) => selection?.selected.includes(id));
  const toggle = (id: string) =>
    selection?.onChange(selection.selected.includes(id) ? selection.selected.filter((x) => x !== id) : [...selection.selected, id]);
  return (
    <div ref={topRef} className="scroll-mt-24">
      <TableWrap>
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">Accounts</caption>
          <thead className="border-b border-[var(--line)] bg-[var(--table-head)] text-[12px] font-medium text-[var(--muted)]">
            <tr>
              {selection ? (
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={pageAllOn ? "Unselect the accounts on this page" : "Select the accounts on this page"}
                    checked={pageAllOn}
                    disabled={!pageIds.length}
                    onChange={() =>
                      selection.onChange(
                        pageAllOn
                          ? selection.selected.filter((id) => !pageIds.includes(id))
                          : [...new Set([...selection.selected, ...pageIds])],
                      )
                    }
                    className="accent-[var(--brand)]"
                  />
                </th>
              ) : null}
              <th scope="col" className="px-4 py-3">Account</th>
              <th scope="col" className="px-4 py-3">Domain</th>
              <th scope="col" className="px-4 py-3">Country</th>
              <th scope="col" className="px-4 py-3">Research</th>
              <th scope="col" className="px-4 py-3">Acceptance</th>
              <th scope="col" className="px-4 py-3">Priority</th>
              <th scope="col" className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((a) => (
              <tr
                key={a.id}
                className={`border-b border-[var(--line)] last:border-0 ${selection?.selected.includes(a.id) ? "bg-[var(--brand-tint)]/40" : ""}`}
              >
                {selection ? (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.name}`}
                      checked={selection.selected.includes(a.id)}
                      disabled={!canQueueResearch(a)}
                      title={canQueueResearch(a) ? undefined : "Already being researched"}
                      onChange={() => toggle(a.id)}
                      className="accent-[var(--brand)]"
                    />
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/accounts/detail?id=${a.id}`} className="font-semibold text-[var(--foreground)] hover:text-[var(--brand-active)]">
                      {a.name}
                    </Link>
                    {a.playbookTemplateKey ? (
                      <span className="rounded-md bg-[var(--brand-tint)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--brand-active)]">
                        {a.playbookTemplateKey.replace(/^custom_/, "").replace(/_/g, " ")}
                      </span>
                    ) : null}
                    {a.source === "crm_import" ? (
                      <span className="rounded-full bg-[#fff1ec] px-2 py-0.5 text-[11px] font-medium text-[#c2410c]">From CRM</span>
                    ) : a.source !== "manual" ? (
                      <span className="text-xs text-[var(--muted)]">{a.source}</span>
                    ) : null}
                  </div>
                  {a.companySummary ? (
                    <p className="mt-0.5 line-clamp-1 max-w-md text-xs font-normal text-[var(--muted)]" title={a.companySummary}>
                      {a.companySummary}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-[var(--muted)]">
                  {websiteUrl(a.domain) ? (
                    <a
                      href={websiteUrl(a.domain)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${a.domain} in a new tab`}
                      className="group inline-flex items-center gap-1 text-[#1d4ed8] hover:text-[#1e40af] hover:underline"
                    >
                      {a.domain}
                      <ExternalLink size={12} className="opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </a>
                  ) : (
                    (a.domain ?? "—")
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--muted)]">{a.country ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.researchState} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.acceptanceState} />
                </td>
                <td className="px-4 py-3 font-medium">{a.fitScore ?? "—"}</td>
                <td className="px-4 py-3 text-[var(--muted)]">{formatDate(a.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {pager}
    </div>
  );
}
