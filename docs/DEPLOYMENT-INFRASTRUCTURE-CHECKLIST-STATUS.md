# Deployment & Infrastructure Checklist — Status

Last audit: run `npm run check:deployment-infra` from the repo root.

Legend: **PASS** = verified in repo or local tooling · **PARTIAL** = building blocks exist, operator must complete · **FAIL** = gap · **OPS** = production-only task (not automatable in git)

---

## Environment

| Check | Status | Evidence / action |
|-------|--------|-------------------|
| Production environment separate from development | **PASS** | `render.yaml` sets `NODE_ENV=production`; `docker-compose.yml` is dev-only (`ENABLE_DEMO_MODE=true`, dev JWT). Use separate Render services / DB from local Compose. |
| Environment variables set correctly in production | **PARTIAL** | `backend/scripts/validate-production-env.cjs`, `go-live-init.cjs --apply`. Run with production `.env` before deploy. |
| Debug mode OFF in production | **PASS** | `NODE_ENV=production` disables demo (`index.js`); `ENABLE_DEMO_MODE=false` enforced by validator. |
| Error logging to file/service (not console.log) | **PARTIAL** | `backend/src/lib/logger.js` — JSON to stderr; optional `LOG_FILE`. Wired in `index.js` + global error handler. Route handlers may still use `console.*`; point log drain at stderr in production. |
| Application monitoring active (uptime every 5 min) | **OPS** | Endpoints ready: `GET /health`, `GET /health/db`. Configure [UptimeRobot](https://uptimerobot.com) or Pingdom — see [DEPLOYMENT-MONITORING.md](./DEPLOYMENT-MONITORING.md). |

---

## Backup & recovery

| Check | Status | Evidence / action |
|-------|--------|-------------------|
| Automated daily database backup verified working | **PARTIAL** | `npm run db:backup` (`backend/scripts/backup-db.cjs`). **Schedule externally** (cron / Task Scheduler). |
| Backup stored offsite (S3 or equivalent) | **OPS** | Copy `backend/backups/*.sql` to S3/Azure — [DEPLOYMENT-OFFSITE-BACKUP.md](./DEPLOYMENT-OFFSITE-BACKUP.md). |
| Recovery drill completed — restored from backup | **PARTIAL** | `npm run go-live:backup-drill` and `npm run go-live:backup-drill -- --restore-test`. Run quarterly in staging/prod clone. |
| RTO tested: system back up in &lt; 1 hour from backup | **OPS** | Time a full restore with `restore-db.cjs` + migrate + health checks; document result. |

---

## Deployment

| Check | Status | Evidence / action |
|-------|--------|-------------------|
| Zero-downtime deployment documented and tested | **PARTIAL** | [DEPLOYMENT-ZERO-DOWNTIME-ROLLBACK.md](./DEPLOYMENT-ZERO-DOWNTIME-ROLLBACK.md) (Render rolling deploy). Not blue/green in repo. |
| Rollback procedure documented and tested | **PARTIAL** | Restore from backup + previous image tag — same doc + [OPERATOR-GO-LIVE.md](./OPERATOR-GO-LIVE.md). |
| SSL certificate valid and auto-renews | **OPS** | TLS at Render edge or nginx/Caddy per [PRODUCTION-NETWORK.md](./PRODUCTION-NETWORK.md). App enforces HTTPS via `enforceHttps`. |
| Domain configured correctly | **OPS** | Set `CORS_ORIGINS`, `APP_BASE_URL`, `VITE_API_BASE`. |
| CDN configured for static assets | **PARTIAL** | Render static site hosts `dist/`; dedicated CDN (Cloudflare) is operator choice. |
| Logs rotating — no disk space exhaustion | **OPS** | Use host log rotation or SaaS aggregation; `.gitignore` ignores `logs/` and `*.log`. |

---

## Scalability baseline

| Check | Status | Evidence / action |
|-------|--------|-------------------|
| Database can handle 1 million records without reconfiguration | **PARTIAL** | Indexes (`031`, `032`), pooling, partitioned `erp_audit_log`, perf seed (`db:seed:perf`). **1M-row load test not committed** — run on staging before go-live. |
| File storage (invoices, PDFs) on cloud storage, not local disk | **FAIL** | PDFs generated on the fly; POD uploads stored as **base64 in PostgreSQL**. Plan S3/MinIO for blobs. |
| App server horizontally scaled if needed | **FAIL** | Single-process WebSockets (`wsServer.js`); multiple instances need Redis pub/sub + sticky sessions. |

---

## Commands

```bash
# Static repo audit (fails on missing runbooks / backup gitignore / logging gap)
npm run check:deployment-infra

# With API running locally
npm run check:deployment-infra -- --live-health

# Prove backup works on this machine (needs pg_dump + DB)
cd backend && npm run go-live:backup-drill
npm run go-live:backup-drill -- --restore-test
```

---

## Verdict

| Area | Ready for production? |
|------|------------------------|
| Environment separation & secrets | Yes, with `go-live:validate-env` |
| Backup scripts | Yes — **scheduling + offsite = operator** |
| Deploy runbooks | Yes |
| Observability & logging | **No** — configure monitoring; replace console logging |
| CDN / SSL / domain | **Operator** |
| Scale to 1M rows / multi-instance / cloud files | **Plan before scale-out** |

**Overall: PARTIAL** — safe to deploy on Render with operator checklist; not all infrastructure boxes are checked until monitoring, offsite backups, and logging are live.
