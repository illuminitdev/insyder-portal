import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requirePlatformAdmin } from "../../middleware/authenticate.js";
import { demoRequestStatuses } from "../../db/schema/index.js";
import { createDemoRequest, listDemoRequests, setDemoRequestStatus } from "../../services/demoRequests.js";
import { assertIntakeKey } from "../../utils/intakeKey.js";

const intakeBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(200),
  company: z.string().trim().max(200).optional(),
  role: z.string().trim().max(120).optional(),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\//i.test(v), "Website should start with http:// or https://")
    .optional(),
  message: z.string().trim().max(2000).optional(),
});

export async function demoRequestRoutes(app: FastifyInstance) {
  /**
   * Intake from the marketing site's server route (server to server, never from a browser).
   * Authenticated by the shared DEMO_INTAKE_KEY sent in the x-intake-key header.
   */
  app.post("/v1/intake/demo-requests", async (req, reply) => {
    assertIntakeKey(req);

    const created = await createDemoRequest(intakeBody.parse(req.body));
    reply.status(201);
    return { ok: true, id: created.id };
  });

  /** "Book a demo" submissions, newest first. */
  app.get("/v1/platform/demo-requests", { preHandler: requirePlatformAdmin }, async (req) => {
    const { status } = z.object({ status: z.enum(demoRequestStatuses).optional() }).parse(req.query);
    return listDemoRequests(status);
  });

  app.patch("/v1/platform/demo-requests/:id", { preHandler: requirePlatformAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(demoRequestStatuses) }).parse(req.body);
    await setDemoRequestStatus(id, status, req.actor!.userId);
    return { ok: true };
  });
}
