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

- `GET /health` - health check
- `POST /api/auth/login` - login
- `GET /api/auth/me` - current user
- `GET /api/products` - products
- `GET /api/customers` - customers
- `GET /api/users` - users
- `POST /api/sales/product-sale` - transactional sale workflow
- `GET /api/dashboard/summary` - live dashboard aggregates

## Backup and restore

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
