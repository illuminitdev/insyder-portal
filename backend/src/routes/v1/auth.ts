import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema/index.js";
import { hashPassword, verifyPassword } from "../../auth/password.js";
import {
  createSession,
  destroyOtherSessions,
  destroySession,
  forgetUserSessions,
  SESSION_COOKIE,
} from "../../auth/session.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { forbidden, rateLimited, unauthorized, validationError } from "../../utils/errors.js";
import { accessRequestStatusForLogin, submitAccessRequest } from "../../services/accessRequests.js";
import { isProduction } from "../../config/env.js";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const failures = new Map<string, { count: number; firstAt: number }>();

/** Per-email+IP failed-login throttle (in-process; one API instance per deployment). */
function checkThrottle(key: string) {
  const entry = failures.get(key);
  if (!entry) return;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    failures.delete(key);
    return;
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    throw rateLimited("Too many failed sign-in attempts. Try again later.");
  }
}

function recordFailure(key: string) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const REQUEST_MAX_PER_IP = 5;
const requestsByIp = new Map<string, { count: number; firstAt: number }>();

/** Per-IP cap on access requests (in-process), so the public form can't be used to flood the queue. */
function throttleAccessRequest(ip: string) {
  const entry = requestsByIp.get(ip);
  if (!entry || Date.now() - entry.firstAt > REQUEST_WINDOW_MS) {
    requestsByIp.set(ip, { count: 1, firstAt: Date.now() });
    return;
  }
  if (entry.count >= REQUEST_MAX_PER_IP) throw rateLimited("Too many requests from this network. Try again later.");
  entry.count++;
}

export async function authRoutes(app: FastifyInstance) {
  /** Public "Create account": files a request for the platform admin to approve. Creates no account. */
  app.post("/v1/auth/access-requests", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1, "Enter your full name").max(200),
        email: z.string().trim().email("Enter a valid email").max(320),
        companyName: z.string().trim().min(1, "Enter your company").max(200),
        message: z.string().trim().max(1000).optional(),
        password: z.string().min(8, "Password must be at least 8 characters").max(200),
      })
      .parse(req.body);
    throttleAccessRequest(req.ip);
    await submitAccessRequest(body);
    return { ok: true };
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    const email = body.email.toLowerCase();
    const throttleKey = `${email}|${req.ip}`;
    checkThrottle(throttleKey);

    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      recordFailure(throttleKey);
      // Someone who asked for access (and typed that same password) is told where their request stands
      const request = user ? null : await accessRequestStatusForLogin(email, body.password);
      if (request === "pending") throw forbidden("Your access request is waiting for approval. You can log in once it's approved.");
      if (request === "rejected") throw forbidden("Your access request was declined. Contact the Insyder team if you think this is a mistake.");
      throw unauthorized("Invalid email or password");
    }
    failures.delete(throttleKey);

    const { token, expiresAt } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      // Frontend (Vercel) and API (Render) are different sites in production, so the cookie
      // must be SameSite=None to ride along on cross-site fetches; None requires Secure.
      sameSite: isProduction() ? "none" : "lax",
      secure: isProduction(),
      expires: expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mustChangePassword: user.mustChangePassword,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    };
  });

  app.post("/v1/auth/change-password", { preHandler: authenticateRequired }, async (req) => {
    const body = z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
      })
      .parse(req.body);
    if (body.newPassword === body.currentPassword) {
      throw validationError("Choose a password different from the current one");
    }
    const throttleKey = `change|${req.actor!.userId}|${req.ip}`;
    checkThrottle(throttleKey);

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, req.actor!.userId)).limit(1);
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      recordFailure(throttleKey);
      throw validationError("Current password is incorrect");
    }
    failures.delete(throttleKey);

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    // Keep this session, sign out everywhere else
    await destroyOtherSessions(user.id, req.cookies?.[SESSION_COOKIE]);
    return { ok: true };
  });

  /**
   * Edit your own details (every role). Name is free to change; the email is your login, so changing
   * it needs your current password and must not belong to anyone else.
   */
  app.patch("/v1/auth/profile", { preHandler: authenticateRequired }, async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1, "Enter your name").max(200).optional(),
        email: z.string().trim().toLowerCase().email("Enter a valid email address").max(320).optional(),
        currentPassword: z.string().optional(),
      })
      .parse(req.body);
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, req.actor!.userId)).limit(1);
    if (!user) throw unauthorized();

    const patch: { name?: string; email?: string } = {};
    if (body.name && body.name !== user.name) patch.name = body.name;
    if (body.email && body.email !== user.email) {
      const throttleKey = `profile|${user.id}|${req.ip}`;
      checkThrottle(throttleKey);
      if (!body.currentPassword || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        recordFailure(throttleKey);
        throw validationError("Enter your current password to change your email");
      }
      failures.delete(throttleKey);
      const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (taken && taken.id !== user.id) throw validationError("That email is already used by another account");
      patch.email = body.email;
    }
    if (Object.keys(patch).length) {
      await db.update(users).set(patch).where(eq(users.id, user.id));
      // Sessions cache the name and email; drop them so every page shows the new details now
      forgetUserSessions(user.id);
    }
    return { user: { id: user.id, name: patch.name ?? user.name, email: patch.email ?? user.email } };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, {
      path: "/",
      sameSite: isProduction() ? "none" : "lax",
      secure: isProduction(),
    });
    return { ok: true };
  });

  app.get("/v1/auth/me", { preHandler: authenticateRequired }, async (req) => {
    return {
      user: {
        id: req.actor!.userId,
        email: req.actor!.email,
        name: req.actor!.name,
        mustChangePassword: req.actor!.mustChangePassword,
        isPlatformAdmin: req.actor!.isPlatformAdmin,
      },
    };
  });
}
