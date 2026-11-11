require("dotenv").config();

const pool = require("../src/db");
const { ensureErpAdminPassword } = require("../src/erpBootstrap");
const { runMigrations } = require("../src/migrate");

runMigrations()
  .then(async (result) => {
    const administrator = await ensureErpAdminPassword();
    console.log(JSON.stringify({ ...result, administrator }, null, 2));
  })
  .catch((error) => {
    console.error("Database migration job failed", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());