require("dotenv").config();

const path = require("path");
const { runMigrations } = require("../src/migrate");
const { runEtimsCreditNoteBatch, runEtimsOutboxBatch } = require("../src/services/integrationService");
const { runEtimsItemRegistrationBatch } = require("../src/services/etimsItemService");
const { runEtimsEventBatch } = require("../src/services/etimsEventService");
const { getEtimsProvider } = require("../src/services/etimsProvider");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.ETIMS_POLL_INTERVAL_MS || 5000));
const batchSize = Math.max(1, Math.min(100, Number(process.env.ETIMS_BATCH_SIZE || 20)));
let stopping = false;

function loadAdapter() {
  const configuredPath = process.env.ETIMS_ADAPTER_MODULE;
  if (!configuredPath) {
    const invoke = async (method, { companyId, ...args }) => {
      const provider = await getEtimsProvider({ companyId });
      if (typeof provider[method] !== "function") throw new Error(`Company eTIMS provider does not implement ${method}`);
      return provider[method](args);
    };
    return {
      submitInvoice: (input) => invoke("submitInvoice", input),
      submitCreditNote: (input) => invoke("submitCreditNote", input),
      saveItem: (input) => invoke("saveItem", input),
      savePurchase: (input) => invoke("savePurchase", input),
      saveStockMaster: (input) => invoke("saveStockMaster", input),
      saveStockItems: (input) => invoke("saveStockItems", input),
      lookupInvoiceStatus: (input) => invoke("lookupInvoiceStatus", input),
    };
  }
  const adapterPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  const loaded = require(adapterPath);
  const adapter = loaded.default || loaded;
  if (typeof adapter.submitInvoice !== "function" || typeof adapter.submitCreditNote !== "function"
    || typeof adapter.saveItem !== "function" || typeof adapter.savePurchase !== "function"
    || typeof adapter.saveStockItems !== "function") {
    throw new Error("The configured eTIMS adapter must export invoice, credit-note, item, purchase, and stock methods");
  }
  return adapter;
}

async function run() {
  const adapter = loadAdapter();
  await runMigrations();
  console.log(JSON.stringify({ event: "worker_health", worker: "etims-outbox", status: "ready", pid: process.pid, poll_interval_ms: pollIntervalMs }));

  while (!stopping) {
    try {
      const summary = await runEtimsOutboxBatch({ adapter, limit: batchSize });
      if (summary.processed) console.log(JSON.stringify(summary));
      const itemSummary = await runEtimsItemRegistrationBatch({ adapter, limit: batchSize });
      if (itemSummary.processed) console.log(JSON.stringify({ item_registrations: itemSummary }));
      const creditSummary = await runEtimsCreditNoteBatch({ adapter, limit: batchSize });
      if (creditSummary.processed) console.log(JSON.stringify({ credit_notes: creditSummary }));
      const eventSummary = await runEtimsEventBatch({ adapter, limit: batchSize });
      if (eventSummary.processed) console.log(JSON.stringify({ purchase_stock_events: eventSummary }));
    } catch (error) {
      console.error(`eTIMS outbox batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await pool.end();
  console.log(JSON.stringify({ event: "worker_health", worker: "etims-outbox", status: "stopped", pid: process.pid }));
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

run().catch(async (error) => {
  console.error(`eTIMS worker did not start: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});
