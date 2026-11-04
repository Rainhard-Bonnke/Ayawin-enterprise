require("dotenv").config();
const pool = require("../src/db");
const { ensureErpFoundation } = require("../src/erpBootstrap");
const { ensureBootstrap } = require("../src/bootstrap");
const auth = require("../src/auth");

async function resetDatabase() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database");
  if (process.env.ALLOW_DB_RESET !== "true") throw new Error("Set ALLOW_DB_RESET=true to confirm this destructive development reset");
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await ensureBootstrap();
  await ensureErpFoundation();
  await auth.ensureDefaultAdmin();
}

if (require.main === module) {
  resetDatabase().catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { resetDatabase };
