# Ayawin Enterprise ERP

## ERP scope and document requirements

See the [Ayawin ERP module catalogue and document register](docs/AYAWIN-ERP-MODULE-CATALOG.md) for the requested sales, inventory, finance, procurement and HR submodules, their required business documents, and the controls each workflow needs. The [Kenya ERP readiness audit](backend/docs/KENYA-ERP-MODULE-READINESS.md) tracks implemented workflows and current gaps.

## What runs where

- Frontend: Vite app at `http://localhost:5173`
- Backend: Express API at `http://localhost:4000`
- Database: PostgreSQL

## Option 1: Easiest local dev with a local PostgreSQL instance

Use this if you already have PostgreSQL running on your machine.

1. Copy env files:

```bash
Copy-Item backend\.env.example backend\.env
Copy-Item .env.example .env
```

2. Start both apps:

```bash
npm install
cd backend
npm install
cd ..
npm run dev:all
```

3. Open:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/health`

## Option 2: Docker for database and backend, frontend locally

Use this if you do not want to install PostgreSQL locally.

1. Start the database and backend:

```bash
docker-compose up --build
```

2. In a second terminal, point the frontend at the backend API:

```bash
$env:VITE_API_BASE="http://localhost:4000"
npm run dev
```

3. Open the frontend at `http://localhost:5173`

## Backend env

`backend/.env.example` is set up for local development:

- `DATABASE_HOST=localhost`
- `PORT=4000`

If you run the backend inside Docker, use `DATABASE_HOST=db`.

## Login

Default seed login:

- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the backend environment before first startup.

## ERP API (Module 1 — Foundation & Auth)

New production API under `/api/v1` with JWT access + refresh tokens, RBAC, MFA (TOTP), multi-company/branch, currencies, audit trail, and system settings.

- **OpenAPI docs:** `http://localhost:4000/api/docs`
- **Module guide:** [backend/docs/MODULE-01-FOUNDATION.md](backend/docs/MODULE-01-FOUNDATION.md)

```bash
cd backend
npm run db:migrate    # apply erp_* schema migrations
```

Example login:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-admin@example.com","password":"your-configured-password"}'
```

Legacy `/api/*` business routes have been removed and return `410 Gone`. Use the ERP API under `/api/v1`.

## Production hosting (Render)

This repo includes a Render blueprint at `render.yaml` for:

- PostgreSQL (`martin-enterprise-db`)
- Redis (`martin-enterprise-redis`)
- Backend web service (`backend/`)
- Frontend static site (root app)

### Deploy steps

1. Push this repository to GitHub.
2. In Render, create a new **Blueprint** and select this repo.
3. Render will create all resources from `render.yaml`.
4. Set these required env vars after services are created:
   - Backend `APP_BASE_URL=https://<your-backend-domain>`
   - Frontend `VITE_API_BASE=https://<your-backend-domain>`
5. Redeploy frontend and backend once env vars are saved.

### Important production settings

- Set independent random `JWT_SECRET` and `MFA_ENCRYPTION_KEY` values of at least 32 characters.
- Set a separate random `DOC_VERIFY_SECRET` of at least 32 characters for invoice verification links.
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before first administrator bootstrap.
- Rotate `JWT_SECRET` and `DOC_VERIFY_SECRET` if you ever expose them
- Attach custom domains:
  - frontend: `app.yourdomain.com`
  - backend: `api.yourdomain.com`
- Enable automatic backups on the managed Postgres instance

## Module 2 — Master Data

- **Guide:** [backend/docs/MODULE-02-MASTER-DATA.md](backend/docs/MODULE-02-MASTER-DATA.md)
- **API base:** `/api/v1/master` (customers, vendors, items, COA, warehouses, price lists, etc.)

## Module 3 — Financial Management (GL)

- **API base:** `/api/v1/finance` (journals, fiscal periods, trial balance, balance sheet, P&L)

## Module 4 — Procurement & Inventory

- **Procurement:** `/api/v1/procurement` (requisitions, POs, GRN with GL accrual on post)
- **Inventory:** `/api/v1/inventory` (stock on hand, movements, transfers, reorder alerts)

## Module 5 — Sales & CRM

- **CRM:** `/api/v1/crm` (leads, opportunities, pipeline forecast, activities)
- **Sales:** `/api/v1/sales` (ATP/credit checks, orders, deliveries, invoices, analytics)

## Module 6 — HR & Payroll (Kenya)

- **HR:** `/api/v1/hr` (employees, org chart, leave, holidays, attendance import)
- **Payroll:** `/api/v1/payroll` (runs, payslips, PAYE/NHIF/NSSF/housing levy, GL post, statutory report)

## Module 7 — Reporting & BI

- **Reports:** `/api/v1/reports` (library, run CSV/JSON, dashboards, KPIs, BI datasets for Power BI/Metabase)
- Dashboards: `DASH-CFO`, `DASH-OPS`, `DASH-HR`
- BI datasets: `sales_orders`, `customer_invoices`, `stock_on_hand`, `payslips`, `gl_balances`

## Module 8 — Platform & Integrations

- **Platform:** `/api/v1/platform` (webhooks, CSV import wizard, background jobs)
- **Integrations:** eTIMS stub, M-Pesa STK stub, email/SMS notifications

## Phase 10 — Production Readiness Baseline

See [docs/PHASE-10-PRODUCTION-READINESS.md](docs/PHASE-10-PRODUCTION-READINESS.md) for the operational go-live checklist covering infrastructure, observability, resilience, DR, UAT, and CI gates.

The repo now includes a stronger Render deployment blueprint in [render.yaml](render.yaml) covering:

- separate API and frontend services
- supervised worker services for eTIMS, M-Pesa, notifications, and reports
- managed Postgres and Redis
- environment-specific secret wiring for staging and production
- private object-storage configuration for documents and backups

> Production deployment remains gated on credentials, provider certification, and signed approvals. The repo intentionally keeps secrets out of source control and requires them to be supplied by the platform secret store.
