# Module 1: Foundation & Auth

## Overview

Production multi-tenant foundation for Martin Enterprise ERP. New tables use the `erp_` prefix and UUID primary keys. Legacy tables (`users`, `products`, etc.) remain for existing screens until each module is migrated.

## Database

Run migrations:

```bash
cd backend
npm run db:migrate
```

Migrations live in `backend/migrations/`:

| File | Purpose |
|------|---------|
| `001_foundation.sql` | Companies, branches, RBAC, users, MFA, settings, audit log |
| `002_seed_foundation.sql` | Demo company, roles, admin user, permissions |

### Standard columns (all `erp_*` business tables)

- `id` UUID
- `company_id` UUID (except global reference tables)
- `created_at`, `updated_at`, `created_by`, `updated_by`
- `is_deleted` soft delete

## API base URL

`/api/v1`

OpenAPI UI: `http://localhost:4000/api/docs`

## Authentication

### Login

`POST /api/v1/auth/login`

```json
{
  "email": "admin@martin.co.ke",
  "password": "demo",
  "company_code": "MARTIN",
  "mfa_token": "123456"
}
```

Response:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "user": { "permissions": ["foundation.view", "..."] }
}
```

### Refresh

`POST /api/v1/auth/refresh` with `{ "refresh_token": "..." }`

### MFA setup

1. `POST /api/v1/auth/mfa/setup` (Bearer access token)
2. Scan `otpauth_url` in authenticator app
3. `POST /api/v1/auth/mfa/verify` with `{ "token": "123456" }`

## RBAC

Permissions are seeded per module action: `view`, `create`, `edit`, `delete`, `approve`, `export`.

- `GET /api/v1/roles/permissions` — all permission definitions
- `GET /api/v1/roles` — company roles with permission codes
- `POST /api/v1/roles` — create role
- `PUT /api/v1/roles/:id/permissions` — replace role permissions

## Other endpoints

| Method | Path | Permission |
|--------|------|------------|
| GET | `/companies/current` | foundation.view |
| PATCH | `/companies/current` | foundation.edit |
| GET | `/companies/branches` | foundation.view |
| POST | `/companies/branches` | foundation.edit |
| GET | `/currencies` | foundation.view |
| GET/POST | `/currencies/exchange-rates` | view / edit |
| GET/POST | `/users` | users.view / create |
| GET/PUT | `/settings/:category/:key` | foundation.view / edit |
| GET | `/audit` | audit.view |
| PATCH | `/auth/profile` | authenticated (self-service) |

## Default credentials

After seed + `ENABLE_DEMO_MODE=true`:

- Email: `admin@martin.co.ke`
- Password: `demo`
- Company code: `MARTIN`

## Audit trail

All create/update/login/MFA actions write to `erp_audit_log` (partitioned by year).

## Not yet in Module 1 (planned)

- OAuth2/SAML callback routes (stubs in env)
- Approval workflow engine (Module 8 / cross-cutting)
- GDPR export/erasure jobs
- Full IP CIDR matching (basic prefix check today)
