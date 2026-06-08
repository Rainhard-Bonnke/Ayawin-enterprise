const test = require('node:test');
const assert = require('node:assert/strict');
const tax = require('../src/lib/taxEngine');

test('beer line excise and VAT', () => {
  const line = tax.calcLineTaxes({
    quantity: 10,
    unitPrice: 200,
    category: 'Beer',
    litresPerUnit: 0.5,
  });
  assert.equal(line.lineSubtotal, 2000);
  assert.equal(line.lineExcise, 609.25);
  assert.equal(line.lineVat, 417.48);
  assert.equal(line.lineTotal, 3026.73);
});

test('spirits excise rate', () => {
  const line = tax.calcLineTaxes({
    quantity: 2,
    unitPrice: 1000,
    category: 'Spirits',
    litresPerUnit: 0.75,
  });
  assert.equal(line.lineExcise, tax.money(2 * 0.75 * 356.28));
  assert.ok(line.lineVat > 0);
});

test('wine and soft drinks excise', () => {
  const wine = tax.calcLineTaxes({ quantity: 1, unitPrice: 500, category: 'Wine', litresPerUnit: 0.75 });
  const soft = tax.calcLineTaxes({ quantity: 12, unitPrice: 70, category: 'Soft Drinks', litresPerUnit: 0.5 });
  assert.ok(wine.lineExcise > soft.lineExcise || wine.lineExcise > 100);
  assert.ok(soft.lineExcise > 0);
});

test('aggregate totals', () => {
  const a = tax.calcLineTaxes({ quantity: 1, unitPrice: 100, category: 'Water', litresPerUnit: 1 });
  const b = tax.calcLineTaxes({ quantity: 2, unitPrice: 50, category: 'Soft Drinks', litresPerUnit: 0.5 });
  const totals = tax.aggregateLines([a, b]);
  assert.ok(totals.total > totals.subtotal);
});
