const bcrypt = require("bcryptjs");
const pool = require("./db");
const { runMigrations } = require("./migrate");

const IS_DEMO_MODE =
  process.env.ENABLE_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "bonnkereinhard654@gmail.com").toLowerCase();
// Do not silently reset the ERP administrator password on every server boot.
// Provisioning or resetting credentials requires an explicit environment value.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

async function ensureErpAdminPassword() {
  if (!ADMIN_PASSWORD) return { updated: false, created: false };

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const companyResult = await pool.query(
    `SELECT c.id AS company_id, b.id AS branch_id, r.id AS role_id
     FROM erp_companies c
     LEFT JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ'
     LEFT JOIN erp_roles r ON r.company_id = c.id AND r.name = 'System Administrator'
     WHERE c.is_deleted = FALSE
     ORDER BY c.created_at ASC
     LIMIT 1`,
  );

  const company = companyResult.rows[0];
  if (!company) {
    return { updated: false, created: false, reason: "No ERP company configured" };
  }

  const canonicalEmail = ADMIN_EMAIL;
  const candidateEmails = Array.from(
    new Set([ADMIN_EMAIL, canonicalEmail].map((email) => email.toLowerCase())),
  );

  const existing = await pool.query(
    `SELECT id, email, username
     FROM erp_users
     WHERE is_deleted = FALSE
       AND (
         LOWER(email) = ANY($1::text[])
         OR LOWER(username) = ANY($2::text[])
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [candidateEmails, [ADMIN_EMAIL.split("@")[0], "admin"]],
  );

  if (existing.rowCount > 0) {
    // Preserve existing credentials on routine startup. Setting
    // RESET_ADMIN_PASSWORD=true is the explicit credential rotation switch.
    if (process.env.RESET_ADMIN_PASSWORD !== "true") {
      return { updated: false, created: false, email: existing.rows[0].email };
    }
    const result = await pool.query(
      `UPDATE erp_users
       SET company_id = COALESCE($1, company_id),
           default_branch_id = COALESCE($2, default_branch_id),
           role_id = COALESCE($3, role_id),
           username = $4,
           email = $5,
           full_name = $6,
           password_hash = $7,
           status = 'active',
           must_change_password = FALSE,
           password_changed_at = NOW(),
           updated_at = NOW()
       WHERE id = $8 AND is_deleted = FALSE
       RETURNING id`,
      [
        company.company_id,
        company.branch_id,
        company.role_id,
        "admin",
        canonicalEmail,
        "System Administrator",
        hash,
        existing.rows[0].id,
      ],
    );
    return { updated: result.rowCount > 0, created: false, email: canonicalEmail };
  }

  const insertResult = await pool.query(
    `INSERT INTO erp_users (
       company_id, default_branch_id, role_id, username, email, full_name, phone, status,
       locale, password_hash, password_changed_at, created_at, updated_at, must_change_password
     )
     VALUES ($1, $2, $3, $4, $5, $6, '+254700000001', 'active', 'en', $7, NOW(), NOW(), NOW(), FALSE)
     ON CONFLICT (company_id, email) DO UPDATE SET
       username = EXCLUDED.username,
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       status = 'active',
       updated_at = NOW()
     RETURNING id`,
    [
      company.company_id,
      company.branch_id,
      company.role_id,
      "admin",
      canonicalEmail,
      "System Administrator",
      hash,
    ],
  );

  return { updated: insertResult.rowCount > 0, created: true, email: canonicalEmail };
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
    ready: tables.rows.some((r) => r.table_name === "erp_users"),
  };
}

module.exports = { ensureErpFoundation, getErpStatus, ensureErpAdminPassword };
