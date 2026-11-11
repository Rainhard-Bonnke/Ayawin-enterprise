# Deployment Architecture Decision

Status: recommended production target selected; production provisioning remains gated on domain, provider credentials, and operational approvals.

## Decision

Use Render for the application services, with the TanStack Start frontend deployed as a Node web service running the Nitro server output. Run the Express ERP API as a separate Node web service, with managed PostgreSQL and Redis. Use a single registrable custom domain for the app and API, such as `app.example.com` and `api.example.com`, so browser requests remain same-site while the API allows the exact app origin through `CORS_ORIGIN`.

The frontend build is server-rendered and emits `.output/server/index.mjs`; a static-site deployment of `.output/public` cannot serve the full application runtime. The current Render blueprint is therefore changed to the Node server output.

## Service boundaries

- Frontend: Node web service; build with `npm ci && npm run build`; start with `node .output/server/index.mjs`.
- ERP API: separate Node web service using `backend/Dockerfile` or `npm start` from `backend/`.
- Database: managed PostgreSQL, private to the API service; use automated backups and point-in-time recovery appropriate to the business RPO/RTO.
- Cache/queues: managed Redis, private to the API and worker services.
- Workers: deploy the eTIMS, M-Pesa, notifications, and report workers separately from the API web process; do not enable live provider credentials until the applicable go-live approvals are complete.

## Required configuration

- Set `VITE_API_BASE` to the HTTPS API origin at frontend build time and `VITE_USE_API_V1=true`.
- Set backend `CORS_ORIGIN` to the exact HTTPS frontend origin; never use `*` with credentialed requests.
- Configure secure cookies, HTTPS, trusted proxy hops, and secrets independently in each environment.
- Keep PostgreSQL and Redis off the public internet. Restrict administrative access and rotate service credentials.
- Configure health checks, alerts, backups, restore drills, log retention, and rollback procedures before production traffic.
- Use separate preview/staging/production databases, API secrets, encryption keys, and provider credentials.

## Release gates

- Verify login, refresh, CSRF, logout, and receipt/download flows through the deployed app and API origins.
- Run CI tests and the role-based UAT scripts in `docs/UAT/` against staging.
- Complete provider certification and finance/security sign-off as listed in `backend/docs/integrations/GO-LIVE.md`.
- Confirm recovery objectives, backup restoration, incident ownership, and production monitoring with the operator.

This decision does not certify external provider integrations or authorize live statutory or payment submissions.
