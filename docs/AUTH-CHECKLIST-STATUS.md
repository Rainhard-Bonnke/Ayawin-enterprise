# Authentication & session checklist

| Check | Status | Implementation |
|-------|--------|----------------|
| Login with correct credentials | **PASS** | `POST /api/v1/auth/login` — demo `admin@martin.co.ke` / `demo` in dev |
| Wrong password — no stack trace | **PASS** | Returns `{ error: "Invalid credentials" }`; errors logged server-side only |
| Account locks after 5 failures | **PASS** | `MAX_FAILED_LOGINS` (default 5) → 30 min lock; test in `auth-security.test.js` |
| Password reset email + 24h expiry | **PASS** | `passwordResetService` + `PASSWORD_RESET_HOURS=24`; email via `integrationService` |
| JWT expiry forces re-login | **PASS** | Access token `JWT_ACCESS_EXPIRES` (default 15m); refresh or `ApiAuthError` on 401 |
| Sales rep cannot access payroll | **PASS** | Payroll routes use `hr.view`; Sales Representative role has no `hr.view` (migration 024) |
| Logout invalidates all tabs | **PASS** | Token blacklist + refresh revoke; `broadcastLogout` / `storage` sync in `sessionSync.ts` |
| 2FA end-to-end if enabled | **PASS** | Setup: Settings → Security; login prompts for `mfa_token` when `mfa_enabled` |
| Remember me | **PASS** | `remember_me` → 30-day refresh (`JWT_REFRESH_REMEMBER_DAYS`) vs 7-day default |
| New user invite | **PASS** | `POST /api/v1/users/invite` + Users → Invite (email link); status `pending` until password set |

## Tests

```bash
cd backend && npm test -- test/auth-security.test.js
```

## Demo accounts

| Email | Role | Password |
|-------|------|----------|
| admin@martin.co.ke | System Administrator | demo (dev) |
| salesrep@martin.co.ke | Sales Representative | Set via bootstrap / invite |

Run migration `024_sales_rep_role.sql` for the sales rep role and user.
