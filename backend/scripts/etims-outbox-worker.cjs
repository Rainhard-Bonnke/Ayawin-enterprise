require("dotenv").config();

const path = require("path");
const { runMigrations } = require("../src/migrate");
const { runEtimsOutboxBatch } = require("../src/services/integrationService");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.ETIMS_POLL_INTERVAL_MS || 5000));
const batchSize = Math.max(1, Math.min(100, Number(process.env.ETIMS_BATCH_SIZE || 20)));
let stopping = false;

function loadAdapter() {
  const configuredPath = process.env.ETIMS_ADAPTER_MODULE;
  if (!configuredPath) {
    throw new Error("ETIMS_ADAPTER_MODULE must point to a certified provider adapter module");
  }
  const adapterPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  const loaded = require(adapterPath);
  const adapter = loaded.default || loaded;
  if (typeof adapter.submitInvoice !== "function") {
    throw new Error("The configured eTIMS adapter must export submitInvoice({ payload, idempotencyKey })");
  }
  return adapter;
}

async function run() {
  const adapter = loadAdapter();
  await runMigrations();
  console.log("eTIMS outbox worker started; provider acceptance is recorded only from adapter confirmation.");

  while (!stopping) {
    try {
      const summary = await runEtimsOutboxBatch({ adapter, limit: batchSize });
      if (summary.processed) console.log(JSON.stringify(summary));
    } catch (error) {
      console.error(`eTIMS outbox batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await pool.end();
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

run().catch(async (error) => {
  console.error(`eTIMS worker did not start: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});
