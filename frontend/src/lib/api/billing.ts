import { api, clearApiCache } from "./client";

export type PlanKey = "starter" | "growth" | "enterprise";
export type BillingStatus = "unpaid" | "active" | "past_due" | "canceled";
export type MonitorCadence = { hours: number; label: string };

export type PlanInfo = {
  key: PlanKey;
  name: string;
  price: number;
  researchUnits: number;
  maxWorkspaces: number;
  maxUsers: number;
  monitorCadences: MonitorCadence[];
};

export type Billing = {
  plan: Omit<PlanInfo, "maxWorkspaces" | "maxUsers"> & { maxUsers: number; maxWorkspaces: number };
  billingStatus: BillingStatus;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  users: { used: number; max: number };
  workspaces: { used: number; max: number };
  /** Research units this month, for the whole company */
  research: { used: number; max: number; periodStart: string | null };
  plans: PlanInfo[];
  paymentsEnabled: boolean;
};

export type Invoice = {
  id: string;
  number: string | null;
  date: string;
  description: string;
  /** Stripe invoice status: paid, open, void, uncollectible */
  status: string;
  amount: number;
  currency: string;
  url: string | null;
  pdf: string | null;
};

export type BillingDetails = {
  invoices: Invoice[];
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  /** Set when the plan was cancelled and still runs until this date */
  cancelAt: string | null;
  error: string | null;
};

export function getBillingDetails(workspaceId: string) {
  return api<BillingDetails>(`/v1/workspaces/${workspaceId}/billing/details`);
}

/** The company's plan as any member sees it (e.g. which monitor frequencies they can pick). */
export type WorkspacePlan = { key: PlanKey; name: string; billingStatus: BillingStatus; monitorCadences: MonitorCadence[] };

export const ALL_CADENCES: MonitorCadence[] = [
  { hours: 24, label: "Daily" },
  { hours: 168, label: "Weekly" },
  { hours: 720, label: "Monthly" },
];

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  active: "Paid",
  unpaid: "Not paid yet",
  past_due: "Payment failed",
  canceled: "Cancelled",
};

export function getPlans() {
  return api<{ plans: PlanInfo[]; paymentsEnabled: boolean }>("/v1/plans");
}

export function getWorkspacePlan(workspaceId: string) {
  return api<WorkspacePlan>(`/v1/workspaces/${workspaceId}/plan`);
}

export function getBilling(workspaceId: string) {
  return api<Billing>(`/v1/workspaces/${workspaceId}/billing`);
}

/** Pay for or switch plan: { url } opens Stripe Checkout, { switched } means it changed in place. */
export async function changePlan(workspaceId: string, plan: PlanKey) {
  const res = await api<{ url?: string; switched?: boolean }>(`/v1/workspaces/${workspaceId}/billing/change-plan`, {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  clearApiCache();
  return res;
}

/** Stripe's billing page; with a flow it opens straight on cancelling or changing the card. */
export function billingPortal(workspaceId: string, flow?: "cancel" | "payment_method") {
  return api<{ url: string }>(`/v1/workspaces/${workspaceId}/billing/portal`, {
    method: "POST",
    body: JSON.stringify(flow ? { flow } : {}),
  });
}

/** Longer wording for frequency dropdowns */
export const CADENCE_TEXT: Record<number, string> = {
  24: "Daily (every 24 hours)",
  168: "Weekly (every 7 days)",
  720: "Monthly (every 30 days)",
};
