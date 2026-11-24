import "./dns-fallback.js";
import { getEnv } from "./config/env.js";
import { startWorker } from "./jobs/startWorker.js";

async function main() {
  const env = getEnv();
  // A standalone worker can't be woken by the API process, so it keeps polling at one rate
  const poll = env.WORKER_POLL_SECONDS ?? 10;
  await startWorker({
    activePollSeconds: poll,
    idlePollSeconds: poll,
    monitorDailyTimeUtc: env.MONITOR_DAILY_TIME_UTC,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
