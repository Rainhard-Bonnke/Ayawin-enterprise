# Security Audit Checklist — Status

Last verified: `cd backend && npm run db:migrate && npm run test:security`

## Authentication & authorization

| Check | Status | Evidence |
|-------|--------|----------|
| All API data endpoints require valid JWT | **PASS** | `authenticateErp` on `/api/v1/*` (public auth routes only: login, refresh, password reset) |
| Role permissions enforced on server | **PASS** | `requirePermission()`; `test/security/rbac-endpoints.test.js` |
| Horizontal privilege escalation blocked | **PASS** | `company_id` scoping; `test/security/horizontal-access.test.js` |
| Admin-only → **403** not 404 | **PASS** | Missing permission returns `403 Forbidden` |
| Tokens invalid after logout | **PASS** | JWT blacklist + refresh revoke; logout test in `rbac-endpoints.test.js` |

## Input security

| Check | Status | Evidence |
|-------|--------|----------|
| SQL injection mitigated | **PASS** | Parameterized queries throughout |
| XSS mitigated | **PASS** | React escaping; no user HTML rendering |
| File uploads validated | **PASS** | Type whitelist, 2MB cap, **magic-byte** check; optional **ClamAV** (`CLAMAV_ENABLED`, `CLAMAV_HOST`) |
| API rate limiting | **PASS** | 100/min (`RATE_LIMIT_MAX`), auth 20/15min |
| CSRF | **PASS** | Bearer JWT SPA — see [SECURITY-CSRF.md](SECURITY-CSRF.md); `sameOriginMutations` for cookie auth |

## Data security

| Check | Status | Evidence |
|-------|--------|----------|
| Passwords bcrypt ≥ 12 | **PASS** | `BCRYPT_ROUNDS` default 12 |
| Sensitive data encrypted at rest | **PASS** | KRA PIN/phone (`piiCrypto`); **salaries** `*_salary_enc` columns (`034` migration, `encrypt:salaries` script) |
| HTTPS enforced | **PASS** | `enforceHttps` when `NODE_ENV=production` |
| Security headers | **PASS** | Helmet: CSP, HSTS (prod), frame deny |
| Database not public | **PASS** | Ops: [PRODUCTION-NETWORK.md](PRODUCTION-NETWORK.md); `go-live:validate-env` checks private DB host |
| Secrets in env | **PASS** | No hardcoded production secrets |
| `.env` not in git | **PASS** | `.gitignore` |

## Audit & compliance

| Check | Status | Evidence |
|-------|--------|----------|
| Change audit (who/what/when/before/after) | **PASS** | `auditService.logAudit` |
| Audit log read-only | **PASS** | No write API; DB trigger `033_audit_log_immutable.sql` |
| Failed logins logged with IP | **PASS** | `login_failed` audit action |
| Sensitive actions need re-auth | **PASS** | `X-Reauth-Password`: month-end, payroll post, user deactivate |

## Dev parity with production

| Check | Status | Evidence |
|-------|--------|----------|
| Legacy API disabled in dev | **PASS** | `dev:all` sets `DISABLE_LEGACY_API=true`; `.env.example` default `true` |

## Operator commands

```bash
cd backend
npm run db:migrate
npm run test:security

# After setting PII_ENCRYPTION_KEY in production:
npm run encrypt:salaries

# Production env + network checks:
npm run go-live:validate-env
```

Optional ClamAV for POD photos:

```env
CLAMAV_ENABLED=true
CLAMAV_HOST=127.0.0.1
```

## Verdict

**PASS** — application and documented operator controls cover the full security checklist.
