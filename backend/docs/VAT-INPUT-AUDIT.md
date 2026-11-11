# Supplier Input VAT Audit

Audit date: 2026-11-09
Scope: `accountsPayableService.js`, `procurementService.js`, and `supplierReturnCreditService.js`. This is the required pre-build audit for the VAT return; VAT return calculation and filing code are not included here.

## Phase 4 implementation status

- Supplier bill lines now record standard-rated, zero-rated, exempt, or out-of-scope treatment, a claimable VAT ratio, and the resulting claimable/non-claimable VAT split.
- Item-backed bill lines default from the item's active tax group and effective rate. Deviations require `tax.edit` and create an audit record.
- Supplier bills store eTIMS invoice identifiers and begin with `unverified` evidence status. The `tax.approve` evidence workflow is a manual checker attestation after document review; it is not an automated KRA supplier-invoice verification API.
- Unverified claimable VAT posts to 1401. Verification reclassifies posted VAT to 1400 with a dated journal. Legacy bills already posted to 1400 are flagged for review and cannot be silently reclassified.
- Confirmed company policy: non-claimable VAT is added to the related expense or asset cost. For receipt-matched bills it is debited to the bill line's cost account, separate from clearing the net goods-received accrual.
- Supplier-return credits snapshot the source claimable ratio and reverse claimable, held, and non-claimable portions to the corresponding control/cost accounts.
- VAT3 working papers can be prepared, approved, exported as CSV/XLSX, reconciled by control account, and locked. They are internal working papers only and do not file on iTax.
- Migrations `069`-`074` add the purchase-tax model, credit splits, tax permissions, line lineage, VAT3 workflow, and evidence posting history.

## Findings

### Accounts payable bills

- Supplier bill lines distinguish standard-rated, zero-rated, exempt, and out-of-scope purchases. Item-backed lines resolve treatment and effective rate from the item tax group; authorized overrides are audited.
- `postBill` posts verified claimable VAT to 1400, holds unverified claimable VAT in 1401, and applies the configured non-claimable treatment. Receipt-matched and unmatched paths are covered by E2E/unit tests.
- Evidence verification is a manual `tax.approve` workflow requiring eTIMS invoice reference, receipt signature, note, and a different user from the bill preparer. It records an audit event and posts the 1401-to-1400 reclassification where applicable.
- Existing bills are backfilled as standard-rated and unverified. Their historic posting to 1400 is not rewritten automatically; after a separate evidence check, they are recognized in their original bill period without a duplicate reclassification journal.
- For receipt-matched bills, the journal clears the net receipt accrual, adds non-claimable VAT to the configured cost account, routes eligible VAT to 1400/1401, and credits AP for total. Unmatched bills use each bill line's expense/asset account.

### Procurement and goods receipts

- Purchase orders and goods receipts track quantities and unit cost but no VAT rate, tax category, or input-tax deductibility. A goods receipt posts inventory against goods-received-not-invoiced for the net stock value; no input VAT is posted until the supplier bill, which is an appropriate separation in principle.
- The purchase flow has no link to KRA purchase-side eTIMS lookup/validation and no exception flag when a supplier invoice lacks valid fiscal evidence.

### Supplier return credit notes

- Supplier-return credits require a source supplier bill line and validate source quantity, gross tax, and the stored claimability ratio. Credit notes snapshot the split and reverse verified VAT from 1400, held VAT from 1401, and non-claimable VAT from the original cost account.
- Date windows and source invoice linkage are enforced, but KRA/eTIMS credit-note evidence is not stored or verified.

## Remaining Requirements Before Filing Use

1. Confirm statutory eligibility rules and any partial-exemption ratios with the company's Kenyan tax adviser; this code does not determine legal deductibility.
2. Define evidence criteria and an independent manual verifier procedure. No automated KRA supplier-invoice verification API is implemented.
3. Reconcile legacy bills and posted journals before approving returns with historical VAT variances.
4. Validate the internal working paper against KRA's current auto-populated VAT return/iTax process before relying on its totals.

## Recommendation

VAT3 is implemented as an internal working paper only. It displays output and input amounts, source drill-downs, and GL variance by control account; it does not file on iTax. Accountant approval of statutory eligibility, manual evidence procedures, and legacy-journal reconciliation remain required before relying on its totals.
