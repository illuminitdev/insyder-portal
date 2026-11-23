import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { importJobs } from "../../db/schema/index.js";
import { authenticateRequired } from "../../middleware/authenticate.js";
import { loadMembership, requireCap } from "../../middleware/requireMembership.js";
import { enqueueCrmImport, enqueueCsvImport } from "../../jobs/queue.js";
import { IMPORT_FIELDS, resolveMapping } from "../../jobs/handlers/csvImport.js";
import { notFound, validationError } from "../../utils/errors.js";
import { CSV_MAX_BYTES, CSV_MAX_ROWS, parseCsv, toCsv } from "../../utils/csv.js";
import { newId } from "../../utils/ids.js";
import { CrmError } from "../../providers/crm/types.js";
import {
  CRM_IMPORT_MAX,
  CRM_IMPORT_STAGES,
  CRM_LABELS,
  importableCrm,
  parseImportOptions,
  previewCrmImport,
} from "../../services/crmImport.js";
import { AppError } from "../../utils/errors.js";
import { getUsage } from "../../services/budget.js";
import { hasCapability } from "../../auth/permissions.js";

const mappingSchema = z
  .object(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.string().optional()])))
  .partial()
  .optional();

/** CRM read failures reach the user as a readable 502, not "Internal server error". */
function crmFailure(err: unknown): never {
  if (err instanceof CrmError) throw new AppError(502, err.message, "crm_error");
  throw err;
}

export async function importRoutes(app: FastifyInstance) {
  /**
   * Can this workspace import from its CRM? Only true once a supported CRM is connected and healthy,
   * which is what shows the "Import from HubSpot" button. Readable by anyone who can import.
   */
  app.get("/v1/workspaces/:workspaceId/imports/crm", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "import");
    const crm = await importableCrm(m.tenantId, m.workspaceId);
    if (!crm) return { available: false as const };
    let companyCount: number | null = null;
    try {
      companyCount = await crm.provider.countCompaniesForImport!({ stages: CRM_IMPORT_STAGES.map((st) => st.key) });
    } catch {
      // Count is a nice-to-have; a missing scope is explained on the preview step
    }
    return {
      available: true as const,
      provider: crm.key,
      providerLabel: CRM_LABELS[crm.key] ?? crm.key,
      accountLabel: crm.accountLabel,
      companyCount,
      max: CRM_IMPORT_MAX,
      // For "Research these" on the done step: what it costs vs what's left this month
      usage: await getUsage(m.tenantId),
      canResearch: hasCapability(m.role, "research"),
      stages: CRM_IMPORT_STAGES,
    };
  });

  /** Read-only estimate of what an import with these options would do. */
  app.post("/v1/workspaces/:workspaceId/imports/crm/preview", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "import");
    const options = parseImportOptions(req.body);
    return previewCrmImport(m.tenantId, m.workspaceId, options).catch(crmFailure);
  });

  /** Start the import in the background; progress comes from GET /v1/imports/:id. */
  app.post("/v1/workspaces/:workspaceId/imports/crm", { preHandler: authenticateRequired }, async (req) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const m = await loadMembership(req, workspaceId);
    requireCap(m, "import");
    const options = parseImportOptions(req.body);
    const crm = await importableCrm(m.tenantId, m.workspaceId);
    if (!crm) throw validationError("Connect a CRM first (Settings → CRM)");
    const db = getDb();
    const running = await db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(eq(importJobs.workspaceId, m.workspaceId), eq(importJobs.source, crm.key), inArray(importJobs.status, ["queued", "running"])))
      .limit(1);
    if (running[0]) return { importJobId: running[0].id, status: "running", alreadyRunning: true };

    const id = newId("imp");
    await db.insert(importJobs).values({
      id,
      tenantId: m.tenantId,
      workspaceId: m.workspaceId,
      status: "queued",
      source: crm.key,
      filterJson: JSON.stringify(options),
      createdBy: req.actor!.userId,
    });
    await enqueueCrmImport(id);
    return { importJobId: id, status: "queued", alreadyRunning: false };
  });

  /** Synchronous preview: headers, suggested mapping, first rows and parse errors. */
  app.post(
    "/v1/workspaces/:workspaceId/imports/preview",
    { preHandler: authenticateRequired, bodyLimit: CSV_MAX_BYTES + 100_000 },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      const body = z.object({ csvText: z.string().min(1).max(CSV_MAX_BYTES) }).parse(req.body);
      const parsed = parseCsv(body.csvText);
      return {
        headers: parsed.headers,
        suggestedMapping: resolveMapping(parsed.headers),
        sampleRows: parsed.rows.slice(0, 5),
        rowCount: parsed.rows.length,
        maxRows: CSV_MAX_ROWS,
        errors: parsed.errors.slice(0, 50),
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/imports",
    { preHandler: authenticateRequired, bodyLimit: CSV_MAX_BYTES + 100_000 },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");

      const body = z
        .object({
          csvText: z.string().min(1).max(CSV_MAX_BYTES),
          mapping: mappingSchema,
        })
        .parse(req.body);

      if (Buffer.byteLength(body.csvText, "utf8") > CSV_MAX_BYTES) {
        throw validationError("CSV file too large (max 2 MB)");
      }
      const parsed = parseCsv(body.csvText);
      if (!parsed.headers.length) throw validationError(parsed.errors[0] ?? "No valid header row");
      if (parsed.rows.length > CSV_MAX_ROWS) {
        throw validationError(`CSV exceeds ${CSV_MAX_ROWS} row limit`);
      }

      const db = getDb();
      const id = newId("imp");
      await db.insert(importJobs).values({
        id,
        tenantId: m.tenantId,
        workspaceId,
        status: "queued",
        mappingJson: body.mapping ? JSON.stringify(body.mapping) : null,
        createdBy: req.actor!.userId,
      });

      await enqueueCsvImport(id, body.csvText, body.mapping as Record<string, string> | undefined);
      return { importJobId: id, status: "queued" };
    },
  );

  /** Recent imports, so the Accounts page can show the last import's report after a refresh. */
  app.get(
    "/v1/workspaces/:workspaceId/imports",
    { preHandler: authenticateRequired },
    async (req) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const m = await loadMembership(req, workspaceId);
      requireCap(m, "import");
      const db = getDb();
      const jobs = await db
        .select()
        .from(importJobs)
        .where(and(eq(importJobs.workspaceId, m.workspaceId), eq(importJobs.tenantId, m.tenantId)))
        .orderBy(desc(importJobs.createdAt))
        .limit(5);
      return {
        imports: jobs.map(({ rowErrorsJson, mappingJson: _mapping, summaryJson, ...j }) => ({
          ...j,
          summary: summaryJson ? JSON.parse(summaryJson) : null,
          rowErrors: rowErrorsJson ? (JSON.parse(rowErrorsJson) as string[]) : [],
        })),
      };
    },
  );

  app.get(
    "/v1/imports/:importJobId",
    { preHandler: authenticateRequired },
    async (req) => {
      const { importJobId } = req.params as { importJobId: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      requireCap(m, "import");
      const job = await loadJob(importJobId, m.workspaceId, m.tenantId);
      return {
        import: {
          ...job,
          summary: job.summaryJson ? JSON.parse(job.summaryJson) : null,
          rowErrors: job.rowErrorsJson ? JSON.parse(job.rowErrorsJson) : [],
        },
      };
    },
  );

  /** Formula-safe row error report download (gate 4). */
  app.get(
    "/v1/imports/:importJobId/errors.csv",
    { preHandler: authenticateRequired },
    async (req, reply) => {
      const { importJobId } = req.params as { importJobId: string };
      const q = z.object({ workspaceId: z.string() }).parse(req.query);
      const m = await loadMembership(req, q.workspaceId);
      requireCap(m, "import");
      const job = await loadJob(importJobId, m.workspaceId, m.tenantId);
      const errors: string[] = job.rowErrorsJson ? JSON.parse(job.rowErrorsJson) : [];
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="import-${job.id}-errors.csv"`);
      return toCsv(["message"], errors.map((e) => [e]));
    },
  );
}

async function loadJob(importJobId: string, workspaceId: string, tenantId: string) {
  const db = getDb();
  const [job] = await db
    .select()
    .from(importJobs)
    .where(
      and(
        eq(importJobs.id, importJobId),
        eq(importJobs.workspaceId, workspaceId),
        eq(importJobs.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!job) throw notFound("Import not found");
  return job;
}
