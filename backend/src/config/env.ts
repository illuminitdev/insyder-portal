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
  /** Shared key the marketing site (Insyder repo) sends to forward "Book a demo" requests. Empty: intake off. */
  DEMO_INTAKE_KEY: z.string().optional().default(""),
  /** Stripe secret key (sk_test_… / sk_live_…). Empty: paid sign-up and billing are off. */
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  /** Signing secret of the Stripe webhook endpoint (whsec_…), used to verify POST /v1/stripe/webhook */
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  /** "true": plan limits and the paid-plan check are enforced. Off (default) while plans are hidden for demos. */
  PLANS_ENFORCED: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() === "true"),
  /** Resend API key for transactional email (login details). Empty: emails are logged, not sent. */
  RESEND_API_KEY: z.string().optional().default(""),
  /** Sender, e.g. "Insyder <hello@yourdomain.com>". Resend's test sender works until a domain is verified. */
  EMAIL_FROM: z.string().optional().default("Insyder <onboarding@resend.dev>"),
  /** Public URL of the marketing site: Stripe returns buyers here after checkout */
  MARKETING_SITE_URL: z.string().optional().default("http://localhost:3001"),
  /** Public URL of this portal's frontend, used for the login link in emails. Default: first FRONTEND_ORIGIN. */
  PORTAL_PUBLIC_URL: z.string().optional().default(""),
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

/** Plans hidden for demos: when false, plan limits and the paid-plan check are skipped (nothing is deleted). */
export function plansEnforced(): boolean {
  return getEnv().PLANS_ENFORCED;
}

export function isStripeConfigured(): boolean {
  return Boolean(getEnv().STRIPE_SECRET_KEY?.trim());
}

/** Where people log in: PORTAL_PUBLIC_URL, else the first FRONTEND_ORIGIN. No trailing slash. */
export function portalUrl(): string {
  const env = getEnv();
  const url = env.PORTAL_PUBLIC_URL.trim() || env.FRONTEND_ORIGIN.split(",")[0]!.trim();
  return url.replace(/\/+$/, "");
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
