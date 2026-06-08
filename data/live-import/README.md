# Live master data import

Replace the sample rows below with your real customers, items, and vendors.

## Files

| File | Required columns |
|------|------------------|
| `customers.csv` | `customer_code`, `name`, `email`, `tax_id`, `credit_limit` |
| `items.csv` | `item_code`, `name`, `standard_cost` |
| `vendors.csv` | `vendor_code`, `name`, `email`, `tax_id`, `credit_limit` |
| `opening_stock.csv` | `warehouse_code`, `item_code`, `quantity`, `unit_cost` |

KRA PINs must match format `A000000000X` (validated on API save).

## Steps

1. Optional: purge demo transactions (keeps chart of accounts and users):

   ```powershell
   $env:CONFIRM_PURGE_DEMO="yes"
   cd backend
   npm run go-live:purge-demo
   ```

2. Edit the CSV files in this folder with live data.

3. Import master data and opening stock:

   ```powershell
   cd backend
   npm run go-live:import
   # or only stock: npm run go-live:import -- --only=opening_stock
   ```

4. Verify in **Master Data** and **Settings → Go-live** checklist.

Upserts use `customer_code` / `item_code` / `vendor_code` — existing demo codes are updated if the same code is reused.
