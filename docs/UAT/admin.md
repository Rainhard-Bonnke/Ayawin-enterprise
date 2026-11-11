# Admin UAT

## Setup
- Sign in as an Admin in the UAT company; confirm the role and company are correct.
- Use approved test customers, suppliers, items, warehouses, and a disposable period. Do not use live provider credentials.

## Journey
- Open Users & Roles; create a test user, assign a least-privilege role, and verify the resulting permission set.
- Configure MFA for the test user, verify it, and confirm the secret is not displayed again after saving.
- Add and remove a test IP allowlist rule; revoke a disposable active session and confirm it is no longer active.
- Create a sales order, confirm it, dispatch it, invoice it, and record a test receipt. Verify each status and audit entry.
- Review one inventory adjustment and one accounting posting; confirm balances and source-document links.
- Open integrations and confirm secrets are masked. Keep providers in sandbox unless the separate production-certification gate is approved.

## Authorization checks
- Sign in as a Sales Rep and verify they cannot approve orders, post deliveries, post invoices, or approve receipts.
- Confirm the Admin audit log records the role/security changes and the sales/accounting actions.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects. Remove disposable users and data after approval.
