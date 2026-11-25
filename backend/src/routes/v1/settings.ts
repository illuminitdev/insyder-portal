import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { offers, playbookVersions, workspaces } from "../../db/schema/index.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { hasCapability } from "../../auth/permissions.js";
import { getUsage } from "../../services/budget.js";
import { researchProviderStatus } from "../../providers/research/index.js";
import { crmProviderStatus } from "../../providers/crm/index.js";
import { newId } from "../../utils/ids.js";
import { forbidden, validationError } from "../../utils/errors.js";
import { writeAudit } from "../../services/audit.js";
import { ensureEntitlements, updateEntitlements } from "../../services/entitlements.js";
import { parseBrief } from "../../services/briefParser.js";
import { parseGates } from "../../services/acceptance.js";
import { parseBranding, validateBranding } from "../../services/branding.js";
import { FIELD_KEYS } from "../../services/qualification.js";
import { normalizeCountry, normalizeWebsite } from "../../utils/normalize.js";
import { latestPlaybook, listPlaybooks } from "../../services/playbooks.js";
import { parseOfferItems } from "../../services/stakeholderBriefs.js";
import {
  applyProfile,
  getProfileState,
  PROFILE_RUN_UNITS,
  profileAgentAvailable,
  startProfileAnalysis,
} from "../../services/companyProfile.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.get(
    "/v1/workspaces/:workspaceId/settings/offer",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "view_accounts")) {
        throw forbidden("Missing capability: view_accounts");
      }
      const db = getDb();
      const [offer] = await db
        .select()
        .from(offers)
        .where(eq(offers.workspaceId, workspaceId))
        .limit(1);
      // Latest version of each playbook; archived ones are hidden from pickers
      const playbooks = (await listPlaybooks(workspaceId)).filter((p) => !p.archived);
      return {
        offer: offer
          ? {
              ...offer,
              buyerRoles: JSON.parse(offer.buyerRolesJson),
              industries: JSON.parse(offer.industriesJson),
              companySizes: JSON.parse(offer.companySizesJson),
              territory: JSON.parse(offer.territoryJson),
              exclusions: JSON.parse(offer.exclusionsJson),
              offerItems: parseOfferItems(offer.offerItemsJson),
              structuredQuery: offer.structuredQueryJson
                ? JSON.parse(offer.structuredQueryJson)
                : null,
              unsupportedFilters: JSON.parse(offer.unsupportedFiltersJson),
            }
          : null,
        playbooks,
      };
    },
  );

  /** Our company profile read from our website: state of the analysis and its suggestions */
  app.get(
    "/v1/workspaces/:workspaceId/settings/company-profile",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "view_accounts")) {
        throw forbidden("Missing capability: view_accounts");
      }
      return {
        ...(await getProfileState(workspaceId, m.tenantId)),
        available: profileAgentAvailable(),
        units: PROFILE_RUN_UNITS,
      };
    },
  );

  /** Read our website and build a profile (uses research units). Suggestions only until applied. */
  app.post(
    "/v1/workspaces/:workspaceId/settings/company-profile/analyze",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = z.object({ website: z.string().trim().min(1, "Enter your website").max(300) }).parse(req.body);
      const state = await startProfileAnalysis(
        { tenantId: m.tenantId, workspaceId, actorUserId: req.actor!.userId },
        body.website,
      );
      return { ...state, available: true, units: PROFILE_RUN_UNITS };
    },
  );

  /** Copy the chosen suggestions into Offer & targeting, products, and a new playbook */
  app.post(
    "/v1/workspaces/:workspaceId/settings/company-profile/apply",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const flag = z.boolean().optional();
      const body = z
        .object({
          offering: flag,
          companyName: flag,
          industries: flag,
          buyerRoles: flag,
          territory: flag,
          companySizes: flag,
          products: flag,
          playbook: flag,
          makeDefault: flag,
        })
        .parse(req.body ?? {});
      return applyProfile({ tenantId: m.tenantId, workspaceId, actorUserId: req.actor!.userId }, body);
    },
  );

  /** Our company and products only (stakeholder briefs rank these per person); targeting is untouched. */
  app.put(
    "/v1/workspaces/:workspaceId/settings/offer/products",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = z
        .object({
          sellerCompany: z.string().trim().max(120).nullable().default(null),
          offerItems: z
            .array(
              z.object({
                name: z.string().trim().min(1, "Each product needs a name").max(80),
                description: z.string().trim().min(1, "Each product needs a description").max(500),
                proofPoints: z.string().trim().max(300).optional(),
                bestFor: z.string().trim().max(300).optional(),
              }),
            )
            .max(15, "Add at most 15 products")
            .default([]),
        })
        .parse(req.body);
      const names = body.offerItems.map((i) => i.name.toLowerCase());
      if (new Set(names).size !== names.length) throw validationError("Each product needs a different name");
      const values = {
        sellerCompany: body.sellerCompany || null,
        offerItemsJson: JSON.stringify(
          body.offerItems.map((i) => ({
            name: i.name,
            description: i.description,
            ...(i.proofPoints ? { proofPoints: i.proofPoints } : {}),
            ...(i.bestFor ? { bestFor: i.bestFor } : {}),
          })),
        ),
      };
      const db = getDb();
      const [existing] = await db.select({ id: offers.id }).from(offers).where(eq(offers.workspaceId, workspaceId)).limit(1);
      if (existing) {
        await db.update(offers).set({ ...values, updatedAt: new Date() }).where(eq(offers.id, existing.id));
      } else {
        await db.insert(offers).values({ id: newId("ofr"), tenantId: m.tenantId, workspaceId, ...values });
      }
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "settings.offer_products.updated",
        metadata: { products: body.offerItems.length },
      });
      return { ok: true, sellerCompany: values.sellerCompany, offerItems: parseOfferItems(values.offerItemsJson) };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/settings/offer",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = z
        .object({
          offering: z.string().min(1).max(300),
          buyerRoles: z.array(z.string().max(80)).max(30).default([]),
          industries: z.array(z.string().max(80)).max(30).default([]),
          companySizes: z.array(z.string().max(20)).max(10).default([]),
          territory: z.array(z.string().max(60)).max(30).default([]),
          exclusions: z.array(z.string().max(200)).max(200).default([]),
          eventWindowDays: z.number().int().min(1).max(3650).default(90),
          naturalLanguageBrief: z.string().max(2000).optional(),
          /** Our own website (optional); "" clears it */
          sellerWebsite: z.string().trim().max(300).nullable().optional(),
          expectedVersion: z.number().int().optional(),
        })
        .parse(req.body);

      // Territory is stored as ISO codes so region matching uses normalized data (R1)
      const territory: string[] = [];
      for (const t of body.territory) {
        const code = normalizeCountry(t);
        if (!code) throw validationError(`Unknown territory "${t}" — use a country name or ISO code`);
        if (!territory.includes(code)) territory.push(code);
      }

      // Undefined = leave as is (older clients); "" or null = clear
      let sellerWebsite: string | null | undefined;
      if (body.sellerWebsite !== undefined) {
        sellerWebsite = body.sellerWebsite ? normalizeWebsite(body.sellerWebsite) : null;
        if (body.sellerWebsite && !sellerWebsite) {
          throw validationError(`"${body.sellerWebsite}" is not a website address — use e.g. yourcompany.com`);
        }
      }

      // Parse NL brief into a visible structured query; surface unsupported filters
      const parsed = body.naturalLanguageBrief ? parseBrief(body.naturalLanguageBrief) : null;
      const structured = {
        offering: body.offering,
        territory,
        industries: body.industries,
        companySizes: body.companySizes,
        eventWindowDays: body.eventWindowDays,
        fromBrief: parsed?.structured ?? null,
      };
      const unsupported = parsed?.unsupported ?? [];

      const db = getDb();
      const [existing] = await db
        .select()
        .from(offers)
        .where(eq(offers.workspaceId, workspaceId))
        .limit(1);

      const values = {
        offering: body.offering,
        buyerRolesJson: JSON.stringify(body.buyerRoles),
        industriesJson: JSON.stringify(body.industries),
        companySizesJson: JSON.stringify(body.companySizes),
        territoryJson: JSON.stringify(territory),
        exclusionsJson: JSON.stringify(body.exclusions),
        eventWindowDays: body.eventWindowDays,
        naturalLanguageBrief: body.naturalLanguageBrief,
        structuredQueryJson: JSON.stringify(structured),
        unsupportedFiltersJson: JSON.stringify(unsupported),
        ...(sellerWebsite !== undefined ? { sellerWebsite } : {}),
      };

      if (existing) {
        if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) {
          const { conflict } = await import("../../utils/errors.js");
          throw conflict("Settings were changed by someone else — reload and retry");
        }
        await db
          .update(offers)
          .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
          .where(eq(offers.id, existing.id));
      } else {
        await db.insert(offers).values({
          id: newId("ofr"),
          tenantId: m.tenantId,
          workspaceId,
          ...values,
        });
      }

      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "settings.offer.updated",
      });

      return { ok: true, territory, sellerWebsite: sellerWebsite ?? existing?.sellerWebsite ?? null, unsupportedFilters: unsupported, structuredQuery: structured };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/settings/active-playbook",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "discover") && !hasCapability(m.role, "manage_settings")) {
        throw forbidden("Missing capability: discover");
      }
      const body = z.object({
        templateKey: z.string(),
      }).parse(req.body ?? {});
      const chosen = await latestPlaybook(workspaceId, body.templateKey);
      if (!chosen) throw validationError("Unknown playbook");
      if (chosen.archived) throw validationError("That playbook is archived. Restore it first.");

      const db = getDb();
      await db
        .update(offers)
        .set({
          activePlaybookTemplateKey: body.templateKey,
          updatedAt: new Date(),
        })
        .where(eq(offers.workspaceId, workspaceId));

      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "settings.active_playbook.updated",
        metadata: { templateKey: body.templateKey },
      });

      return { ok: true, activePlaybookTemplateKey: body.templateKey };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/settings/event-window",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "discover") && !hasCapability(m.role, "manage_settings")) {
        throw forbidden("Missing capability: discover");
      }
      const body = z.object({
        eventWindowDays: z.number().int().positive(),
      }).parse(req.body ?? {});

      const db = getDb();
      await db
        .update(offers)
        .set({
          eventWindowDays: body.eventWindowDays,
          updatedAt: new Date(),
        })
        .where(eq(offers.workspaceId, workspaceId));

      return { ok: true, eventWindowDays: body.eventWindowDays };
    },
  );

  /** White label colours of this workspace (every member gets them, so the app is drawn in them) */
  app.get(
    "/v1/workspaces/:workspaceId/settings/branding",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      const [ws] = await getDb()
        .select({ brandingJson: workspaces.brandingJson })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      return { branding: parseBranding(ws?.brandingJson), canEdit: hasCapability(m.role, "manage_settings") };
    },
  );

  /** Set (or with null, reset to Insyder colours) the workspace's colours. Tenant admin only. */
  app.put(
    "/v1/workspaces/:workspaceId/settings/branding",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = z
        .object({
          branding: z
            .object({ primary: z.string().max(20), accent: z.string().max(20), sidebar: z.string().max(20) })
            .nullable(),
        })
        .parse(req.body);
      let branding = null;
      if (body.branding) {
        const r = validateBranding(body.branding);
        if ("errors" in r) throw validationError(r.errors.join(" "));
        branding = r.branding;
      }
      await getDb()
        .update(workspaces)
        .set({ brandingJson: branding ? JSON.stringify(branding) : null })
        .where(eq(workspaces.id, workspaceId));
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: m.userId,
        action: branding ? "settings.branding.updated" : "settings.branding.reset",
        metadata: branding ?? {},
      });
      return { branding, canEdit: true };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/settings/acceptance-gates",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      await loadMembership(req, workspaceId);
      const db = getDb();
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
      return { gates: parseGates(ws?.acceptanceGatesJson), fieldKeys: FIELD_KEYS };
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/settings/acceptance-gates",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_settings");
      const body = z
        .object({
          requiredKnownFields: z.array(z.enum(FIELD_KEYS)).max(FIELD_KEYS.length).optional(),
          skipReview: z.boolean().optional(),
        })
        .parse(req.body);
      const db = getDb();
      // Each field is optional: keep the saved value for anything not sent
      const [ws] = await db
        .select({ gates: workspaces.acceptanceGatesJson })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1);
      const current = parseGates(ws?.gates);
      const gates = {
        requiredKnownFields: body.requiredKnownFields ?? current.requiredKnownFields ?? [],
        skipReview: body.skipReview ?? current.skipReview ?? false,
      };
      await db
        .update(workspaces)
        .set({ acceptanceGatesJson: JSON.stringify(gates) })
        .where(eq(workspaces.id, workspaceId));
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "settings.acceptance_gates.updated",
        metadata: { requiredKnownFields: gates.requiredKnownFields, skipReview: gates.skipReview },
      });
      return { gates };
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/settings/connections",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      if (!hasCapability(m.role, "manage_settings") && !hasCapability(m.role, "research")) {
        throw forbidden("Missing capability: manage_settings");
      }
      const usage = await getUsage(m.tenantId);
      const entitlements = await ensureEntitlements(m.tenantId, workspaceId);
      const crm = await crmProviderStatus(m.tenantId, m.workspaceId);
      return {
        research: researchProviderStatus(),
        usage,
        entitlements: {
          researchEnabled: entitlements.researchEnabled,
          researchKillSwitch: entitlements.researchKillSwitch,
        },
        crm: {
          ...crm,
          enabled: entitlements.crmEnabled,
          note: crm.configured
            ? "Accepted accounts can be sent to the CRM from each account page, with a preview first"
            : "No CRM connected yet. A tenant admin can connect one below.",
        },
        sending: {
          enabled: false,
          note: "Phase 1 does not dispatch calls or messages",
        },
      };
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/entitlements",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "manage_entitlements");
      const body = z
        .object({
          researchEnabled: z.boolean().optional(),
          researchKillSwitch: z.boolean().optional(),
        })
        .parse(req.body);
      const updated = await updateEntitlements(m.tenantId, workspaceId, body);
      await writeAudit({
        tenantId: m.tenantId,
        workspaceId,
        actorUserId: req.actor!.userId,
        action: "entitlements.updated",
        metadata: body,
      });
      return {
        entitlements: {
          researchEnabled: updated.researchEnabled,
          researchKillSwitch: updated.researchKillSwitch,
        },
      };
    },
  );
}
