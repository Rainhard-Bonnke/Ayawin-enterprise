require("dotenv").config();

const { runMigrations } = require("../src/migrate");
const reports = require("../src/services/scheduledReportService");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.REPORT_SCHEDULE_POLL_INTERVAL_MS || 30000));
const batchSize = Math.max(1, Math.min(50, Number(process.env.REPORT_SCHEDULE_BATCH_SIZE || 10)));
let stopping = false;

async function run() {
  await runMigrations();
  console.log("Scheduled report worker started.");
  while (!stopping) {
    try {
      const summary = await reports.runScheduledReportsBatch({ limit: batchSize });
      if (summary.processed) console.log(JSON.stringify(summary));
    } catch (error) {
      console.error(`Scheduled report batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
run().catch((error) => {
  console.error(`Scheduled report worker did not start: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());