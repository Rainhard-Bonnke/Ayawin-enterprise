const fs = require('fs/promises');
const path = require('path');
const pool = require('./db');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS erp_schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT name FROM erp_schema_migrations ORDER BY name');
  return new Set(result.rows.map((row) => row.name));
}

async function listMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries.filter((name) => name.endsWith('.sql')).sort();
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
  await ensureYearlyPartitions(client, 'erp_audit_log', 'erp_audit_log');
}

async function runMigrations() {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);
    const done = await getAppliedMigrations(client);
    const files = await listMigrationFiles();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO erp_schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    }

    await ensureAuditPartitions(client);
    await client.query('COMMIT');
    return { applied, total: files.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getMigrationStatus() {
  await ensureMigrationsTable(pool);
  const files = await listMigrationFiles();
  const result = await pool.query('SELECT name, applied_at FROM erp_schema_migrations ORDER BY name');
  const applied = new Set(result.rows.map((row) => row.name));
  return {
    pending: files.filter((f) => !applied.has(f)),
    applied: result.rows,
    ready: files.every((f) => applied.has(f)),
  };
}

module.exports = { runMigrations, getMigrationStatus, ensureAuditPartitions };
