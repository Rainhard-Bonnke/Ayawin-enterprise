# Sales role and maker-checker matrix

Backend permission checks are authoritative. The client hides actions for convenience only. `sales.create` and `sales.approve` remain for unrelated legacy operations during migration; order, delivery, invoice, receipt and credit-note endpoints use the specific codes below.

| Role | Create | Approve / post | Constraints |
| --- | --- | --- | --- |
| Admin | All sales actions | All sales actions | Administrative access; audit every override |
| Sales Rep | Orders | None | No delivery, invoice posting, receipt or approval |
| Cashier/POS | Invoices, receipts | None | Receipt creation only; above-threshold receipts await another approver |
| Storekeeper/Warehouse | Delivery posting | None | No order, invoice or receipt approval |
| Accountant | Invoices, receipts, credit notes | Invoice post, receipt approval, credit-note approval | Create and approve checks must be performed by different users |
| Manager / Operations Manager | None | Order approval, invoice post, receipt and credit-note approval | Discount and credit overrides require reason and separate audit |

`erp_maker_checker_policies` stores per-company document thresholds and whether approvals require a different user. Existing checks still enforce separation for discounts, credit overrides, receipts, credit notes, stock adjustments, payment batches and manual journals. Use `assertDifferentUser(createdBy, actor)` for new approval paths.
