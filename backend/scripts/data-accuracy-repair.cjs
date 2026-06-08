#!/usr/bin/env node
/**
 * Repairs common data-accuracy gaps before audit (PERF seed cleanup, stock ledger, payroll refresh).
 */
require('dotenv').config();
const pool = require('../src/db');
const { ensureErpFoundation } = require('../src/erpBootstrap');
const payroll = require('../src/services/payrollService');
const pii = require('../src/lib/piiCrypto');
const { PAYROLL_MONTH } = require('./data-accuracy-simulate.cjs');

const BATCH = 50;

async function getCtx() {
  await ensureErpFoundation();
  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  const user = await pool.query(`SELECT id FROM erp_users WHERE email = 'admin@martin.co.ke' LIMIT 1`);
  return { companyId: company.rows[0].id, userId: user.rows[0].id };
}

async function removePerfVolume(client, companyId) {
  const inv = await client.query(
    `SELECT COUNT(*)::int AS n FROM erp_customer_invoices
     WHERE company_id = $1 AND invoice_no LIKE 'PERF-INV-%'`,
    [companyId],
  );
  if (!inv.rows[0].n) return 0;

  await client.query(
    `DELETE FROM erp_customer_invoice_lines WHERE company_id = $1
     AND invoice_id IN (SELECT id FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE 'PERF-INV-%')`,
    [companyId],
  );
  const del = await client.query(
    `DELETE FROM erp_customer_invoices WHERE company_id = $1 AND invoice_no LIKE 'PERF-INV-%' RETURNING id`,
    [companyId],
  );
  await client.query(
    `DELETE FROM erp_sales_order_lines WHERE company_id = $1
     AND sales_order_id IN (SELECT id FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE 'PERF-SO-%')`,
    [companyId],
  );
  await client.query(`DELETE FROM erp_sales_orders WHERE company_id = $1 AND order_no LIKE 'PERF-SO-%'`, [companyId]);
  return del.rowCount;
}

async function postUnjournaledInvoices(ctx, companyId) {
  const gl = require('../src/services/glPostingService');
  const ACCOUNT_CODES = {
    accountsReceivable: '1200',
    salesRevenue: '4000',
    vatOutput: '2100',
    excisePayable: '2300',
  };

  const pending = await pool.query(
    `SELECT * FROM erp_customer_invoices
     WHERE company_id = $1 AND is_deleted = FALSE
       AND status IN ('posted','partial','paid','overdue')
       AND journal_id IS NULL AND invoice_no NOT LIKE 'PERF-%'
       AND invoice_type IS DISTINCT FROM 'proforma'
     ORDER BY invoice_date LIMIT 500`,
    [companyId],
  );

  const accounts = await pool.query(
    `SELECT id, account_code FROM erp_chart_of_accounts
     WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_deleted = FALSE`,
    [companyId, Object.values(ACCOUNT_CODES)],
  );
  const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));

  let posted = 0;
  let failed = 0;
  for (const inv of pending.rows) {
    try {
      if (!byCode[ACCOUNT_CODES.accountsReceivable] || !byCode[ACCOUNT_CODES.salesRevenue]) {
        throw new Error('COA 1200/4000 missing');
      }
      const lines = [
        { account_id: byCode[ACCOUNT_CODES.accountsReceivable], debit: inv.total_amount, credit: 0, description: 'AR' },
        { account_id: byCode[ACCOUNT_CODES.salesRevenue], debit: 0, credit: inv.subtotal, description: 'Revenue' },
      ];
      const exciseAmt = Number(inv.excise_amount || 0);
      if (byCode[ACCOUNT_CODES.excisePayable] && exciseAmt > 0) {
        lines.push({ account_id: byCode[ACCOUNT_CODES.excisePayable], debit: 0, credit: exciseAmt, description: 'Excise' });
      }
      if (byCode[ACCOUNT_CODES.vatOutput] && Number(inv.tax_amount) > 0) {
        lines.push({ account_id: byCode[ACCOUNT_CODES.vatOutput], debit: 0, credit: inv.tax_amount, description: 'VAT' });
      }
      const journal = await gl.createJournal({
        companyId,
        userId: ctx.userId,
        entryDate: inv.invoice_date,
        journalType: 'sales',
        referenceNo: inv.invoice_no,
        description: `Customer invoice ${inv.invoice_no}`,
        lines,
      });
      await gl.postJournal({ journalId: journal.id, companyId, userId: ctx.userId });
      await pool.query('UPDATE erp_customer_invoices SET journal_id = $1 WHERE id = $2', [journal.id, inv.id]);
      posted += 1;
    } catch (e) {
      failed += 1;
      if (failed <= 3) console.log(`  skip invoice ${inv.invoice_no}: ${e.message}`);
    }
  }
  return { posted, failed, total: pending.rowCount };
}

async function backfillStockLedger(client, companyId, userId) {
  const gaps = await client.query(
    `SELECT s.warehouse_id, s.item_id, s.quantity::numeric AS on_hand,
            COALESCE(SUM(sl.quantity), 0)::numeric AS ledger_sum
     FROM erp_stock_on_hand s
     LEFT JOIN erp_stock_ledger sl ON sl.company_id = s.company_id
       AND sl.item_id = s.item_id AND sl.warehouse_id = s.warehouse_id
     WHERE s.company_id = $1 AND s.is_deleted = FALSE
     GROUP BY s.warehouse_id, s.item_id, s.quantity
     HAVING ABS(s.quantity - COALESCE(SUM(sl.quantity), 0)) > 0.001`,
    [companyId],
  );

  let filled = 0;
  for (const row of gaps.rows) {
    const delta = Number(row.on_hand) - Number(row.ledger_sum);
    if (Math.abs(delta) < 0.001) continue;
    const costRow = await client.query(
      `SELECT avg_unit_cost FROM erp_stock_on_hand
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [companyId, row.warehouse_id, row.item_id],
    );
    const unitCost = Number(costRow.rows[0]?.avg_unit_cost || 0);
    if (delta > 0) {
      await client.query(
        `INSERT INTO erp_stock_ledger (
           company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
           reference_type, reference_id, movement_date, created_by
         ) VALUES ($1,$2,$3,'receipt',$4,$5,'opening_balance',NULL,NOW(),$6)`,
        [companyId, row.warehouse_id, row.item_id, delta, unitCost, userId],
      );
    } else {
      await client.query(
        `INSERT INTO erp_stock_ledger (
           company_id, warehouse_id, item_id, movement_type, quantity, unit_cost,
           reference_type, reference_id, created_by
         ) VALUES ($1,$2,$3,'issue',$4,$5,'opening_balance',NULL,$6)`,
        [companyId, row.warehouse_id, row.item_id, delta, unitCost, userId],
      );
    }
    filled += 1;
  }
  return filled;
}

async function refreshAuditPayroll(ctx, companyId) {
  const runNo = `PR-${PAYROLL_MONTH.slice(0, 7)}`;
  const existing = await pool.query(
    `SELECT id, status, journal_id FROM erp_payroll_runs WHERE company_id = $1 AND run_no = $2`,
    [companyId, runNo],
  );

  if (existing.rowCount && existing.rows[0].status === 'posted') {
    await pool.query(`DELETE FROM erp_payslips WHERE payroll_run_id = $1`, [existing.rows[0].id]);
    await pool.query(
      `UPDATE erp_payroll_runs SET status = 'calculated', journal_id = NULL, posted_at = NULL WHERE id = $1`,
      [existing.rows[0].id],
    );
    if (existing.rows[0].journal_id) {
      await pool.query(
        `UPDATE erp_journals SET status = 'cancelled', is_deleted = TRUE WHERE id = $1`,
        [existing.rows[0].journal_id],
      );
    }
  } else if (existing.rowCount) {
    await pool.query(`DELETE FROM erp_payslips WHERE payroll_run_id = $1`, [existing.rows[0].id]);
    await pool.query(`DELETE FROM erp_payroll_runs WHERE id = $1`, [existing.rows[0].id]);
  }

  const result = await payroll.runPayroll({
    companyId,
    userId: ctx.userId,
    payrollMonth: PAYROLL_MONTH,
  });
  await payroll.postPayrollToGl({ companyId, userId: ctx.userId, runId: result.run_id });

  const slips = await pool.query(
    `SELECT ps.id, ps.paye, ps.gross_pay, e.basic_salary, e.basic_salary_enc AS employee_basic_salary_enc,
            ec.basic_salary, ec.house_allowance, ec.transport_allowance, ec.basic_salary_enc
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE ps.payroll_run_id = $1`,
    [result.run_id],
  );
  const config = await payroll.getPayrollConfig(companyId);
  let mism = 0;
  for (const row of slips.rows) {
    const emp = pii.mergePayrollEmployeeRow(row);
    const exp = payroll.computePayslip(emp, emp, config);
    if (Math.abs(Number(row.paye) - exp.paye) > 1) mism += 1;
  }
  return { run_id: result.run_id, payslips: slips.rowCount, paye_mismatches: mism };
}

async function syncPostedPayrollSlips(ctx, companyId) {
  const run = await pool.query(
    `SELECT id FROM erp_payroll_runs
     WHERE company_id = $1 AND status = 'posted' AND run_no <> $2
     ORDER BY created_at DESC LIMIT 1`,
    [companyId, `PR-${PAYROLL_MONTH.slice(0, 7)}`],
  );
  if (!run.rowCount) return { updated: 0 };

  const config = await payroll.getPayrollConfig(companyId);
  const slips = await pool.query(
    `SELECT ps.id, ps.gross_pay, ps.helb, ps.sacco, ps.loan_deduction, ps.other_deductions,
            e.basic_salary, e.basic_salary_enc AS employee_basic_salary_enc,
            ec.basic_salary, ec.house_allowance, ec.transport_allowance, ec.basic_salary_enc
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE ps.payroll_run_id = $1`,
    [run.rows[0].id],
  );

  let updated = 0;
  for (const row of slips.rows) {
    const emp = pii.mergePayrollEmployeeRow(row);
    const exp = payroll.computePayslip(emp, emp, config, {
      helb: row.helb,
      sacco: row.sacco,
      loan: row.loan_deduction,
      other: row.other_deductions,
    });
    await pool.query(
      `UPDATE erp_payslips SET paye = $2, nhif = $3, nssf = $4, housing_levy = $5, net_pay = $6,
              earnings_detail = $7::jsonb, deductions_detail = $8::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [
        row.id,
        exp.paye,
        exp.nhif,
        exp.nssf,
        exp.housing_levy,
        exp.net_pay,
        JSON.stringify(exp.earnings_detail),
        JSON.stringify(exp.deductions_detail),
      ],
    );
    updated += 1;
  }
  return { updated, run_id: run.rows[0].id };
}

async function runRepair() {
  console.log('\n=== Data accuracy repair ===\n');
  const ctx = await getCtx();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const perfRemoved = await removePerfVolume(client, ctx.companyId);
    await client.query('COMMIT');
    console.log(`Removed ${perfRemoved} PERF-* benchmark invoices/orders`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const gl = await postUnjournaledInvoices(ctx, ctx.companyId);
  console.log(`Posted GL for ${gl.posted}/${gl.total} invoices (${gl.failed} skipped)`);

  const ledgerClient = await pool.connect();
  try {
    await ledgerClient.query('BEGIN');
    const filled = await backfillStockLedger(ledgerClient, ctx.companyId, ctx.userId);
    await ledgerClient.query('COMMIT');
    console.log(`Backfilled ${filled} stock ledger opening gap(s)`);
  } catch (e) {
    await ledgerClient.query('ROLLBACK');
    throw e;
  } finally {
    ledgerClient.release();
  }

  const pay = await refreshAuditPayroll(ctx, ctx.companyId);
  console.log(`Audit payroll ${PAYROLL_MONTH}: ${pay.payslips} slips, PAYE mismatches ${pay.paye_mismatches}`);

  const sync = await syncPostedPayrollSlips(ctx, ctx.companyId);
  if (sync.updated) {
    console.log(`Synced ${sync.updated} payslip(s) on latest posted run to current tax tables`);
  }

  console.log('\nRepair complete — run: npm run check:data-accuracy\n');
}

if (require.main === module) {
  runRepair()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { runRepair };
