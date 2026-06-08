#!/usr/bin/env node
/**
 * One-time: encrypt plaintext salary columns when PII_ENCRYPTION_KEY is set.
 * Usage: node scripts/encrypt-existing-salaries.cjs
 */
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const pii = require('../src/lib/piiCrypto');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

if (!pii.isEnabled()) {
  console.error('Set PII_ENCRYPTION_KEY (32+ chars) before running this script.');
  process.exit(1);
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DATABASE_HOST || 'localhost',
        port: Number(process.env.DATABASE_PORT || 5432),
        user: process.env.DATABASE_USER || 'postgres',
        password: process.env.DATABASE_PASSWORD || 'postgres',
        database: process.env.DATABASE_DB || 'ayawin_enterprise',
      },
);

async function encryptTable(table, fields) {
  const rows = await pool.query(`SELECT id, ${fields.join(', ')}, ${fields.map((f) => `${f}_enc`).join(', ')} FROM ${table}`);
  let updated = 0;
  for (const row of rows.rows) {
    const body = {};
    for (const f of fields) {
      if (row[f] != null && Number(row[f]) > 0 && !row[`${f}_enc`]) {
        body[f] = row[f];
      }
    }
    if (!Object.keys(body).length) continue;
    const protectedFields = pii.protectSalaryFields(body);
    const sets = [];
    const params = [row.id];
    for (const f of fields) {
      if (protectedFields[`${f}_enc`]) {
        params.push(protectedFields[`${f}_enc`], protectedFields[f]);
        sets.push(`${f}_enc = $${params.length - 1}`, `${f} = $${params.length}`);
      }
    }
    if (!sets.length) continue;
    await pool.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    updated += 1;
  }
  return updated;
}

async function main() {
  const emp = await encryptTable('erp_employees', ['basic_salary']);
  const contracts = await encryptTable('erp_employee_contracts', [
    'basic_salary',
    'house_allowance',
    'transport_allowance',
  ]);
  console.log(`Encrypted salaries: ${emp} employees, ${contracts} contracts`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
