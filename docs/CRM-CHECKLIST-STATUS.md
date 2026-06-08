# CRM / Customers checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Customer statement: invoices, payments, credit notes chronological | **PASS** | `crmService.getCustomerStatement` — unified ledger, `ORDER BY txn_date ASC` |
| 2 | Opening balance carried forward correctly | **PASS** | Sum of transactions before `from`; running balance per row; opening/closing in UI |
| 3 | Credit limit at order creation — block or warn configurable | **PASS** | `CREDIT_LIMIT_ENFORCEMENT=block\|warn` (default `block`); `applyCreditLimitCheck` on SO create/confirm |
| 4 | Aging buckets: Current / 30 / 60 / 90 / 90+ | **PASS** | `getArAging` by `due_date`; summary keys `current`, `days_30`, `days_60`, `days_90`, `days_90_plus` |
| 5 | KRA PIN format validated | **PASS** | `validateKraPin` (11-char `A#########Z`); required on customer create/update in API |
| 6 | Duplicate customer on name + PIN | **PASS** | `assertDuplicateCustomer` on master data create/update |
| 7 | Inactive toggle prevents new orders | **PASS** | `assertCustomerActive` on SO create/confirm; `is_active` in customer form |

## Env

- `CREDIT_LIMIT_ENFORCEMENT=warn` — allow orders over limit with `credit_warning` on response
- `CREDIT_LIMIT_ENFORCEMENT=block` — hard reject (default)

## Key files

- `backend/src/services/crmService.js`
- `backend/src/routes/v1/crm.js`
- `backend/src/lib/creditLimitPolicy.js`
- `backend/src/services/salesService.js`
- `src/routes/_app.customers.tsx`

## Tests

- `backend/test/crm.test.js`
- `backend/test/e2e/customer-inactive.test.js`
