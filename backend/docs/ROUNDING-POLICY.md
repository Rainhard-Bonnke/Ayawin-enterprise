# Money and rounding policy

The company default is `finance.money_rounding_policy = "half_up_line_2dp"`. Quantities retain their existing scale. Each invoice line’s net amount is quantity × unit price rounded half up to two decimals; each line’s tax is then rounded half up to two decimals, and document totals are sums of those rounded line amounts. `src/lib/money.js` performs calculations using integer minor units / decimal coefficients. Sales, customer receipts and allocations, customer and supplier return credit notes, and general ledger balance checks use the utility; monetary comparisons use exact minor units, and general ledger debit and credit totals must match exactly.

Migration 062 converts the principal sales, receipt and journal money columns to `NUMERIC(18,2)`. AP and payroll still contain legacy float arithmetic and are not yet fully migrated to the utility.
