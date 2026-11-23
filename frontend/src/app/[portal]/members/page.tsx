"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RequireCap } from "@/components/common/RequireCap";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  grantMembership,
  listMemberships,
  resetMemberPassword,
  revokeMembership,
  type MembershipRow,
} from "@/lib/api/memberships";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, FormError, inputClass } from "@/components/ui/Field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { usePagination } from "@/components/ui/Pagination";
import { Modal } from "@/components/ui/Modal";
import { Search, UserPlus } from "lucide-react";

const ROLES = ["tenant_admin", "researcher", "sdr", "sales_reviewer", "partner", "analyst"] as const;

function Members({ workspaceId }: { workspaceId: string }) {
  const { user } = useWorkspace();
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("researcher");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  // Filter the list by role ("" = everyone)
  const [roleFilter, setRoleFilter] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (m) => (!roleFilter || m.role === roleFilter) && (!q || `${m.name} ${m.email}`.toLowerCase().includes(q)),
  );
  const { pageItems, pager } = usePagination(shown);
  const countByRole = (r: string) => rows.filter((m) => m.role === r).length;

  const refresh = useCallback(async () => {
    try {
      setRows((await listMemberships(workspaceId)).memberships);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeAdd = () => {
    setAdding(false);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access"
        title="Workspace members"
        description="Access comes only from an explicit membership — belonging to an organization never grants it. Agency users get delegated membership here too. Revoking takes effect on their next request."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setNotice(null);
              setError(null);
              setAdding(true);
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <UserPlus size={16} aria-hidden /> Add member
            </span>
          </Button>
        }
      />

      {notice ? (
        <p role="status" className="rounded-[10px] bg-[var(--badge-green-bg)] px-4 py-3 text-sm text-[var(--badge-green-fg)]">
          {notice}
        </p>
      ) : null}
      {!adding ? <FormError message={error} /> : null}

      <Modal
        open={adding}
        onClose={closeAdd}
        title="Add a member"
        description="They can sign in straight away with the password you set, and change it under Settings → Password."
        footer={
          <>
            <Button onClick={closeAdd}>Cancel</Button>
            <Button type="submit" form="add-member-form" variant="primary" disabled={busy || !email}>
              {busy ? "Adding…" : "Grant access"}
            </Button>
          </>
        }
      >
        <form
          id="add-member-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            setNotice(null);
            try {
              const res = await grantMembership(workspaceId, { email, name: name || undefined, role, password: password || undefined });
              setNotice(
                res.existingAccount
                  ? `${email} already had a Insyder account, so they keep their own password and can sign in now.`
                  : `${email} can sign in now with the password you set. They can change it under Settings → Password.`,
              );
              setEmail("");
              setName("");
              setPassword("");
              setAdding(false);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Grant failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email">
              <input type="email" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. sara@yourcompany.com" />
            </Field>
            <Field label="Name (optional)">
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara Khan" />
            </Field>
            <Field label="Password" hint="At least 8 characters. Not needed if they already have an account.">
              <PasswordInput
                id="member-password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Set their password"
              />
            </Field>
            <Field label="Role">
              <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="mt-3 rounded-[8px] bg-[var(--chip-bg)] px-3 py-2 text-xs text-[var(--muted)]">
            <strong className="text-[var(--foreground)]">{ROLE_LABELS[role]}:</strong> {ROLE_DESCRIPTIONS[role]}
          </p>
          <div className="mt-3">
            <FormError message={error} />
          </div>
        </form>
      </Modal>

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 pt-5">
          <h2 className="text-[17px] font-semibold">
            Active members{" "}
            <span className="font-normal text-[var(--muted)]">
              ({query || roleFilter ? `${shown.length} of ${rows.length}` : rows.length})
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative block">
              <span className="sr-only">Search members</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search members..."
                className="w-64 rounded-[8px] border border-[var(--input-border)] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-tint)]"
              />
            </label>
            <label className="block">
              <span className="sr-only">Filter by role</span>
              <select
                className="rounded-[8px] border border-[var(--input-border)] bg-white px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
              >
                <option value="">All roles ({rows.length})</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} ({countByRole(r)})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto px-6 pb-2">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-[var(--brand-tint)] text-left text-[13px] text-[var(--foreground)]">
                <th className="rounded-l-[8px] px-4 py-3 font-semibold">Member</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="rounded-r-[8px] px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {pageItems.map((m) => {
                const self = m.userId === user?.id;
                return (
                  <tr key={m.id} className="align-middle">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[13px] font-semibold text-[var(--brand-active)]">
                          {(m.name || m.email).trim().charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--foreground)]">
                            {m.name} {self ? <span className="font-normal text-[var(--muted)]">(you)</span> : null}
                          </p>
                          <p className="truncate text-[13px] text-[var(--muted)]">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex rounded-[6px] border border-[#BFDDD7] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--brand-active)]">
                        {ROLE_LABELS[m.role] ?? m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {self ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : confirmRevoke === m.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-[var(--muted)]">Revoke {m.name || m.email}?</span>
                          <Button
                            variant="primary"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await revokeMembership(workspaceId, m.id);
                                setConfirmRevoke(null);
                                await refresh();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Revoke failed");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Confirm revoke
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmRevoke(null)}>
                            Keep
                          </Button>
                        </div>
                      ) : confirmReset === m.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <PasswordInput
                            id={`reset-password-${m.id}`}
                            autoComplete="new-password"
                            aria-label={`New password for ${m.email}`}
                            wrapperClassName="w-56"
                            value={resetPassword}
                            onChange={(e) => setResetPassword(e.target.value)}
                            placeholder="New password (8+ characters)"
                          />
                          <Button
                            variant="primary"
                            disabled={busy || resetPassword.length < 8}
                            onClick={async () => {
                              setBusy(true);
                              setError(null);
                              setNotice(null);
                              try {
                                await resetMemberPassword(workspaceId, m.id, resetPassword);
                                setNotice(`New password set for ${m.email}. They were signed out and can sign in with it now.`);
                                setResetPassword("");
                                setConfirmReset(null);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Reset failed");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Set password
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setConfirmReset(null);
                              setResetPassword("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4 text-[13.5px] font-medium">
                          <button type="button" className="text-[var(--foreground)] hover:underline" onClick={() => setConfirmReset(m.id)}>
                            Reset password
                          </button>
                          <span className="h-4 w-px bg-[var(--line)]" aria-hidden />
                          <button type="button" className="text-[var(--danger)] hover:underline" onClick={() => setConfirmRevoke(m.id)}>
                            Revoke access
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              {rows.length ? (
                <>
                  No members match.{" "}
                  <button
                    type="button"
                    className="font-medium text-[var(--brand-active)] hover:underline"
                    onClick={() => {
                      setRoleFilter("");
                      setQuery("");
                    }}
                  >
                    Show everyone
                  </button>
                </>
              ) : (
                "No active members."
              )}
            </p>
          ) : null}
        </div>
        <div className="px-6 pb-4">{pager}</div>
      </Card>
    </div>
  );
}

export default function MembersPage() {
  return <RequireCap cap="manage_membership">{(workspaceId) => <Members workspaceId={workspaceId} />}</RequireCap>;
}
