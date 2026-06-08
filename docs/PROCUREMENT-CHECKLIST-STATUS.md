# Procurement checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | PO raises against correct supplier | **PASS** | `vendor_id` FK + `assertVendorForPo` (active vendor, same company) on `createPurchaseOrder` |
| 2 | PO approval enforces limits (>KES 100K needs MD) | **PASS** | `PO_MD_THRESHOLD` (env `PO_MD_APPROVAL_THRESHOLD`); `pending_md_approval` → MD role/`procurement.md_approve`; E2E `md-po-approval.test.js` |
| 3 | GRN links to PO and updates stock on save | **PASS** | `erp_goods_receipts.purchase_order_id`; `createAndPostGrn` / `postGoodsReceipt` → `recordReceipt` + inventory WebSocket |
| 4 | Partial delivery — PO stays open until fully received | **PASS** | `qty_received` per line; PO status `partial` until all lines received; partial GRN lines supported |
| 5 | Supplier invoice matches GRN before payment (3-way match) | **PASS** | `createVendorBillFromGrn` compares PO/GRN/bill; `postVendorBill` blocks `failed`; payment requires posted bill + GRN link |
| 6 | Landed cost allocation works | **PASS** | `landed_cost_total` on GRN; `allocateLandedCost` spreads freight/duty into receipt unit costs |
| 7 | PO cannot be edited after approval without re-approval | **PASS** | `PATCH /procurement/purchase-orders/:id` resets approved POs to `draft`, clears MD approval, increments `revision_no`; blocks line edits after receipt |
| 8 | Supplier balance updates on invoice posting | **PASS** | `erp_vendors.ap_balance` += bill total on `postVendorBill`; -= payment on `recordVendorPayment` |

## Migration

`027_procurement_ap_enhancements.sql` — `ap_balance`, `landed_cost_total`, PO amendment columns.

```powershell
cd backend; npm run db:migrate
```

## Key files

- `backend/src/services/procurementService.js`
- `backend/src/services/apService.js`
- `backend/src/routes/v1/procurement.js`
- `backend/src/routes/v1/finance.js` (vendor bills)
- `src/routes/_app.procurement.tsx`
- `src/routes/_app.accounts-payable.tsx`
