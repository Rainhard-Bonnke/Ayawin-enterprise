# Sales Rep UAT

## Setup
- Sign in as Sales Rep and prepare an active test customer, item, and warehouse.
- Confirm the test customer has a safe credit limit and no production communication will be sent.

## Journey
- Create a draft sales order with a valid required date and one or more lines.
- Review order details, customer, tax preview, and current status.
- Search and filter the order register; verify the order remains visible after refresh.

## Authorization checks
- Verify the Sales Rep cannot confirm an order, post a delivery, create/post an invoice, record a receipt, or approve a credit note.
- Verify invalid quantities, missing warehouse, and required dates before order date are rejected with actionable feedback.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects. Cancel the disposable order after evidence capture.
