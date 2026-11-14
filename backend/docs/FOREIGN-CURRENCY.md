# Foreign-Currency Accounting

Status: policy-scoped foreign journals are supported only for foreign-denominated asset/liability accounts explicitly included in an approved FX policy; supplier/customer module posting remains blocked unless it can satisfy that account and policy contract. Journal lines persist transaction and base debit/credit amounts, rate direction/source/effective date, and the approved-rate reference. FX migrations `100` through `107` add and backfill line snapshots, rate-review controls, company-scoped policies, policy supersession, and database-enforced governance immutability; historical foreign lines are marked `legacy_unknown` rather than assigning an unverified direction. Exchange rates and accounting policies are immutable records: drafts can only be independently approved/rejected, and approved policies can only be superseded by an approved replacement. A rate is retrievable only when its pair, direction, effective date, and source match an approved policy and the company's current base currency. Every posted GL amount and journal total remains in company base currency.

## Required Accounting Contract

- Store transaction currency amount, approved exchange rate, rate direction/source/effective date, and base-currency amount per journal line.
- Balance and report the general ledger exclusively in company base currency.
- For supplier/customer settlement, compare the base value of the open monetary balance with the settlement value and post realized gain/loss to approved accounts.
- At month-end, revalue eligible open foreign monetary balances using the approved closing rate, post unrealized gain/loss, and create an automatic reversal in the following period.
- Preserve the original transaction and prior revaluation history; never rewrite posted foreign balances when rates change.

## Decisions and Controls Required

Before enabling a currency, finance must approve rate source, base/quote direction, effective-date policy, rounding method, gain/loss accounts, monetary account scope, and revaluation reversal date. The approved-rate lookup requires an exact effective date; no fallback or interpolation policy is assumed.

The API stores those decisions as an independently approved per-currency policy. The currently supported policy choices are exact-date rates, base-per-transaction or transaction-per-base direction, currency-minor-unit half-up rounding, and reversal at the next period start. The conversion helper applies either quote direction and an explicitly supplied base-currency precision. Policies require company-local postable base-currency income/expense accounts for FX gains/losses and postable foreign-currency asset/liability accounts for monetary scope. Approved policies are immutable; approval of a replacement supersedes the former version while preserving its audit history. These are finance-authored decisions, not defaults.

Approved rate/policy lookup and scoped foreign-currency journal conversion are implemented. Realized FX settlement for open supplier/customer balances and month-end revaluation with historical reversal are not. The policy-scoped posting path does not yet satisfy the full accounting contract. Do not route supplier bills/payments or customer invoices/receipts through it until their transaction-currency subledgers, settlement allocation, gain/loss, and revaluation tests are implemented.
