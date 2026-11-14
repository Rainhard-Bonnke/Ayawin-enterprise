# Phase E — Finance and Accounting implementation checklist

This checklist reflects the current repo state as of 2026-11-13. It separates what is already implemented, what is partial, and what still needs to be built for the Phase E acceptance target.

## E1. General Ledger

Status: Partial

Implemented:
- General ledger workspace screen exists in [src/routes/_app.accounting.tsx](../src/routes/_app.accounting.tsx)
- Fiscal period close controls exist in [backend/src/services/financeCloseService.js](../backend/src/services/financeCloseService.js)
- GL balancing and period-close checks exist in the accounting workspace and close checklist
- VAT return workflows exist and are integrated into accounting

Still missing / not fully implemented:
- full chart-of-accounts admin hierarchy maintenance screen with lock/import workflow
- journal templates and recurring journal approval engine
- posting rules editor with audit trail
- journal attachments and ledger drill-down to source document
- branch/dimension filter UI for Phase B dimensions
- full account statement and ledger drill-through export

## E2. Cash and Bank

Status: Partial

Implemented:
- bank reconciliation exists in [src/routes/_app.bank-reconciliation.tsx](../src/routes/_app.bank-reconciliation.tsx)
- bank statement matching and reconciliation logic exists in backend services
- M-Pesa statement matching and reconciliation capability exists in e2e coverage and backend services

Still missing / not fully implemented:
- bank account and cash account management screens
- petty cash float, replenishment and count workflow
- bank-to-bank and branch-to-branch transfer approvals
- cheque register lifecycle (issued/received, post-dated, cleared, bounced)
- CSV statement import UX and auto-match rules for all cash/bank sources
- cash book and full cash account register

## E3. Accounts Payable and Receivable Completion

Status: Partial

Implemented:
- AP and AR pages exist in the app: [src/routes/_app.accounts-payable.tsx](../src/routes/_app.accounts-payable.tsx), [src/routes/_app.accounts-receivable.tsx](../src/routes/_app.accounts-receivable.tsx)
- supplier bill, payment, and AP aging logic exist in backend services and tests
- AR collections and invoice activity controls exist

Still missing / not fully implemented:
- three-way match queue with tolerances for PO, GRN, and supplier bill
- full payment batch approval and bank file generation
- prepayments and supplier advances
- supplier statement reconciliation and aged payable detail
- aged receivables as-of date and customer balance confirmation letters

## E4. Budget and Forecasting

Status: Partial

Implemented:
- budget forecast storage and read-only snapshot API exist in [backend/migrations/114_budget_forecast_lines.sql](../backend/migrations/114_budget_forecast_lines.sql) and [backend/src/services/budgetForecastService.js](../backend/src/services/budgetForecastService.js)

Still missing:
- budget version lifecycle, authoring, approval and lines by account/branch/cost centre/period
- Excel import and copy-from-actuals
- commitment tracking and configured control thresholds
- actuals sourced from posted GL, seasonal forecast engine and 13-week cash-flow forecast
- full budget-versus-actual and variance reporting

## E5. Fixed Assets

Status: Partial

Implemented:
- asset register and depreciation route exist: [src/routes/_app.assets.tsx](../src/routes/_app.assets.tsx), [src/routes/_app.depreciation.tsx](../src/routes/_app.depreciation.tsx)
- basic asset metadata and depreciation output exist

Still missing / not fully implemented:
- full asset categories with tax and book depreciation policy
- acquisition approvals and capitalisation threshold workflow
- transfer by branch/custodian, maintenance log and verification
- tax depreciation schedule and asset-to-GL reconciliation
- disposal and write-off posting journals (current disposal records gain/loss impact but does not post it)
- reversal workflow for a posted depreciation run
- branch and custodian dimensions
- delete guard for assets with postings

Implemented since the initial audit:
- monthly depreciation runs require an exact matching open fiscal period and use accumulated depreciation from prior posted run lines
- a run stores per-asset lines and creates a balanced posted GL journal atomically; posting requires `finance.approve`
- depreciation run totals are capped at each asset's depreciable basis and account for acquisition month
- depreciation run posting and close blockers have database-backed regression tests

## E6. Tax Management

Status: Partial

Implemented:
- VAT return generation and lock workflow exists in [backend/src/services/vatReturnService.js](../backend/src/services/vatReturnService.js)
- tax settings screen exists in [src/routes/_app.settings.tsx](../src/routes/_app.settings.tsx)
- VAT return APIs exist in [backend/src/routes/v1/tax.js](../backend/src/routes/v1/tax.js)

Still missing / not fully implemented:
- withholding tax engine on supplier payments and certificates
- WHT payable tracking until remittance
- customer withholding certificate matching against AR
- tax calendar and due-date reminders
- eTIMS reconciliation workflow beyond the current invoice/outbox flow
- excise duty implementation (requires product decision from the user)
- corporate tax schedule and accounting-to-taxable profit bridge

## E7. Expenses Management

Status: Partial

Implemented since the initial audit:
- persistent company-scoped categories, budgets, expense claims and multi-line claim details
- claim submission requires a linked active employee, validates category, currency, dates, positive amounts and configured per-claim limits, and writes an audit event transactionally
- the screen submits a claim and displays live company data without sample claims or fabricated budgets

Still missing:
- independent multi-step approval and rejection workflow
- receipt attachment capture and required-receipt enforcement at approval
- mileage and per-diem calculations/policies
- reimbursement by bank payment or payroll with reconciliation
- recurring/direct expenses and petty cash linkage
- cost-centre allocation policies and budget check at submission
- category and budget administration UI, including budget authoring and approval

## E8. Financial Reporting

Status: Partial

Implemented:
- accounting workspace and P&L screen exist in [src/routes/_app.accounting.tsx](../src/routes/_app.accounting.tsx)
- ATP/AR/AP and close checklist reporting exist in core app
- export workbook and print support are present

Still missing / not fully implemented:
- trial balance detail, balance sheet, cash-flow statement, statement of changes in equity
- note schedules and financial ratios
- branch/consolidated reporting
- drill-down from figures to source documents
- monthly management pack assembly with scheduled email distribution
- IFRS for SMEs or full IFRS-specific reporting choices confirmed by accountant

## E9. Multi-currency

Status: Partial

Implemented:
- FX policy and exchange-rate approval logic exists in backend and relevant tests
- rate policy enforcement and some foreign-currency posting paths are present

Still missing / not fully implemented:
- full transactional rate management screen for manual entry with approval and imports
- month-end revaluation and auto-reversal workflow fully exposed in the UX
- FX gain/loss account integration and reporting in base and transaction currency
- branch-wise and consolidated multi-currency reporting
- re-enable of non-base journals only after conversion/revaluation tests complete

## E10. Payroll Accounting Integration

Status: Partial

Implemented:
- payroll service and posting exist, and payroll accounting integration exists in backend logic

Still missing / not fully implemented:
- posting map per pay component, branch and cost centre
- accruals for leave pay and bonuses
- statutory liability settlement reconciliation
- payroll journal reconciliation to payslips in UI/reporting

## E11. Audit and Compliance

Status: Partial

Implemented:
- audit trail and access controls exist in the project structure and some backend services
- close-period guardrails exist

Still missing / not fully implemented:
- full audit trail viewer with document change history and hash chain export
- segregation-of-duties conflict and user access review reports
- period-lock log and QR document verification endpoint
- compliance calendar and read-only auditor role
- auditor pack export and retention periods by document type

## E12. Finance Reports and Close

Status: Partial

Implemented:
- close checklist exists in [backend/src/services/financeCloseService.js](../backend/src/services/financeCloseService.js)
- finance close and VAT lock controls exist

Still missing / not fully implemented:
- database-backed close blockers for withholding remittance and FX revaluation; no governed persistent workflows currently provide these records
- budget, accrual, AP/AR equality and branch-level inventory reconciliation close checks
- full close-pack acceptance test that balances trial balance by branch and generates reconciled reports

Implemented since the initial audit:
- close checklist and transactional close guard now query period-matched posted depreciation runs and unresolved stocktake sessions
- close e2e coverage verifies real database records block closure and that resolving them clears their blockers

## Acceptance target

Status: Not yet fully complete

The repo currently satisfies the core inventory and procurement golden path, plus the basic finance close and accounting workspace. Database-backed depreciation posting, period-scoped depreciation/inventory close blockers, and persisted expense claim submission are now covered. It still does not satisfy the full Phase E acceptance requirement for a two-branch closed monthly cycle with approved budgets, payroll, realized and unrealized FX, fixed assets, tax, reconciled financial statements, and close-pack reconciliation in one end-to-end run.

## Recommended next implementation order

1. E2. Cash and Bank
2. E4. Budget and Forecasting
3. E5. Fixed Assets
4. E6. Tax Management (WHT / VAT reconciliation / tax calendar)
5. E7. Expenses Management
6. E8. Financial Reporting (trial balance, balance sheet, cash-flow, management pack)
7. E9. Multi-currency finalization
8. E10. Payroll accounting integration
9. E11. Audit and compliance
10. E12. Close checklist and gold-path automation

This order reduces the risk of building accounting features that later need to reconcile to cash, fixed assets, tax, payroll, and FX.
