const test = require('node:test');
const assert = require('node:assert/strict');

test('VAT calculation at 16%', () => {
  const subtotal = 100000;
  const tax = Math.round(subtotal * 0.16 * 100) / 100;
  assert.equal(tax, 16000);
  assert.equal(subtotal + tax, 116000);
});

test('credit exposure includes order total', () => {
  const outstanding = 50000;
  const orderTotal = 174000;
  const limit = 500000;
  assert.equal(outstanding + orderTotal <= limit, true);
});
