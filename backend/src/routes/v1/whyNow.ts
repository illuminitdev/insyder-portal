import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { accounts, offers, providerUsage } from "../../db/schema/index.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { assertAccountReadable, loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { getResearchProvider, isResearchConfigured } from "../../providers/research/index.js";
import { NormalizedProviderError } from "../../providers/research/types.js";
import { refundResearchBudget, reserveResearchBudget } from "../../services/budget.js";
import { assertResearchAllowed } from "../../services/entitlements.js";
import { writeAudit } from "../../services/audit.js";
import { isAccountSuppressed } from "../../services/suppressions.js";
import { detectOfferingCategory } from "../../services/signals/buildBusinessContext.js";
import { AppError, providerNotConfigured, validationError } from "../../utils/errors.js";
import { newId } from "../../utils/ids.js";

/** The question asked about every company; dates and sources keep the answer checkable. */
export function whyNowQuestion(name: string, domain: string | null, offering?: string | null): string {
  const offerCat = detectOfferingCategory(offering);
  const targetDesc = domain ? ` (${domain})` : "";

  if (offerCat === "recruitment") {
    return (
      `What core products or services does ${name}${targetDesc} sell, and are they currently expanding, ` +
      "hiring technical staff, or announcing major business growth? " +
      "Answer in at most two sentences, identifying what the company does and what is happening right now."
    );
  }
  if (offerCat === "software") {
    return (
      `What products or services does ${name}${targetDesc} provide, and are they currently undertaking ` +
      "cloud migration, software modernization, or strategic business expansion? " +
      "Answer in at most two sentences, identifying what the company does and what is happening right now."
    );
  }
  if (offerCat === "infrastructure") {
    return (
      `What products or services does ${name}${targetDesc} provide, and are they currently expanding facilities, ` +
      "refreshing hardware/servers, adding compute or storage capacity, or hiring infrastructure staff? " +
      "Answer in at most two sentences, identifying what the company does and what is happening right now."
    );
  }
  return (
    `What products, services, or business model does ${name}${targetDesc} have, and what major strategic developments, ` +
    "expansion, or hiring initiatives are happening right now? " +
    "Answer in at most two sentences, identifying what the company does and what is happening right now."
  );
}

/** "Why now?": one cited, AI-written summary per account (Exa Answer). Costs one research unit. */
export async function whyNowRoutes(app: FastifyInstance) {
  app.post(
    "/v1/accounts/:accountId/why-now",
    { preHandler: authenticateRequired },
    async (req) => {
      const { accountId } = req.params as { accountId: string };
      const body = z.object({ workspaceId: z.string() }).parse(req.body);
      const m = await loadMembership(req, body.workspaceId);
      requireCap(m, "research");
      await assertAccountReadable(m, accountId);
      await assertResearchAllowed(m.tenantId, m.workspaceId);
      if (!isResearchConfigured()) throw providerNotConfigured("exa");
      if (await isAccountSuppressed(m.workspaceId, accountId)) {
        throw validationError("Cannot research a suppressed account");
      }
      const provider = getResearchProvider();
      if (!provider.answer) throw validationError("The research provider cannot write summaries");

      const db = getDb();
      const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
      if (!account) throw validationError("Account not found");

      const [offer] = await db.select({ offering: offers.offering }).from(offers).where(eq(offers.workspaceId, body.workspaceId)).limit(1);

      await reserveResearchBudget(m.tenantId, 1);
      let result;
      try {
        result = await provider.answer(whyNowQuestion(account.name, account.domain, offer?.offering), {
          ...(account.country ? { userLocation: account.country } : {}),
        });
      } catch (err) {
        await refundResearchBudget(m.tenantId, 1);
        if (err instanceof NormalizedProviderError) {
          throw new AppError(502, err.message, err.code);
        }
        throw err;
      }

      await db.insert(providerUsage).values({
        id: newId("pug"),
        tenantId: m.tenantId,
        workspaceId: m.workspaceId,
        researchRunId: null,
        provider: provider.name,
        requestRef: result.requestRef,
        units: 1,
      });
      const now = new Date();
      await db
        .update(accounts)
        .set({
          whyNowText: result.answer,
          whyNowCitationsJson: JSON.stringify(result.citations),
          whyNowAt: now,
        })
        .where(eq(accounts.id, accountId));
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId: m.workspaceId,
        actorUserId: m.userId,
        action: "account.why_now_generated",
        entityType: "account",
        entityId: accountId,
        metadata: { citations: result.citations.length },
      });

      return { whyNow: { text: result.answer, citations: result.citations, generatedAt: now.toISOString() } };
    },
  );
}
