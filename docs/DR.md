# Disaster Recovery and restore drill

This runbook covers database backup, restore, and operational recovery for the ERP platform.

## Backup

Use the project backup script to generate a SQL dump:

```bash
npm --prefix backend run db:backup
```

Backups are written under `backend/backups` by default. Store copies in a durable, encrypted object store or off-site storage immediately after creation.

## Restore

To restore a database from a backup:

```bash
npm --prefix backend run db:restore -- ./backups/ayawin-enterprise-<timestamp>.sql
```

Use this process only in a controlled environment and validate the restored state before reconnecting traffic.

## Recovery checklist

- Confirm the PostgreSQL client binaries are available.
- Verify that the target database name, host, and credentials match the active environment.
- Validate the restore using readiness and migration checks before releasing the application.
- Re-run migration status checks to ensure the restored environment is consistent.
- Confirm app secrets and admin bootstrap values are present if the database was rebuilt from scratch.

## Annual drill

Perform a documented restore drill at least once per year or before each major release:

1. Take a fresh backup.
2. Restore it to a staging instance.
3. Verify app startup, migration status, and critical flows.
4. Record the duration and any corrective actions in the release notes.

## Legacy database transition

Migration `091_remove_empty_legacy_schema.sql` drops the retired unprefixed schema only when every listed table is empty. It intentionally aborts if it finds any rows. For an existing installation with legacy data, take and verify a backup, map and reconcile each required record set into the ERP tables, verify balances and document counts, and only then rerun the locked migration job. Do not remove the guard or manually drop the tables to make deployment pass.

## CSV import drill

In staging, use the authenticated `/api/v1/platform/import` endpoint to import a small customer CSV, verify the import job and resulting rows are scoped to the authenticated company, then remove the drill records. The API ignores a client-supplied `company_id`; the company is derived from the verified access token. The cross-company read and import checks run in `backend/test/e2e/tenant-isolation.test.js`.

## Operational note

The project now refuses to start when the database is unavailable or migrations are unfinished. This reduces the risk of serving traffic against a partially initialized system.
