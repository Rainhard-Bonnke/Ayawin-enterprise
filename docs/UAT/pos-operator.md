# POS Operator UAT

## Setup
- Sign in as POS Operator on the UAT tenant; verify the role has sales order create, delivery post, invoice create, and receipt create permissions.
- Use a test customer, stocked item, and designated POS warehouse; do not use live payment providers.

## Journey
- Search by item name, code, or barcode; add items and change quantities in the cart.
- Verify the server tax preview completes before checkout and the displayed total matches the posted invoice.
- Complete a cash sale with sufficient tender; verify stock dispatch, invoice, receipt, and change.
- Download and print the generated receipt; verify it contains the expected invoice number and totals.
- Repeat with a non-cash test method and verify the recorded payment reference.

## Authorization checks
- Verify checkout is unavailable when any required permission is removed and the backend rejects the corresponding direct action.
- Verify insufficient cash, empty cart, missing customer, invalid quantity, and stock shortage do not produce a completed sale.
- Verify the POS Operator cannot approve another user's orders, invoices, or receipts, or access user administration.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects. Void/reconcile test transactions only through approved UAT procedures.
