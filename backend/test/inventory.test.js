const test = require('node:test');
const assert = require('node:assert/strict');

test('weighted average cost calculation', () => {
  const oldQty = 100;
  const oldAvg = 10;
  const receiptQty = 50;
  const receiptCost = 12;
  const newQty = oldQty + receiptQty;
  const newAvg = ((oldQty * oldAvg) + (receiptQty * receiptCost)) / newQty;
  assert.equal(newAvg, 10.666666666666666);
  assert.equal(newQty, 150);
});
