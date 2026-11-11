# Foreign-Currency Accounting

Status: foreign-currency journals remain blocked. The GL currently rejects non-base-currency entries; do not remove that guard until transaction-currency and base-currency accounting are implemented together.

## Required Accounting Contract

- Store transaction currency amount, approved exchange rate, rate direction/source/effective date, and base-currency amount per journal line.
- Balance and report the general ledger exclusively in company base currency.
- For supplier/customer settlement, compare the base value of the open monetary balance with the settlement value and post realized gain/loss to approved accounts.
- At month-end, revalue eligible open foreign monetary balances using the approved closing rate, post unrealized gain/loss, and create an automatic reversal in the following period.
- Preserve the original transaction and prior revaluation history; never rewrite posted foreign balances when rates change.

## Decisions and Controls Required

Before enabling a currency, finance must approve rate source, base/quote direction, effective-date policy, rounding method, gain/loss accounts, monetary account scope, and revaluation reversal date. The rate table already records effective dates, but a stored rate alone is not sufficient for safe posting.

No foreign-currency journal conversion, realized FX settlement, or revaluation is implemented. Keep the existing GL guard until the complete balanced-base-currency workflow and its supplier-bill/payment/revaluation tests are available.
