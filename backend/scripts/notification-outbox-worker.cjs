require("dotenv").config();

const path = require("path");
const { runMigrations } = require("../src/migrate");
const notifications = require("../src/services/notificationOutboxService");
const pool = require("../src/db");

const pollIntervalMs = Math.max(1000, Number(process.env.NOTIFICATION_POLL_INTERVAL_MS || 5000));
const batchSize = Math.max(1, Math.min(100, Number(process.env.NOTIFICATION_BATCH_SIZE || 20)));
let stopping = false;

function loadAdapter() {
  const configuredPath = process.env.NOTIFICATION_ADAPTER_MODULE;
  if (!configuredPath) {
    throw new Error("NOTIFICATION_ADAPTER_MODULE must point to an email/SMS provider adapter module");
  }
  const adapterPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
  const loaded = require(adapterPath);
  const adapter = loaded.default || loaded;
  if (typeof adapter.sendEmail !== "function" && typeof adapter.sendSms !== "function") {
    throw new Error("Notification adapter must export sendEmail and/or sendSms");
  }
  return adapter;
}

async function run() {
  const adapter = loadAdapter();
  await runMigrations();
  console.log("Notification outbox worker started; a message is marked sent only after provider confirmation.");

  while (!stopping) {
    try {
      const summary = await notifications.runNotificationOutboxBatch({ adapter, limit: batchSize });
      if (summary.processed) console.log(JSON.stringify(summary));
    } catch (error) {
      console.error(`Notification outbox batch failed: ${error.message}`);
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  await pool.end();
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

run().catch(async (error) => {
  console.error(`Notification worker did not start: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});
