"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Inbox, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/common/LoadingState";
import { ErrorState } from "@/components/common/ErrorState";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_ORDER } from "@/lib/auth/capabilities";
import { formatDate } from "@/lib/utils/dates";
import {
  ACCESS_REQUESTS_CHANGED,
  approveAccessRequest,
  getPlatformUsers,
  listAccessRequests,
  rejectAccessRequest,
  type AccessRequest,
  type AccessRequestStatus,
  type PlatformUsersCompany,
} from "@/lib/api/platform";

const TABS: Array<{ key: AccessRequestStatus; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function ApproveDialog({
  request,
  companies,
  onClose,
  onDone,
}: {
  request: AccessRequest;
  companies: PlatformUsersCompany[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Default to the existing company when the requested name matches one
  const match = companies.find((c) => c.name.trim().toLowerCase() === request.companyName.trim().toLowerCase());
  const [kind, setKind] = useState<"new_company" | "existing_workspace">(match ? "existing_workspace" : "new_company");
  const [companyName, setCompanyName] = useState(request.companyName);
  const [workspaceName, setWorkspaceName] = useState("Default Workspace");
  const [tenantId, setTenantId] = useState(match?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState(match?.workspaces[0]?.id ?? "");
  const [role, setRole] = useState("researcher");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const company = companies.find((c) => c.id === tenantId);

  const valid = kind === "new_company" ? companyName.trim().length > 0 : Boolean(tenantId && workspaceId && role);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "new_company") {
        await approveAccessRequest(request.id, { kind, companyName, workspaceName });
        onDone(`${request.name} approved as tenant admin of the new company ${companyName.trim()}.`);
      } else {
        await approveAccessRequest(request.id, { kind, tenantId, workspaceId, role });
        const ws = company?.workspaces.find((w) => w.id === workspaceId)?.name ?? "the workspace";
        onDone(`${request.name} approved as ${ROLE_LABELS[role] ?? role} in ${company?.name} · ${ws}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${request.name}`}
      description={`${request.email} asked for access for “${request.companyName}”. They'll log in with the password they chose.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="approve-access-form" variant="primary" disabled={busy || !valid}>
            {busy ? "Approving…" : "Approve"}
          </Button>
        </>
      }
    >
      <form
        id="approve-access-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-[var(--muted)]">Where should they go?</legend>
          {(
            [
              ["new_company", "Create a new company", "They become its tenant admin and can invite their team."],
              ["existing_workspace", "Add to an existing company", "Join a workspace with the role you choose."],
            ] as const
          ).map(([key, label, hint]) => (
            <label
              key={key}
              className={`flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 text-sm ${
                kind === key ? "border-[var(--brand)] bg-[var(--brand-tint)]" : "border-[var(--line)]"
              }`}
            >
              <input type="radio" name="kind" className="mt-1" checked={kind === key} onChange={() => setKind(key)} />
              <span>
                <span className="block font-semibold text-[var(--foreground)]">{label}</span>
                <span className="block text-xs text-[var(--muted)]">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {kind === "new_company" ? (
          <>
            <Field label="Company name">
              <input required className={inputClass} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field label="First workspace name">
              <input className={inputClass} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Company">
              <select
                required
                className={inputClass}
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  setWorkspaceId(companies.find((c) => c.id === e.target.value)?.workspaces[0]?.id ?? "");
                }}
              >
                <option value="">Choose a company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workspace">
              <select required className={inputClass} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} disabled={!company}>
                {!company ? <option value="">Choose a company first</option> : null}
                {company?.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
              <select required className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r] ?? r}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <FormError message={error} />
      </form>
    </Modal>
  );
}

function RejectDialog({ request, onClose, onDone }: { request: AccessRequest; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reject ${request.name}`}
      description="No account is created. They'll see that the request was declined if they try to log in, and can request again later."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="reject-access-form" variant="primary" disabled={busy || !reason.trim()}>
            {busy ? "Rejecting…" : "Reject"}
          </Button>
        </>
      }
    >
      <form
        id="reject-access-form"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await rejectAccessRequest(request.id, reason);
            onDone(`${request.name}'s request was rejected.`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not reject the request");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Reason" hint="Kept with the request for your team's records.">
          <textarea
            required
            rows={3}
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Not a customer yet; duplicate of another request"
          />
        </Field>
        <FormError message={error} />
      </form>
    </Modal>
  );
}

/** Platform admin: approve or reject "Create account" requests from the login page. */
export default function AccessRequestsPage() {
  const [tab, setTab] = useState<AccessRequestStatus>("pending");
  const [data, setData] = useState<Awaited<ReturnType<typeof listAccessRequests>> | null>(null);
  const [companies, setCompanies] = useState<PlatformUsersCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);

  const load = useCallback(async () => {
    try {
      const [reqs, users] = await Promise.all([listAccessRequests(tab), getPlatformUsers()]);
      setData(reqs);
      setCompanies(users.companies);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load access requests");
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (message: string) => {
    setApproving(null);
    setRejecting(null);
    setNotice(message);
    window.dispatchEvent(new Event(ACCESS_REQUESTS_CHANGED));
    void load();
  };

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="Access requests"
        description="People who used “Create account” on the login page. Nobody gets in until you approve them."
      />

      <div className="flex gap-1 border-b border-[var(--line)]" role="tablist" aria-label="Request status">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setNotice(null);
            }}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium ${
              tab === t.key ? "border-[var(--brand-active)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
            <span className="rounded-full bg-[var(--chip-bg)] px-2 py-0.5 text-xs tabular-nums">{data.counts[t.key]}</span>
          </button>
        ))}
      </div>

      {notice ? (
        <p role="status" className="text-sm font-medium text-[var(--badge-green-fg)]">
          {notice}
        </p>
      ) : null}

      {data.requests.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <Inbox size={28} className="text-[var(--muted)]" aria-hidden />
          <p className="text-sm text-[var(--muted)]">
            {tab === "pending" ? "No requests waiting. New sign-ups will appear here." : `No ${tab} requests yet.`}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.requests.map((r) => (
            <Card key={r.id} className="!p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px]">{r.name}</h3>
                    {r.status === "pending" ? <Badge tone="amber">Pending</Badge> : null}
                    {r.status === "approved" ? <Badge tone="green">Approved</Badge> : null}
                    {r.status === "rejected" ? <Badge tone="red">Rejected</Badge> : null}
                  </div>
                  <p className="text-sm text-[var(--foreground)]">{r.email}</p>
                  <p className="text-sm text-[var(--muted)]">
                    Company: <span className="font-medium text-[var(--foreground)]">{r.companyName}</span> · Requested {formatDate(r.updatedAt)}
                  </p>
                  {r.message ? <p className="text-sm text-[var(--muted)]">“{r.message}”</p> : null}
                  {r.status === "approved" ? (
                    <p className="text-sm text-[var(--muted)]">
                      Added to {r.tenantName ?? "a company"}
                      {r.workspaceName ? ` · ${r.workspaceName}` : ""} as {ROLE_LABELS[r.role ?? ""] ?? r.role}
                      {r.reviewedAt ? ` on ${formatDate(r.reviewedAt)}` : ""}
                      {r.reviewedByName ? ` by ${r.reviewedByName}` : ""}
                    </p>
                  ) : null}
                  {r.status === "rejected" ? (
                    <p className="text-sm text-[var(--muted)]">
                      Rejected{r.reviewedAt ? ` on ${formatDate(r.reviewedAt)}` : ""}
                      {r.reviewedByName ? ` by ${r.reviewedByName}` : ""}: {r.decisionReason}
                    </p>
                  ) : null}
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button onClick={() => setRejecting(r)}>
                      <X size={15} className="mr-1.5" aria-hidden />
                      Reject
                    </Button>
                    <Button variant="primary" onClick={() => setApproving(r)}>
                      <Check size={15} className="mr-1.5" aria-hidden />
                      Approve
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {approving ? <ApproveDialog request={approving} companies={companies} onClose={() => setApproving(null)} onDone={done} /> : null}
      {rejecting ? <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={done} /> : null}
    </div>
  );
}
