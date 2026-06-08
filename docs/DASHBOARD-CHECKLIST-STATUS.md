# Dashboard checklist status

| Check | Status | Notes |
|-------|--------|-------|
| KPI cards load real data | **PASS** | `GET /api/v1/dashboard/summary` — DB aggregates (invoices, orders, stock, AR) |
| KPIs update without refresh | **PASS** | WebSocket via `subscribeLiveEvents` + 30s polling fallback |
| Charts: 0 / low / high data | **PASS** | `ChartEmptyState` for empty series; Recharts scales for sparse/dense data |
| Date range updates all widgets | **PASS** | Preset selector re-fetches summary; charts, KPIs, alerts scoped to range |
| Low stock alerts link to items | **PASS** | Links to `/inventory?q={item_code}` |
| Overdue invoice alerts link | **PASS** | Links to `/invoices?q={invoice_no}` |
| Revenue chart missing months | **PASS** | `fillMonthlyRevenueGaps` zero-fills months in range |
| Dashboard loads &lt; 2s | **PASS** | Single API round-trip (was 4 parallel calls) |
| Mobile layout | **PASS** | `grid-cols-1`, responsive chart heights, table scroll |

## API

`GET /api/v1/dashboard/summary?preset=6m`

Presets: `7d`, `30d`, `90d`, `mtd`, `6m`, `ytd`

## Tests

`backend/test/chart-months.test.js` — gap filling for revenue months
