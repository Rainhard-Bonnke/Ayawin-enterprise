#!/usr/bin/env node
/**
 * Deployment & infrastructure checklist — repo-verifiable items + optional live probes.
 *
 * Usage:
 *   node scripts/deployment-infra-audit.cjs
 *   node scripts/deployment-infra-audit.cjs --live-health
 *   node scripts/deployment-infra-audit.cjs --live-backup   # requires pg_dump + DB
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const backend = path.join(root, 'backend');
const liveHealth = process.argv.includes('--live-health');
const liveBackup = process.argv.includes('--live-backup');

let repoFail = 0;
let repoPass = 0;
let opsWarn = 0;
let opsPass = 0;

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function pass(section, item, detail = '') {
  console.log(`PASS  [${section}] ${item}${detail ? ` — ${detail}` : ''}`);
  repoPass += 1;
}

function fail(section, item, detail = '') {
  console.log(`FAIL  [${section}] ${item}${detail ? ` — ${detail}` : ''}`);
  repoFail += 1;
}

function ops(section, item, ok, detail = '') {
  const tag = ok ? 'OPS✓' : 'OPS ';
  console.log(`${tag}  [${section}] ${item}${detail ? ` — ${detail}` : ''}`);
  if (ok) opsPass += 1;
  else opsWarn += 1;
}

function grepDir(dir, pattern) {
  const hits = [];
  function walk(d) {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) {
        if (name.name === 'node_modules' || name.name === 'dist' || name.name === 'backups') continue;
        walk(p);
      } else if (/\.(js|cjs|ts|tsx)$/.test(name.name)) {
        const t = read(p);
        if (pattern.test(t)) hits.push(p);
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return hits;
}

console.log('\n=== Deployment & infrastructure audit ===\n');

// --- ENVIRONMENT ---
const renderYaml = exists('render.yaml') ? read('render.yaml') : '';
const compose = exists('docker-compose.yml') ? read('docker-compose.yml') : '';
const envExample = exists('backend/.env.example') ? read('backend/.env.example') : '';
const prodEnvExample = exists('.env.production.example') ? read('.env.production.example') : '';

if (/NODE_ENV[\s\S]*production/.test(renderYaml) && /ENABLE_DEMO_MODE[\s\S]*false/.test(renderYaml)) {
  pass('ENV', 'Production blueprint separates from dev', 'render.yaml NODE_ENV=production, demo off');
} else {
  fail('ENV', 'Production blueprint', 'render.yaml missing prod env defaults');
}

if (/ENABLE_DEMO_MODE:\s*'true'/.test(compose) && /dev_jwt_secret/.test(compose)) {
  pass('ENV', 'Local Docker Compose is development-only', 'demo mode + dev JWT in compose');
} else {
  ops('ENV', 'Docker Compose dev-only markers', false, 'review docker-compose.yml');
}

if (exists('backend/scripts/validate-production-env.cjs') && exists('backend/scripts/go-live-init.cjs')) {
  pass('ENV', 'Production env validation tooling', 'go-live:validate-env + go-live-init');
} else {
  fail('ENV', 'Production env validation tooling');
}

if (/NODE_ENV=development/.test(envExample) && /ENABLE_DEMO_MODE=true/.test(envExample)) {
  pass('ENV', 'backend/.env.example defaults to development');
} else {
  fail('ENV', 'backend/.env.example dev defaults');
}

const indexJs = exists('backend/src/index.js') ? read('backend/src/index.js') : '';
if (/ENABLE_DEMO_MODE.*NODE_ENV.*production/.test(indexJs.replace(/\s+/g, ' '))) {
  pass('ENV', 'Demo mode blocked when NODE_ENV=production');
} else {
  fail('ENV', 'Demo mode production guard in index.js');
}

const guards = exists('backend/src/middleware/guards.js') ? read('backend/src/middleware/guards.js') : '';
if (/assertProductionSecrets/.test(guards)) {
  pass('ENV', 'Production secret assertions at startup');
} else {
  fail('ENV', 'assertProductionSecrets');
}

const hasStructuredLogger = exists('backend/src/lib/logger.js')
  && /require\(['"]\.\/lib\/logger['"]\)/.test(indexJs);
if (hasStructuredLogger) {
  pass('ENV', 'Structured logging (JSON stderr + optional LOG_FILE)', 'backend/src/lib/logger.js wired in index.js');
} else {
  fail('ENV', 'Structured application logging', 'add logger.js and use in index.js');
}
const consoleHeavy = grepDir(path.join(backend, 'src'), /console\.(log|error|warn)/).length;
if (consoleHeavy > 20) {
  ops('ENV', 'Migrate route handlers from console.* to logger', false, `${consoleHeavy} files still use console`);
}

ops('ENV', 'Application monitoring (uptime every 5 min)', false, 'configure UptimeRobot/Pingdom → GET /health and /health/db');

// --- BACKUP & RECOVERY ---
if (exists('backend/scripts/backup-db.cjs') && exists('backend/scripts/restore-db.cjs')) {
  pass('BACKUP', 'Database backup/restore scripts present');
} else {
  fail('BACKUP', 'backup-db.cjs / restore-db.cjs');
}

if (exists('backend/scripts/backup-restore-drill.cjs')) {
  pass('BACKUP', 'Recovery drill script', 'npm run go-live:backup-drill [--restore-test]');
} else {
  fail('BACKUP', 'backup-restore-drill.cjs');
}

const gitignore = exists('.gitignore') ? read('.gitignore') : '';
if (/backend\/backups/.test(gitignore) || /backups/.test(gitignore)) {
  pass('BACKUP', 'Backup directory gitignored');
} else {
  fail('BACKUP', 'backend/backups/ not in .gitignore', 'risk committing dumps');
}

ops('BACKUP', 'Automated daily backup verified in production', false, 'schedule: cron/Task Scheduler → npm run db:backup');
ops('BACKUP', 'Backup stored offsite (S3 or equivalent)', false, 'see docs/DEPLOYMENT-OFFSITE-BACKUP.md');
ops('BACKUP', 'Recovery drill completed in production', false, 'run go-live:backup-drill --restore-test quarterly');
ops('BACKUP', 'RTO < 1 hour tested from backup', false, 'operator timed restore drill');

if (liveBackup) {
  const r = spawnSync('npm', ['run', 'go-live:backup-drill'], { cwd: backend, shell: true, stdio: 'pipe', encoding: 'utf8' });
  if (r.status === 0) {
    ops('BACKUP', 'Live backup drill (this machine)', true, 'go-live:backup-drill succeeded');
  } else {
    ops('BACKUP', 'Live backup drill (this machine)', false, (r.stderr || r.stdout || '').slice(0, 200));
  }
}

// --- DEPLOYMENT ---
if (exists('docs/OPERATOR-GO-LIVE.md') && exists('docs/PRODUCTION-GO-LIVE.md')) {
  pass('DEPLOY', 'Deployment runbooks documented');
} else {
  fail('DEPLOY', 'Operator go-live runbooks');
}

if (exists('docs/DEPLOYMENT-ZERO-DOWNTIME-ROLLBACK.md')) {
  pass('DEPLOY', 'Zero-downtime and rollback procedures documented');
} else {
  fail('DEPLOY', 'Zero-downtime / rollback doc', 'missing DEPLOYMENT-ZERO-DOWNTIME-ROLLBACK.md');
}

if (/enforceHttps|trust proxy/.test(read('backend/src/middleware/security.js'))) {
  pass('DEPLOY', 'HTTPS enforcement middleware for production');
} else {
  fail('DEPLOY', 'HTTPS middleware');
}

ops('DEPLOY', 'SSL certificate valid and auto-renews', false, 'terminate TLS at Render/LB/Let\'s Encrypt — not in repo');
ops('DEPLOY', 'Production domain configured', false, 'set CORS_ORIGINS, VITE_API_BASE, APP_BASE_URL');
ops('DEPLOY', 'CDN for static assets', false, 'Render static or Cloudflare in front of dist/');
ops('DEPLOY', 'Log rotation — no disk exhaustion', false, 'use platform log drain or logrotate on LOG_FILE');

if (exists('render.yaml') && /healthCheckPath/.test(renderYaml)) {
  pass('DEPLOY', 'Platform health check configured', 'render.yaml /health');
} else {
  ops('DEPLOY', 'Platform health check', false);
}

// --- SCALABILITY BASELINE ---
const dbJs = exists('backend/src/db.js') ? read('backend/src/db.js') : '';
if (/DATABASE_POOL_MAX|Pool/.test(dbJs)) {
  pass('SCALE', 'Database connection pooling');
} else {
  fail('SCALE', 'Connection pooling');
}

const mig001 = exists('backend/migrations/001_foundation.sql') ? read('backend/migrations/001_foundation.sql') : '';
if (/PARTITION|partition/.test(mig001)) {
  pass('SCALE', 'Audit log partitioning for large volumes');
} else {
  ops('SCALE', 'Table partitioning', false);
}

if (exists('backend/scripts/seed-performance-volume.cjs') && exists('backend/scripts/query-plan-audit.js')) {
  pass('SCALE', 'Performance volume seed + query plan audit', 'evidence for 10k+ tx; extend to 1M via ops load test');
} else {
  fail('SCALE', 'Performance benchmarking tooling');
}

ops('SCALE', 'Database verified at 1M records without reconfiguration', false, 'run load test on production-sized DB');
ops('SCALE', 'Invoices/PDFs on cloud object storage', false, 'POD photos stored in DB (base64); migrate to S3');
ops('SCALE', 'App server horizontally scalable', false, 'WebSockets in-memory; need Redis pub/sub for multi-instance');

// --- Live health ---
if (liveHealth) {
  const base = process.env.API_BASE || 'http://localhost:4000';
  const probe = (p) => new Promise((resolve) => {
    const req = http.get(`${base}${p}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
  (async () => {
    const h = await probe('/health');
    const d = await probe('/health/db');
    if (h.status === 200) ops('LIVE', 'GET /health', true, base);
    else ops('LIVE', 'GET /health', false, h.error || `status ${h.status}`);
    if (d.status === 200) ops('LIVE', 'GET /health/db', true);
    else ops('LIVE', 'GET /health/db', false, d.error || `status ${d.status}`);
    summary();
  })();
} else {
  ops('LIVE', 'API health probes', false, 're-run with --live-health when API is up');
  summary();
}

function summary() {
  console.log('\n--- Summary ---');
  console.log(`Repo checks: ${repoPass} pass, ${repoFail} fail`);
  console.log(`Operator/infra: ${opsPass} done, ${opsWarn} pending`);
  console.log('\nSee docs/DEPLOYMENT-INFRASTRUCTURE-CHECKLIST-STATUS.md\n');
  if (repoFail > 0) process.exit(1);
}
