# Operator go-live runbook

Step-by-step for production deployment. Run from the repo root unless noted.

## 1. Production secrets

```powershell
cd backend
node scripts/go-live-init.cjs
# Review backend\.env.production, then apply:
node scripts/go-live-init.cjs --apply
```

Edit placeholders:

- `CORS_ORIGINS` — your production frontend URL (e.g. `https://erp.ayawin.co.ke`)
- `APP_BASE_URL` — same frontend URL (password reset links)
- Database `DATABASE_*` — production PostgreSQL

Validate:

```powershell
# After copying production values into .env:
$env:NODE_ENV="production"
$env:ENABLE_DEMO_MODE="false"
npm run go-live:validate-env
```

Frontend `.env` for production build:

```env
VITE_API_BASE=https://api.ayawin.co.ke
VITE_USE_API_V1=true
VITE_DEMO_MODE=false
```

## 2. Change admin password

**Option A — CLI (recommended before first deploy):**

```powershell
$env:NEW_ADMIN_PASSWORD="YourStrongPassword-Min12Chars!"
npm run go-live:password
```

**Option B — In app:** Settings → **Go-live** → Change password (current + new).

Remove `ADMIN_PASSWORD` from `.env` after bootstrap.

## 3. Load live master data

1. Copy templates from `data/live-import/README.md`.
2. Fill `customers.csv`, `items.csv`, `vendors.csv` with real data.
3. Optional purge of demo transactions:

   ```powershell
   $env:CONFIRM_PURGE_DEMO="yes"
   npm run go-live:purge-demo
   ```

4. Import:

   ```powershell
   npm run go-live:import
   ```

5. Enter opening stock via **Inventory → Stock in** or opening journal in finance.

## 4. PDF client sign-off

Follow [PDF-SIGNOFF-CHECKLIST.md](./PDF-SIGNOFF-CHECKLIST.md). Complete in staging with production company profile.

## 5. Backup / restore drill

```powershell
npm run go-live:backup-drill
# Full restore test (creates DATABASE_drill):
npm run go-live:backup-drill -- --restore-test
```

Schedule nightly backups:

```powershell
npm run db:backup
```

Backups default to `backend/backups/`.

## 6. Final checks

```powershell
npm run db:migrate
npm run production:gate
```

In the app: **Settings → Go-live** — all checklist items green.

## Quick reference

| Task | Command |
|------|---------|
| Generate secrets | `npm run go-live:init` |
| Apply secrets to `.env` | `npm run go-live:init -- --apply` |
| Set admin password | `npm run go-live:password` |
| Validate env | `npm run go-live:validate-env` |
| Import CSVs | `npm run go-live:import` |
| Purge demo txns | `CONFIRM_PURGE_DEMO=yes npm run go-live:purge-demo` |
| Backup drill | `npm run go-live:backup-drill` |
| Production gate | `npm run production:gate` |
