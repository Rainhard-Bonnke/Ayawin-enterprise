# Ayawin ERP operating model

This is the product design for Ayawin Stock Solution: a Kenyan beverage wholesaler and distributor ERP. The system should follow the work people do, with one source of truth and a clear hand-off between roles. It should not be a collection of unrelated CRUD screens.

## The operating loop

1. **Buy and receive:** stock request → approval → supplier purchase order → goods receipt with quantity, cost, lot and expiry → supplier bill matched to order and receipt → supplier payment.
2. **Sell and fulfil:** customer enquiry/quote → credit and available-to-promise check → approved sales order → pick by FEFO (first-expiry, first-out) → dispatch and proof of delivery → tax invoice → collection and allocation.
3. **Account and close:** every posted commercial document creates balanced ledger entries once; cash/bank is reconciled; AR/AP, inventory valuation, tax control and trial balance agree before the period closes.
4. **Control:** approvals, permissions, branch/warehouse scope, immutable source documents, audit history, exception queues, and period locks apply across those loops.

The user interface should make the next valid action obvious. Draft, pending approval, approved, partially fulfilled, posted, settled, and reversed are distinct states. A page must not pretend a draft is posted or a provider integration succeeded when it did not.

## Ayawin's module map

| Work area | Main records and responsibilities | Essential work queues |
| --- | --- | --- |
| Home / Work queue | Company and branch pulse, exceptions assigned to this user, approvals, deadlines, drill-through to source records | Low stock, overdue collections, pending receipts, unposted documents, failed integrations |
| Customer and Sales | Customers, routes/territories, price lists, credit limits, quotes, orders, reservations, dispatch, returns, invoices, receipts, credit notes | Credit holds, unfulfilled orders, POD gaps, overdue invoices |
| Procurement | Suppliers, purchase requests, approvals, POs, receipts, supplier bills, debit notes, payments, supplier performance | Approvals, overdue POs, quantity/price mismatches, due bills |
| Inventory and Warehouse | SKU/UOM/case conversions, warehouses/bins, stock ledger, on-hand, lot/batch, expiry, counts, transfers, reservations, valuation | Reorder, expiry, negative/discrepant stock, pick/dispatch |
| Finance | Chart of accounts, dimensions, journals, AR, AP, cash/bank, bank reconciliation, tax, fixed assets, budgets, periods and reports | Unbalanced/unposted journals, unreconciled cash, AR/AP aging, close checklist |
| People and Payroll | Employee lifecycle, contracts, leave, attendance, payroll, statutory liabilities, approvals and payslips | Missing employee data, leave approvals, payroll validation and remittance due dates |
| Insights and Admin | Reports, audit, users/roles, company/branch configuration, integration health, backups and retention | Failed jobs, permission changes, stale master data, data quality |

Each work area owns its records and rules; shared customer, supplier, item, warehouse, user, currency, tax and accounting dimensions are referenced by stable IDs. Cross-module actions go through domain services in a database transaction, rather than a page writing another module's tables directly.

## Business invariants

- A posted document is immutable; corrections use reversal, return, or credit/debit note linked to the original.
- Posting is idempotent. Retrying a request cannot create a second delivery issue, invoice, payment, or journal.
- On-hand is a control balance backed by an append-only movement ledger. Warehouse and lot movements must reconcile; serial/lot traceability must survive dispatch and transfer.
- Credit availability includes open exposure and order reservations. Reservations expire or release through explicit events.
- Every financial document has a source link, posting date, currency, exchange-rate snapshot where relevant, and balanced debit/credit lines.
- Kenyan tax, payroll, privacy, and retention settings are effective-dated and auditable. They must be verified against current official specifications before production use.
- Tenant/company scope is enforced in the server query and authorization layer, not only hidden in the interface.

## Architecture decisions

Keep the existing Express/PostgreSQL application as a **modular monolith** while it is one product and one deployment. This preserves reliable ACID transactions across orders, stock and journals without introducing a distributed system prematurely. Keep domain services and route boundaries explicit; add background workers only for work that needs retry or scheduled execution.

External side effects (eTIMS, M-Pesa, email/SMS) need an outbox record committed with the ERP document, then an asynchronous worker with retries, idempotency keys, attempt history, and a visible failed state. This avoids the “ERP posted but provider call vanished” dual-write failure described in the [transactional outbox pattern](https://learn.microsoft.com/en-us/power-platform/architecture/reference-architectures/transactional-outbox-pattern).

## AI policy

AI belongs in the user's work queue as a decision aid: demand/reorder forecasts, unusual margin or price movement, collection risk, purchase/receipt mismatch, expiry and stock discrepancy triage, and natural-language reporting. First ship deterministic calculations with traceable source rows; use a model only for concise explanations over those facts. Show the evidence, as-of time, model/provider, confidence/limitations, and reviewer outcome. AI may draft a purchase request or collection task, but a person with the right permission must approve and post it. Never let generated text post journals, release credit, alter payroll, or claim an integration completed.

This follows the [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework/ai-rmf-core) emphasis on accountable, transparent systems and defined human oversight, and [GS1 traceability guidance](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard) around product/lot, source/destination location, despatch and receipt events.

## Kenya-specific readiness

- **eTIMS:** [KRA documents OSCU/VSCU system-to-system integration and certification](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration). The ERP must retain submission payload/reference, response, retries and invoice state, and must not report success until KRA confirms acceptance. Certification and live credentials remain an operational prerequisite.
- **Payroll:** preserve effective-dated statutory rules, calculation snapshots per run, remittance control accounts and payment evidence; separate calculated liability from remitted liability.
- **Privacy:** employee, customer and contact data need least-privilege access, audit, retention/export/deletion procedures and an accountable controller/processor setup. Confirm Ayawin's applicable [ODPC registration and obligations](https://www.odpc.go.ke/faqs/) before production.
- **Distribution operations:** model route, driver/vehicle, load, proof of delivery, returns, breakages, empties/deposits where used, and customer-specific terms as real operational records, not free-text notes.

## Delivery order

1. Make inventory traceable end to end (lot balances, FEFO picks, transfers, counts, expiry work queue, valuation reconciliation).
2. Complete order-to-cash and procure-to-pay exceptions (returns/credit notes, allocations, collections, three-way matching, approvals, audit links).
3. Complete finance close controls (bank reconciliation, AR/AP aging, cash-flow, tax control reconciliation, period close/reopen controls).
4. Complete workforce lifecycle and Kenyan payroll evidence (employee changes, leave balances/accrual, statutory remittance register).
5. Add reliable outbox-based integrations, then operational AI grounded in the above clean data.

Use [KENYA-ERP-MODULE-READINESS.md](./KENYA-ERP-MODULE-READINESS.md) as the code-level gap tracker. This operating model describes the intended destination, not a claim that every listed capability is already implemented.
