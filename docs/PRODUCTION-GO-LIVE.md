# Production Go-Live Guide — Ayawin Stock Solutions ERP

## Pre-flight (required)

**Full operator runbook:** [OPERATOR-GO-LIVE.md](./OPERATOR-GO-LIVE.md)

1. `cd backend && npm run go-live:init` then `--apply` (secrets + production `.env`)
2. `npm run go-live:validate-env` with `NODE_ENV=production`
3. `npm run db:migrate`
4. `npm run go-live:password` with `NEW_ADMIN_PASSWORD`
5. Import live CSVs: `npm run go-live:import` (see `data/live-import/`)
6. PDF sign-off: [PDF-SIGNOFF-CHECKLIST.md](./PDF-SIGNOFF-CHECKLIST.md)
7. `npm run go-live:backup-drill`
8. `npm run production:gate`
9. In app: **Settings → Go-live** checklist all green

## Security defaults (implemented)

- **bcrypt rounds:** 12 (`BCRYPT_ROUNDS`)
- **Legacy `/api/*`:** Returns HTTP 410 in production unless `ENABLE_LEGACY_API=true`
- **Protected ops routes:** bootstrap, email trigger, AI insight require `INTERNAL_API_KEY` header `x-internal-api-key`
- **M-Pesa callback:** Requires `MPESA_CALLBACK_SECRET` in production
- **Rate limits:** 100 req/min API, 20 auth attempts / 15 min
- **Account lockout:** 5 failed logins → 30 min lock (v1 auth)

## Real-time behaviour

WebSockets are not implemented. The app uses:

- **30s polling** on dashboard KPIs
- **20s polling** on sales, invoices, delivery lists

## Validation

- KRA PIN format enforced on customer/vendor master data (API + UI)
- Kenya phone format validated on customer save (UI)
- Credit limit enforced when creating sales orders (not only on confirm)

## Password reset

- `POST /api/v1/auth/forgot-password` — always returns success message (no email enumeration)
- `POST /api/v1/auth/reset-password` — `{ token, password }`
- Reset link: `{APP_BASE_URL}/login?reset={token}` (24h default)

## Remember me

Login with `remember_me: true` extends refresh token to 30 days (`JWT_REFRESH_REMEMBER_DAYS`).

## Still required before full production sign-off

| Area | Status |
|------|--------|
| Live eTIMS / M-Pesa (not stubs) | Configure env + real HTTP |
| WebSocket live updates | Optional — polling in place |
| Credit notes / returns / quotations UI | Schema exists; UI pending |
| Bank reconciliation | Partial |
| Load testing (50 users, 10k rows) | Run externally |
| Backup restore drill | Ops task |
| SSL / CDN / monitoring | Infra task |

## Smoke test (staging)

1. Sign in → dashboard loads KPIs (refresh after 30s).
2. Create customer with valid KRA PIN → save.
3. Create sales order → confirm → delivery → invoice → payment.
4. PO → GRN → vendor bill from GRN → post → pay.
5. Payroll run for current month.
6. Export report CSV/XLSX.

## Tests

```bash
cd backend
npm test
npm run test:e2e:critical
```
