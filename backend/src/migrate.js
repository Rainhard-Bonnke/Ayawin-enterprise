const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const pool = require("./db");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");
const MIGRATION_LOCK_KEY = "erp_schema_migration_lock";
const PREVIOUS_MIGRATION_CHECKSUMS = Object.freeze({
  "063_numbered_document_void_guards.sql": "d89b5cba9be436e7dc104a0f8b5aa7f8f5b889e5f64850e9e686886d6c3f398d",
});

function checksumForSql(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS erp_schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT,
      status TEXT NOT NULL DEFAULT 'applied',
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    ALTER TABLE IF EXISTS erp_schema_migrations
      ADD COLUMN IF NOT EXISTS checksum TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT;
  `);

  await client.query(`
    UPDATE erp_schema_migrations
    SET status = COALESCE(status, 'applied')
    WHERE status IS NULL;
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    "SELECT name, checksum FROM erp_schema_migrations WHERE status <> 'failed' ORDER BY name",
  );
  return new Map(result.rows.map((row) => [row.name, row.checksum || null]));
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

async function ensureYearlyPartitions(client, parentTable, prefix) {
  const year = new Date().getFullYear();
  for (let y = year - 1; y <= year + 2; y += 1) {
    const partition = `${prefix}_${y}`;
    const from = `${y}-01-01`;
    const to = `${y + 1}-01-01`;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${partition}
      PARTITION OF ${parentTable}
      FOR VALUES FROM ('${from}') TO ('${to}');
    `);
  }
}

async function ensureAuditPartitions(client) {
  const auditExists = await client.query("SELECT to_regclass('public.erp_audit_log') AS name");
  if (auditExists.rows[0]?.name) {
    await ensureYearlyPartitions(client, "erp_audit_log", "erp_audit_log");
  }
}

async function runMigrations(options = {}) {
  const { dryRun = false, client: suppliedClient = null } = options;
  const client = suppliedClient || (await pool.connect());
  const applied = [];
  const pending = [];
  const lockName = MIGRATION_LOCK_KEY;

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    const files = await listMigrationFiles();
    let done = new Map();
    const ledgerExists = await client.query("SELECT to_regclass('public.erp_schema_migrations') AS name");
    if (ledgerExists.rows[0]?.name) {
      done = await getAppliedMigrations(client);
    } else if (!dryRun) {
      await ensureMigrationsTable(client);
    }

    for (const file of files) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(filePath, "utf8");
      const expectedChecksum = checksumForSql(sql);
      const recordedChecksum = done.get(file);

      if (recordedChecksum && recordedChecksum !== expectedChecksum) {
        if (recordedChecksum !== PREVIOUS_MIGRATION_CHECKSUMS[file]) {
          throw new Error(`Migration checksum mismatch for ${file}: recorded ${recordedChecksum}, expected ${expectedChecksum}`);
        }
        if (!dryRun) {
          await client.query(
            "UPDATE erp_schema_migrations SET checksum = $2 WHERE name = $1 AND checksum = $3",
            [file, expectedChecksum, recordedChecksum],
          );
        }
        done.set(file, expectedChecksum);
      }

      if (done.has(file)) {
        continue;
      }

      pending.push({ file, checksum: expectedChecksum });
      if (dryRun) {
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO erp_schema_migrations (name, checksum, status, applied_at) VALUES ($1, $2, 'applied', NOW()) ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, status = 'applied', applied_at = NOW()",
          [file, expectedChecksum],
        );
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        await client.query(
          "INSERT INTO erp_schema_migrations (name, checksum, status, applied_at) VALUES ($1, $2, 'failed', NOW()) ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, status = 'failed', applied_at = NOW()",
          [file, expectedChecksum],
        );
        throw err;
      }
    }

    if (!dryRun) {
      await ensureAuditPartitions(client);
    }

    return { applied, pending, total: files.length, dryRun };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => {});
    if (!suppliedClient) {
      client.release();
    }
  }
}

async function getMigrationStatus() {
  const files = await listMigrationFiles();
  const ledgerExists = await pool.query("SELECT to_regclass('public.erp_schema_migrations') AS name");
  const result = ledgerExists.rows[0]?.name
    ? await pool.query("SELECT name, checksum, status, applied_at FROM erp_schema_migrations ORDER BY name")
    : { rows: [] };
  const applied = new Map(result.rows.map((row) => [row.name, row]));
  const pending = [];

  for (const file of files) {
    const row = applied.get(file);
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const currentChecksum = checksumForSql(sql);
    if (!row) {
      pending.push({ file, checksum: currentChecksum, status: "pending" });
      continue;
    }
    if (row.checksum && row.checksum !== currentChecksum && row.checksum !== PREVIOUS_MIGRATION_CHECKSUMS[file]) {
      pending.push({ file, checksum: currentChecksum, status: "checksum_mismatch", recorded: row.checksum });
    }
  }

  return {
    pending,
    applied: result.rows,
    ready: files.every((file) => {
      const row = applied.get(file);
      return Boolean(row) && row.status !== "failed";
    }) && pending.length === 0,
  };
}

module.exports = { runMigrations, getMigrationStatus, ensureAuditPartitions, checksumForSql };
