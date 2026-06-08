const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateKraPin,
  validatePhone,
  validateEmail,
  validatePositiveAmount,
  validateStrictPositive,
  validateDateRange,
  validateRequiredString,
  money2,
} = require('../src/lib/validators');
const { validatePartyBody, validateItemBody, validateEmployeeBody } = require('../src/lib/masterDataValidation');
const { rowsToCsv } = require('../src/lib/csvExport');

test('KRA PIN accepts 11-char format', () => {
  assert.equal(validateKraPin('P051999999Z').ok, true);
  assert.equal(validateKraPin('P051999999Z').value, 'P051999999Z');
  assert.equal(validateKraPin('short').ok, false);
});

test('Kenya phone normalizes to +254', () => {
  const r = validatePhone('0712345678');
  assert.equal(r.ok, true);
  assert.match(r.value, /^\+254/);
});

test('Kenya phone accepts +254 prefix and spaced or dashed formats', () => {
  assert.equal(validatePhone('+254712345678').ok, true);
  assert.equal(validatePhone('+254 712 345 678').value, '+254712345678');
  assert.equal(validatePhone('+254-712-345-678').value, '+254712345678');
  assert.equal(validatePhone('254712345678').value, '+254712345678');
});

test('money2 rounds to 2 decimals', () => {
  assert.equal(money2(10.005), 10.01);
  assert.equal(money2(10.004), 10);
});

test('validatePositiveAmount rejects negative values', () => {
  assert.equal(validatePositiveAmount(-1).ok, false);
  assert.equal(validatePositiveAmount(0).ok, true);
});

test('validateStrictPositive rejects zero', () => {
  assert.equal(validateStrictPositive(0).ok, false);
  assert.equal(validateStrictPositive(1).ok, true);
});

test('validateDateRange rejects end before start', () => {
  const r = validateDateRange('2026-06-01', '2026-05-01');
  assert.equal(r.ok, false);
});

test('validatePartyBody requires name', () => {
  assert.equal(validatePartyBody({}).ok, false);
  const ok = validatePartyBody({ name: 'Acme Ltd', email: 'a@b.co.ke' });
  assert.equal(ok.ok, true);
});

test('validateItemBody enforces name', () => {
  assert.equal(validateItemBody({ item_code: 'SKU1' }).ok, false);
});

test('validateEmployeeBody enforces hire/termination order', () => {
  const bad = validateEmployeeBody({
    first_name: 'Jane',
    last_name: 'Doe',
    hire_date: '2026-06-01',
    termination_date: '2026-01-01',
  });
  assert.equal(bad.ok, false);
});

test('rowsToCsv escapes commas', () => {
  const csv = rowsToCsv([{ a: 'hello, world' }]);
  assert.match(csv, /"hello, world"/);
});
