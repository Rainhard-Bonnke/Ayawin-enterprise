const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillMonthlyRevenueGaps } = require('../src/lib/chartMonths');

test('fillMonthlyRevenueGaps inserts zero months', () => {
  const rows = [
    { month: 'Jan 26', sort_key: new Date('2026-01-15'), revenue: 100 },
    { month: 'Mar 26', sort_key: new Date('2026-03-15'), revenue: 200 },
  ];
  const filled = fillMonthlyRevenueGaps(rows, '2026-01-01', '2026-03-31');
  assert.equal(filled.length, 3);
  assert.equal(filled[0].revenue, 100);
  assert.equal(filled[1].revenue, 0);
  assert.equal(filled[2].revenue, 200);
});
