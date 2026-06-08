const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertCanTransition,
  assertDispatchAllowed,
  assertInvoiceFromOrderAllowed,
  assertCancelAllowed,
} = require('../src/lib/orderWorkflow');

test('workflow allows draft to confirmed only', () => {
  assert.equal(assertCanTransition('draft', 'confirmed'), null);
  assert.ok(assertCanTransition('draft', 'invoiced'));
});

test('dispatch requires confirmed or partial', () => {
  assert.doesNotThrow(() => assertDispatchAllowed('confirmed'));
  assert.throws(() => assertDispatchAllowed('draft'));
});

test('invoice requires delivered or partial with delivery', () => {
  assert.doesNotThrow(() => assertInvoiceFromOrderAllowed('delivered'));
  assert.throws(() => assertInvoiceFromOrderAllowed('confirmed'));
});

test('cancel blocked for invoiced', () => {
  assert.throws(() => assertCancelAllowed('invoiced'));
  assert.doesNotThrow(() => assertCancelAllowed('delivered'));
});
