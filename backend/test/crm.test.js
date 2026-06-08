const test = require('node:test');
const assert = require('node:assert/strict');
const { validateKraPin } = require('../src/lib/validators');
const { getCreditLimitMode, applyCreditLimitCheck } = require('../src/lib/creditLimitPolicy');

test('KRA PIN format validation', () => {
  assert.equal(validateKraPin('A123456789Z').ok, true);
  assert.equal(validateKraPin('bad').ok, false);
  assert.equal(validateKraPin('', { required: true }).ok, false);
});

test('credit limit warn mode allows exceed', () => {
  process.env.CREDIT_LIMIT_ENFORCEMENT = 'warn';
  const result = applyCreditLimitCheck({ ok: false, credit_limit: 1000, exposure: 1500 });
  assert.equal(result.ok, true);
  assert.equal(result.warning, true);
  delete process.env.CREDIT_LIMIT_ENFORCEMENT;
});

test('credit limit block mode throws on exceed', () => {
  process.env.CREDIT_LIMIT_ENFORCEMENT = 'block';
  assert.throws(
    () => applyCreditLimitCheck({ ok: false, credit_limit: 1000, exposure: 1500 }),
    /Credit limit exceeded/,
  );
  delete process.env.CREDIT_LIMIT_ENFORCEMENT;
});

test('default credit limit mode is block', () => {
  delete process.env.CREDIT_LIMIT_ENFORCEMENT;
  assert.equal(getCreditLimitMode(), 'block');
});
