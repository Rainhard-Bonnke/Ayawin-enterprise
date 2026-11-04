# Customer receipts and tills

Receipts use the active company payment method mapping in `erp_payment_methods`. Defaults map cash to 1110, M-Pesa to 1120, bank transfers to 1100, cheques to 1130 and cards to 1140. A company can change the mapping to another active postable account.

Receipts above the company `sales.receipt_approval_threshold` setting (KES 100,000 by default) wait for approval by another user. Cheques remain in transit until cleared. A receipt may be split over invoices; any remainder stays on account and can be allocated later. Send `Idempotency-Key` on receipt creation to safely retry the same request.

Cash receipts require an open cashier till. Closing compares opening float plus posted cash receipts with counted cash; any variance posts to cash on hand and cash over/short (5300). Customer statements are available as JSON and PDF under `/api/v1/sales/customers/:id/statement`.
