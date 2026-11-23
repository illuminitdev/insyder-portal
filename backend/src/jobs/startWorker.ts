import { getBoss, JOB_CRM_IMPORT, JOB_IMPORT, JOB_RESEARCH } from "./queue.js";
import { handleCrmImport } from "./handlers/crmImport.js";
import { handleCsvImport } from "./handlers/csvImport.js";
import { handleResearchRun } from "./handlers/researchRun.js";
import { JOB_CRM_SYNC, type CrmSyncJob } from "./crmQueue.js";
import { handleCrmSync } from "./handlers/crmSync.js";
import { enqueueDueMonitors, handleMonitorCheck, JOB_MONITOR_CHECK, type MonitorCheckJob } from "./monitorQueue.js";
import { failStaleResearchRuns } from "./staleRuns.js";

const STALE_SWEEP_MS = 5 * 60_000;

/**
 * Starts every background job queue. Runs as its own process (`npm run worker`) or inside the
 * API process when RUN_WORKER_IN_API is set (hosts without a separate worker service).
 */
export async function startWorker(opts: { pollingIntervalSeconds?: number } = {}) {
  const boss = await getBoss();
  const poll = opts.pollingIntervalSeconds ? { pollingIntervalSeconds: opts.pollingIntervalSeconds } : {};

  await boss.createQueue(JOB_RESEARCH);
  await boss.work<{ researchRunId: string }>(JOB_RESEARCH, { includeMetadata: true, ...poll }, async ([job]) => {
    if (!job) return;
    await handleResearchRun(job.data, {
      retryCount: job.retryCount ?? 0,
      retryLimit: job.retryLimit ?? 0,
    });
  });

  await boss.createQueue(JOB_IMPORT);
  await boss.work(JOB_IMPORT, { ...poll }, async ([job]) => {
    await handleCsvImport(job.data as { importJobId: string; csvText: string });
  });

  await boss.createQueue(JOB_CRM_IMPORT);
  await boss.work<{ importJobId: string }>(JOB_CRM_IMPORT, { ...poll }, async ([job]) => {
    if (job) await handleCrmImport(job.data);
  });

  await boss.createQueue(JOB_CRM_SYNC);
  await boss.work<CrmSyncJob>(JOB_CRM_SYNC, { ...poll }, async ([job]) => {
    if (job) await handleCrmSync(job.data);
  });

  // Scheduled monitors: each due monitor becomes one queued job (locked per monitor, retried on outages)
  await boss.createQueue(JOB_MONITOR_CHECK);
  await boss.work<MonitorCheckJob>(JOB_MONITOR_CHECK, { includeMetadata: true, ...poll }, async ([job]) => {
    if (job) await handleMonitorCheck(job.data, { retryCount: job.retryCount ?? 0 });
  });
  setInterval(async () => {
    try {
      await enqueueDueMonitors();
    } catch (err) {
      console.error("[monitor-scheduler]", err);
    }
  }, 60_000);

  // Research runs a worker never finished are failed so their accounts don't stay "Research running"
  const sweep = async () => {
    try {
      const r = await failStaleResearchRuns();
      if (r.runsFailed || r.accountsFreed) {
        console.log(`[stale-research] failed ${r.runsFailed} stuck run(s), freed ${r.accountsFreed} account(s)`);
      }
    } catch (err) {
      console.error("[stale-research]", err);
    }
  };
  void sweep();
  setInterval(sweep, STALE_SWEEP_MS);

  console.log("Signal worker listening for research-run, csv-import, crm-import, crm-sync, and active scheduled monitors");
}
