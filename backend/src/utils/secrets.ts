import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getEnv } from "../config/env.js";

/**
 * Encryption for customer credentials stored in the database (e.g. a company's CRM token).
 * AES-256-GCM. The key comes from SECRETS_ENCRYPTION_KEY, or is derived from AUTH_SECRET when
 * that isn't set (set a dedicated key in production: rotating AUTH_SECRET would otherwise make
 * stored credentials unreadable, and customers would need to reconnect).
 */
function key(): Buffer {
  const env = getEnv();
  const material = env.SECRETS_ENCRYPTION_KEY?.trim() || env.AUTH_SECRET;
  return Buffer.from(hkdfSync("sha256", material, "insyder", "stored-credentials-v1", 32));
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable stored credential");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** What the UI may show of a credential: its last four characters. */
export function secretHint(plain: string): string {
  return `••••${plain.trim().slice(-4)}`;
}
