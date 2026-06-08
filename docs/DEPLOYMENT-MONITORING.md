# Production monitoring (operator setup)

The API exposes health endpoints; **uptime checks and APM are not bundled in the repo**.

## Uptime (every 5 minutes)

Create two HTTP monitors:

| Monitor | URL | Interval | Alert if |
|---------|-----|----------|----------|
| API liveness | `https://api.<your-domain>/health` | 5 min | non-200 or timeout &gt; 30s |
| Database | `https://api.<your-domain>/health/db` | 5 min | status 503 |

Suggested tools: UptimeRobot, Pingdom, Better Stack, or your cloud provider’s synthetic checks.

Local verification:

```bash
npm run check:deployment-infra -- --live-health
# or: API_BASE=https://api.example.com npm run check:deployment-infra -- --live-health
```

## Error tracking

Until structured logging ships in-app:

1. Attach **Render log stream** or **Datadog Agent** to container stdout/stderr.
2. Add **Sentry** (or similar) for unhandled exceptions — wrap Express error handler in a follow-up change.

## Alerts (minimum)

- `/health/db` down → page on-call immediately.
- `/health` down → page on-call.
- Disk &gt; 85% on database host → warning.
- Backup job missed 24h → warning (see [DEPLOYMENT-OFFSITE-BACKUP.md](./DEPLOYMENT-OFFSITE-BACKUP.md)).
