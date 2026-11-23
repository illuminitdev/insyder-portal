import { beforeAll, describe, expect, it } from "vitest";

describe("stored credential encryption", () => {
  beforeAll(() => {
    process.env.DATABASE_URL ||= "postgres://unused";
    process.env.AUTH_SECRET ||= "test-secret-test-secret";
  });

  it("round-trips, never stores the plain value, and shows only the last 4 characters", async () => {
    const { decryptSecret, encryptSecret, secretHint } = await import("./secrets.js");
    const token = "pat-eu1-1234567890abcdef";
    const stored = encryptSecret(token);
    expect(stored).not.toContain(token);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptSecret(stored)).toBe(token);
    // Same input encrypts differently each time (random IV)
    expect(encryptSecret(token)).not.toBe(stored);
    expect(secretHint(token)).toBe("••••cdef");
  });

  it("refuses a tampered value", async () => {
    const { decryptSecret, encryptSecret } = await import("./secrets.js");
    const [v, iv, tag, data] = encryptSecret("pat-eu1-abcdefghijkl").split(".");
    const buf = Buffer.from(data!, "base64url");
    buf[0] ^= 1;
    const flipped = buf.toString("base64url");
    expect(() => decryptSecret([v, iv, tag, flipped].join("."))).toThrow();
  });
});
