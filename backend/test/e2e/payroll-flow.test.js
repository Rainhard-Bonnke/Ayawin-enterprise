const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, pool } = require('./helpers');
const payroll = require('../../src/services/payrollService');

test('E2E payroll flow: run -> payslips -> GL post', async () => {
  const ctx = await getTestContext();

  const run = await payroll.runPayroll({
    companyId: ctx.companyId,
    userId: ctx.userId,
    payrollMonth: '2026-07-01',
  });
  assert.ok(run.run_id);
  assert.ok(run.employees >= 1);

  const slips = await pool.query(
    'SELECT COUNT(*)::int AS n, COALESCE(SUM(net_pay),0) AS net FROM erp_payslips WHERE payroll_run_id = $1',
    [run.run_id],
  );
  assert.ok(slips.rows[0].n >= 1);
  assert.ok(Number(slips.rows[0].net) > 0);

  const posted = await payroll.postPayrollToGl({
    companyId: ctx.companyId,
    userId: ctx.userId,
    runId: run.run_id,
  });
  assert.equal(posted.ok, true);
  assert.ok(posted.journal_id);

  const status = await pool.query('SELECT status FROM erp_payroll_runs WHERE id = $1', [run.run_id]);
  assert.equal(status.rows[0].status, 'posted');
});
