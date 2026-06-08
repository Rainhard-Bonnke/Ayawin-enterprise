const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePaye, calculateNhif, calculateNssf, computePayslip } = require('../src/services/payrollService');

const bands = [
  { min: 0, max: 24000, rate: 10 },
  { min: 24001, max: 32333, rate: 25 },
  { min: 32334, max: 500000, rate: 30 },
  { min: 500001, max: 800000, rate: 32.5 },
  { min: 800001, max: null, rate: 35 },
];

test('NHIF bracket for mid salary', () => {
  assert.equal(calculateNhif(95000), 1600);
});

test('NSSF tier I on first 7,000', () => {
  const n = calculateNssf(5000);
  assert.equal(n.tier1, 300);
  assert.equal(n.tier2, 0);
  assert.equal(n.total, 300);
});

test('NSSF tier I and II for high earners', () => {
  const n = calculateNssf(100000);
  assert.equal(n.tier1, 420);
  assert.equal(n.tier2, 1740);
  assert.equal(n.total, 2160);
});

test('PAYE increases with taxable income', () => {
  const low = calculatePaye(20000, bands);
  const high = calculatePaye(200000, bands);
  assert.ok(high > low);
});

test('housing levy is 1.5% of gross', () => {
  const slip = computePayslip(
    { basic_salary: 100000 },
    { basic_salary: 100000 },
    { paye_bands: bands, nhif_brackets: DEFAULT_NHIF(), nssf_ceiling: 36000, housing_levy_rate: 1.5 },
  );
  assert.equal(slip.housing_levy, 1500);
});

function DEFAULT_NHIF() {
  return [{ min: 0, max: null, amount: 1700 }];
}

test('computePayslip net is less than gross with itemized deductions', () => {
  const slip = computePayslip(
    { basic_salary: 95000 },
    { basic_salary: 95000, house_allowance: 14250, transport_allowance: 3000 },
    { paye_bands: bands, nhif_brackets: DEFAULT_NHIF(), housing_levy_rate: 1.5 },
  );
  assert.ok(slip.net_pay < slip.gross_pay);
  assert.ok(slip.paye >= 0);
  assert.ok(slip.deductions_detail.some((d) => d.code === 'NSSF_TIER_I'));
  assert.ok(slip.deductions_detail.some((d) => d.code === 'HOUSING_LEVY'));
});

test('duplicate payroll month blocked when posted', async () => {
  const { getTestContext } = require('./e2e/helpers');
  const payrollSvc = require('../src/services/payrollService');
  const pool = require('../src/db');
  const ctx = await getTestContext();
  const posted = await pool.query(
    `SELECT payroll_month::text AS m FROM erp_payroll_runs
     WHERE company_id = $1 AND status = 'posted' AND is_deleted = FALSE LIMIT 1`,
    [ctx.companyId],
  );
  if (!posted.rowCount) return;
  const month = String(posted.rows[0].m).slice(0, 10);
  await assert.rejects(
    () => payrollSvc.runPayroll({ companyId: ctx.companyId, userId: ctx.userId, payrollMonth: month }),
    /already posted/i,
  );
});
