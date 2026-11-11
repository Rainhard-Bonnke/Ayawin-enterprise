## Database fixtures

Migrations seed reference records only. For local or test data, run `npm run db:seed:demo` with `NODE_ENV` other than `production`.
To rebuild a development database, set `ALLOW_DB_RESET=true` and run `npm run db:reset`. The reset command refuses to run in production.
Create the first ERP administrator by setting `ADMIN_EMAIL` and `ADMIN_PASSWORD` before bootstrap.

# Ayawin Enterprise Backend

## Local development

1. Copy `backend/.env.example` to `backend/.env`.
2. Make sure PostgreSQL is running and `DATABASE_HOST` points to it.
3. From the repo root:

```bash
npm install
npm run dev:all
```

That starts:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## API endpoints

The platform exposes the ERP API under `/api/v1`. Retired `/api/*` business routes return `410 Gone`.

- `GET /health` - health check
- `GET /ready` - readiness check
- `GET /api/v1/auth/me` - current user
- `GET /api/v1/master/customers` - customers
- `GET /api/v1/procurement/purchase-orders` - purchase orders
- `GET /api/v1/sales/orders` - sales orders

## Backup and restore

Replace the company's product catalog from the supplied certified workbook after reviewing a dry run:

```bash
npm run db:import-certified-products -- --dry-run
npm run db:backup
npm run db:import-certified-products -- --confirm-replace-catalog
```

The import preserves the workbook's category, SKU, product name, package size, volume, origin, type, packaging tier, stock-status label, and retail price. The workbook contains no cost, tax, or physical stock quantities; those values are deliberately not inferred. Configure the correct tax treatment and opening inventory before selling or posting stock.

Before a legacy-data migration or cleanup, run the read-only reconciliation audit:

```bash
npm run db:legacy-audit --prefix backend
```

It reports table counts and aggregate reconciliation checks without selecting personal fields or modifying data. A nonzero document delta or missing source detail requires business reconciliation before the guarded legacy cleanup migration can proceed.

Refresh planner statistics and reclaim eligible dead tuples without deleting live records:

```bash
npm run db:maintain
```

Create a PostgreSQL backup:

```bash
npm run db:backup --prefix backend
```

Restore from a backup file:

```bash
npm run db:restore --prefix backend -- ./backups/ayawin-enterprise-example.sql
```

For production, schedule `npm run db:backup --prefix backend` with Windows Task Scheduler, cron, or your cloud scheduler and copy the output directory to durable storage.

## Docker

If you want the database and backend only:

```bash
docker-compose up --build
```

If you use Docker, keep the frontend running locally with:

```bash
set VITE_API_BASE=http://localhost:4000
npm run dev
```
