# Sales pricing controls

Sales orders and direct invoices resolve their unit prices from the customer's assigned price list, or the company's active default list, using the document date and quantity tier. A supplied client price is accepted as an override only when the acting user has `sales.price_override`; every override records the effective list price and selected price in the audit trail. An item's optional `minimum_sale_price` uses the same permission.

The company setting `sales.maximum_discount_percent` defaults to 10. A line discount above that limit leaves the order in draft with `discount_approval_status = pending`; a different user with `sales.discount_approve` must provide a reason before the order can be confirmed. Tax uses the dated tax-rate snapshot and is calculated after the discount. Zero-price lines require `is_free_issue = true` and a reason code.
