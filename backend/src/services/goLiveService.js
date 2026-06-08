const pool = require('../db');
const piiCrypto = require('../lib/piiCrypto');
const fs = require('fs');
const path = require('path');

function checkSecrets() {
  const items = [];
  items.push({
    id: 'demo_mode',
    label: 'Demo mode disabled',
    pass: process.env.ENABLE_DEMO_MODE === 'false',
    hint: 'Set ENABLE_DEMO_MODE=false',
  });
  items.push({
    id: 'jwt',
    label: 'JWT_SECRET (32+ chars)',
    pass: (process.env.JWT_SECRET || '').length >= 32,
    hint: 'Run npm run go-live:init',
  });
  items.push({
    id: 'pii',
    label: 'PII_ENCRYPTION_KEY set',
    pass: (process.env.PII_ENCRYPTION_KEY || '').length >= 32,
    hint: 'Run npm run go-live:init',
  });
  items.push({
    id: 'cors',
    label: 'CORS_ORIGINS (production URLs)',
    pass: Boolean(process.env.CORS_ORIGINS) && !String(process.env.CORS_ORIGINS).includes('localhost'),
    hint: 'Set to your frontend URL',
  });
  items.push({
    id: 'node_env',
    label: 'NODE_ENV=production',
    pass: process.env.NODE_ENV === 'production',
    hint: 'Set NODE_ENV=production on the server',
  });
  return items;
}

async function checkAdminPassword(email) {
  const r = await pool.query(
    `SELECT password_changed_at, password_hash FROM erp_users
     WHERE LOWER(email) = $1 AND is_deleted = FALSE`,
    [email.toLowerCase()],
  );
  if (!r.rowCount) return { pass: false, hint: 'Admin user not found' };
  const changed = Boolean(r.rows[0].password_changed_at);
  return {
    pass: changed,
    hint: changed ? 'Password was changed after bootstrap' : 'Run npm run go-live:password with NEW_ADMIN_PASSWORD',
  };
}

async function checkLiveImport() {
  const dir = path.resolve(__dirname, '..', '..', '..', 'data', 'live-import');
  const files = ['customers.csv', 'items.csv', 'vendors.csv'];
  const present = files.filter((f) => fs.existsSync(path.join(dir, f)));
  const jobs = await pool.query(
    `SELECT entity_type, success_rows, total_rows, created_at
     FROM erp_import_jobs ORDER BY created_at DESC LIMIT 5`,
  );
  return {
    pass: present.length >= 2 || jobs.rows.some((j) => j.success_rows > 0),
    hint: 'Place CSVs in data/live-import/ and run npm run go-live:import',
    templates_present: present,
    recent_imports: jobs.rows,
  };
}

async function getGoLiveStatus(adminEmail) {
  const secrets = checkSecrets();
  const password = await checkAdminPassword(adminEmail || process.env.ADMIN_EMAIL || 'admin@martin.co.ke');
  const liveImport = await checkLiveImport();

  const backupDir = process.env.BACKUP_DIR || path.resolve(__dirname, '..', '..', 'backups');
  let lastBackup = null;
  if (fs.existsSync(backupDir)) {
    const sql = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sql')).sort();
    if (sql.length) lastBackup = sql[sql.length - 1];
  }

  const checklist = [
    ...secrets,
    { id: 'admin_password', label: 'Admin password changed', pass: password.pass, hint: password.hint },
    { id: 'live_data', label: 'Live master data imported', pass: liveImport.pass, hint: liveImport.hint },
    {
      id: 'backup',
      label: 'Database backup exists',
      pass: Boolean(lastBackup),
      hint: lastBackup ? `Latest: ${lastBackup}` : 'Run npm run go-live:backup-drill',
    },
    {
      id: 'pii_active',
      label: 'PII encryption active',
      pass: piiCrypto.isEnabled(),
      hint: piiCrypto.isEnabled() ? 'Encryption enabled' : 'Set PII_ENCRYPTION_KEY',
    },
  ];

  const passCount = checklist.filter((c) => c.pass).length;
  return {
    ready: passCount === checklist.length,
    pass_count: passCount,
    total: checklist.length,
    checklist,
    live_import: liveImport,
    pdf_signoff_url: '/docs/PDF-SIGNOFF-CHECKLIST.md',
  };
}

module.exports = { getGoLiveStatus, checkSecrets };
