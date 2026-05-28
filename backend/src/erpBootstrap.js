const bcrypt = require('bcryptjs');
const pool = require('./db');
const { runMigrations } = require('./migrate');

const IS_DEMO_MODE = (process.env.ENABLE_DEMO_MODE === 'true') && (process.env.NODE_ENV !== 'production');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@martin.co.ke').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_DEMO_MODE ? 'demo' : '');

async function ensureErpAdminPassword() {
  if (!ADMIN_PASSWORD) return { updated: false };

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const result = await pool.query(
    `UPDATE erp_users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
     WHERE LOWER(email) = $2 AND is_deleted = FALSE
     RETURNING id`,
    [hash, ADMIN_EMAIL],
  );
  return { updated: result.rowCount > 0 };
}

async function ensureErpFoundation() {
  const migration = await runMigrations();
  const password = await ensureErpAdminPassword();
  return { migration, password };
}

async function getErpStatus() {
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'erp_%'`,
  );
  return {
    erp_tables: tables.rows.map((r) => r.table_name).sort(),
    ready: tables.rows.some((r) => r.table_name === 'erp_users'),
  };
}

module.exports = { ensureErpFoundation, getErpStatus, ensureErpAdminPassword };
