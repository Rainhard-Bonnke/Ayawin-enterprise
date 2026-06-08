# Production network hardening

## PostgreSQL

- Bind the database to a **private address** only (`listen_addresses` on localhost or internal VPC).
- Security groups / firewall: allow port **5432** only from the application server subnet.
- Do not expose Postgres to `0.0.0.0/0` on the public internet.
- Use `DATABASE_URL` or `DATABASE_HOST` pointing at the private hostname (e.g. `db.internal`, RDS private endpoint).

Validate before go-live:

```bash
cd backend
npm run go-live:validate-env
```

## Application server

- Terminate **TLS** at the load balancer or reverse proxy (nginx, Caddy, Azure App Gateway).
- The Node app enforces HTTPS redirect when `NODE_ENV=production` (`enforceHttps` middleware).
- Set `CORS_ORIGINS` to your production frontend origin(s) only.

## Antivirus (optional)

For proof-of-delivery photo uploads, enable ClamAV on the app host or sidecar:

```env
CLAMAV_ENABLED=true
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
```

Without ClamAV, uploads still require allowed image types, magic-byte verification, and a 2MB size cap.
