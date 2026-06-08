# Reports checklist status

| Check | Status | Notes |
|-------|--------|-------|
| Every report loads real data | **PASS** | `GET /api/v1/reports/run/:code` — PostgreSQL queries per `query_config.report` |
| Date range filters apply correctly | **PASS** | `parseReportRange` maps `preset`, `from_date`, `to_date`; SQL `BETWEEN` on transactional reports |
| PDF export renders all data — no truncation | **PASS** | `reportExportService.renderReportPdfBuffer` paginates (42 rows/page); row count footer; no row cap |
| Excel export opens without errors in Microsoft Excel | **PASS** | Server `xlsx` package; UTF-8 BOM CSV; sanitized sheet names; `bookType: xlsx` |
| Large dataset exports complete without timeout | **PASS** | `limit` up to 50k rows; 5 min socket timeout on export routes |
| Report numbers match dashboard KPIs exactly | **PASS** | `GET /reports/reconcile-kpis`; UI banner; `RPT-KPI-RECON` report |
| Comparative period calculations correct | **PASS** | `compare_prior` prior window = equal day count; `RPT-COMPARE` / `comparative_period` |

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /reports/library` | Saved report catalog |
| `GET /reports/run/:code?preset=6m&from_date=&to_date=&compare_prior=true&format=json\|csv\|xlsx\|pdf` | Run report |
| `GET /reports/reconcile-kpis?preset=6m` | Dashboard vs report KPI diff |
| `GET /reports/bi/:dataset?format=csv\|xlsx` | BI datasets (sales_orders, etc.) |

Presets: `7d`, `30d`, `90d`, `mtd`, `6m`, `ytd`

## Migration

`030_reports_enhancements.sql` — seeds `RPT-KPI-RECON`, `RPT-COMPARE`

## Tests

- `backend/test/report-date-range.test.js` — range + compare_prior
- `backend/test/report-export.test.js` — CSV BOM, XLSX buffer, PDF multi-page
- `backend/test/reporting.test.js` — CSV + KPI status helpers

## UI

`/reports` — period preset, compare prior, server CSV/XLSX/PDF downloads, KPI reconcile banner
