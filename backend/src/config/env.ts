import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
 
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  DATABASE_URL_UNPOOLED: z.string().optional().default(""),
  NEON_BRANCH: z.string().optional().default(""),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  EXA_API_KEY: z.string().optional().default(""), 
  SECRETS_ENCRYPTION_KEY: z.string().optional().default(""),
  /** "true": the API process also runs the background job worker (no separate worker service) */
  RUN_WORKER_IN_API: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() === "true"),
  /**
   * Fast worker poll rate (seconds) during the 30 min after job activity. Idle workers in the API
   * process poll only every 3 h and are woken when a job is queued.
   */
  WORKER_POLL_SECONDS: z.coerce.number().int().min(1).max(300).optional(),
  /** "HH:MM" UTC time of the daily monitor run; default 03:30 UTC (9:00 AM India) */
  MONITOR_DAILY_TIME_UTC: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Prefer direct URL for migrations / long-lived workers. */
export function getDirectDatabaseUrl(): string {
  const env = getEnv();
  return env.DATABASE_URL_UNPOOLED?.trim() || env.DATABASE_URL;
}

export function isExaConfigured(): boolean {
  return Boolean(getEnv().EXA_API_KEY?.trim());
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
