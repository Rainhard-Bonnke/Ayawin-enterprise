require("dotenv").config();

const pool = require("../src/db");
const { runMigrations } = require("../src/migrate");
const { rotateIntegrationSecret } = require("../src/lib/integrationSecrets");

async function main() {
  const currentKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const nextKey = process.env.INTEGRATION_ENCRYPTION_KEY_NEXT;
  const nextVersion = process.env.INTEGRATION_ENCRYPTION_KEY_NEXT_VERSION;
  if (!currentKey || currentKey.length < 32 || !nextKey || nextKey.length < 32 || !nextVersion) {
    throw new Error("Set INTEGRATION_ENCRYPTION_KEY, INTEGRATION_ENCRYPTION_KEY_NEXT, and INTEGRATION_ENCRYPTION_KEY_NEXT_VERSION before rotation");
  }
  if (currentKey === nextKey || nextVersion === (process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || "1")) {
    throw new Error("Use a new integration key and a new key version");
  }

  await runMigrations();
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      `SELECT id, secret_payload_encrypted FROM erp_integration_settings
       WHERE secret_payload_encrypted IS NOT NULL FOR UPDATE`,
    );
    for (const row of rows.rows) {
      const encrypted = rotateIntegrationSecret(row.secret_payload_encrypted, {
        sourceKey: currentKey,
        targetKey: nextKey,
        targetKeyVersion: nextVersion,
      });
      await client.query(
        `UPDATE erp_integration_settings SET secret_payload_encrypted = $2, updated_at = NOW()
         WHERE id = $1`,
        [row.id, encrypted],
      );
      count += 1;
    }
    await client.query("COMMIT");
    console.log(`Rotated ${count} integration secret payload(s) to key version ${nextVersion}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(`Integration key rotation failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());