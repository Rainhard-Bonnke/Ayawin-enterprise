const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

process.env.JWT_SECRET ??= "phase8-test-secret-32-characters-long";
process.env.MFA_ENCRYPTION_KEY ??= "phase8-test-mfa-key-32-characters-long";
process.env.INTEGRATION_ENCRYPTION_KEY ??= "phase8-test-integration-key-32-chars";

const { app } = require("../src/index");
const pool = require("../src/db");

test("legacy API endpoints are retired", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/products`);
  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /Legacy API is retired/);
});

test("migrations remove the retired legacy business tables", async (t) => {
  const legacyTables = [
    "roles", "users", "categories", "products", "warehouses", "customers", "suppliers",
    "stock_movements", "sales_orders", "sales_order_items", "invoices", "invoice_items",
    "payments", "purchase_orders", "purchase_order_items", "grns", "deliveries",
    "employees", "payroll", "accounts", "journal_entries", "taxes", "audit_logs",
  ];

  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name",
      [legacyTables],
    );
    assert.deepEqual(result.rows.map((row) => row.table_name), []);
  } catch (error) {
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error?.code)) {
      return t.skip("Database not available for legacy schema verification");
    }
    throw error;
  }
});

test("legacy cleanup refuses a partial schema without a product source", async () => {
  const migration = await require("node:fs/promises").readFile(
    require("node:path").resolve(__dirname, "..", "migrations", "091_remove_empty_legacy_schema.sql"),
    "utf8",
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TABLE roles (id INTEGER PRIMARY KEY)");
    await client.query("INSERT INTO roles (id) VALUES (1)");
    await client.query("SAVEPOINT before_legacy_cleanup");
    await assert.rejects(client.query(migration), /Legacy table public\.roles exists but the products source is missing/);
    await client.query("ROLLBACK TO SAVEPOINT before_legacy_cleanup");
    const retained = await client.query("SELECT COUNT(*)::int AS count FROM roles");
    assert.equal(retained.rows[0].count, 1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("migration dry-run reports pending files without mutating schema state", async (t) => {
  const { runMigrations, getMigrationStatus } = require("../src/migrate");

  try {
    const statusBefore = await getMigrationStatus();
    const dryRun = await runMigrations({ dryRun: true });
    const statusAfter = await getMigrationStatus();
    assert.equal(dryRun.dryRun, true);
    assert.equal(statusBefore.ready, statusAfter.ready);
    assert.equal(Array.isArray(dryRun.pending), true);
    assert.equal(Array.isArray(statusAfter.pending), true);
  } catch (error) {
    if (error?.code === "ECONNREFUSED" || /database|connect/i.test(error?.message || "")) {
      return t.skip("Database not available for migration state verification");
    }
    throw error;
  }
});

test("migration runner accepts and repairs the approved 063 checksum correction", async () => {
  const { runMigrations, checksumForSql } = require("../src/migrate");
  const migrationName = "063_numbered_document_void_guards.sql";
  const previousChecksum = "d89b5cba9be436e7dc104a0f8b5aa7f8f5b889e5f64850e9e686886d6c3f398d";
  const migrationPath = path.resolve(__dirname, "..", "migrations", migrationName);
  const sql = await fs.readFile(migrationPath, "utf8");
  const expectedChecksum = checksumForSql(sql);

  await pool.query("UPDATE erp_schema_migrations SET checksum = $2 WHERE name = $1", [migrationName, previousChecksum]);
  await runMigrations();
  const result = await pool.query("SELECT checksum FROM erp_schema_migrations WHERE name = $1", [migrationName]);
  assert.equal(result.rows[0]?.checksum, expectedChecksum);
});
