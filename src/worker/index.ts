import { JobService } from "@/server/services/job-service";
import { logger } from "@/server/utils/logger";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

let stopped = false;

async function main() {
  const service = new JobService();
  logger.info({ pollIntervalMs: POLL_INTERVAL_MS }, "CI Repair worker started");

  while (!stopped) {
    const record = await service.processNextJob();
    if (!record) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info("CI Repair worker stopped");
}

void main().catch((error) => {
  logger.error({ error }, "Worker crashed");
  process.exitCode = 1;
});

process.on("SIGINT", () => {
  stopped = true;
});

process.on("SIGTERM", () => {
  stopped = true;
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
