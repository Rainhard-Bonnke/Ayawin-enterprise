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

test('NSSF capped at ceiling', () => {
  assert.equal(calculateNssf(450000, 4320), 259.2);
});

test('PAYE increases with taxable income', () => {
  const low = calculatePaye(20000, bands);
  const high = calculatePaye(200000, bands);
  assert.ok(high > low);
});

test('computePayslip net is less than gross', () => {
  const slip = computePayslip(
    { basic_salary: 95000 },
    { basic_salary: 95000, house_allowance: 14250, transport_allowance: 3000 },
    { paye_bands: bands, nhif_brackets: [{ min: 0, max: null, amount: 2613 }], nssf_ceiling: 4320, housing_levy_rate: 1.5 },
  );
  assert.ok(slip.net_pay < slip.gross_pay);
  assert.ok(slip.paye >= 0);
});
