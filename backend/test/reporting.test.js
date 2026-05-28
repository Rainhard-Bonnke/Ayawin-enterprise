const test = require('node:test');
const assert = require('node:assert/strict');
const { rowsToCsv, kpiStatus } = require('../src/services/reportingService');

test('rowsToCsv produces header and row', () => {
  const csv = rowsToCsv([{ a: 1, b: 'hello' }, { a: 2, b: 'world' }]);
  assert.match(csv, /^a,b/);
  assert.match(csv, /hello/);
});

test('kpiStatus green when above target', () => {
  assert.equal(kpiStatus(100, 80, 70, 60, true), 'green');
});

test('kpiStatus red when below critical', () => {
  assert.equal(kpiStatus(50, 80, 70, 60, true), 'red');
});
