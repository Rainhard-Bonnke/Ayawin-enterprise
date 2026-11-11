# Phase 10 — Production Readiness

Status: baseline established; production go-live is still gated on provider certification, security review, and signed operational approvals.

## 1) Infrastructure as Code

### Required configuration

- Separate staging and production deployments, each with distinct secrets and provider credentials.
- Private PostgreSQL and Redis only; no public database endpoints.
- HTTPS everywhere, HSTS on the frontend, and a strict CSP.
- Separate API, frontend, and workers with independent health checks.
- Managed object storage for documents and backups, scoped to the production environment.

### Repo baseline

- The Render blueprint in [render.yaml](../render.yaml) now defines:
  - API web service
  - frontend web service
  - eTIMS worker
  - M-Pesa worker
  - notification worker
  - report worker
  - managed Postgres
  - managed Redis
  - non-repo secret wiring for cloud credentials and KRA/Daraja values

### Operational note

- Secrets must remain in the platform secret store; they are intentionally not committed to the repository.
- Provider credentials for KRA and Safaricom must be separated by environment and rotated on schedule.

## 2) Observability

### Required controls

- Structured JSON logs with trace/request IDs and redaction of secret material, full phone numbers, and personal data fields.
- Metrics on API latency, 4xx/5xx rate, DB latency, queue depth, queue age, worker heartbeat, and backup age.
- Health checks and uptime verification on `/ready`.
- Alerting for API errors, readines failures, backlog, pending eTIMS/Safaricom requests, backup age, and saturation.

### Administrative status surface

- A status page should aggregate integration status, queue sizes, and worker liveness by environment.
- This should be treated as a production operating artifact, not a demo-only screen.

## 3) Performance and Resilience

### Required validation

- Run realistic load tests for POS, posting, stock-on-hand, ageing, trial balance, and payroll flows.
- Document 95th percentile targets and confirm the live system meets them.
- Validate failure scenarios for:
  - mid-post database outage
  - worker crash while submitting to KRA or Safaricom
  - Redis outage leading to graceful degradation

### Business target baseline

- POS and posting calls: p95 under 500 ms on a representative production-like workload.
- Critical stock and financial summary calls: p95 under 1 s for standard report loads.
- Queue worker latency and backlog alert thresholds must be agreed before go-live.

## 4) Security Review

### Required checks before production

- Dependency scanning in CI.
- Secret scanning and image scanning.
- Authorization matrix for every route and role.
- Rate-limit and lockout tests.
- OWASP ASVS L2 review for the critical web and API surfaces.
- Proof that no admin path can be obtained without valid credentials.
- Proof of tenant isolation and no cross-company data access.
- No secrets in logs, no full phone numbers in logs, no raw sensitive data in error output.

### Data protection obligations

- Confirm the privacy notice and consent language for employee, customer, and supplier data.
- Publish the data-subject request process.
- Keep a breach escalation and notification procedure.
- Maintain a record of processing activities and confirm whether registration with the Data Commissioner is required for the operating jurisdiction and business model.

## 5) Disaster Recovery

### Recovery objectives

- Define RTO and RPO before production activation.
- Test a full restore drill from the latest backup into a fresh environment.
- Validate rollback and failover runbooks for:
  - database failure
  - region outage
  - leaked secret rotation
  - KRA or Safaricom outage
  - stuck outbox
  - bad deployment rollback

### Repo support

- The backup/restore instructions already exist in [docs/DR.md](./DR.md) and the project retains the restore scripts under the backend tooling.
- The operational readiness status is exposed via the authenticated platform status endpoint at `/api/v1/platform/status` and can be used for the admin status page and alerting baseline.
- CI gate automation is available in [backend/scripts/phase10-ci.cjs](../backend/scripts/phase10-ci.cjs) and the `ci:phase10` script in the repo package manifests.
- The operational readiness status is exposed via the authenticated platform status endpoint at `/api/v1/platform/status` and can be used for the admin status page and alerting baseline.
- CI gate automation is available in [backend/scripts/phase10-ci.cjs](../backend/scripts/phase10-ci.cjs) and the `ci:phase10` script in the repo package manifests.

## 6) UAT and Cutover

### Required artifacts

- Role-based UAT scripts under [docs/UAT](./UAT/).
- Sign-off sheets for admin, accounts, stores, sales, HR, and management.
- Parallel month-end reconciliation against the old process for at least one cycle.
- Open-to-close reconciliation for stock, receivables, payables, VAT, and payroll.

### Cutover controls

- Freeze date and opening balance import governance.
- Stock count at cutover.
- Supplier/customer balance confirmation and approval.
- Provider switch only after certification and approvals.
- Rollback criteria, owner, and on-call contact defined before go-live.

## 7) CI Gates for Production

Before merge or deploy, the following must pass in CI:

- TypeScript build
- lint
- backend unit and e2e tests against a clean migrated database
- frontend unit and Playwright tests
- npm audit with no high findings
- Docker build
- secret scan
- migration dry run against a staging replica

## 8) Go-Live Checklist

All items must be true before production activation:

- KRA certification complete and production credentials stored in the secret manager
- Safaricom production shortcode live and approved
- Accountant sign-off on VAT3, WHT, payroll files, and period close
- Restore drill passed and recorded
- Load and security review closed
- UAT signed by stakeholders
- Training complete for each role
- On-call and rollback plan agreed

## Implementation status

### Complete in repo

- Render deployment blueprint refined
- production guidance documented
- DR and UAT assets remain in the repo
- backup/restore and platform readiness runbooks already exist

### Still operationally required before production

- final provider certificates and production credentials
- security findings closeout
- load test evidence and p95 validation
- sign-off from finance, operations, and management
- restore drill execution and recorded results

This is a production-readiness baseline, not a full production certification. The final go-live decision remains an operational authorization, not a code-only decision.
