import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { loadMembership } from "../../middleware/requireMembership.js";
import { markNotifications, notificationState, notificationsFor } from "../../services/notifications.js";

export async function notificationRoutes(app: FastifyInstance) {
  /** The signed-in member's bell: only what their own role is allowed to see, plus what they've read. */
  app.get("/v1/workspaces/:workspaceId/notifications", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    const [items, state] = await Promise.all([
      notificationsFor(m, req.actor!.email),
      // Read state is a nicety: if it can't load (e.g. migration not applied yet), the bell still works
      notificationState(m).catch((err: unknown) => {
        req.log.warn({ err }, "notification read state unavailable");
        return { seenAt: {}, clearedAt: {} };
      }),
    ]);
    return { items, state };
  });

  /** Mark bell groups read or cleared; saved per person so every device shows the same */
  app.post("/v1/workspaces/:workspaceId/notifications/state", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    const body = z
      .object({ keys: z.array(z.string().min(1).max(60)).min(1).max(30), action: z.enum(["read", "clear"]) })
      .parse(req.body ?? {});
    return { state: await markNotifications(m, body.keys, body.action) };
  });
}
