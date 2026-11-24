import {
  getBoss,
  isJobActivityRecent,
  JOB_CRM_IMPORT,
  JOB_IMPORT,
  JOB_RESEARCH,
  markJobActivity,
  notifyWorkers,
  registerWorker,
} from "./queue.js";
import { handleCrmImport } from "./handlers/crmImport.js";
import { handleCsvImport } from "./handlers/csvImport.js";
import { handleResearchRun } from "./handlers/researchRun.js";
import { JOB_CRM_SYNC, type CrmSyncJob } from "./crmQueue.js";
import { handleCrmSync } from "./handlers/crmSync.js";
import { enqueueDueMonitors, handleMonitorCheck, JOB_MONITOR_CHECK, type MonitorCheckJob } from "./monitorQueue.js";
import { failStaleResearchRuns } from "./staleRuns.js";
import { msUntilNextDailyRun, parseDailyTimeUtc } from "./dailySchedule.js";

const STALE_SWEEP_MS = 30 * 60_000;
const IDLE_POLL_SECONDS = 3 * 3600;

export type StartWorkerOptions = {
  /** Fast wake-up rate while there was job activity in the last 30 min (default 10 s) */
  activePollSeconds?: number;
  /** pg-boss poll rate when idle (default 3 h; the API wakes in-process workers when it queues a job) */
  idlePollSeconds?: number;
  /** "HH:MM" UTC time of the daily monitor run (default 03:30) */
  monitorDailyTimeUtc?: string;
};

/** Marks job activity before and after a handler, so workers stay on the fast rate while busy. */
function tracked<A extends unknown[]>(handler: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    markJobActivity();
    try {
      await handler(...args);
    } finally {
      markJobActivity();
    }
  };
}

/**
 * Starts every background job queue. Runs as its own process (`npm run worker`) or inside the
 * API process when RUN_WORKER_IN_API is set (hosts without a separate worker service).
 *
 * Neon bills the time the database is awake, so when idle the worker sends no queries: pg-boss
 * polls only every `idlePollSeconds`, and queueing a job wakes the workers right away.
 */
export async function startWorker(opts: StartWorkerOptions = {}) {
  const boss = await getBoss();
  const activePollSeconds = opts.activePollSeconds ?? 10;
  const poll = { pollingIntervalSeconds: opts.idlePollSeconds ?? IDLE_POLL_SECONDS };

  await boss.createQueue(JOB_RESEARCH);
  registerWorker(
    await boss.work<{ researchRunId: string }>(
      JOB_RESEARCH,
      { includeMetadata: true, ...poll },
      tracked(async ([job]) => {
        if (!job) return;
        await handleResearchRun(job.data, {
          retryCount: job.retryCount ?? 0,
          retryLimit: job.retryLimit ?? 0,
        });
      }),
    ),
  );

  await boss.createQueue(JOB_IMPORT);
  registerWorker(
    await boss.work<{ importJobId: string; csvText: string }>(
      JOB_IMPORT,
      { ...poll },
      tracked(async ([job]) => {
        if (job) await handleCsvImport(job.data);
      }),
    ),
  );

  await boss.createQueue(JOB_CRM_IMPORT);
  registerWorker(
    await boss.work<{ importJobId: string }>(
      JOB_CRM_IMPORT,
      { ...poll },
      tracked(async ([job]) => {
        if (job) await handleCrmImport(job.data);
      }),
    ),
  );

  await boss.createQueue(JOB_CRM_SYNC);
  registerWorker(
    await boss.work<CrmSyncJob>(
      JOB_CRM_SYNC,
      { ...poll },
      tracked(async ([job]) => {
        if (job) await handleCrmSync(job.data);
      }),
    ),
  );

  // Scheduled monitors: each due monitor becomes one queued job (locked per monitor, retried on outages)
  await boss.createQueue(JOB_MONITOR_CHECK);
  registerWorker(
    await boss.work<MonitorCheckJob>(
      JOB_MONITOR_CHECK,
      { includeMetadata: true, ...poll },
      tracked(async ([job]) => {
        if (job) await handleMonitorCheck(job.data, { retryCount: job.retryCount ?? 0 });
      }),
    ),
  );

  // Fast rate only while there was recent job activity; no database query at all when idle
  setInterval(() => {
    if (isJobActivityRecent()) notifyWorkers();
  }, activePollSeconds * 1000);

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
  setInterval(() => {
    if (isJobActivityRecent()) void sweep();
  }, STALE_SWEEP_MS);

  const runMonitors = async () => {
    try {
      const n = await enqueueDueMonitors();
      if (n) console.log(`[monitor-scheduler] queued ${n} monitor check(s)`);
    } catch (err) {
      console.error("[monitor-scheduler]", err);
    }
  };
  // Catch-up at startup (the host may have been asleep at the daily time), then once a day
  void runMonitors();
  const dailyMinutes = parseDailyTimeUtc(opts.monitorDailyTimeUtc);
  const scheduleDaily = () => {
    setTimeout(async () => {
      await sweep();
      await runMonitors();
      scheduleDaily();
    }, msUntilNextDailyRun(dailyMinutes));
  };
  scheduleDaily();

  const hhmm = `${String(Math.floor(dailyMinutes / 60)).padStart(2, "0")}:${String(dailyMinutes % 60).padStart(2, "0")}`;
  console.log(
    `Insyder worker listening for research-run, csv-import, crm-import, crm-sync, and monitor checks (monitors daily at ${hhmm} UTC)`,
  );
}
