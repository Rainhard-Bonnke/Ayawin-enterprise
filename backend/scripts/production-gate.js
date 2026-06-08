#!/usr/bin/env node
/**
 * Production readiness gate — runs migrations, unit tests, E2E, and data accuracy checks.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`\nGATE FAILED at: ${label}`);
    process.exit(result.status || 1);
  }
}

run('npm', ['run', 'db:migrate'], 'Database migrations');

run('npm', ['test'], 'Unit tests');
run('npm', ['run', 'test:security'], 'Security tests');

run('node', ['--test', '--test-concurrency=1',
  'test/e2e/sales-flow.test.js',
  'test/e2e/purchase-flow.test.js',
  'test/e2e/payroll-flow.test.js',
  'test/e2e/delivery-list.test.js',
  'test/e2e/stock-adjustment-flow.test.js',
  'test/e2e/month-end-flow.test.js',
  'test/e2e/md-po-approval.test.js',
  'test/e2e/integration-flows.test.js',
], 'Critical E2E & integration flows');

run('node', ['scripts/data-accuracy-audit.js'], 'Data accuracy audit');

run('node', [path.join(__dirname, '..', '..', 'scripts', 'ui-ux-audit.cjs')], 'UI/UX audit');

run('node', [path.join(__dirname, '..', '..', 'scripts', 'deployment-infra-audit.cjs')], 'Deployment & infra audit');

console.log('\n========================================');
console.log(' PRODUCTION GATE: PASS');
console.log(' Operator checklist remains:');
console.log('  - Change default admin password');
console.log('  - Set PII_ENCRYPTION_KEY and JWT_SECRET in production');
console.log('  - Replace seed data with live master data');
console.log('  - Client sign-off on PDF templates');
console.log('========================================\n');
