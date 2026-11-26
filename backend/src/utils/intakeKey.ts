import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getEnv } from "../config/env.js";
import { AppError, unauthorized } from "./errors.js";

/** Constant-time comparison of the shared intake key (hashed first so lengths always match). */
export function keyMatches(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Server-to-server calls from the marketing site (Insyder repo) carry DEMO_INTAKE_KEY in the
 * x-intake-key header. Browsers never call these routes directly.
 */
export function assertIntakeKey(req: FastifyRequest) {
  const expected = getEnv().DEMO_INTAKE_KEY.trim();
  if (!expected) throw new AppError(503, "Marketing site intake is not configured. Set DEMO_INTAKE_KEY.", "intake_not_configured");
  const given = req.headers["x-intake-key"];
  if (typeof given !== "string" || !keyMatches(given, expected)) throw unauthorized("Invalid intake key");
}
