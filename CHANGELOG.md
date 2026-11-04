# Changelog

## Phase 2 controls

- Added inventory valuation reconciliation, server-side issue costing, stock count journals, price-list enforcement, discount approval, customer credit controls, mapped customer receipts, tills, and on-account receipt allocation.
- Added granular sales permissions and a maker-checker policy table; see [ROLE-MATRIX.md](backend/docs/ROLE-MATRIX.md).
- Added transaction-scoped, year-based sequence allocation, posting-time invoice and credit-note numbers, and hard-delete guards for numbered documents; see [DOCUMENT-NUMBERING.md](backend/docs/DOCUMENT-NUMBERING.md).
- Added minor-unit money helpers, half-up line rounding and exact GL balance validation; see [ROUNDING-POLICY.md](backend/docs/ROUNDING-POLICY.md).
- Applied exact minor-unit arithmetic to customer receipt allocations/statements and supplier return credit notes; added multi-invoice payment-on-account coverage.
- Added master-data usage guards, KRA PIN validation, VAT registration fields, and tax-invoice customer flags; see [MASTER-DATA-GUARDS.md](backend/docs/MASTER-DATA-GUARDS.md).
