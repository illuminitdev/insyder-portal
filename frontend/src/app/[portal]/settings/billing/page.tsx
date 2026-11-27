"use client";

import { useEffect, useState, type ReactNode } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { SHOW_PLANS } from "@/lib/features";
import { Check, CreditCard, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FormError } from "@/components/ui/Field";
import { formatDate } from "@/lib/utils/dates";
import {
  BILLING_STATUS_LABEL,
  billingPortal,
  changePlan,
  getBilling,
  getBillingDetails,
  type Billing,
  type BillingDetails,
  type Invoice,
  type PlanInfo,
  type PlanKey,
} from "@/lib/api/billing";

function money(amount: number, currency = "gbp") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(amount);
}

function planSummary(p: Pick<PlanInfo, "researchUnits" | "maxUsers" | "maxWorkspaces" | "monitorCadences">) {
  return [
    `${p.researchUnits} research units a month`,
    `${p.maxUsers} users`,
    `${p.maxWorkspaces} workspace${p.maxWorkspaces === 1 ? "" : "s"}`,
    `${p.monitorCadences.map((c) => c.label).join(" & ")} monitors`,
  ];
}

/** A white card with a title row; the action sits on the right like the other settings pages. */
function Section({ title, subtitle, action, children }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {subtitle ? <div className="mt-1 text-sm text-[var(--muted)]">{subtitle}</div> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </Card>
  );
}

const INVOICE_TONE: Record<string, "green" | "amber" | "red" | "default"> = {
  paid: "green",
  open: "amber",
  uncollectible: "red",
  void: "default",
};

const INVOICE_LABEL: Record<string, string> = { paid: "Paid", open: "Due", uncollectible: "Failed", void: "Void" };

function UsageRow({ label, used, max, strong = false }: { label: string; used: number; max: number; strong?: boolean }) {
  const pct = max ? (used / max) * 100 : 0;
  const tone = pct >= 100 ? "text-amber-700 font-semibold" : pct >= 80 ? "text-amber-700" : "";
  return (
    <tr className="border-t border-slate-100">
      <td className={`py-3 pr-4 ${strong ? "font-semibold" : ""}`}>{label}</td>
      <td className="py-3 px-4 text-center tabular-nums">{used}</td>
      <td className="py-3 px-4 text-center tabular-nums">{max}</td>
      <td className={`py-3 pl-4 text-center tabular-nums ${tone}`}>{pct.toFixed(pct > 0 && pct < 10 ? 1 : 0)}%</td>
    </tr>
  );
}

function InvoicesTable({ invoices }: { invoices: Invoice[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-[var(--muted)]">
            <th className="pb-2 pr-4 font-semibold">Date</th>
            <th className="pb-2 px-4 font-semibold">Description</th>
            <th className="pb-2 px-4 text-center font-semibold">Status</th>
            <th className="pb-2 px-4 text-center font-semibold">Amount</th>
            <th className="pb-2 pl-4 text-center font-semibold">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className="border-t border-slate-100">
              <td className="whitespace-nowrap py-3 pr-4">{formatDate(i.date)}</td>
              <td className="py-3 px-4 text-[var(--muted)]">{i.description}</td>
              <td className="py-3 px-4 text-center">
                <Badge tone={INVOICE_TONE[i.status] ?? "default"}>{INVOICE_LABEL[i.status] ?? i.status}</Badge>
              </td>
              <td className="whitespace-nowrap py-3 px-4 text-center font-medium tabular-nums">{money(i.amount, i.currency)}</td>
              <td className="py-3 pl-4 text-center">
                {i.url || i.pdf ? (
                  <a
                    href={i.url ?? i.pdf ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[var(--link)] hover:underline"
                  >
                    <ExternalLink size={13} aria-hidden /> View
                  </a>
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingView({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const [data, setData] = useState<Billing | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);

  const load = () => {
    getBilling(workspaceId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
    getBillingDetails(workspaceId)
      .then(setDetails)
      .catch((e) =>
        setDetails({ invoices: [], card: null, cancelAt: null, error: e instanceof Error ? e.message : "Could not load invoices" }),
      );
  };

  useEffect(() => {
    load();
    // Back from Stripe Checkout: the webhook may land a moment after the redirect
    if (params.get("paid")) {
      const t = setTimeout(load, 3000);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (!data) return error ? <ErrorState message={error} /> : <LoadingState />;

  const paid = data.billingStatus === "active";
  const statusTone = paid ? "green" : data.billingStatus === "unpaid" ? "amber" : "red";
  const cancelAt = details?.cancelAt ?? null;
  const card = details?.card ?? null;

  async function choose(plan: PlanKey) {
    setBusy(plan);
    setError(null);
    try {
      const res = await changePlan(workspaceId, plan);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setPlansOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change plan");
    } finally {
      setBusy(null);
    }
  }

  async function portal(flow?: "cancel" | "payment_method") {
    setBusy(flow ?? "portal");
    setError(null);
    try {
      window.location.href = (await billingPortal(workspaceId, flow)).url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open billing");
      setBusy(null);
    }
  }

  const periodStart = data.research.periodStart ? new Date(data.research.periodStart) : null;
  const periodEnd = periodStart ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Plan & billing"
        description="Your company's plan, payment details, what you've used this month and your invoices. Prices are per company per month, in UK pounds."
      />

      {params.get("paid") ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Thanks, your payment went through. It can take a few seconds to show here.
        </p>
      ) : null}
      {!paid ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          {data.billingStatus === "past_due"
            ? "Your last payment failed, so research is paused. Update your card under Payment."
            : data.billingStatus === "canceled"
              ? "Your plan is cancelled, so research is paused. Use Adjust plan to start again."
              : "Your plan hasn't been paid yet, so research is locked. Use Adjust plan to pay."}
        </p>
      ) : null}

      <div className="max-w-5xl space-y-4">
        {/* Plan */}
        <Section
          title={
            <span className="flex flex-wrap items-center gap-2">
              {data.plan.name}
              <Badge tone={cancelAt ? "amber" : statusTone}>{cancelAt ? "Cancelling" : BILLING_STATUS_LABEL[data.billingStatus]}</Badge>
              <span className="text-sm font-normal text-[var(--muted)]">£{data.plan.price}/mo</span>
            </span>
          }
          subtitle={
            <>
              <p>{planSummary(data.plan).join(" · ")}</p>
              {cancelAt ? (
                <p className="mt-1 text-amber-700">Cancelled. Your plan stays active until {formatDate(cancelAt)}, then research stops.</p>
              ) : paid && data.currentPeriodEnd ? (
                <p className="mt-1">Renews on {formatDate(data.currentPeriodEnd)}.</p>
              ) : null}
            </>
          }
          action={
            <Button variant="secondary" onClick={() => setPlansOpen(true)} disabled={busy !== null}>
              Adjust plan
            </Button>
          }
        />

        {/* Payment */}
        <Section
          title="Payment"
          subtitle={
            !data.paymentsEnabled ? (
              "Online payment isn't switched on yet. Contact Insyder to change your plan."
            ) : card ? (
              <span className="inline-flex items-center gap-1.5">
                <CreditCard size={14} aria-hidden />
                <span className="capitalize">{card.brand}</span> ending {card.last4} · expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
              </span>
            ) : data.hasStripeCustomer ? (
              "Update your payment details"
            ) : (
              "No payment on file yet."
            )
          }
          action={
            data.paymentsEnabled ? (
              data.hasStripeCustomer ? (
                <Button variant="secondary" onClick={() => void portal()} disabled={busy !== null}>
                  {busy === "portal" ? "Opening…" : "Manage in Stripe"}
                </Button>
              ) : (
                <Button onClick={() => void choose(data.plan.key)} disabled={busy !== null}>
                  {busy === data.plan.key ? "Please wait…" : "Pay now"}
                </Button>
              )
            ) : null
          }
        >
          {data.paymentsEnabled && data.hasStripeCustomer ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-3 text-sm">
              <button
                type="button"
                onClick={() => void portal("payment_method")}
                disabled={busy !== null}
                className="font-medium text-[var(--link)] hover:underline disabled:opacity-50"
              >
                {busy === "payment_method" ? "Opening…" : "Update card"}
              </button>
              {paid && !cancelAt ? (
                <button
                  type="button"
                  onClick={() => void portal("cancel")}
                  disabled={busy !== null}
                  className="font-medium text-[var(--muted)] hover:text-[var(--danger)] hover:underline disabled:opacity-50"
                >
                  {busy === "cancel" ? "Opening…" : "Cancel plan"}
                </button>
              ) : cancelAt ? (
                <button
                  type="button"
                  onClick={() => void portal()}
                  disabled={busy !== null}
                  className="font-medium text-[var(--link)] hover:underline disabled:opacity-50"
                >
                  Keep my plan
                </button>
              ) : null}
            </div>
          ) : null}
        </Section>

        {/* Included usage */}
        <Section
          title="Included usage"
          subtitle={periodStart && periodEnd ? `${formatDate(periodStart)} – ${formatDate(periodEnd)}` : "This month"}
        >
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-semibold">Item</th>
                  <th className="pb-2 px-4 text-center font-semibold">Used</th>
                  <th className="pb-2 px-4 text-center font-semibold">Included</th>
                  <th className="pb-2 pl-4 text-center font-semibold">Usage</th>
                </tr>
              </thead>
              <tbody>
                <UsageRow label="Research units" used={data.research.used} max={data.research.max} strong />
                <UsageRow label="Users" used={data.users.used} max={data.users.max} />
                <UsageRow label="Workspaces" used={data.workspaces.used} max={data.workspaces.max} />
              </tbody>
            </table>
          </div>
        </Section>

        {/* Invoices */}
        <Section title="Invoices">
          {!details ? (
            <p className="mt-3 text-sm text-[var(--muted)]">Loading invoices…</p>
          ) : details.error ? (
            <p className="mt-3 text-sm text-[var(--danger)]">Couldn&apos;t load invoices from Stripe: {details.error}</p>
          ) : details.invoices.length ? (
            <InvoicesTable invoices={details.invoices} />
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">No invoices yet. They show here after your first payment.</p>
          )}
        </Section>

        <FormError message={error} />
      </div>

      <Modal
        open={plansOpen}
        onClose={() => setPlansOpen(false)}
        title="Adjust plan"
        description={
          data.paymentsEnabled
            ? "Switching takes effect straight away; Stripe adjusts the next bill for the days already paid."
            : "Online payment isn't switched on yet. Contact Insyder to change your plan."
        }
        size="lg"
      >
        <div className="grid gap-3 md:grid-cols-3">
          {data.plans.map((p) => {
            const current = p.key === data.plan.key;
            const label = current ? (paid ? "Current plan" : "Pay now") : paid ? `Switch to ${p.name}` : `Choose ${p.name}`;
            return (
              <div
                key={p.key}
                className={`flex flex-col rounded-2xl bg-white p-4 ${
                  current ? "border-2 border-[var(--brand-active)]" : "border border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold">{p.name}</h3>
                  {current ? (
                    <span className="rounded-full bg-[var(--brand-active)] px-2 py-0.5 text-[10px] font-semibold text-[var(--on-accent)]">
                      Your plan
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight">
                  £{p.price}
                  <span className="text-[13px] font-medium text-[var(--muted)]"> / month</span>
                </p>
                <ul className="mt-3 flex-1 space-y-2 text-sm">
                  {planSummary(p).map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <Check size={14} className="mt-0.5 shrink-0 text-[var(--brand-active)]" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
                {data.paymentsEnabled ? (
                  <Button
                    className="mt-4 w-full"
                    variant={current && paid ? "secondary" : "primary"}
                    disabled={(current && paid) || busy !== null}
                    onClick={() => void choose(p.key)}
                  >
                    {busy === p.key ? "Please wait…" : label}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Lowering your plan never removes people or workspaces, but you can&apos;t add more until you&apos;re back under the new limits.
        </p>
      </Modal>
    </div>
  );
}

export default function BillingPage() {
  // Hidden for demos (see lib/features.ts)
  if (!SHOW_PLANS) notFound();
  return <RequireCap cap="manage_membership">{(workspaceId) => <BillingView workspaceId={workspaceId} />}</RequireCap>;
}
