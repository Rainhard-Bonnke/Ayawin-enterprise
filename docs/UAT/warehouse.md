# Warehouse UAT

## Setup
- Sign in as Warehouse user and prepare test inventory in a designated UAT warehouse.

## Journey
- Review stock on hand and movement history for a test item.
- Process a permitted delivery or transfer receipt against an authorized source document.
- Record a driver stock count or warehouse count with required evidence and verify the resulting workflow status.
- Confirm all movements show the correct item, quantity, warehouse, and reference.

## Authorization checks
- Verify the role cannot create sales orders, invoices, or receipts, or approve its own stock adjustment where separation is required.
- Verify a user cannot dispatch stock from a warehouse outside the permitted workflow.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects. Reconcile test stock after completion.
