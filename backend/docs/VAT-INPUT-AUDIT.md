# Supplier Input VAT Audit

Audit date: 2026-11-07
Scope: `accountsPayableService.js`, `procurementService.js`, and `supplierReturnCreditService.js`. This is the required pre-build audit for the VAT return; no VAT return calculation or filing code is included here.

## Findings

### Accounts payable bills

- Supplier bill lines accept only a numeric `tax_rate` and derive tax with `round(net * rate)`. They have no tax-treatment or input-VAT claimability field. Exempt, zero-rated, out-of-scope, and standard-rated purchases are therefore not distinguishable as statutory categories at bill level.
- `postBill` debits the entire `bill.tax_amount` to input VAT account 1400 whenever that amount is positive. There is no validation that the tax is deductible, supported by an eligible supplier tax invoice, or split into claimable versus non-claimable VAT.
- Supplier bills store the supplier invoice number and dates but no verified eTIMS invoice number, receipt signature, verification response, or input-tax claim status. This cannot support a reliable evidence-based VAT3 input schedule.
- For receipt-matched bills, the journal debits inventory/accrual clearing for the net subtotal, input VAT for all tax, and credits AP for total. For unmatched bills, expense/asset lines receive net and VAT is posted separately. The accounting arithmetic balances, but the VAT classification/evidence weakness applies to both paths.

### Procurement and goods receipts

- Purchase orders and goods receipts track quantities and unit cost but no VAT rate, tax category, or input-tax deductibility. A goods receipt posts inventory against goods-received-not-invoiced for the net stock value; no input VAT is posted until the supplier bill, which is an appropriate separation in principle.
- The purchase flow has no link to KRA purchase-side eTIMS lookup/validation and no exception flag when a supplier invoice lacks valid fiscal evidence.

### Supplier return credit notes

- Supplier-return credits require a source supplier bill line and validate the claimed amount against that line's net, VAT, quantity, and rate. They reverse the input VAT control account for the entered credit VAT when posted.
- The source VAT check assumes the original tax amount is deductible input VAT. Since supplier bills do not record claimability, the credit note can reverse input VAT that was originally non-claimable or fail to reverse the correct split.
- Date windows and source invoice linkage are enforced, but KRA/eTIMS credit-note evidence is not stored or verified.

## Required decisions before implementing VAT3

1. Define and persist purchase tax treatment separately from the supplier's displayed tax rate, including exempt, zero-rated, out-of-scope, standard-rated and partially/non-claimable inputs.
2. Define evidence criteria for input VAT recognition and how unverified eTIMS supplier invoices are held from the claimable schedule.
3. Decide whether non-claimable VAT is included in the underlying expense/asset cost or posted to a separate non-claimable VAT account, including treatment for inventory and receipt-matched bills.
4. Confirm statutory eligibility rules and any partial-exemption allocation policy with the company's Kenyan tax adviser; this code audit does not determine legal deductibility.

## Recommendation

Do not build or publish a VAT3 return from current AP data. First add tax treatment, claimable amount, non-claimable amount, and invoice-evidence lineage to bills/lines and ensure credit notes reverse the same claimable fraction originally recognized. Then reconcile return totals to output/input VAT control accounts and present an explicit variance.
