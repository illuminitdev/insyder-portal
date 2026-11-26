"use client";

import { useState } from "react";
import { CreditCard, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormError, inputClass } from "@/components/ui/Field";
import { formatDate } from "@/lib/utils/dates";
import { BILLING_STATUS_LABEL, type BillingStatus, type PlanKey } from "@/lib/api/billing";
import { resendLoginDetails, setCompanyPlan, type PlatformCompanyDetail } from "@/lib/api/platform";

const PLAN_OPTIONS: { key: PlanKey; label: string }[] = [
  { key: "starter", label: "Starter · £40/mo" },
  { key: "growth", label: "Growth · £80/mo" },
  { key: "enterprise", label: "Enterprise · £150/mo" },
];

/** Platform → company detail: the company's plan, payment status and login-details resend. */
export function PlanBillingPanel({ c, onChanged }: { c: PlatformCompanyDetail; onChanged: () => void }) {
  const [plan, setPlan] = useState<PlanKey>(c.plan);
  const [status, setStatus] = useState<BillingStatus>(c.billingStatus);
  const [busy, setBusy] = useState<"save" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const dirty = plan !== c.plan || status !== c.billingStatus;

  async function save() {
    setBusy("save");
    setError(null);
    setNote(null);
    try {
      await setCompanyPlan(c.id, { plan, billingStatus: status });
      setNote("Saved.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (!confirm(`Send ${c.name}'s admin a new temporary password? Their current password stops working.`)) return;
    setBusy("resend");
    setError(null);
    setNote(null);
    try {
      const r = await resendLoginDetails(c.id);
      setNote(
        r.emailed
          ? `New login details emailed to ${r.email}.`
          : `Email isn't set up, so nothing was sent. Give ${r.email} this temporary password: ${r.tempPassword}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resend");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[14px] border border-[var(--line)] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--foreground)]">
          <CreditCard size={16} aria-hidden /> Plan &amp; billing
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">
            {c.planName} · £{c.price}/mo
          </span>
          <Badge tone={c.billingStatus === "active" ? "green" : c.billingStatus === "unpaid" ? "amber" : "red"}>
            {BILLING_STATUS_LABEL[c.billingStatus]}
          </Badge>
        </div>
      </div>

      <p className="mt-2 text-sm text-[var(--muted)]">
        Limits: {c.limits.users} users · {c.limits.workspaces} workspace{c.limits.workspaces === 1 ? "" : "s"} · {c.limits.researchUnits} research units a month
        {c.currentPeriodEnd ? ` · renews ${formatDate(c.currentPeriodEnd)}` : ""}
        {c.stripeCustomerId ? " · billed by Stripe" : " · not on Stripe"}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">Plan</span>
          <select className={inputClass} value={plan} onChange={(e) => setPlan(e.target.value as PlanKey)}>
            {PLAN_OPTIONS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-[var(--muted)]">Payment status</span>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as BillingStatus)}>
            {(Object.keys(BILLING_STATUS_LABEL) as BillingStatus[]).map((s) => (
              <option key={s} value={s}>
                {BILLING_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        <Button className="ml-auto" disabled={busy !== null} onClick={() => void resend()}>
          <KeyRound size={14} className="mr-1.5" aria-hidden />
          {busy === "resend" ? "Sending…" : "Resend login details"}
        </Button>
      </div>
      {c.stripeCustomerId ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          This company pays through Stripe: a change made here is replaced by Stripe&apos;s next update. Use it for companies you bill by hand.
        </p>
      ) : null}
      {note ? (
        <p className="mt-3 rounded-lg bg-[var(--badge-green-bg)] px-3 py-2 text-sm text-[var(--badge-green-fg)]" role="status">
          {note}
        </p>
      ) : null}
      <FormError message={error} />
    </section>
  );
}
