import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { crmConnections } from "../../db/schema/index.js";
import { crmNotConnected } from "../../utils/errors.js";
import { decryptSecret } from "../../utils/secrets.js";
import { HubspotCrmProvider } from "./hubspot.js";
import { parseSalesforceCredential, SalesforceCrmProvider } from "./salesforce.js";
import type { CrmProvider } from "./types.js";

let override: CrmProvider | null = null;

/** CRMs that have an adapter and can actually be connected. */
export const SUPPORTED_CRM_PROVIDERS = new Set(["hubspot", "salesforce"]);

/** Test hook: replace the live CRM with a fake (never used in production paths). */
export function setCrmProviderForTests(provider: CrmProvider | null) {
  override = provider;
}

/** The workspace's own CRM connection row, if it has one (each workspace connects its own CRM). */
export async function getCrmConnection(tenantId: string, workspaceId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(crmConnections)
    .where(and(eq(crmConnections.tenantId, tenantId), eq(crmConnections.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Build the adapter for a stored connection. Only providers with an adapter can be built. */
export function providerFromConnection(conn: { provider: string; encryptedCredential: string; externalAccountId: string | null }): CrmProvider {
  if (conn.provider === "hubspot") {
    return new HubspotCrmProvider(decryptSecret(conn.encryptedCredential), conn.externalAccountId);
  }
  if (conn.provider === "salesforce") {
    return new SalesforceCrmProvider(parseSalesforceCredential(decryptSecret(conn.encryptedCredential)));
  }
  throw crmNotConnected();
}

/** The CRM adapter for this workspace, using its own credentials (each workspace connects its own CRM). */
export async function getCrmProvider(tenantId: string, workspaceId: string): Promise<CrmProvider> {
  if (override) return override;
  const conn = await getCrmConnection(tenantId, workspaceId);
  if (!conn) throw crmNotConnected();
  return providerFromConnection(conn);
}

export async function isCrmConfigured(tenantId: string, workspaceId: string): Promise<boolean> {
  if (override) return true;
  const conn = await getCrmConnection(tenantId, workspaceId);
  return Boolean(conn && SUPPORTED_CRM_PROVIDERS.has(conn.provider));
}

export async function crmProviderStatus(tenantId: string, workspaceId: string) {
  if (override) return { provider: override.name, configured: true, accountLabel: null as string | null };
  const conn = await getCrmConnection(tenantId, workspaceId);
  return {
    provider: conn?.provider ?? null,
    configured: Boolean(conn && SUPPORTED_CRM_PROVIDERS.has(conn.provider)),
    accountLabel: conn?.externalAccountLabel ?? null,
  };
}

export type { CrmProvider } from "./types.js";
export { CrmError } from "./types.js";
