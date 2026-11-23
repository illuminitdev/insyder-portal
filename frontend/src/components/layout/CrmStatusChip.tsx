"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CrmLogo } from "../settings/CrmLogos";
import { usePortal } from "../../hooks/usePortal";
import { useWorkspace } from "../../hooks/useWorkspace";
import { getCrmConnection, type CrmConnection } from "../../lib/api/crm";
import { formatDate } from "../../lib/utils/dates";

/**
 * Top-bar chip showing which CRM is connected (logo + name + health). Only for the tenant admin,
 * who is the one sending leads to it, and only once a CRM is connected: before that, nothing.
 * Re-checks on every page change, so it appears right after connecting.
 */
export function CrmStatusChip() {
  const { can, workspaceId } = useWorkspace();
  const { href } = usePortal();
  const pathname = usePathname();
  const [conn, setConn] = useState<CrmConnection | null>(null);
  const allowed = can("manage_settings");

  useEffect(() => {
    if (!allowed || !workspaceId) return;
    let live = true;
    getCrmConnection(workspaceId)
      .then((r) => live && setConn(r.connection))
      .catch(() => live && setConn(null));
    return () => {
      live = false;
    };
  }, [allowed, workspaceId, pathname]);

  if (!allowed || !conn) return null;
  const ok = conn.status === "connected";

  return (
    <Link
      href={href("/settings/crm")}
      title={[
        conn.accountLabel,
        `Connected ${formatDate(conn.connectedAt)}${conn.connectedByName ? ` by ${conn.connectedByName}` : ""}`,
        ok ? null : `Last check failed${conn.lastError ? `: ${conn.lastError}` : ""}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      aria-label={`${conn.providerName}: ${ok ? "connected" : "check the connection"}`}
      className="hidden items-center gap-2.5 rounded-full bg-[var(--lilac)] py-1.5 pl-1.5 pr-4 text-[14px] font-medium text-[var(--foreground)] transition hover:brightness-[0.98] sm:inline-flex"
    >
      {/* The connected CRM's logo, with a health dot: green = connected, amber = last check failed */}
      <span className="relative shrink-0">
        <span className="block overflow-hidden rounded-full bg-white shadow-[0_1px_4px_rgba(13,27,42,0.12)]">
          <CrmLogo provider={conn.provider} size={16} tile={28} />
        </span>
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--lilac)] ${ok ? "bg-[#22a35a]" : "bg-[#d99a1e]"}`}
          aria-hidden
        />
      </span>
      {ok ? "CRM connected:" : "Check CRM:"}
      <span className="font-semibold text-[var(--brand-active)]">{conn.providerName}</span>
    </Link>
  );
}
