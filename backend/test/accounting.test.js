const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLinesBalanced } = require('../src/services/glPostingService');
const accounting = require('../src/services/accountingService');
const { KENYA_REQUIRED_ACCOUNTS } = accounting;

test('balanced journal validation', () => {
  const t = validateLinesBalanced([
    { debit: 500, credit: 0 },
    { debit: 0, credit: 500 },
  ]);
  assert.equal(t.totalDebit, 500);
  assert.equal(t.totalCredit, 500);
});

test('Kenya COA required account list includes excise and payroll', () => {
  const codes = KENYA_REQUIRED_ACCOUNTS.map((a) => a.code);
  assert.ok(codes.includes('2300'));
  assert.ok(codes.includes('2200'));
  assert.ok(codes.includes('6100'));
});

test('accounting reports with DB context', async () => {
  const { getTestContext } = require('./e2e/helpers');
  const ctx = await getTestContext();
  const coa = await accounting.getKenyaCoaStatus(ctx.companyId);
  assert.ok(Array.isArray(coa.accounts));
  assert.equal(typeof coa.ok, 'boolean');

  const periodR = await require('../src/db').query(
    `SELECT id FROM erp_fiscal_periods WHERE company_id = $1 AND is_deleted = FALSE ORDER BY start_date DESC LIMIT 1`,
    [ctx.companyId],
  );
  if (!periodR.rowCount) return;
  const periodId = periodR.rows[0].id;

  const tb = await accounting.getTrialBalanceReport(ctx.companyId, periodId);
  assert.ok(tb.lines);
  assert.equal(typeof tb.totals.difference, 'number');
  assert.equal(typeof tb.totals.balanced, 'boolean');

  const pl = await accounting.getProfitLossReport(ctx.companyId, periodId);
  assert.ok(pl.lines);
  assert.equal(typeof pl.net_profit, 'number');

  const bs = await accounting.getBalanceSheetReport(ctx.companyId, periodId);
  assert.equal(typeof bs.balanced, 'boolean');

  const journals = await accounting.verifyPostedJournalsBalanced(ctx.companyId);
  assert.equal(typeof journals.ok, 'boolean');

  const vat = await accounting.getVatReport(ctx.companyId);
  assert.equal(typeof vat.invoice_vat_total, 'number');
  assert.equal(typeof vat.matched, 'boolean');

  const excise = await accounting.getExciseReport(ctx.companyId);
  assert.equal(excise.format, 'KRA_excise_return');
});
