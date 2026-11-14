require("dotenv").config();

const { runMigrations } = require("../src/migrate");
const { applyDueFutureEffectiveEvents } = require("../src/services/hrComplianceService");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.HR_COMPLIANCE_POLL_INTERVAL_MS || 30000));
const batchSize = Math.max(1, Math.min(200, Number(process.env.HR_COMPLIANCE_BATCH_SIZE || 50)));
let stopping = false;

async function run() {
  await runMigrations();
  console.log(JSON.stringify({ event: "worker_health", worker: "hr-compliance", status: "ready", pid: process.pid, poll_interval_ms: pollIntervalMs }));
  while (!stopping) {
    try {
      const summary = await applyDueFutureEffectiveEvents({ limit: batchSize });
      if (summary.processed) console.log(JSON.stringify(summary));
    } catch (error) {
      console.error(`HR compliance batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
run().catch((error) => {
  console.error(`HR compliance worker did not start: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
  console.log(JSON.stringify({ event: "worker_health", worker: "hr-compliance", status: "stopped", pid: process.pid }));
});