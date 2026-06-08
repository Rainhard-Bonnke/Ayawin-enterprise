#!/usr/bin/env node
/**
 * Load benchmark: sequential + concurrent requests against local API.
 * Usage:
 *   node scripts/load-benchmark.js
 *   node scripts/load-benchmark.js --concurrency 20 --iterations 5
 */
const base = (process.argv.find((a, i) => process.argv[i - 1] === '--base') || 'http://localhost:4000').replace(
  /\/+$/,
  '',
);

const concurrency = Number(process.argv.find((a, i) => process.argv[i - 1] === '--concurrency') || 10);
const iterations = Number(process.argv.find((a, i) => process.argv[i - 1] === '--iterations') || 3);
const virtualUsers = Number(process.argv.find((a, i) => process.argv[i - 1] === '--users') || 0);

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

async function timed(name, fn) {
  const start = performance.now();
  try {
    await fn();
    return { name, ms: performance.now() - start, ok: true };
  } catch (err) {
    return { name, ms: performance.now() - start, ok: false, error: err.message };
  }
}

async function runConcurrent(token, path, n) {
  const headers = { Authorization: `Bearer ${token}` };
  const start = performance.now();
  const tasks = Array.from({ length: n }, () =>
    fetch(`${base}/api/v1${path}`, { headers }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }),
  );
  const results = await Promise.allSettled(tasks);
  const ms = performance.now() - start;
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  return { ok, fail: n - ok, ms, avg: ms / n };
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

  const endpoints = [
    ['GET /sales/orders', '/sales/orders'],
    ['GET /sales/invoices', '/sales/invoices'],
    ['GET /inventory/stock', '/inventory/stock'],
    ['GET /reports/kpis', '/reports/kpis'],
  ];

  console.log('\n=== Sequential latency (target <300ms) ===');
  for (const [label, path] of endpoints) {
    const samples = [];
    for (let i = 0; i < iterations; i++) {
      const r = await timed(label, () =>
        fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json();
        }),
      );
      samples.push(r.ms);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = percentile(sorted, 95);
    const status = avg < 300 && p95 < 500 ? 'PASS' : 'SLOW';
    console.log(
      `${status.padEnd(5)} ${label.padEnd(28)} avg ${avg.toFixed(0)}ms p95 ${p95.toFixed(0)}ms (${iterations} runs)`,
    );
  }

  if (virtualUsers > 0) {
    console.log(`\n=== Virtual users (${virtualUsers} × mixed read workload) ===`);
    const mixed = endpoints.map(([, path]) => path);
    const start = performance.now();
    const tasks = Array.from({ length: virtualUsers }, (_, i) => {
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
    const totalMs = performance.now() - start;
    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
    const p95 = percentile(sorted, 95);
    const fail = virtualUsers - latencies.length;
    const status = fail === 0 && p95 < 800 ? 'PASS' : 'WARN';
    console.log(
      `${status.padEnd(5)} ${latencies.length}/${virtualUsers} ok in ${totalMs.toFixed(0)}ms wall — avg ${avg.toFixed(0)}ms p95 ${p95.toFixed(0)}ms`,
    );
    if (fail) console.log(`      ${fail} request(s) failed`);
  }

  console.log(`\n=== Concurrent load (${concurrency} parallel × ${endpoints.length} endpoints) ===`);
  for (const [label, path] of endpoints) {
    const r = await runConcurrent(token, path, concurrency);
    const status = r.fail === 0 && r.avg < 500 ? 'PASS' : 'WARN';
    console.log(
      `${status.padEnd(5)} ${label.padEnd(28)} ${r.ok}/${concurrency} ok in ${r.ms.toFixed(0)}ms (avg ${r.avg.toFixed(0)}ms)`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
