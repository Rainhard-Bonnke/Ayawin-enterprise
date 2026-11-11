const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const payroll = require("../../src/services/payrollService");
const remittances = require("../../src/services/payrollRemittanceService");

test("E2E payroll flow: run -> payslips -> GL post", async (t) => {
  const ctx = await getTestContext();
  const monthResult = await pool.query(
    `SELECT TO_CHAR(month_start, 'YYYY-MM-DD') AS payroll_month
     FROM erp_fiscal_periods fp
     CROSS JOIN LATERAL generate_series(
       date_trunc('month', GREATEST(fp.start_date, CURRENT_DATE))::date,
       date_trunc('month', fp.end_date)::date,
       INTERVAL '1 month'
     ) AS month_start
     WHERE fp.company_id = $1 AND fp.status = 'open' AND fp.is_deleted = FALSE
       AND month_start::date BETWEEN fp.start_date AND fp.end_date
       AND NOT EXISTS (
         SELECT 1 FROM erp_payroll_runs pr
         WHERE pr.company_id = fp.company_id
           AND pr.run_no = 'PR-' || TO_CHAR(month_start, 'YYYY-MM')
       )
     ORDER BY month_start
     LIMIT 1`,
    [ctx.companyId],
  );
  if (!monthResult.rowCount) {
    return t.skip("No unused payroll month exists in an open fiscal period");
  }

  const run = await payroll.runPayroll({
    companyId: ctx.companyId,
    userId: ctx.userId,
    payrollMonth: monthResult.rows[0].payroll_month,
  });
  assert.ok(run.run_id);
  assert.ok(run.employees >= 1);

  const slips = await pool.query(
    "SELECT COUNT(*)::int AS n, COALESCE(SUM(net_pay),0) AS net FROM erp_payslips WHERE payroll_run_id = $1",
    [run.run_id],
  );
  assert.ok(slips.rows[0].n >= 1);
  assert.ok(Number(slips.rows[0].net) > 0);

  await assert.rejects(
    () => payroll.approvePayrollRun({ companyId: ctx.companyId, userId: ctx.userId, runId: run.run_id }),
    /creator cannot approve/,
  );
  const approved = await payroll.approvePayrollRun({
    companyId: ctx.companyId,
    userId: ctx.reviewerId,
    runId: run.run_id,
  });
  assert.equal(approved.status, "approved");
  const locked = await payroll.lockPayrollRun({
    companyId: ctx.companyId,
    userId: ctx.reviewerId,
    runId: run.run_id,
  });
  assert.equal(locked.status, "locked");

  const posted = await payroll.postPayrollToGl({
    companyId: ctx.companyId,
    userId: ctx.userId,
    runId: run.run_id,
  });
  assert.equal(posted.ok, true);
  assert.ok(posted.journal_id);

  const status = await pool.query("SELECT status FROM erp_payroll_runs WHERE id = $1", [
    run.run_id,
  ]);
  assert.equal(status.rows[0].status, "posted");

  const obligations = await remittances.listRemittances(ctx.companyId, run.run_id);
  assert.deepEqual(
    obligations.map((obligation) => obligation.agency_code).sort(),
    ["AHL", "KRA_PAYE", "NSSF", "SHA_SHIF"],
  );
  const obligation = obligations.find((row) => row.agency_code === "KRA_PAYE");
  assert.ok(Number(obligation.amount_due) > 0);

  const bank = await pool.query(
    `SELECT id FROM erp_chart_of_accounts
     WHERE company_id = $1 AND account_type = 'asset' AND account_code LIKE '11%'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
     ORDER BY account_code LIMIT 1`,
    [ctx.companyId],
  );
  assert.ok(bank.rowCount > 0);
  const payment = await remittances.createPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    remittanceId: obligation.id,
    amount: Number(obligation.amount_due),
    paymentDate: String(run.payroll_month).slice(0, 10),
    bankAccountId: bank.rows[0].id,
    referenceNo: `E2E-KRA-${Date.now()}`,
  });
  await assert.rejects(
    () => remittances.postPayment({ companyId: ctx.companyId, userId: ctx.userId, paymentId: payment.id }),
    /preparer cannot approve/,
  );
  const postedRemittance = await remittances.postPayment({
    companyId: ctx.companyId,
    userId: ctx.reviewerId,
    paymentId: payment.id,
  });
  assert.equal(postedRemittance.remittance_status, "paid");

  const paidObligation = await pool.query(
    "SELECT status, amount_paid FROM erp_payroll_statutory_remittances WHERE id = $1",
    [obligation.id],
  );
  assert.equal(paidObligation.rows[0].status, "paid");
  assert.equal(Number(paidObligation.rows[0].amount_paid), Number(obligation.amount_due));
});
