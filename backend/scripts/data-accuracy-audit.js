#!/usr/bin/env node
/**
 * Data accuracy audit — financial, inventory, and payroll reconciliations.
 *
 * Usage:
 *   node scripts/data-accuracy-audit.js
 *   node scripts/data-accuracy-audit.js --from 2026-01-01 --to 2026-01-31
 *   node scripts/data-accuracy-audit.js --simulate   # run month sim first (slow)
 */
require('dotenv').config();
const pool = require('../src/db');
const { ensureErpFoundation } = require('../src/erpBootstrap');
const crm = require('../src/services/crmService');
const accounting = require('../src/services/accountingService');
const inventory = require('../src/services/inventoryService');
const payroll = require('../src/services/payrollService');
const pii = require('../src/lib/piiCrypto');

const TOL = 1; // KES rounding tolerance for tax/statutory
const TB_TOL = 0.02;

const args = process.argv.slice(2);
const SIMULATE = args.includes('--simulate');
const SKIP_REPAIR = args.includes('--skip-repair');
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const fromDate = fromIdx >= 0 ? args[fromIdx + 1] : null;
const toDate = toIdx >= 0 ? args[toIdx + 1] : null;

let failed = 0;
let warned = 0;

function pass(msg, detail = '') {
  console.log(`PASS  ${msg}${detail ? ` — ${detail}` : ''}`);
}

function fail(msg, detail = '') {
  console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ''}`);
  failed += 1;
}

function warn(msg, detail = '') {
  console.log(`WARN  ${msg}${detail ? ` — ${detail}` : ''}`);
  warned += 1;
}

function near(a, b, tol = TOL) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function getCompanyId() {
  const co = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  if (!co.rowCount) throw new Error('MARTIN company not found');
  return co.rows[0].id;
}

async function resolveFiscalPeriod(companyId) {
  if (fromDate && toDate) {
    const r = await pool.query(
      `SELECT id, start_date::text AS start_date, end_date::text AS end_date
       FROM erp_fiscal_periods
       WHERE company_id = $1 AND is_deleted = FALSE
         AND start_date <= $3::date AND end_date >= $2::date
       ORDER BY start_date DESC LIMIT 1`,
      [companyId, fromDate, toDate],
    );
    return r.rows[0] || { id: null, start_date: fromDate, end_date: toDate };
  }
  const r = await pool.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM erp_fiscal_periods
     WHERE company_id = $1 AND is_deleted = FALSE
       AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
     ORDER BY start_date DESC LIMIT 1`,
    [companyId],
  );
  if (r.rowCount) return r.rows[0];
  const latest = await pool.query(
    `SELECT id, start_date::text AS start_date, end_date::text AS end_date
     FROM erp_fiscal_periods WHERE company_id = $1 AND is_deleted = FALSE
     ORDER BY end_date DESC LIMIT 1`,
    [companyId],
  );
  return latest.rows[0] || { id: null, start_date: null, end_date: null };
}

async function checkFinancial(companyId, period) {
  console.log('\n=== Financial accuracy ===\n');

  const arAging = await crm.getArAging(companyId);
  const invOs = await pool.query(
    `SELECT COALESCE(SUM(total_amount - amount_paid), 0)::numeric AS total
     FROM erp_customer_invoices
     WHERE company_id = $1 AND status IN ('posted','partial','overdue') AND is_deleted = FALSE`,
    [companyId],
  );
  const invoiceTotal = Number(invOs.rows[0].total);
  const agingTotal = Number(arAging.summary.total);
  if (near(invoiceTotal, agingTotal, 0.01)) {
    pass('AR aging total = sum of outstanding invoices', `KES ${agingTotal.toFixed(2)}`);
  } else {
    fail('AR aging vs invoice outstanding', `aging ${agingTotal} vs invoices ${invoiceTotal}`);
  }

  const vat = await accounting.getVatReport(companyId, period.start_date, period.end_date);
  const vatParams = [companyId];
  let vatDateFilter = ` AND inv.status NOT IN ('draft','cancelled') AND inv.is_deleted = FALSE
    AND inv.invoice_type IS DISTINCT FROM 'proforma' AND inv.journal_id IS NOT NULL`;
  if (period.start_date) {
    vatParams.push(period.start_date);
    vatDateFilter += ` AND inv.invoice_date >= $${vatParams.length}`;
  }
  if (period.end_date) {
    vatParams.push(period.end_date);
    vatDateFilter += ` AND inv.invoice_date <= $${vatParams.length}`;
  }
  const vatPostedInv = await pool.query(
    `SELECT COALESCE(SUM(inv.tax_amount), 0)::numeric AS vat
     FROM erp_customer_invoices inv WHERE inv.company_id = $1 ${vatDateFilter}`,
    vatParams,
  );
  const postedInvoiceVat = Number(vatPostedInv.rows[0].vat);
  const unpostedVat = vat.invoice_vat_total - postedInvoiceVat;
  if (unpostedVat > 1) {
    fail('VAT on all invoices must equal GL', `unposted invoice VAT KES ${unpostedVat.toFixed(2)}`);
  } else if (!near(vat.invoice_vat_total, vat.gl_vat_total, 1)) {
    fail('VAT variance', `invoices ${vat.invoice_vat_total} vs GL ${vat.gl_vat_total} (Δ ${vat.variance})`);
  } else {
    pass('VAT on invoices = VAT report (zero variance)', `KES ${vat.invoice_vat_total.toFixed(2)}`);
  }

  const excise = await accounting.getExciseReport(companyId, period.start_date, period.end_date);
  const exciseVar = Number(excise.totals?.variance ?? 0);
  if (near(exciseVar, 0, TOL)) {
    pass('Excise on invoices = Excise report', `KES ${excise.totals.total_excise.toFixed(2)}`);
  } else {
    fail('Excise variance', `invoice ${excise.totals.total_excise} vs GL ${excise.totals.gl_excise} (Δ ${exciseVar})`);
  }

  if (period.id) {
    const pl = await accounting.getProfitLossReport(companyId, period.id);
    const salesGl = pl.lines
      .filter((l) => l.account_code === '4000' || String(l.account_name).toLowerCase().includes('revenue'))
      .reduce((s, l) => s + Number(l.amount || 0), 0);

    const invParams = [companyId];
    let invFilter = ` AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE AND journal_id IS NOT NULL`;
    if (period.start_date) {
      invParams.push(period.start_date);
      invFilter += ` AND invoice_date >= $${invParams.length}`;
    }
    if (period.end_date) {
      invParams.push(period.end_date);
      invFilter += ` AND invoice_date <= $${invParams.length}`;
    }
    const invSales = await pool.query(
      `SELECT COALESCE(SUM(subtotal), 0)::numeric AS subtotal
       FROM erp_customer_invoices WHERE company_id = $1 ${invFilter}`,
      invParams,
    );
    const cnParams = [companyId];
    let cnFilter = ` AND cn.status = 'posted'`;
    if (period.start_date) {
      cnParams.push(period.start_date);
      cnFilter += ` AND cn.credit_date >= $${cnParams.length}`;
    }
    if (period.end_date) {
      cnParams.push(period.end_date);
      cnFilter += ` AND cn.credit_date <= $${cnParams.length}`;
    }
    const cnSales = await pool.query(
      `SELECT COALESCE(SUM(cn.subtotal), 0)::numeric AS subtotal
       FROM erp_credit_notes cn WHERE cn.company_id = $1 ${cnFilter}`,
      cnParams,
    );
    const creditNotes = Number(cnSales.rows?.[0]?.subtotal || 0);
    const invoiceSubtotal = Number(invSales.rows[0].subtotal) - creditNotes;
    if (near(salesGl, invoiceSubtotal, Math.max(100, Math.abs(invoiceSubtotal) * 0.02))) {
      pass('P&L revenue aligns with GL-posted invoiced sales', `GL ${salesGl.toFixed(2)} / inv ${invoiceSubtotal.toFixed(2)}`);
    } else {
      fail('P&L revenue vs GL-posted invoice subtotal', `GL ${salesGl} vs invoices ${invoiceSubtotal} (credits ${creditNotes})`);
    }

    const bs = await accounting.getBalanceSheetReport(companyId, period.id);
    const cashLine = bs.lines.find((l) => l.account_code === '1100');
    const cashBs = cashLine ? Number(cashLine.balance) : 0;

    const bankGl = await pool.query(
      `SELECT COALESCE(SUM(b.closing_debit - b.closing_credit), 0)::numeric AS balance
       FROM erp_bank_accounts ba
       JOIN erp_chart_of_accounts a ON a.id = ba.gl_account_id
       JOIN erp_gl_balances b ON b.account_id = a.id AND b.fiscal_period_id = $2
       WHERE ba.company_id = $1 AND ba.is_deleted = FALSE AND ba.is_active = TRUE`,
      [companyId, period.id],
    );
    const bankSum = Number(bankGl.rows[0]?.balance || cashBs);
    if (near(cashBs, bankSum, Math.max(100, Math.abs(cashBs) * 0.01))) {
      pass('Cash on balance sheet = linked bank GL balances', `KES ${cashBs.toFixed(2)}`);
    } else {
      warn('Cash BS vs bank GL accounts', `BS 1100 ${cashBs} vs bank-linked ${bankSum}`);
    }

    const tb = await accounting.getTrialBalanceReport(companyId, period.id);
    const diff = Number(tb.totals.difference);
    if (near(diff, 0, TB_TOL) && tb.totals.balanced) {
      pass('Trial balance difference = KES 0.00', `period debit/credit Δ ${diff}`);
    } else {
      fail('Trial balance not balanced', `difference ${diff}`);
    }
  } else {
    warn('No fiscal period — skipped P&L/BS/TB period checks');
  }

  const jd = await pool.query(
    `SELECT COALESCE(SUM(debit), 0) AS d, COALESCE(SUM(credit), 0) AS c
     FROM erp_journal_lines jl
     JOIN erp_journals j ON j.id = jl.journal_id
     WHERE j.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE`,
    [companyId],
  );
  const jDiff = Math.abs(Number(jd.rows[0].d) - Number(jd.rows[0].c));
  if (near(jDiff, 0, TB_TOL)) {
    pass('All posted journals balance', `debits = credits`);
  } else {
    fail('Posted journals out of balance', `Δ ${jDiff}`);
  }
}

async function checkInventory(companyId) {
  console.log('\n=== Inventory accuracy ===\n');

  const valuation = await inventory.getStockValuation(companyId);
  const reportTotal = Number(valuation.totals.total_value);
  const direct = await pool.query(
    `SELECT COALESCE(SUM(quantity * avg_unit_cost), 0)::numeric AS v
     FROM erp_stock_on_hand WHERE company_id = $1 AND is_deleted = FALSE`,
    [companyId],
  );
  const directTotal = Number(direct.rows[0].v);
  if (near(reportTotal, directTotal, 0.01)) {
    pass('Stock valuation = Σ(qty × avg cost)', `KES ${reportTotal.toFixed(2)}`);
  } else {
    fail('Stock valuation mismatch', `report ${reportTotal} vs calc ${directTotal}`);
  }

  const ledgerVsOnHand = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE ledger_sum <> 0 AND ABS(on_hand - ledger_sum) > 0.001)::int AS tracked_mismatches,
       COUNT(*) FILTER (WHERE ledger_sum = 0 AND on_hand > 0.001)::int AS opening_only
     FROM (
       SELECT s.item_id, s.warehouse_id, s.quantity::numeric AS on_hand,
              COALESCE(SUM(sl.quantity), 0)::numeric AS ledger_sum
       FROM erp_stock_on_hand s
       LEFT JOIN erp_stock_ledger sl ON sl.company_id = s.company_id
         AND sl.item_id = s.item_id AND sl.warehouse_id = s.warehouse_id
       WHERE s.company_id = $1 AND s.is_deleted = FALSE
       GROUP BY s.item_id, s.warehouse_id, s.quantity
     ) x`,
    [companyId],
  );
  const trackedBad = ledgerVsOnHand.rows[0].tracked_mismatches;
  const openingOnly = ledgerVsOnHand.rows[0].opening_only;
  if (trackedBad === 0) {
    pass('Stock on hand = ledger for SKUs with movements', 'all tracked SKUs match');
  } else {
    fail('Ledger vs on-hand on tracked SKUs', `${trackedBad} row(s) — run repair`);
  }
  if (openingOnly > 0) {
    fail('Opening stock without ledger history', `${openingOnly} SKU/warehouse — run repair`);
  }

  const movementEq = await pool.query(
    `SELECT
       COALESCE(SUM(quantity), 0)::numeric AS net_movement,
       (SELECT COALESCE(SUM(quantity), 0)::numeric FROM erp_stock_on_hand WHERE company_id = $1 AND is_deleted = FALSE) AS closing,
       (SELECT COALESCE(SUM(on_hand - ledger_sum), 0)::numeric FROM (
          SELECT s.quantity::numeric AS on_hand, COALESCE(SUM(sl.quantity), 0)::numeric AS ledger_sum
          FROM erp_stock_on_hand s
          LEFT JOIN erp_stock_ledger sl ON sl.company_id = s.company_id
            AND sl.item_id = s.item_id AND sl.warehouse_id = s.warehouse_id
          WHERE s.company_id = $1 AND s.is_deleted = FALSE
          GROUP BY s.item_id, s.warehouse_id, s.quantity
        ) o) AS opening_balance
     FROM erp_stock_ledger WHERE company_id = $1`,
    [companyId],
  );
  const m = movementEq.rows[0];
  const closing = Number(m.closing);
  const net = Number(m.net_movement);
  const opening = Number(m.opening_balance);
  if (near(closing, opening + net, 0.01)) {
    pass('Movement equation: opening + receipts − issues = closing', `opening ${opening.toFixed(0)}, net ${net.toFixed(0)}, closing ${closing.toFixed(0)}`);
  } else {
    fail('Stock movement reconciliation', `opening ${opening} + net ${net} ≠ closing ${closing}`);
  }

  const adjNoReason = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_stock_adjustments
     WHERE company_id = $1 AND status = 'posted' AND (reason IS NULL OR trim(reason) = '')`,
    [companyId],
  );
  if (adjNoReason.rows[0].n === 0) {
    pass('Posted adjustments have reason recorded');
  } else {
    fail('Adjustments missing reason', `${adjNoReason.rows[0].n} rows`);
  }

  const recentSo = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_sales_orders
     WHERE company_id = $1 AND status IN ('confirmed','partial','delivered','invoiced')
       AND is_deleted = FALSE AND order_date >= CURRENT_DATE - INTERVAL '90 days'`,
    [companyId],
  );
  if (recentSo.rows[0].n >= 1) {
    pass('Sales order → stock issue path exercised', `${recentSo.rows[0].n} recent orders`);
  } else {
    warn('No recent confirmed sales orders — run --simulate for full SO/dispatch test');
  }
}

async function checkPayroll(companyId) {
  console.log('\n=== Payroll accuracy ===\n');

  const { PAYROLL_MONTH } = require('./data-accuracy-simulate.cjs');
  let run = await pool.query(
    `SELECT id, run_no, status, total_gross, payroll_month::text AS month
     FROM erp_payroll_runs
     WHERE company_id = $1 AND payroll_month = $2::date AND status IN ('calculated','posted') AND is_deleted = FALSE
     LIMIT 1`,
    [companyId, PAYROLL_MONTH],
  );
  if (!run.rowCount) {
    run = await pool.query(
      `SELECT id, run_no, status, total_gross, payroll_month::text AS month
       FROM erp_payroll_runs
       WHERE company_id = $1 AND status = 'posted' AND is_deleted = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [companyId],
    );
  }
  if (!run.rowCount) {
    run = await pool.query(
      `SELECT id, run_no, status, total_gross, payroll_month::text AS month
       FROM erp_payroll_runs
       WHERE company_id = $1 AND status IN ('calculated','posted') AND is_deleted = FALSE
       ORDER BY created_at DESC LIMIT 1`,
      [companyId],
    );
  }
  if (!run.rowCount) {
    warn('No payroll run found — run payroll or --simulate');
    return;
  }

  const runId = run.rows[0].id;
  const config = await payroll.getPayrollConfig(companyId);
  const slips = await pool.query(
    `SELECT ps.gross_pay, ps.paye, ps.nhif, ps.nssf, ps.housing_levy, ps.helb, ps.sacco,
            ps.loan_deduction, ps.other_deductions, ps.net_pay,
            e.basic_salary, e.basic_salary_enc AS employee_basic_salary_enc,
            ec.basic_salary, ec.house_allowance, ec.transport_allowance, ec.basic_salary_enc
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE ps.payroll_run_id = $1`,
    [runId],
  );

  let payeOk = 0;
  let nhifOk = 0;
  let netOk = 0;
  for (const row of slips.rows) {
    const emp = pii.mergePayrollEmployeeRow(row);
    const expected = payroll.computePayslip(emp, emp, config, {
      helb: row.helb,
      sacco: row.sacco,
      loan: row.loan_deduction,
      other: row.other_deductions,
    });
    if (near(row.paye, expected.paye, 1)) payeOk += 1;
    if (near(row.nhif, expected.nhif, 1)) nhifOk += 1;
    const dedSum =
      Number(row.paye) +
      Number(row.nhif) +
      Number(row.nssf) +
      Number(row.housing_levy || 0) +
      Number(row.helb || 0) +
      Number(row.sacco || 0) +
      Number(row.loan_deduction || 0) +
      Number(row.other_deductions || 0);
    const netCalc = Math.round((Number(row.gross_pay) - dedSum) * 100) / 100;
    if (near(row.net_pay, netCalc, 1)) netOk += 1;
  }

  const n = slips.rowCount;
  if (payeOk === n) {
    pass('PAYE matches KRA bands (all slips)', `${n} employees`);
  } else {
    fail('PAYE mismatches', `${n - payeOk}/${n} slips differ from KRA bands`);
  }

  if (nhifOk === n) pass('NHIF matches rate table (all slips)', `${n} employees`);
  else fail('NHIF mismatches', `${n - nhifOk}/${n} slips differ`);

  if (netOk === n) {
    pass('Net = Gross − PAYE − NHIF − NSSF − Housing Levy − other (all slips)', `${n} employees`);
  } else {
    fail('Net pay mismatches', `${n - netOk}/${n} slips differ`);
  }

  if (n >= 10) pass('Payroll processed for employee set', `${n} payslips (target 10+)`);
  else warn('Payroll employee count', `${n} payslips (seed more employees for 10-band test)`);

  if (run.rows[0].status === 'posted') {
    const je = await pool.query(
      `SELECT COALESCE(SUM(jl.debit), 0)::numeric AS debit
       FROM erp_journal_lines jl
       JOIN erp_chart_of_accounts a ON a.id = jl.account_id
       WHERE jl.journal_id = (SELECT journal_id FROM erp_payroll_runs WHERE id = $1)
         AND a.account_code IN ('6100', '6000')`,
      [runId],
    );
    const slipGross = slips.rows.reduce((s, r) => s + Number(r.gross_pay), 0);
    const jeDebit = Number(je.rows[0].debit);
    if (near(jeDebit, slipGross, TOL)) {
      pass('Payroll JE salary expense = sum of gross', `KES ${jeDebit.toFixed(2)}`);
    } else {
      fail('Payroll JE vs gross', `JE ${jeDebit} vs slips ${slipGross}`);
    }
  } else {
    warn('Payroll run not posted — JE check skipped', run.rows[0].status);
  }
}

async function main() {
  if (SIMULATE) {
    const { runSimulation } = require('./data-accuracy-simulate.cjs');
    await runSimulation();
  } else if (!SKIP_REPAIR) {
    const { runRepair } = require('./data-accuracy-repair.cjs');
    await runRepair();
  }

  await ensureErpFoundation();
  const companyId = await getCompanyId();
  const period = await resolveFiscalPeriod(companyId);

  console.log('\n=== Data accuracy audit ===');
  console.log(`Company: MARTIN  Period: ${period.start_date || 'all'} → ${period.end_date || 'all'}`);

  await checkFinancial(companyId, period);
  await checkInventory(companyId);
  await checkPayroll(companyId);

  console.log('\n=== Summary ===');
  if (failed) {
    console.log(`FAIL  ${failed} check(s) failed, ${warned} warning(s)`);
  } else if (warned) {
    console.log(`PASS  with ${warned} warning(s)`);
  } else {
    console.log('PASS  All data accuracy checks passed');
  }

  await pool.end();
  process.exit(failed || warned ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
