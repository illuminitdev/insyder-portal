"use client";

import { useEffect, useState } from "react";
import { SHOW_PLANS } from "@/lib/features";
import { ALL_CADENCES, getPlans, getWorkspacePlan, type MonitorCadence, type PlanInfo, type WorkspacePlan } from "@/lib/api/billing";

export type CadenceOption = MonitorCadence & { allowed: boolean; /** e.g. "Enterprise plan", for options the plan lacks */ hint: string | null };

/**
 * The company's plan, for showing limits where people hit them (monitor frequency for now).
 * While it loads, every option counts as allowed; the server enforces the plan either way.
 */
export function usePlan(workspaceId: string | null | undefined) {
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);

  useEffect(() => {
    // Plans hidden for demos (see lib/features.ts): every frequency stays open
    if (!workspaceId || !SHOW_PLANS) return;
    getWorkspacePlan(workspaceId).then(setPlan).catch(() => setPlan(null));
    getPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, [workspaceId]);

  const allowedHours = plan ? plan.monitorCadences.map((c) => c.hours) : null;

  const cadenceOptions: CadenceOption[] = ALL_CADENCES.map((c) => {
    const allowed = !allowedHours || allowedHours.includes(c.hours);
    const on = plans.filter((p) => p.monitorCadences.some((x) => x.hours === c.hours)).map((p) => p.name);
    return { ...c, allowed, hint: allowed || !on.length ? null : `${on.join(" or ")} plan` };
  });

  /** Weekly when the plan has it, else its first frequency. */
  const defaultCadence = allowedHours ? (allowedHours.includes(168) ? 168 : allowedHours[0]!) : 168;

  return { plan, allowedHours, cadenceOptions, defaultCadence };
}
