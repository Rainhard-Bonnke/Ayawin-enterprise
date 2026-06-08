const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, pool } = require('./helpers');
const payroll = require('../../src/services/payrollService');

test('E2E payroll: run calculates payslips for active employees', async () => {
  const ctx = await getTestContext();
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;

  const result = await payroll.runPayroll({
    companyId: ctx.companyId,
    userId: ctx.userId,
    payrollMonth: month,
  });

  assert.ok(result.run_id);
  assert.ok(result.run_no);

  const slips = await pool.query(
    'SELECT COUNT(*)::int AS n FROM erp_payslips WHERE payroll_run_id = $1',
    [result.run_id],
  );
  assert.ok(slips.rows[0].n > 0, 'expected at least one payslip');
});
