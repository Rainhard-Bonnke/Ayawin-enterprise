# Sales role and maker-checker matrix

Backend permission checks are authoritative. The client hides actions for convenience only. `sales.create` and `sales.approve` remain for unrelated legacy operations during migration; order, delivery, invoice, receipt and credit-note endpoints use the specific codes below.

| Role | Create | Approve / post | Constraints |
| --- | --- | --- | --- |
| Admin | All sales actions | All sales actions | Administrative access; audit every override |
| Sales Rep | Orders | None | No delivery, invoice posting, receipt or approval |
| Cashier/POS | Invoices, receipts | None | Receipt creation only; above-threshold receipts await another approver |
| POS Operator | Orders, invoices, receipts | None | Checkout creation only; no independent approval rights |
| Storekeeper/Warehouse | Delivery posting | None | No order, invoice or receipt approval |
| Accountant | Invoices, receipts, credit notes | Invoice post, receipt approval, credit-note approval | Create and approve checks must be performed by different users |
| Manager / Operations Manager | None | Order approval, invoice post, receipt and credit-note approval | Discount and credit overrides require reason and separate audit |

`erp_maker_checker_policies` stores per-company document thresholds and whether approvals require a different user. Existing checks still enforce separation for discounts, credit overrides, receipts, credit notes, stock adjustments, payment batches and manual journals. Use `assertDifferentUser(createdBy, actor)` for new approval paths.

## Tax Workflows

| Role | Tax permissions | Constraints |
| --- | --- | --- |
| Admin / System Administrator | `tax.view`, `tax.prepare`, `tax.approve`, `tax.edit`, `tax.export` | Every evidence verification and return action is audited |
| Accountant | `tax.view`, `tax.prepare`, `tax.approve`, `tax.edit`, `tax.export` | Must not approve a VAT return or verify evidence for a bill they prepared |
| Manager / Operations Manager | `tax.view` | No preparation, override, approval, or export by default |

`tax.edit` is required to override an item's supplier tax-group treatment, rate, or claimable ratio. `tax.approve` controls manual supplier-evidence verification and VAT-return approval/lock/reopen. These permissions do not authorize filing on iTax.

## Integration Production Controls

| Role | Integration permissions | Constraints |
| --- | --- | --- |
| Admin / System Administrator | `integrations.production_certify` | Company-level certification only after all provider checklist items are confirmed; settings changes and certification are audited by user and timestamp |
| Other roles | None by default | Sandbox configuration does not grant production activation; production secrets are stored separately by environment |

Invoice submission requires `sales.invoice.post`; M-Pesa STK initiation requires `sales.receipt.create`. See [GO-LIVE.md](integrations/GO-LIVE.md) for external approvals and the production release gate.
