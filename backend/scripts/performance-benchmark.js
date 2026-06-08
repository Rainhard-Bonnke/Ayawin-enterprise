#!/usr/bin/env node
/**
 * Performance checklist benchmark — PASS/FAIL against production targets.
 *
 * Prerequisites:
 *   - API running (default http://localhost:4000)
 *   - node scripts/seed-performance-volume.cjs (for volume tests)
 *   - npm run db:migrate (031 indexes)
 *
 * Usage:
 *   node scripts/performance-benchmark.js
 *   node scripts/performance-benchmark.js --skip-seed-check
 */
const base = (
  process.argv.find((a, i) => process.argv[i - 1] === '--base') || 'http://localhost:4000'
).replace(/\/+$/, '');

const skipSeedCheck = process.argv.includes('--skip-seed-check');

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function login() {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@martin.co.ke', password: 'demo', remember_me: false }),
  });
  if (!res.ok) throw new Error(`Login failed ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function timedFetch(path, { token, method = 'GET', body, accept } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (accept) headers.Accept = accept;
  const start = performance.now();
  const res = await fetch(`${base}/api/v1${path}`, { method, headers, body });
  const ms = performance.now() - start;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} → ${res.status} ${text.slice(0, 120)}`);
  }
  const buf = accept && !accept.includes('json');
  const payload = buf ? await res.arrayBuffer() : await res.json();
  return { ms, payload, res };
}

async function sampleLatency(token, path, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const { ms } = await timedFetch(path, { token });
    samples.push(ms);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p95: percentile(sorted, 95),
    samples: sorted,
  };
}

function record(results, name, ms, limitMs, extra = '') {
  const pass = ms <= limitMs;
  results.push({ name, ms, limitMs, pass, extra });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`${tag.padEnd(5)} ${name.padEnd(42)} ${ms.toFixed(0)}ms (≤${limitMs}ms) ${extra}`);
  return pass;
}

async function main() {
  let token = process.argv.find((a, i) => process.argv[i - 1] === '--token');
  if (!token) {
    try {
      token = await login();
    } catch (e) {
      console.error('Login failed — start backend or pass --token', e.message);
      process.exit(1);
    }
  }

  const results = [];
  let allPass = true;

  console.log('\n=== Ayawin performance benchmark ===\n');

  if (!skipSeedCheck) {
    try {
      const { payload } = await timedFetch('/sales/invoices?limit=1&page=1', { token });
      const total = payload.pagination?.total ?? (Array.isArray(payload) ? payload.length : 0);
      if (total < 1000) {
        console.warn(
          `WARN  Volume data low (${total} invoices). Run: node scripts/seed-performance-volume.cjs\n`,
        );
      }
    } catch {
      console.warn('WARN  Could not probe invoice count — seed may be missing.\n');
    }
  }

  console.log('--- Load benchmarks ---');

  try {
    await timedFetch('/dashboard/summary?preset=6m', { token });
    const dash = await sampleLatency(token, '/dashboard/summary?preset=6m', 3);
    allPass =
      record(results, 'Dashboard summary (10k+ tx)', dash.p95, 2000, `avg ${dash.avg.toFixed(0)}ms (warmed)`) &&
      allPass;
  } catch (e) {
    console.log(`FAIL  Dashboard summary                     ${e.message}`);
    allPass = false;
  }

  try {
    const search = await sampleLatency(token, '/master/items?q=PERF&limit=50', 5);
    allPass =
      record(results, 'Product search (500 SKUs)', search.p95, 500, `avg ${search.avg.toFixed(0)}ms`) && allPass;
  } catch (e) {
    console.log(`FAIL  Product search                         ${e.message}`);
    allPass = false;
  }

  try {
    const inv = await sampleLatency(token, '/sales/invoices?limit=50&page=1', 5);
    allPass =
      record(results, 'Invoice list page (5k paginated)', inv.p95, 300, `avg ${inv.avg.toFixed(0)}ms`) && allPass;
  } catch (e) {
    console.log(`FAIL  Invoice list paginated                 ${e.message}`);
    allPass = false;
  }

  try {
    const invList = await timedFetch('/sales/invoices?limit=1&page=1', { token });
    const first = invList.payload.data?.[0] || invList.payload[0];
    const invoiceNo = first?.invoice_no;
    if (!invoiceNo) throw new Error('no invoice for PDF test');
    const pdf = await timedFetch(`/sales/invoices/${encodeURIComponent(invoiceNo)}/pdf`, {
      token,
      accept: 'application/pdf',
    });
    allPass = record(results, 'Invoice PDF generation', pdf.ms, 5000) && allPass;
  } catch (e) {
    console.log(`FAIL  Invoice PDF                            ${e.message}`);
    allPass = false;
  }

  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const xlsx = await timedFetch(
      `/reports/bi/customer_invoices?format=xlsx&limit=2000&from=${from}&to=${to}`,
      { token, accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );
    const kb = xlsx.payload.byteLength / 1024;
    allPass = record(results, 'Excel export 2,000 rows', xlsx.ms, 10000, `${kb.toFixed(0)} KB`) && allPass;
  } catch (e) {
    console.log(`FAIL  Excel export 2000 rows                 ${e.message}`);
    allPass = false;
  }

  try {
    const report = await timedFetch('/reports/run/RPT-SALES-SUMMARY?preset=12m', { token });
    const rows = report.payload.rows?.length ?? 0;
    allPass = record(results, '12-month report render', report.ms, 3000, `${rows} rows`) && allPass;
  } catch (e) {
    console.log(`FAIL  12-month report                        ${e.message}`);
    allPass = false;
  }

  console.log('\n--- API latency under normal load ---');
  const endpoints = [
    ['GET /dashboard/summary', '/dashboard/summary?preset=1m'],
    ['GET /sales/invoices', '/sales/invoices?limit=25&page=1'],
    ['GET /inventory/stock', '/inventory/stock'],
    ['GET /reports/kpis', '/reports/kpis'],
  ];
  for (const [label, path] of endpoints) {
    try {
      const s = await sampleLatency(token, path, 3);
      const pass = s.avg < 300 && s.p95 < 400;
      results.push({ name: label, ms: s.avg, limitMs: 300, pass, extra: `p95 ${s.p95.toFixed(0)}ms` });
      console.log(
        `${(pass ? 'PASS' : 'FAIL').padEnd(5)} ${label.padEnd(42)} avg ${s.avg.toFixed(0)}ms p95 ${s.p95.toFixed(0)}ms`,
      );
      if (!pass) allPass = false;
    } catch (e) {
      console.log(`FAIL  ${label.padEnd(42)} ${e.message}`);
      allPass = false;
    }
  }

  console.log('\n--- 50 concurrent users (mixed reads) ---');
  const mixed = endpoints.map(([, p]) => p);
  const start = performance.now();
  const tasks = Array.from({ length: 50 }, (_, i) => {
    const path = mixed[i % mixed.length];
    const t0 = performance.now();
    return fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return performance.now() - t0;
      })
      .catch(() => -1);
  });
  const latencies = (await Promise.all(tasks)).filter((ms) => ms >= 0);
  const wall = performance.now() - start;
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const p95 = percentile(sorted, 95);
  const fail = 50 - latencies.length;
  const pass = fail === 0 && p95 < 2000;
  console.log(
    `${(pass ? 'PASS' : 'FAIL').padEnd(5)} 50 concurrent requests          ${latencies.length}/50 ok, wall ${wall.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms`,
  );
  if (!pass) allPass = false;

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed (tracked checks) ===`);
  console.log(allPass ? '\nOVERALL: PASS\n' : '\nOVERALL: FAIL — tune indexes, seed volume, or restart API\n');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
