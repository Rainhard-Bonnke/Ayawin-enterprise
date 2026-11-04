# Sales credit controls

Customer exposure at confirmation includes open posted invoice balances after credit notes and unapplied receipts, confirmed order quantities not yet delivered, delivered quantities not yet invoiced, and the order being confirmed. The response exposes each component in `breakdown`. Confirmations lock the customer row so concurrent orders for the same customer serialize.

The company setting `sales.overdue_block_days` defaults to 30 days past invoice due date. An overdue open invoice blocks confirmation regardless of credit limit. `erp_customers.credit_hold` is a manual stop that blocks both confirmation and delivery.

An authorized user with `sales.credit_override` can approve one draft order with a reason. The approver must differ from the order creator; approval is audited and expires after one hour. A manual customer credit hold cannot be overridden.
