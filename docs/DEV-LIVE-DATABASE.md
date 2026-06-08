# Dev: real database (not fake UI data)

## Why it feels “fake”

The app can show **sample master data** (Martin Beverages, Coca-Cola SKUs, etc.) from **PostgreSQL seed migrations**. That is real data in your database, not browser mock JSON — but names look like a demo company.

**Writes only work when:**

1. Backend is running (`http://localhost:4000/health` → OK)
2. You signed in via **API v1** (JWT token, not `demo:` token)
3. Header badge shows **Live** or **Polling** (not “Demo / API off”)
4. You have **stock on hand** before selling (Inventory → Stock in, or run reset script below)

If `VITE_USE_API_V1=false` in a root `.env` file, the UI may fall back to old/mock paths — remove that line or set it to `true`.

## Clean database + working connection

From repo root (PowerShell):

```powershell
# 1. Ensure Postgres is running and backend/.env has DATABASE_* set
cd backend
npm run db:migrate

# 2. Wipe transactions, keep users/COA/master data, restore test stock
$env:CONFIRM_RESET_DEV="yes"
npm run dev:reset-db

# 3. Start frontend + backend
cd ..
npm run dev:all
```

Sign in: **admin@martin.co.ke** / **demo**

## Verify you are on the live API

| Check | Expected |
|--------|----------|
| `GET http://localhost:4000/health` | `{"status":"ok"}` |
| Header badge | Live or Polling |
| New customer in Master Data | Appears after refresh; survives browser reload |
| Inventory → Stock in | Quantity increases in DB |
| New invoice | Row in Invoices list; not only in a popup |

## Replace demo names with your company data

1. Edit `data/live-import/customers.csv`, `items.csv`, `vendors.csv`
2. `npm run go-live:import --prefix backend`

## KRA PIN when adding customers

Kenya KRA PIN is **11 characters** but not “any 11 characters”:

- Valid: **P051999999Z** (letter + 9 digits + letter)
- Invalid: **05199999999** (11 digits only)

On the customer form, use **Use sample** in dev or enter a PIN in that format.

## Common blockers

| Symptom | Cause | Fix |
|---------|--------|-----|
| “Sign in with API…” toast | Old `demo:` token | Log out, sign in again |
| 429 errors | Rate limit | Restart `dev:all` (limits raised in dev) |
| Can’t sell / ATP fails | Zero stock | Stock in or `dev:reset-db` |
| KRA “must be 11” with 11 typed | Wrong format (digits only) | Use P051999999Z pattern |
| Saves disappear on reload | Client-only demo create | Use live login + v1 API |
