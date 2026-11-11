# Manager UAT

## Setup
- Sign in as Manager or Operations Manager with the approved UAT permission set.
- Prepare a draft sales order and a separate user's pending approval item.

## Journey
- Review the sales pipeline and order details; confirm an eligible order created by another user.
- Review a pending invoice, receipt, and credit-note approval where enabled; approve only items prepared by a different user.
- Review inventory and finance dashboards and confirm totals agree with their registers.
- Verify overrides require a reason and are visible in the audit history.

## Authorization checks
- Verify the Manager cannot create sales orders, post deliveries, create receipts, or change integration secrets unless separately authorized.
- Verify approval of an item created by the same user is blocked when maker-checker policy requires separation.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects.
