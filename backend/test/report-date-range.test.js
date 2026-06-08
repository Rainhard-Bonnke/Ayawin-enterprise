const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReportRange } = require('../src/lib/reportDateRange');

test('parseReportRange maps from_date and to_date', () => {
  const range = parseReportRange({ from_date: '2026-01-01', to_date: '2026-01-31' });
  assert.equal(range.from, '2026-01-01');
  assert.equal(range.to, '2026-01-31');
});

test('parseReportRange compare_prior yields prior window of equal length', () => {
  const range = parseReportRange({
    from_date: '2026-02-01',
    to_date: '2026-02-28',
    compare_prior: 'true',
  });
  assert.ok(range.compare);
  assert.equal(range.compare.from, '2026-01-04');
  assert.equal(range.compare.to, '2026-01-31');
  assert.equal(range.compare.days, 28);
});

test('parseReportRange caps export limit at 50000', () => {
  const range = parseReportRange({ limit: '999999', preset: '7d' });
  assert.equal(range.limit, 50000);
});
