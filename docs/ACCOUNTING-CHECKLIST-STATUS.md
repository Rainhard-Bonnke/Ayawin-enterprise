# Accounting & Finance checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Every financial transaction posts a balanced journal entry (debits = credits) | **PASS** | `glPostingService.validateLinesBalanced` on create/post; `accountingService.verifyPostedJournalsBalanced`; month-end blocks unbalanced posted journals |
| 2 | Chart of accounts — all standard Kenya accounts present | **PASS** | `accountingService.KENYA_REQUIRED_ACCOUNTS` + `GET /finance/coa/kenya-status`; migration `028_accounting_kenya_coa.sql` (2300 excise, 2400 PAYE, 3100 retained earnings) |
| 3 | Trial balance balances to zero difference | **PASS** | `getTrialBalanceReport` returns `totals.difference` and `balanced`; month-end preview blocks if \|difference\| > 0.01 |
| 4 | P&L pulls correct income and expense accounts | **PASS** | `getProfitLossReport` — postable `income`/`expense` from `erp_gl_balances` |
| 5 | Balance sheet assets = liabilities + equity | **PASS** | `getBalanceSheetReport` — `signedBalance`, `totals.difference`, `balanced` flag |
| 6 | VAT report matches sum of all VAT-able invoices in period | **PASS** | `getVatReport` — invoice `tax_amount` vs GL account `2200`; variance + `matched` |
| 7 | Excise duty report matches KRA submission format | **PASS** | `getExciseReport` — `format: KRA_excise_return`, PIN, litres, rate/litre, line excise; GL `2300` reconcile |
| 8 | Bank reconciliation clears matched transactions | **PASS** | `bankReconService.matchStatementLine` sets `status = matched`; unmatched list excludes matched receipts/journals |
| 9 | Financial year close process works without corrupting data | **PASS** | `monthEndService.executeMonthEnd` — preview blockers (TB, drafts, unbalanced journals); `POST /fiscal-periods/:id/close` uses same path with re-auth |
| 10 | Multi-period reporting works correctly | **PASS** | `getMultiPeriodReport` — P&L and TB balance per period by fiscal year or period IDs |

## Key files

- `backend/src/services/accountingService.js`
- `backend/src/services/glPostingService.js`
- `backend/src/services/monthEndService.js`
- `backend/src/services/bankReconService.js`
- `backend/src/routes/v1/finance.js`
- `backend/migrations/028_accounting_kenya_coa.sql`
- `src/routes/_app.accounting.tsx`

## API (v1)

- `GET /finance/reports/trial-balance?fiscal_period_id=`
- `GET /finance/reports/profit-loss?fiscal_period_id=`
- `GET /finance/reports/balance-sheet?fiscal_period_id=`
- `GET /finance/reports/vat-return?from_date=&to_date=`
- `GET /finance/reports/excise-return?from_date=&to_date=`
- `GET /finance/reports/multi-period?fiscal_year_id=`
- `GET /finance/coa/kenya-status`
- `GET /finance/month-end/:periodId/preview`
- `POST /finance/month-end/:periodId/close`

## Tests

- `backend/test/gl.test.js`
- `backend/test/accounting.test.js`
- `backend/test/e2e/month-end-flow.test.js`
