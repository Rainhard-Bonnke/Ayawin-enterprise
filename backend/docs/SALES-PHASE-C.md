# Phase C: Sales and CRM

Status: backend workflow implementation complete and regression-tested. This is not a certification of statutory compliance or production provider connectivity.

## Workflow Coverage

- CRM leads support company-scoped create, search, update, archive, activity history, and conversion to a customer plus opportunity. Opportunities support search, stage updates, amount/probability, expected close date, and a required reason when marked lost.
- Quotations use effective customer pricing and server-calculated tax, database document numbering, validity dates, draft/sent/accepted/rejected/converted transitions, line detail, and atomic accepted-quote conversion to one sales order.
- Sales order confirmation retains existing stock reservation, available-to-promise, credit-control, maker-checker discount, and credit override behavior.
- Pick lists are created from open reserved quantities. Warehouse confirmation must account for the full quantity on every line before the list becomes dispatchable. Delivery may reference that picked list and cannot exceed its remaining picked quantities.
- Delivery proof, per-line quantity reconciliation, evidence attachments, route reconciliation, and closure/review remain available through the existing sales routes.
- Invoices retain accounting posting and issuer snapshots. Posting queues an eTIMS submission in the durable outbox. The E2E suite validates mocked provider acceptance, retries, and idempotency; it does not certify KRA approval or production certification.
- Receipts, till closure, customer statement, collection activities, payment promises, M-Pesa callbacks, and allocation are covered by existing sales flows. The dunning action queues an idempotent email/SMS reminder per invoice and date through the notification outbox. Queueing is not delivery; a configured provider worker must confirm delivery.
- Customer credit notes remain linked to the original posted invoice and delivery. Posting reverses AR/revenue/VAT, restores good stock or quarantines damaged stock, and posts inventory/COGS effects at source cost. Sales performance uses posted invoice net amounts less posted credit-note net amounts.
- Managers can assign dated sales targets and effective-dated commission plans. The sales performance report returns net sales, attainment, invoice/credit counts, and commission clawback for the representative.
- POS session tokens preserve the POS role's narrow order-create, invoice-create, and receipt-create capabilities without broadening access to approval or posting privileges.

## API Additions

CRM routes live under `/api/v1/crm`:

- Leads: `GET/POST /leads`, `GET/PUT/DELETE /leads/:id`, `POST /leads/:id/convert`
- Opportunities: `GET/POST /opportunities`, `GET/PUT/DELETE /opportunities/:id`
- Activities: `GET/POST /activities`
- Quotes: `GET/POST /quotes`, `GET /quotes/:id`, `POST /quotes/:id/send`, `/accept`, `/reject`, and `/convert-order`
- Performance setup: `POST /sales-targets`, `POST /commission-plans`

Sales routes live under `/api/v1/sales`:

- Picking: `POST /orders/:id/pick-list`, `GET /pick-lists/:id`, `POST /pick-lists/:id/confirm`
- Delivery can include `pick_list_id` in `POST /deliveries`.
- Dunning: `POST /receivables/dunning/reminders` with optional `{ "as_of": "YYYY-MM-DD" }`.

Reporting is exposed as `GET /api/v1/reports/sales-performance?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD` with optional `sales_rep_id`.

## Verification

- Unit suite: 141 passed, 0 failed.
- Full backend E2E suite: 48 passed, 0 failed, 3 skipped. Skips are environment/data prerequisites noted by the tests.
- Phase C E2E coverage verifies POS authorization, quote/order conversion, full pick confirmation before delivery, invoice and eTIMS mock lifecycle, M-Pesa receipt flow, return/restock, target/commission clawback, and idempotent dunning queueing.

Before production rollout, run the provider certification gates in `integrations/GO-LIVE.md`, validate tax and commission policy with the responsible finance/business owners, configure and exercise the real notification worker, and verify frontend workflows against these APIs.
