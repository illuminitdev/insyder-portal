import "./dns-fallback.js";
import { getEnv } from "./config/env.js";
import { startWorker } from "./jobs/startWorker.js";

async function main() {
  const env = getEnv();
  await startWorker({ pollingIntervalSeconds: env.WORKER_POLL_SECONDS });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
