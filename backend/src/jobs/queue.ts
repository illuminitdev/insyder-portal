import PgBoss from "pg-boss";
import { getDirectDatabaseUrl } from "../config/env.js";

export const JOB_RESEARCH = "research-run";
export const JOB_IMPORT = "csv-import";
export const JOB_CRM_IMPORT = "crm-import";

let boss: PgBoss | null = null;

/**
 * Worker wake-up. Idle workers poll the database only every few hours (Neon bills awake time);
 * enqueueing a job wakes them at once, and they keep polling fast for ACTIVE_WINDOW_MS after.
 */
const workerIds = new Set<string>();
const ACTIVE_WINDOW_MS = 30 * 60_000;
let lastActivityAt = 0;

export function registerWorker(id: string) {
  workerIds.add(id);
}

export function markJobActivity() {
  lastActivityAt = Date.now();
}

export function isJobActivityRecent(now = Date.now()) {
  return now - lastActivityAt < ACTIVE_WINDOW_MS;
}

export function notifyWorkers() {
  if (!boss) return;
  for (const id of workerIds) boss.notifyWorker(id);
}

/** Call after every send: marks activity and makes in-process workers fetch right away. */
export function wakeWorkers() {
  markJobActivity();
  notifyWorkers();
}

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  // Direct connection for durable job worker sessions
  const b = new PgBoss({
    connectionString: getDirectDatabaseUrl(),
    application_name: "insyder-jobs",
    // No pg-boss cron schedules are used; its cron clock would query the database every few seconds
    schedule: false,
    // Housekeeping (archive / purge) every 6 h instead of every 2 min, so an idle database can sleep
    maintenanceIntervalSeconds: 6 * 3600,
  });
  b.on("error", (err) => console.error("[pg-boss]", err.message));
  await b.start();
  boss = b;
  return boss;
}

export async function enqueueResearchRun(researchRunId: string) {
  const b = await getBoss();
  await b.createQueue(JOB_RESEARCH);
  await b.send(JOB_RESEARCH, { researchRunId }, {
    retryLimit: 3,
    retryBackoff: true,
    expireInMinutes: 30,
  });
  wakeWorkers();
}

export async function enqueueCsvImport(
  importJobId: string,
  csvText: string,
  mapping?: Record<string, string>,
) {
  const b = await getBoss();
  await b.createQueue(JOB_IMPORT);
  await b.send(JOB_IMPORT, { importJobId, csvText, mapping }, {
    retryLimit: 2,
    expireInMinutes: 60,
  });
  wakeWorkers();
}


export async function enqueueCrmImport(importJobId: string) {
  const b = await getBoss();
  await b.createQueue(JOB_CRM_IMPORT);
  await b.send(JOB_CRM_IMPORT, { importJobId }, {
    retryLimit: 2,
    retryBackoff: true,
    expireInMinutes: 120,
    singletonKey: `crm-import:${importJobId}`,
  });
  wakeWorkers();
}
