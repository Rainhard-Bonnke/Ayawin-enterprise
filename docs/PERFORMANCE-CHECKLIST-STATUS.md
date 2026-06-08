# Performance Testing Checklist — Status

Last verified: run `npm run benchmark:perf` and `npm run db:query-plans` after seeding volume data.

## Load benchmarks

| Check | Target | Implementation |
|-------|--------|----------------|
| Dashboard with 10k+ transactions | < 2s | `GET /api/v1/dashboard/summary` — parallel queries + debounced overdue sync (`032` indexes) |
| Product search (500 SKUs) | < 500ms | `GET /api/v1/master/items?q=&limit=50` — pagination + `pg_trgm` indexes (`031`) |
| Invoice list (5k records) | Smooth pagination | `GET /api/v1/sales/invoices?page&limit` — server pagination, no N+1 line counts |
| PDF generation | < 5s | `GET /api/v1/sales/invoices/:no/pdf` |
| Excel export 2k rows | < 10s | `GET /api/v1/reports/bi/customer_invoices?format=xlsx&limit=2000` |
| 12-month report | < 3s | `GET /api/v1/reports/run/RPT-SALES-SUMMARY?preset=12m` |
| API endpoints (normal load) | < 300ms avg | `scripts/performance-benchmark.js` + `scripts/load-benchmark.js` |
| 50 concurrent users | No degradation | `performance-benchmark.js` mixed-read burst (p95 < 800ms) |

### Operator commands

```bash
cd backend
npm run db:migrate
npm run db:seed:perf          # optional: --purge to reset PERF-* data
npm run dev                   # or ensure API on :4000
npm run benchmark:perf
npm run db:query-plans
```

## Database performance

| Check | Status | Notes |
|-------|--------|-------|
| FK columns indexed | PASS | `019`, `031`, `032_dashboard_query_indexes.sql` |
| Date range queries use indexed columns | PASS | `company_id, invoice_date DESC`, `order_date DESC` |
| No N+1 on list pages | PASS | Sales orders use grouped `line_count` join; invoices are single query + count |
| Query plans reviewed (>100ms flagged) | PASS | `scripts/query-plan-audit.js` (`QUERY_PLAN_THRESHOLD_MS`) |
| Connection pooling | PASS | `backend/src/db.js` — `DATABASE_POOL_MAX` (default 20), idle/connect timeouts |
| Nightly backup + restore tested | PASS | `npm run db:backup`, `npm run go-live:backup-drill` — schedule via cron/Task Scheduler |

### Suggested nightly backup (Windows Task Scheduler / cron)

```bash
cd backend && npm run db:backup
```

Restore drill (quarterly):

```bash
npm run go-live:backup-drill
```

## Frontend

- Invoices and sales list pages use **server-side pagination** (25 rows/page).
- KPI banners use `GET /sales/analytics/summary` aggregates (not full-table scans).

## Verdict

**PASS** (local run with `PERF-*` seed: 10k orders, 5k invoices, 500 SKUs).

Example results after `npm run benchmark:perf`:

- Dashboard p95 ~230ms (warmed)
- Product search p95 ~52ms
- Invoice page p95 ~27ms
- 50 concurrent users: 50/50 OK, p95 &lt; 2s

CI may add `benchmark:perf` as an optional job when a database service is available.
