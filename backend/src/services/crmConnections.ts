import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { crmConnections, users, type CrmProviderKey } from "../db/schema/index.js";
import { getCrmConnection, providerFromConnection } from "../providers/crm/index.js";
import { HubspotCrmProvider } from "../providers/crm/hubspot.js";
import { normalizeMyDomainUrl, SalesforceCrmProvider } from "../providers/crm/salesforce.js";
import { CrmError, type CrmProvider } from "../providers/crm/types.js";
import { validationError, notFound } from "../utils/errors.js";
import { newId } from "../utils/ids.js";
import { redactString } from "../utils/redact.js";
import { encryptSecret, secretHint } from "../utils/secrets.js";
import { writeAudit } from "./audit.js";

/** One input on the "Connect" form. Secret fields are masked and never shown again. */
export type CrmCredentialField = { key: string; label: string; placeholder: string; secret: boolean; hint?: string };

/** CRMs shown in Settings. Each one listed has an adapter and can be connected. */
export const CRM_CATALOG: Array<{
  key: CrmProviderKey;
  name: string;
  available: boolean;
  credentialHelp: string;
  fields: CrmCredentialField[];
}> = [
  {
    key: "hubspot",
    name: "HubSpot",
    available: true,
    credentialHelp:
      "In HubSpot: Settings → Integrations → Private apps → Create a private app. Give it CRM read/write scopes for companies, contacts and deals, then copy its access token.",
    fields: [{ key: "token", label: "HubSpot access token", placeholder: "pat-eu1-…", secret: true }],
  },
  {
    key: "salesforce",
    name: "Salesforce",
    available: true,
    credentialHelp:
      "In Salesforce Setup, create a Connected App (or External Client App) with OAuth enabled, the “api” scope and “Enable Client Credentials Flow” ticked. In its policies set a Run As user who can read and edit Accounts, Contacts and Opportunities. Then copy its Consumer Key and Consumer Secret, and your My Domain URL (Setup → My Domain).",
    fields: [
      {
        key: "myDomainUrl",
        label: "My Domain URL",
        placeholder: "https://yourcompany.my.salesforce.com",
        secret: false,
        hint: "Setup → My Domain. Sandboxes end in .sandbox.my.salesforce.com",
      },
      { key: "clientId", label: "Consumer key", placeholder: "3MVG9…", secret: false },
      { key: "clientSecret", label: "Consumer secret", placeholder: "", secret: true },
    ],
  },
];

type Prepared = { provider: CrmProvider; stored: string; hint: string };

/** Validate the entered fields and build an adapter from them, plus what gets stored (encrypted) and shown. */
function prepareCredentials(provider: CrmProviderKey, raw: Record<string, string>): Prepared {
  const entry = CRM_CATALOG.find((c) => c.key === provider)!;
  const values: Record<string, string> = {};
  for (const f of entry.fields) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) throw validationError(`Enter the ${f.label}`);
    if (v.length > 2000) throw validationError(`The ${f.label} is too long`);
    values[f.key] = v;
  }
  if (provider === "hubspot") {
    const token = values.token!;
    if (token.length < 10) throw validationError("That HubSpot access token looks too short");
    return { provider: new HubspotCrmProvider(token, null), stored: token, hint: secretHint(token) };
  }
  if (provider === "salesforce") {
    let myDomainUrl: string;
    try {
      myDomainUrl = normalizeMyDomainUrl(values.myDomainUrl!);
    } catch (err) {
      throw validationError((err as Error).message);
    }
    const creds = { myDomainUrl, clientId: values.clientId!, clientSecret: values.clientSecret! };
    // The hint identifies the Connected App by its consumer key; the secret is never shown, even in part
    return { provider: new SalesforceCrmProvider(creds), stored: JSON.stringify(creds), hint: `Key ${secretHint(creds.clientId)}` };
  }
  throw validationError("Unknown CRM");
}

/** What anyone in the company may see about the connection: never the credential itself. */
export async function getConnectionView(tenantId: string, workspaceId: string) {
  const conn = await getCrmConnection(tenantId, workspaceId);
  if (!conn) return null;
  const db = getDb();
  const [by] = await db.select({ name: users.name }).from(users).where(eq(users.id, conn.connectedBy)).limit(1);
  return {
    provider: conn.provider,
    providerName: CRM_CATALOG.find((c) => c.key === conn.provider)?.name ?? conn.provider,
    status: conn.status as "connected" | "failed",
    credentialHint: conn.credentialHint,
    accountLabel: conn.externalAccountLabel,
    lastCheckedAt: conn.lastCheckedAt,
    lastError: conn.lastError,
    connectedAt: conn.createdAt,
    connectedByName: by?.name ?? null,
  };
}

/** Readable reason a CRM refused a credential. */
function connectError(err: unknown, provider: string) {
  if (err instanceof CrmError && (err.status === 401 || err.status === 403)) {
    if (provider === "salesforce") {
      const reason = err.message.replace(/^Salesforce refused the login:?\s*/, "") || "no reason given";
      return `Salesforce refused these details (${reason}). Check the consumer key and secret were copied in full, that “Enable Client Credentials Flow” is ticked with a Run As user set, and that the My Domain URL is your org's.`;
    }
    return "HubSpot refused this token. Check it was copied in full and that the private app has CRM scopes for companies, contacts and deals.";
  }
  return redactString(err instanceof Error ? err.message : "Could not reach the CRM");
}

/** Connect (or replace) the company's CRM. The credential is checked against the CRM before it's saved. */
export async function connectCrm(input: {
  tenantId: string;
  workspaceId: string;
  actorUserId: string;
  provider: string;
  credentials: Record<string, string>;
}) {
  const entry = CRM_CATALOG.find((c) => c.key === input.provider);
  if (!entry) throw validationError("Unknown CRM");
  if (!entry.available) throw validationError(`${entry.name} isn't available yet`);
  const prepared = prepareCredentials(entry.key, input.credentials);

  let account: { id: string; label: string };
  try {
    account = await prepared.provider.describeAccount();
  } catch (err) {
    throw validationError(connectError(err, entry.key));
  }

  const db = getDb();
  const now = new Date();
  const values = {
    provider: entry.key,
    encryptedCredential: encryptSecret(prepared.stored),
    credentialHint: prepared.hint,
    externalAccountId: account.id,
    externalAccountLabel: account.label,
    status: "connected",
    lastCheckedAt: now,
    lastError: null,
    connectedBy: input.actorUserId,
    updatedAt: now,
  };
  await db
    .insert(crmConnections)
    .values({ id: newId("crmc"), tenantId: input.tenantId, workspaceId: input.workspaceId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: crmConnections.workspaceId, set: { ...values, createdAt: now } });

  await writeAudit({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "crm.connected",
    entityType: "crm_connection",
    entityId: input.workspaceId,
    metadata: { provider: entry.key, account: account.label },
  });
  return getConnectionView(input.tenantId, input.workspaceId);
}

/** Re-check the stored credential still works, and record the result. */
export async function testCrmConnection(tenantId: string, workspaceId: string) {
  const conn = await getCrmConnection(tenantId, workspaceId);
  if (!conn) throw notFound("No CRM is connected");
  const db = getDb();
  const now = new Date();
  try {
    const account = await providerFromConnection(conn).describeAccount();
    await db
      .update(crmConnections)
      .set({
        status: "connected",
        lastCheckedAt: now,
        lastError: null,
        externalAccountId: account.id,
        externalAccountLabel: account.label,
        updatedAt: now,
      })
      .where(eq(crmConnections.id, conn.id));
  } catch (err) {
    await db
      .update(crmConnections)
      .set({ status: "failed", lastCheckedAt: now, lastError: connectError(err, conn.provider), updatedAt: now })
      .where(eq(crmConnections.id, conn.id));
  }
  return getConnectionView(tenantId, workspaceId);
}

/** Remove the company's CRM connection. Records already sent stay in the CRM; nothing more is sent. */
export async function disconnectCrm(input: { tenantId: string; workspaceId: string; actorUserId: string }) {
  const conn = await getCrmConnection(input.tenantId, input.workspaceId);
  if (!conn) return null;
  const db = getDb();
  // Only this workspace's connection; other workspaces keep theirs
  await db.delete(crmConnections).where(eq(crmConnections.id, conn.id));
  await writeAudit({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "crm.disconnected",
    entityType: "crm_connection",
    entityId: input.workspaceId,
    metadata: { provider: conn.provider },
  });
  return null;
}
