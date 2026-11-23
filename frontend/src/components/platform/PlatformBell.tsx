"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, UserPlus, UserX, Users } from "lucide-react";
import { BellMenu, type BellItem } from "@/components/layout/AttentionBell";
import { ACCESS_REQUESTS_CHANGED, getPlatformOverview, listAccessRequests, listPlatformWorkspaces } from "@/lib/api/platform";

/** Platform header bell: companies and workspaces that need the app owner's attention. */
export function PlatformBell() {
  const [items, setItems] = useState<BellItem[]>([]);

  const load = useCallback(async () => {
    const [ov, ws, ar] = await Promise.allSettled([getPlatformOverview(), listPlatformWorkspaces(), listAccessRequests("pending")]);
    const next: BellItem[] = [];
    if (ar.status === "fulfilled") {
      next.push({
        key: "access-requests",
        Icon: UserPlus,
        label: "Access requests waiting for approval",
        count: ar.value.counts.pending,
        href: "/platform/access-requests",
      });
    }
    if (ov.status === "fulfilled") {
      const companies = ov.value.companies;
      next.push({
        key: "quota",
        Icon: Gauge,
        label: "Companies at 90%+ of research units",
        count: companies.filter((c) => c.researchQuotaMonthly && c.researchUsedMonthly / c.researchQuotaMonthly >= 0.9).length,
        href: "/platform",
      });
      next.push({
        key: "no-members",
        Icon: UserX,
        label: "Companies with no active members",
        count: companies.filter((c) => c.members === 0).length,
        href: "/platform/companies",
      });
    }
    if (ws.status === "fulfilled") {
      next.push({
        key: "empty-workspaces",
        Icon: Users,
        label: "Workspaces with no members",
        count: ws.value.workspaces.filter((w) => w.members === 0).length,
        href: "/platform/workspaces",
      });
    }
    setItems(next);
  }, []);

  // Load once, then refresh every minute and when the panel opens
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    const onChange = () => void load();
    window.addEventListener(ACCESS_REQUESTS_CHANGED, onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener(ACCESS_REQUESTS_CHANGED, onChange);
    };
  }, [load]);

  return <BellMenu storageKey="platform" items={items} onOpen={() => void load()} />;
}
