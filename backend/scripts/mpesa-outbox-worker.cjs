require("dotenv").config();

const path = require("path");
const { runMigrations } = require("../src/migrate");
const mpesa = require("../src/services/mpesaService");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.MPESA_POLL_INTERVAL_MS || 5000));
const batchSize = Math.max(1, Math.min(100, Number(process.env.MPESA_BATCH_SIZE || 20)));
let stopping = false;

function loadAdapter() {
  const configuredPath = process.env.MPESA_ADAPTER_MODULE;
  if (!configuredPath) {
    throw new Error("MPESA_ADAPTER_MODULE must point to a configured Safaricom Daraja adapter module");
  }
  if (!process.env.MPESA_CALLBACK_TOKEN) {
    throw new Error("MPESA_CALLBACK_TOKEN must be configured for callback authentication");
  }
  const adapterPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  const loaded = require(adapterPath);
  const adapter = loaded.default || loaded;
  if (typeof adapter.initiateStkPush !== "function" || typeof adapter.verifyPayment !== "function") {
    throw new Error("M-Pesa adapter must export initiateStkPush and verifyPayment methods");
  }
  return adapter;
}

async function run() {
  const adapter = loadAdapter();
  await runMigrations();
  console.log("M-Pesa worker started; callbacks are treated as notifications until provider verification succeeds.");

  while (!stopping) {
    try {
      const initiated = await mpesa.runMpesaInitiationBatch({ adapter, limit: batchSize });
      const verified = await mpesa.runMpesaCallbackBatch({ adapter, limit: batchSize });
      if (initiated.processed || verified.processed) {
        console.log(JSON.stringify({ initiated, verified }));
      }
    } catch (error) {
      console.error(`M-Pesa worker batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await pool.end();
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

run().catch(async (error) => {
  console.error(`M-Pesa worker did not start: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});
