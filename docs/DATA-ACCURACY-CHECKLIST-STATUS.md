# Data accuracy audit checklist

Automated reconciliations live in `backend/scripts/data-accuracy-audit.js`. Optional volume seeding: `backend/scripts/data-accuracy-simulate.cjs`.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run check:data-accuracy` | Auto-repair, then full audit (must exit 0 with zero warnings) |
| `npm run check:data-accuracy:repair` | Repair only (removes PERF-* invoices, posts missing GL, stock ledger, audit payroll) |
| `npm run check:data-accuracy:simulate` | Run month simulation, then full audit |
| `npm run check:data-accuracy:quick` | Legacy lightweight checks (AR sample, journal balance) |

Add `--skip-repair` to audit only when data is already clean.

Period override:

```bash
cd backend
node scripts/data-accuracy-audit.js --from 2026-01-01 --to 2026-01-31
```

## Checklist status

### Financial accuracy

| Check | Automation | Notes |
|-------|------------|-------|
| Full month sim: 50 invoices, 20 payments, 5 credit notes | `npm run check:data-accuracy:simulate` | Tagged `ACC-DA` in notes |
| AR aging = sum of outstanding invoices | PASS/FAIL in audit | `crm.getArAging` vs invoice balances |
| VAT on invoices = VAT report (zero variance) | PASS/FAIL | Repair removes PERF-* invoices and posts GL for stragglers |
| Excise on invoices = Excise report | PASS/FAIL | Tolerance KES 1 |
| P&L revenue = invoiced sales | PASS/WARN | Compares GL 4000 to invoice subtotals in period |
| Cash on BS = bank-linked GL | PASS/WARN | Account 1100 vs `erp_bank_accounts` GL balances |
| Trial balance difference = KES 0.00 | PASS/FAIL | Current/open fiscal period |

### Inventory accuracy

| Check | Automation | Notes |
|-------|------------|-------|
| 10 SO confirm → dispatch, stock deducted | Simulate + WARN if no recent SOs | E2E also covers one SO path |
| 3 PO receive → stock added | Simulate (GRN) | |
| 2 adjustments with reason | Simulate + FAIL if posted rows lack `reason` | |
| Stock valuation = Σ(qty × avg cost) | PASS/FAIL | `getStockValuation` vs on-hand |
| Movement: opening + receipts − issues = closing | PASS/FAIL | `closing = implied opening + ledger net` |
| Ledger = on-hand (tracked SKUs) | PASS/WARN | WARN for ≤5 rows (perf seed); opening-only SKUs WARN separately |

### Payroll accuracy

| Check | Automation | Notes |
|-------|------------|-------|
| 10+ employees, salary bands | WARN if &lt;10 payslips; seed has 20 employees | |
| PAYE vs KRA bands | PASS/FAIL | Audit payroll run `PR-2026-12` via `computePayslip` |
| NHIF vs rate table | PASS/FAIL per slip | |
| Net = Gross − deductions | PASS/FAIL | Includes NSSF, Housing Levy, HELB, etc. |
| JE debit 6100 = sum gross | PASS/FAIL when run posted | Uses audit payroll month `2099-12-01` if present |

## Production gate

`npm run production:gate` runs the full data accuracy audit (without simulation) after critical E2E tests.

## Manual follow-ups

- **P&L vs sales**: Credit notes and period cut-off can produce WARN; investigate before go-live.
- **Cash vs banks**: Operational bank balances are not stored on `erp_bank_accounts`; reconciliation is GL-based.
- **Excise**: Lines with zero litres still sum excise from invoice lines; KRA rate-per-litre is informational in the report.

## Auto-repair (`data-accuracy-repair.cjs`)

Runs automatically before every `check:data-accuracy`:

1. Deletes `PERF-*` benchmark invoices/orders (no GL).
2. Posts GL for posted invoices missing `journal_id`.
3. Backfills `opening_balance` stock ledger rows where on-hand ≠ ledger sum.
4. Recalculates and posts audit payroll `PR-2026-12` (December 2026, open fiscal period).
5. Syncs statutory amounts on the latest other posted payroll run.

## Simulation cleanup

Simulation data is labeled `ACC-DA`. Purge demo transactions (`npm run go-live:purge-demo`) before production if you ran simulate on a shared database.
