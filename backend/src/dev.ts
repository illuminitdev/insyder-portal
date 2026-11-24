// Local dev: run the API and the job worker in one process, so queueing a job wakes the worker at once.
process.env.RUN_WORKER_IN_API = "true";
await import("./index.js");
