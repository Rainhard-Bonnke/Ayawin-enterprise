# Zero-downtime deploy & rollback

## Render (blueprint in `render.yaml`)

Render performs **rolling deploys** for web services: new instances pass `healthCheckPath: /health` before traffic shifts. Expect brief overlap, not a hard outage.

### Deploy sequence

1. `npm run production:gate` on the release branch.
2. `npm run db:migrate` against production **before or during** deploy (backward-compatible migrations only).
3. Push / trigger Render deploy for **backend**, then **frontend** (update `VITE_API_BASE` if API URL changed).
4. Verify:
   - `GET https://api.<domain>/health` → `{ "status": "ok" }`
   - `GET https://api.<domain>/health/db` → `{ "status": "ok" }`
   - Login + one critical flow (sales list, dashboard).

### Zero-downtime constraints

- **Do not** run breaking migrations that remove columns while old code is still live.
- **WebSocket** clients may reconnect once during deploy; acceptable for current scale.
- Large restores or schema rebuilds are **not** zero-downtime — schedule maintenance windows.

## Rollback

### Application rollback (< 15 minutes)

1. In Render dashboard → **backend** service → **Deploys** → **Rollback** to last green deploy.
2. Rollback **frontend** static deploy if the release included UI changes.
3. Re-run health checks.

If the failure was caused by a **bad migration**, rolling back the app is not enough — restore the database (below).

### Database rollback (30–60 minutes)

1. Stop write traffic (maintenance banner or scale backend to 0).
2. Identify last good backup in offsite storage or `backend/backups/`.
3. Restore:

   ```bash
   cd backend
   npm run db:restore -- ./backups/<timestamp>.sql
   npm run db:migrate
   ```

4. Deploy the **known-good** application image (git tag).
5. Validate trial balance / dashboard / login.

Document actual RTO from your last drill in the ops log.

## VM / Docker (development stack)

`docker-compose.yml` is for **local development only**. Production VMs should use the same health checks and a process manager (systemd) that restarts on failure — not the dev Compose file as-is.
