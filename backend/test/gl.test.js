const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLinesBalanced } = require('../src/services/glPostingService');

test('balanced journal passes validation', () => {
  const lines = [
    { debit: 1000, credit: 0 },
    { debit: 0, credit: 1000 },
  ];
  const t = validateLinesBalanced(lines);
  assert.equal(t.totalDebit, 1000);
  assert.equal(t.totalCredit, 1000);
});

test('unbalanced journal throws', () => {
  assert.throws(
    () => validateLinesBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 50 }]),
    /not balanced/,
  );
});
