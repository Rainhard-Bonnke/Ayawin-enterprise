const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext } = require('./helpers');
const monthEnd = require('../../src/services/monthEndService');

test('E2E month-end: open period preview returns structure', async () => {
  const ctx = await getTestContext();
  const period = await monthEnd.getOpenPeriod(ctx.companyId);
  if (!period) {
    return; // no open fiscal period configured in seed
  }
  const preview = await monthEnd.previewMonthEnd(ctx.companyId, period.id);
  assert.ok(preview.period);
  assert.ok(Array.isArray(preview.blockers));
  assert.equal(typeof preview.can_close, 'boolean');
  assert.ok(preview.trial_balance);
});
