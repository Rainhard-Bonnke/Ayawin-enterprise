# Performance baseline and guardrails

This document records the operational performance baseline for the Ayawin Enterprise ERP stack after the Phase 8 backend hardening work.

## Guardrails

- PostgreSQL pool limit: 20 concurrent clients by default, adjustable via `PG_POOL_MAX`.
- Connection timeout: 5 seconds by default via `PG_CONNECTION_TIMEOUT_MS`.
- Idle timeout: 30 seconds by default via `PG_IDLE_TIMEOUT_MS`.
- Migration runner uses a PostgreSQL advisory lock to prevent concurrent migration attempts.
- Production deployments run `npm --prefix backend run db:migrate` as a separate locked job before API instances are rolled out.
- Startup refuses to accept a database or migration state that is not ready.
- PostgreSQL autovacuum remains enabled; `npm --prefix backend run db:maintain` refreshes planner statistics and vacuums only ERP tables with at least 50 estimated dead tuples, at least 15% dead rows, and at least 128 KiB total size.

## Key measurements to track

- `GET /ready` latency
- `GET /health/db` latency
- migration runtime per batch
- database transaction time for high-churn modules such as sales, procurement, and AP ledger posting
- Redis round-trip latency for token/session cache operations

## Baseline checklist

1. Measure the slowest query by module and log the median and p95 durations.
2. Validate migration time with a dry-run in staging before production rollout.
3. Confirm no migration or startup path exceeds 10 seconds under a normal load test.
4. Review session cache hit rates and connection pool saturation after major releases.
5. After bulk imports or large deletion/update batches, run `npm --prefix backend run db:maintain` and inspect the reported vacuum candidates.

## Recommended drill

Run the following before every release candidate:

```bash
node --check backend/src/migrate.js
node --check backend/src/index.js
npm --prefix backend test
```

Use the output as the deployment baseline and compare against the same metrics after the next release.
