const fs = require("fs/promises");
const path = require("path");
const pool = require("./db");

const REQUIRED_TABLES = [
  "users",
  "roles",
  "customers",
  "suppliers",
  "products",
  "categories",
  "warehouses",
  "stock_movements",
  "sales_orders",
  "sales_order_items",
  "invoices",
  "invoice_items",
  "payments",
  "purchase_orders",
  "purchase_order_items",
  "grns",
  "deliveries",
  "employees",
  "payroll",
  "journal_entries",
  "accounts",
  "taxes",
  "audit_logs",
];

let bootstrapPromise = null;

async function getMissingTables() {
  const result = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES],
  );

  const existing = new Set(result.rows.map((row) => row.table_name));
  return REQUIRED_TABLES.filter((table) => !existing.has(table));
}

async function loadSchemaFile() {
  const schemaPath = path.resolve(__dirname, "..", "init.sql");
  return fs.readFile(schemaPath, "utf8");
}

async function bootstrapDatabase() {
  const missingTables = await getMissingTables();
  if (missingTables.length === 0) {
    return { initialized: false, missingTables: [] };
  }

  const schemaSql = await loadSchemaFile();
  await pool.query(schemaSql);
  await pool.query(`
    ALTER TABLE IF EXISTS roles ADD COLUMN IF NOT EXISTS description TEXT;

    ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS barcode TEXT;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS litres_per_unit NUMERIC(10,3) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS retail_price NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS distributor_price NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS min_stock INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS products ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

    ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS manager TEXT;
    ALTER TABLE IF EXISTS warehouses ADD COLUMN IF NOT EXISTS phone TEXT;

    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS location TEXT;
    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS segment TEXT;
    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
    ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0;

    ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS payment_terms TEXT;
    ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS suppliers ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0;

    CREATE UNIQUE INDEX IF NOT EXISTS roles_name_uidx ON roles (name);
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users (username);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email);
    CREATE UNIQUE INDEX IF NOT EXISTS products_sku_uidx ON products (sku);
    CREATE UNIQUE INDEX IF NOT EXISTS warehouses_name_uidx ON warehouses (name);
    CREATE UNIQUE INDEX IF NOT EXISTS customers_kra_pin_uidx ON customers (kra_pin);
    CREATE UNIQUE INDEX IF NOT EXISTS suppliers_kra_pin_uidx ON suppliers (kra_pin);
  `);

  return { initialized: true, missingTables };
}

async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapDatabase().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }

  return bootstrapPromise;
}

async function getSchemaStatus() {
  const missingTables = await getMissingTables();
  return {
    ready: missingTables.length === 0,
    missingTables,
    requiredTables: REQUIRED_TABLES,
  };
}

module.exports = {
  REQUIRED_TABLES,
  ensureBootstrap,
  getSchemaStatus,
};
