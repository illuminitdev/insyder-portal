"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { CircleAlert, CircleCheck, Plug } from "lucide-react";
import { Card } from "../ui/Card";
import { CrmLogo } from "./CrmLogos";
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, FormError, inputClass } from "../ui/Field";
import { PasswordInput } from "../ui/PasswordInput";
import {
  connectCrm,
  disconnectCrm,
  getCrmConnection,
  testCrmConnection,
  type CrmCatalogEntry,
  type CrmConnection,
} from "../../lib/api/crm";
import { formatDate } from "../../lib/utils/dates";

/**
 * "Connect your CRM": each workspace connects its own CRM here (one per workspace; other workspaces
 * of the company are not affected). Each CRM defines its own fields (HubSpot: a token; Salesforce: My Domain URL plus a
 * Connected App key/secret). They are checked with the CRM before saving, stored encrypted, and never
 * shown again (only the last 4 characters of a token or consumer key).
 */
export function CrmConnectionCard({
  workspaceId,
  canManage,
  syncEnabled,
}: {
  workspaceId: string;
  /** Tenant admin: may connect, replace and disconnect. Others may only view and test. */
  canManage: boolean;
  syncEnabled: boolean;
}) {
  const [connection, setConnection] = useState<CrmConnection | null>(null);
  const [catalog, setCatalog] = useState<CrmCatalogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [choosing, setChoosing] = useState<CrmCatalogEntry | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getCrmConnection(workspaceId);
      setConnection(r.connection);
      setCatalog(r.catalog);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the CRM connection");
    } finally {
      setLoaded(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const closeConnect = () => {
    setChoosing(null);
    setCredentials({});
    setError(null);
  };

  const submitConnect = () => {
    if (!choosing) return;
    void run(async () => {
      const r = await connectCrm(workspaceId, choosing.key, credentials);
      setConnection(r.connection);
      closeConnect();
      setNotice(`Connected to ${r.connection.accountLabel ?? choosing.name}.`);
    });
  };

  // Token entry floats over the page
  const connectForm = (
    <Modal
      open={Boolean(choosing)}
      onClose={closeConnect}
      title={choosing ? `${connection ? "Replace" : "Connect"} ${choosing.name}` : ""}
      description={choosing?.credentialHelp}
      icon={choosing ? <CrmLogo provider={choosing.key} /> : null}
      footer={
        <>
          <Button onClick={closeConnect}>Cancel</Button>
          <Button type="submit" form="crm-connect-form" variant="primary" disabled={busy || !choosing?.fields.every((f) => (credentials[f.key] ?? "").trim().length > 0)}>
            {busy ? "Checking…" : "Connect"}
          </Button>
        </>
      }
    >
      <form
        id="crm-connect-form"
        onSubmit={(e) => {
          e.preventDefault();
          submitConnect();
        }}
      >
        <div className="space-y-4">
          {(choosing?.fields ?? []).map((f) => {
            const value = credentials[f.key] ?? "";
            const onChange = (e: ChangeEvent<HTMLInputElement>) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }));
            return (
              <Field key={f.key} label={f.label} hint={f.hint}>
                {f.secret ? (
                  <PasswordInput autoComplete="off" value={value} onChange={onChange} placeholder={f.placeholder} />
                ) : (
                  <input className={inputClass} autoComplete="off" spellCheck={false} value={value} onChange={onChange} placeholder={f.placeholder} />
                )}
              </Field>
            );
          })}
          <p className="text-xs text-[var(--muted)]">
            {`Checked with ${choosing?.name ?? "the CRM"} first, then stored encrypted. Secrets are never shown again.`}
          </p>
        </div>
        <div className="mt-3">
          <FormError message={error} />
        </div>
      </form>
    </Modal>
  );

  return (
    <Card className="md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-[16px]">
            {connection ? <CrmLogo provider={connection.provider} size={20} tile={34} /> : <Plug size={18} aria-hidden />}
            {connection ? `CRM · ${connection.providerName}` : "Connect your CRM"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Accepted leads from this workspace are sent to this CRM, so your sales team works where they already do. Only the deal
            result (stage and value) is read back, for your reports.
          </p>
        </div>
        {connection ? (
          connection.status === "connected" ? (
            <Badge tone={syncEnabled ? "green" : "amber"}>{syncEnabled ? "Connected" : "Connected · sync switched off"}</Badge>
          ) : (
            <Badge tone="amber">Check failed</Badge>
          )
        ) : (
          <Badge>Not connected</Badge>
        )}
      </div>

      {!loaded ? <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p> : null}

      {loaded && connection ? (
        <div className="mt-5 space-y-4">
          <dl className="grid gap-4 rounded-[12px] border border-[var(--line)] p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">Connected to</dt>
              <dd className="mt-1 font-medium text-[var(--foreground)]">{connection.accountLabel ?? connection.providerName}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">Credential</dt>
              <dd className="mt-1 font-mono text-[var(--foreground)]">{connection.credentialHint}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">Connected</dt>
              <dd className="mt-1 text-[var(--foreground)]">
                {formatDate(connection.connectedAt)}
                {connection.connectedByName ? ` by ${connection.connectedByName}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[var(--muted)]">Last checked</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-[var(--foreground)]">
                {connection.status === "connected" ? (
                  <CircleCheck size={14} className="text-[var(--badge-green-fg)]" aria-hidden />
                ) : (
                  <CircleAlert size={14} className="text-[var(--badge-amber-fg)]" aria-hidden />
                )}
                {connection.lastCheckedAt ? formatDate(connection.lastCheckedAt) : "Never"}
              </dd>
            </div>
          </dl>
          {connection.status === "failed" && connection.lastError ? (
            <p role="alert" className="rounded-[10px] bg-[var(--badge-amber-bg)] px-4 py-3 text-sm text-[var(--badge-amber-fg)]">
              {connection.lastError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await testCrmConnection(workspaceId);
                  setConnection(r.connection);
                  setNotice(r.connection.status === "connected" ? "The connection works." : null);
                })
              }
            >
              {busy ? "Checking…" : "Test connection"}
            </Button>
            {canManage ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() => setChoosing(catalog.find((c) => c.key === connection.provider) ?? null)}
                >
                  Replace credentials
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Disconnect ${connection.providerName}? Records already sent stay in your CRM; nothing more will be sent.`)) return;
                    void run(async () => {
                      await disconnectCrm(workspaceId);
                      setConnection(null);
                      setNotice("CRM disconnected.");
                    });
                  }}
                >
                  Disconnect
                </Button>
              </>
            ) : null}
          </div>
          {connectForm}
        </div>
      ) : null}

      {loaded && !connection ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {catalog.map((c) => {
              const active = choosing?.key === c.key;
              return (
                <div
                  key={c.key}
                  className={`flex flex-col items-start gap-3 rounded-[12px] border p-4 ${
                    active ? "border-[var(--brand)] bg-[var(--brand-tint)]" : "border-[var(--line)] bg-white"
                  }`}
                >
                  <CrmLogo provider={c.key} />
                  <span className="text-[15px] font-semibold text-[var(--foreground)]">{c.name}</span>
                  {c.available ? (
                    canManage ? (
                      <Button variant={active ? "primary" : "secondary"} disabled={busy} onClick={() => setChoosing(c)}>
                        Connect
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">A tenant admin can connect it</span>
                    )
                  ) : (
                    <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">Coming soon</span>
                  )}
                </div>
              );
            })}
          </div>
          {connectForm}
        </>
      ) : null}

      {notice ? (
        <p role="status" className="mt-4 text-sm font-medium text-[var(--badge-green-fg)]">
          {notice}
        </p>
      ) : null}
      <div className="mt-3">
        <FormError message={choosing ? null : error} />
      </div>
    </Card>
  );
}
