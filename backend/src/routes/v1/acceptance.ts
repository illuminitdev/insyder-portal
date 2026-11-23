import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { assertAccountReadable, loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { sendLeadForReview } from "../../services/researchHandoff.js";
import { reasonCategories, transitionAcceptance } from "../../services/acceptance.js";
import { acceptanceStates } from "../../db/schema/workflow.js";

export async function acceptanceRoutes(app: FastifyInstance) {
  // Send a lead with no research task to a named sales reviewer (they get a Sales review task)
  app.post("/v1/accounts/:accountId/send-for-review", { preHandler: authenticateRequired }, async (req) => {
    const { accountId } = req.params as { accountId: string };
    const body = z
      .object({ workspaceId: z.string(), note: z.string().min(1).max(2000), reviewerUserId: z.string().min(1) })
      .parse(req.body);
    const m = await loadMembership(req, body.workspaceId);
    requireCap(m, "submit_review");
    await assertAccountReadable(m, accountId);
    return sendLeadForReview({
      tenantId: m.tenantId,
      workspaceId: m.workspaceId,
      accountId,
      note: body.note,
      reviewerUserId: body.reviewerUserId,
      actorUserId: req.actor!.userId,
      role: m.role,
    });
  });

  app.get("/v1/acceptance/reason-categories", { preHandler: authenticateRequired }, async () => ({
    reasonCategories,
  }));

  app.post(
    "/v1/accounts/:accountId/acceptance-decisions",
    { preHandler: authenticateRequired },
    async (req) => {
      const { accountId } = req.params as { accountId: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      await assertAccountReadable(m, accountId);

      const body = z
        .object({
          toState: z.enum(acceptanceStates),
          reasonCategory: z.enum(reasonCategories).optional(),
          reasonDetail: z.string().max(2000).optional(),
          nextAction: z.string().max(500).optional(),
          ownerUserId: z.string().optional(),
          expectedVersion: z.number().int().optional(),
        })
        .parse(req.body);

      return transitionAcceptance({
        tenantId: m.tenantId,
        workspaceId: m.workspaceId,
        accountId,
        toState: body.toState,
        actorUserId: req.actor!.userId,
        role: m.role,
        reasonCategory: body.reasonCategory,
        reasonDetail: body.reasonDetail,
        nextAction: body.nextAction,
        ownerUserId: body.ownerUserId,
        expectedVersion: body.expectedVersion,
      });
    },
  );
}
