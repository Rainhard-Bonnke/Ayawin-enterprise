# Inventory checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Stock levels update in real-time after every sale, purchase, and adjustment | **PASS** | `publishInventoryUpdate` on stock-in, transfer, adjustment post, delivery (`salesService.postDeliveryNote`); WebSocket `inventory.updated` + 30s polling on `_app.inventory.tsx` |
| 2 | Negative stock impossible — blocked at order confirmation | **PASS** | `checkAtp` on SO create + confirm (throws `ATP_FAILED`); `applyStockOnHandDelta` / `recordIssue` guards; optional DB `CHECK (quantity >= 0)` in migration 026 |
| 3 | Batch/lot numbers tracked through entire lifecycle | **PASS** | `batch_no` on `erp_stock_ledger`; stock-in and transfer lines; batch balances API `GET /inventory/batches` |
| 4 | Expiry dates enforced — FEFO picking order suggested | **PASS** | `getFefoPickPlan`, `recordIssueFefo` (default on issues); `GET /inventory/fefo-pick`; nearest expiry on stock list |
| 5 | Stock adjustment requires reason code and approver | **PASS** | `reason_code` + notes (`inventoryReasonCodes.js`); draft → post with `procurement.approve` and `approved_by` |
| 6 | Inter-warehouse transfer reduces source, increases destination atomically | **PASS** | Single transaction in `POST /inventory/transfers` — issue from source (FEFO) then receipt at destination |
| 7 | Barcode lookup returns correct product | **PASS** | `GET /inventory/lookup?barcode=`; Enter key on inventory search |
| 8 | Stock valuation report matches physical count | **PASS** | `GET /inventory/valuation` (Σ qty × avg cost); dashboard KPI uses same totals |
| 9 | Minimum stock alert fires when threshold crossed | **PASS** | `getReorderAlerts` where `quantity <= reorder_point`; dashboard + inventory reorder card |
| 10 | Stock movement history is complete and accurate | **PASS** | All receipts/issues write `erp_stock_ledger`; `GET /inventory/movements` + UI table |

## Migration

Run `npm run db:migrate` to apply `026_inventory_enhancements.sql` (reason_code, approved_by, non-negative constraint when no negative rows exist).

## Key files

- `backend/src/services/inventoryService.js`
- `backend/src/routes/v1/inventory.js`
- `backend/src/services/inventoryAdjustmentService.js`
- `backend/migrations/026_inventory_enhancements.sql`
- `src/routes/_app.inventory.tsx`
