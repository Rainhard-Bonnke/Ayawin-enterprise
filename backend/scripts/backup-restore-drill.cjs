#!/usr/bin/env node
/**
 * Backup/restore drill: pg_dump → verify file → restore to drill database (optional).
 * Usage:
 *   npm run go-live:backup-drill
 *   npm run go-live:backup-drill -- --restore-test
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const root = path.resolve(__dirname, '..');
const restoreTest = process.argv.includes('--restore-test');
const drillDb = process.env.DRILL_DATABASE_DB || `${process.env.DATABASE_DB || 'martin_enterprise'}_drill`;

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(r.status || 1);
  }
}

run('Backup', 'npm', ['run', 'db:backup']);

const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');
const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sql')).sort();
const latest = files[files.length - 1];
if (!latest) {
  console.error('No backup file found');
  process.exit(1);
}
const backupPath = path.join(backupDir, latest);
const stat = fs.statSync(backupPath);
console.log(`\n✓ Latest backup: ${latest} (${(stat.size / 1024).toFixed(1)} KB)`);

const sample = fs.readFileSync(backupPath, 'utf8').slice(0, 50000);
const checks = ['erp_users', 'erp_companies', 'erp_chart_of_accounts'];
for (const t of checks) {
  if (!sample.includes(t)) {
    console.warn(`  ! Table name ${t} not found in backup sample — verify dump completeness`);
  } else {
    console.log(`  ✓ Contains ${t}`);
  }
}

if (!restoreTest) {
  console.log('\nDrill complete (backup only). Re-run with --restore-test to restore into drill DB.');
  process.exit(0);
}

const host = process.env.DATABASE_HOST || 'localhost';
const port = process.env.DATABASE_PORT || '5432';
const user = process.env.DATABASE_USER || 'postgres';
const password = process.env.DATABASE_PASSWORD || 'postgres';
const env = { ...process.env, PGPASSWORD: password };

console.log(`\n→ Creating drill database ${drillDb} (if not exists)`);
spawnSync(
  'psql',
  ['-h', host, '-p', port, '-U', user, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${drillDb}; CREATE DATABASE ${drillDb};`],
  { env, stdio: 'inherit', shell: true },
);

run('Restore to drill DB', 'psql', [
  '-h', host, '-p', port, '-U', user, '-d', drillDb,
  '-f', backupPath,
  '-v', 'ON_ERROR_STOP=1',
], { env });

const verify = spawnSync(
  'psql',
  ['-h', host, '-p', port, '-U', user, '-d', drillDb, '-t', '-c', 'SELECT COUNT(*) FROM erp_users;'],
  { env, encoding: 'utf8', shell: true },
);
if (verify.status === 0) {
  console.log(`\n✓ Drill restore verified — erp_users count:${verify.stdout.trim()}`);
} else {
  console.error('Restore verification query failed');
  process.exit(1);
}

console.log(`\nDrill database ${drillDb} left in place for inspection. Drop manually when done.`);
