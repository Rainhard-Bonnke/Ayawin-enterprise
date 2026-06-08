const test = require('node:test');
const assert = require('node:assert/strict');
const { maxDiscountPercent, assertLineDiscounts } = require('../src/lib/discountPolicy');

test('administrator may apply 100% discount', () => {
  assert.equal(maxDiscountPercent({ role_name: 'System Administrator' }), 100);
});

test('sales rep capped at 5%', () => {
  assert.throws(
    () => assertLineDiscounts({ role_name: 'Sales Representative' }, [{ discount_percent: 10 }]),
    /exceeds/,
  );
});

test('operations manager may apply 15%', () => {
  assert.doesNotThrow(() =>
    assertLineDiscounts({ role_name: 'Operations Manager' }, [{ discount_percent: 12 }]),
  );
});
