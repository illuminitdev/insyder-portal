import "./dns-fallback.js";
import { getEnv } from "./config/env.js";
import { buildApp } from "./app.js";
import { startWorker } from "./jobs/startWorker.js";

async function main() {
  const env = getEnv();
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: "::" });
  console.log(`Insyder API listening on :${env.PORT}`);
  console.log(`Exa configured: ${Boolean(env.EXA_API_KEY?.trim())}`);

  // Hosts without a separate worker service (e.g. Render free tier) run the job queues here.
  // A worker failure is logged but never takes the API down.
  if (env.RUN_WORKER_IN_API) {
    startWorker({
      activePollSeconds: env.WORKER_POLL_SECONDS ?? 10,
      monitorDailyTimeUtc: env.MONITOR_DAILY_TIME_UTC,
    }).catch((err) =>
      console.error("[worker-in-api] failed to start:", err),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
