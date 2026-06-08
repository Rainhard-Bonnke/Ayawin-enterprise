#!/usr/bin/env node
/** Try common Render Postgres external host suffixes for a short internal hostname. */
const { Pool } = require('pg');

const base = process.argv[2] || 'dpg-d88ns7beo5us7384v67g-a';
const user = process.argv[3] || 'ayawin_enterprise_db_user';
const pass = process.argv[4];
const db = process.argv[5] || 'ayawin_enterprise_db';

if (!pass) {
  console.error('Usage: node probe-render-pg.cjs HOST USER PASS DB');
  process.exit(1);
}

const regions = [
  'oregon-postgres.render.com',
  'frankfurt-postgres.render.com',
  'singapore-postgres.render.com',
  'ohio-postgres.render.com',
  'virginia-postgres.render.com',
];

async function tryHost(host) {
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/${db}`;
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 6000,
  });
  try {
    const r = await pool.query('SELECT 1 AS ok');
    await pool.end();
    return { ok: true, host, row: r.rows[0] };
  } catch (e) {
    await pool.end().catch(() => {});
    return { ok: false, host, error: e.message };
  }
}

(async () => {
  console.log(`Probing ${base} across Render regions…\n`);
  for (const region of regions) {
    const host = `${base}.${region}`;
    const result = await tryHost(host);
    if (result.ok) {
      console.log('SUCCESS:', host);
      console.log(`DATABASE_URL=postgresql://${user}:***@${host}:5432/${db}`);
      process.exit(0);
    }
    console.log('fail', host, '-', result.error);
  }
  console.error('\nNo region matched. Copy External Database URL from Render dashboard.');
  process.exit(1);
})();
