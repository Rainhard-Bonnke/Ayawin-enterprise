# Integration & end-to-end flow checklist

Five business flows are automated in `backend/test/e2e/integration-flows.test.js`.

## Command

```bash
cd backend
npm run test:e2e:integration
```

Included in `npm run production:gate` after critical E2E tests.

## Flow coverage

### FLOW 1: Full sale cycle

| Step | Covered |
|------|---------|
| New customer | `createTestCustomer` |
| Credit check | `sales.checkCreditLimit` |
| Sales order → confirm | `createSalesOrder` / `confirmSalesOrder` |
| Delivery + driver dispatch | `createAndPostDelivery` + `logistics_status = delivered` |
| Invoice + GL | `createCustomerInvoice` + `journal_id` |
| Payment + receipt + GL | `recordCustomerPayment` + receipt journal |
| AR balance | `crm.getCustomerArBalance` |
| Dashboard KPI | `getDashboardSummary` revenue MTD |

### FLOW 2: Full procurement cycle

| Step | Covered |
|------|---------|
| Low stock alert | `getReorderAlerts` after qty ≤ reorder point |
| Draft PO → approved → sent | `createPurchaseOrder` / `approvePurchaseOrder` / `sendPurchaseOrderToSupplier` |
| GRN + stock | `createAndPostGrn` |
| Supplier invoice + AP | `createVendorBillFromGrn` / `postVendorBill` |
| Payment + AP balance | `recordVendorPayment` |
| Ledger (AP GL) | account `2100` balance read |

### FLOW 3: Full payroll cycle

| Step | Covered |
|------|---------|
| Attendance / leave | row counts on `erp_attendance`, `erp_leave_balances` |
| Payroll computed | `runPayroll` (PR-2026-11) |
| Statutory deductions | PAYE + NHIF sums on payslips |
| Manager approval | `approvePayrollRun` |
| Payslips + bank file | `buildPayrollBankExport` + `renderPayslipPdf` |
| Journal + P&L expense | `postPayrollToGl` + GL `6100` / `getProfitLossReport` |

### FLOW 4: Month-end close

| Step | Covered |
|------|---------|
| VAT / excise reports | `getVatReport` / `getExciseReport` |
| Bank reconciliation | `importStatementLines` + `getUnmatched` |
| Trial balance zero | `previewMonthEnd` |
| P&L & balance sheet | `getProfitLossReport` / `getBalanceSheetReport` |
| PDF export | `renderReportPdfBuffer` |

Skips period close execution if draft invoices exist (cancelled in test); does not force-close the period to keep dev DB usable.

### FLOW 5: Stock discrepancy resolution

| Step | Covered |
|------|---------|
| Physical vs system qty | adjustment `quantity_delta` |
| Reason recorded | `CYCLE_COUNT` + reason text |
| Approval + post | `postStockAdjustment` with `approverId` |
| Stock + valuation | on-hand qty + `getStockValuation` |
| Audit trail | `erp_audit_log` create + post actions |

## New service APIs

- `procurement.sendPurchaseOrderToSupplier`
- `payroll.approvePayrollRun`
- `payroll.buildPayrollBankExport` / `exportPayrollBankFile`
- Stock adjustment audit via `logAudit` on create/post

## Manual / UI validation

Run `npm run dev:all` and walk the same flows in the UI for operator sign-off. Service-layer tests do not replace browser testing.
