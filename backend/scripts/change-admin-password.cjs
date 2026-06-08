#!/usr/bin/env node
/**
 * Set the ERP admin password (erp_users table).
 * Usage:
 *   set NEW_ADMIN_PASSWORD=YourStrongPassword!   (PowerShell: $env:NEW_ADMIN_PASSWORD='...')
 *   npm run go-live:password
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const pool = require('../src/db');
const { BCRYPT_ROUNDS } = require('../src/constants');

const email = (process.env.ADMIN_EMAIL || 'admin@martin.co.ke').toLowerCase();
const password = process.env.NEW_ADMIN_PASSWORD || process.argv.find((a, i) => process.argv[i - 1] === '--password');

async function main() {
  if (!password || password.length < 12) {
    console.error('Set NEW_ADMIN_PASSWORD (min 12 characters) or pass --password "..."');
    process.exit(1);
  }
  if (password === 'demo') {
    console.error('Refusing to set password to "demo" in go-live script.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await pool.query(
    `UPDATE erp_users
     SET password_hash = $1, password_changed_at = NOW(), failed_login_attempts = 0,
         locked_until = NULL, status = 'active', updated_at = NOW()
     WHERE LOWER(email) = $2 AND is_deleted = FALSE
     RETURNING id, email, full_name`,
    [hash, email],
  );

  if (!result.rowCount) {
    console.error(`No user found for ${email}. Run npm run db:migrate first.`);
    process.exit(1);
  }

  console.log(`Password updated for ${result.rows[0].email} (${result.rows[0].full_name})`);
  console.log('All active sessions should log in again with the new password.');
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
