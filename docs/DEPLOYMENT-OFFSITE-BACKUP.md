# Offsite database backup

## Daily backup (on server or CI runner)

```bash
cd backend
npm run db:backup
```

Output: `backend/backups/ayawin-enterprise-<timestamp>.sql` (override with `BACKUP_DIR`).

## Copy to S3 (example — adjust bucket/region)

**Linux / macOS (AWS CLI):**

```bash
export BACKUP_DIR=/var/backups/martin-enterprise
cd backend && npm run db:backup
LATEST=$(ls -t "$BACKUP_DIR"/*.sql | head -1)
aws s3 cp "$LATEST" "s3://YOUR-BUCKET/martin-enterprise/db/$(basename "$LATEST)" \
  --storage-class STANDARD_IA
```

**Windows (after backup):**

```powershell
cd backend
npm run db:backup
$latest = Get-ChildItem .\backups\*.sql | Sort-Object LastWriteTime -Descending | Select-Object -First 1
aws s3 cp $latest.FullName "s3://YOUR-BUCKET/martin-enterprise/db/$($latest.Name)"
```

## Retention

- Keep **30 days** minimum on offsite storage (lifecycle rule on the bucket prefix).
- Keep **7 daily** + **4 weekly** on the app server if disk allows.

## Verify

Monthly: download one object from S3 and run:

```bash
npm run go-live:backup-drill -- --restore-test
```

(on a **non-production** database host)

Record RTO (time from `db:restore` start to `/health/db` OK). Target: **under 1 hour** for full ERP restore.
