import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { offers, researchRuns } from "../../db/schema/index.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { hasCapability } from "../../auth/permissions.js";
import { forbidden, notFound } from "../../utils/errors.js";
import { writeAudit } from "../../services/audit.js";
import {
  createPlaybook,
  extractWorkspaceCustomSignals,
  listPlaybooks,
  playbookHistory,
  playbookInputSchema,
  setPlaybookArchived,
  SIGNAL_KINDS,
  updatePlaybook,
  type CustomSignal,
} from "../../services/playbooks.js";

/**
 * Signal playbooks. Everyone who can discover or view accounts can read them; members
 * with discover or manage_settings can create playbooks from scratch or saved searches.
 */
export async function playbookRoutes(app: FastifyInstance) {
  app.get("/v1/workspaces/:workspaceId/playbooks", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    if (!["discover", "view_accounts", "manage_settings"].some((c) => hasCapability(m.role, c as "discover"))) {
      throw forbidden("Missing capability: view_accounts");
    }
    const [offer] = await getDb()
      .select({ active: offers.activePlaybookTemplateKey })
      .from(offers)
      .where(eq(offers.workspaceId, workspaceId))
      .limit(1);
    const playbooks = await listPlaybooks(workspaceId);
    const customSignals = extractWorkspaceCustomSignals(playbooks);
    const signalKinds = Array.from(new Set([...SIGNAL_KINDS, ...customSignals.map((c) => c.key)]));
    return {
      playbooks,
      activeTemplateKey: offer?.active ?? "infrastructure",
      signalKinds,
      customSignals,
      canManage: hasCapability(m.role, "manage_settings"),
    };
  });

  app.post(
    "/v1/workspaces/:workspaceId/playbooks/custom-signals",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "discover")) {
        throw forbidden("Missing capability: discover");
      }
      const body = z
        .object({
          label: z.string().trim().min(2, "Give the signal a name").max(100),
          description: z.string().trim().max(300).optional().default(""),
          key: z.string().trim().max(80).optional(),
        })
        .parse(req.body ?? {});

      const rawKey = body.key?.trim() || body.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      const key = rawKey.startsWith("custom_") ? rawKey : `custom_${rawKey}`;

      const customSignal: CustomSignal = {
        key,
        label: body.label,
        description: body.description,
      };

      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "playbook.custom_signal_created",
        metadata: { key, label: body.label },
      });

      return { customSignal };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/playbooks/:templateKey/versions",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, templateKey } = req.params as { workspaceId: string; templateKey: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "discover") && !hasCapability(m.role, "manage_settings")) {
        throw forbidden("Missing capability: discover");
      }
      return { versions: await playbookHistory(workspaceId, templateKey) };
    },
  );

  app.post("/v1/workspaces/:workspaceId/playbooks", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "discover")) {
      throw forbidden("Missing capability: discover");
    }
    const body = playbookInputSchema.parse(req.body ?? {});
    const playbook = await createPlaybook(m.tenantId, workspaceId, body);
    await writeAudit({
      tenantId: m.tenantId,
      workspaceId,
      actorUserId: req.actor!.userId,
      action: "playbook.created",
      metadata: { templateKey: playbook.templateKey, name: playbook.name, version: playbook.version },
    });
    return { playbook };
  });

  /**
   * Saves the inputs and filters from a successful search run as a reusable playbook.
   */
  app.post(
    "/v1/workspaces/:workspaceId/research-runs/:runId/save-playbook",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, runId } = req.params as { workspaceId: string; runId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "discover")) {
        throw forbidden("Missing capability: discover");
      }
      const body = z
        .object({
          name: z.string().trim().min(2, "Give the playbook a name").max(80),
          description: z.string().trim().max(200).optional(),
          discoveryQuestion: z.string().trim().max(400).optional(),
        })
        .parse(req.body ?? {});

      const db = getDb();
      const [run] = await db
        .select()
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.id, runId),
            eq(researchRuns.workspaceId, m.workspaceId),
            eq(researchRuns.tenantId, m.tenantId),
          ),
        )
        .limit(1);
      if (!run) throw notFound("Search run not found");

      let rawFilters: Record<string, unknown> = {};
      try {
        rawFilters = JSON.parse(run.filtersJson || "{}");
      } catch {
        // ignore
      }

      const validSignals = Array.isArray(rawFilters.signals)
        ? (rawFilters.signals as string[]).filter(
            (s) => (SIGNAL_KINDS as readonly string[]).includes(s as any) || s.startsWith("custom_"),
          )
        : [];
      const signals: string[] = validSignals.length > 0 ? validSignals : ["expansion"];

      const countries = Array.isArray(rawFilters.countries) ? (rawFilters.countries as string[]) : [];
      const industries = Array.isArray(rawFilters.industries) ? (rawFilters.industries as string[]) : [];
      const eventWindowDays = typeof rawFilters.eventWindowDays === "number" ? rawFilters.eventWindowDays : null;
      const requiredPhrase = typeof rawFilters.requiredPhrase === "string" ? rawFilters.requiredPhrase : "";

      const playbook = await createPlaybook(m.tenantId, workspaceId, {
        name: body.name,
        description: body.description || (run.brief ?? run.query).slice(0, 200),
        signals,
        countries,
        industries,
        eventWindowDays,
        requiredPhrase,
        discoveryQuestion: body.discoveryQuestion ?? "",
        requiredEvidence: "Dated announcement or verified signal for company and location.",
      });

      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "playbook.created_from_search",
        metadata: {
          runId,
          templateKey: playbook.templateKey,
          name: playbook.name,
          version: playbook.version,
        },
      });

      return { playbook };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/playbooks/:templateKey",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, templateKey } = req.params as { workspaceId: string; templateKey: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = playbookInputSchema.parse(req.body ?? {});
      const playbook = await updatePlaybook(m.tenantId, workspaceId, templateKey, body);
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "playbook.updated",
        metadata: { templateKey, name: playbook.name, version: playbook.version },
      });
      return { playbook };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/playbooks/:templateKey/archive",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId, templateKey } = req.params as { workspaceId: string; templateKey: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const { archived } = z.object({ archived: z.boolean() }).parse(req.body ?? {});
      const [offer] = await getDb()
        .select({ active: offers.activePlaybookTemplateKey })
        .from(offers)
        .where(eq(offers.workspaceId, workspaceId))
        .limit(1);
      const playbook = await setPlaybookArchived(m.tenantId, workspaceId, templateKey, archived, offer?.active ?? null);
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: archived ? "playbook.archived" : "playbook.restored",
        metadata: { templateKey, version: playbook.version },
      });
      return { playbook };
    },
  );
}
