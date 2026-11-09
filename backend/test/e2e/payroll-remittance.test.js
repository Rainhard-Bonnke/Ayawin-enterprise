const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const remittances = require("../../src/services/payrollRemittanceService");

test("E2E payroll remittance: posted payroll creates obligations and maker-checker payment posts", async (t) => {
  const ctx = await getTestContext();
  const run = await pool.query(
    `SELECT id, TO_CHAR(payroll_month, 'YYYY-MM-DD') AS payroll_month FROM erp_payroll_runs
     WHERE company_id = $1 AND status = 'posted' AND is_deleted = FALSE
     ORDER BY payroll_month DESC LIMIT 1`,
    [ctx.companyId],
  );
  if (!run.rowCount) return t.skip("No posted payroll run exists in the development database");

  const obligations = await remittances.listRemittances(ctx.companyId, run.rows[0].id);
  assert.deepEqual(
    obligations.map((obligation) => obligation.agency_code).sort(),
    ["AHL", "KRA_PAYE", "NSSF", "SHA_SHIF"],
  );
  const obligation = obligations.find((row) => Number(row.outstanding_amount) > 0);
  if (!obligation) return t.skip("All statutory obligations for the posted payroll are already paid");

  const bank = await pool.query(
    `SELECT id FROM erp_chart_of_accounts
     WHERE company_id = $1 AND account_type = 'asset' AND account_code LIKE '11%'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
     ORDER BY account_code LIMIT 1`,
    [ctx.companyId],
  );
  const approver = await pool.query(
    `SELECT id FROM erp_users
     WHERE company_id = $1 AND id <> $2 AND status = 'active' AND is_deleted = FALSE
     ORDER BY created_at LIMIT 1`,
    [ctx.companyId, ctx.userId],
  );
  assert.ok(bank.rowCount > 0);
  assert.ok(approver.rowCount > 0);

  const payment = await remittances.createPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    remittanceId: obligation.id,
    amount: Number(obligation.outstanding_amount),
    paymentDate: String(run.rows[0].payroll_month).slice(0, 10),
    bankAccountId: bank.rows[0].id,
    referenceNo: `E2E-REMIT-${Date.now()}`,
  });
  await assert.rejects(
    () => remittances.postPayment({ companyId: ctx.companyId, userId: ctx.userId, paymentId: payment.id }),
    /preparer cannot approve/,
  );
  const posted = await remittances.postPayment({
    companyId: ctx.companyId,
    userId: approver.rows[0].id,
    paymentId: payment.id,
  });
  assert.equal(posted.remittance_status, "paid");
});
