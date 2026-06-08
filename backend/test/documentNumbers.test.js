const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextSequentialNo } = require('../src/lib/documentNumbers');

test('nextSequentialNo increments suffix', async () => {
  const seen = new Set();
  const client = {
    query: async () => ({
      rowCount: seen.size ? 1 : 0,
      rows: seen.size ? [{ doc_no: `INV-2026-${String(seen.size).padStart(4, '0')}` }] : [],
    }),
  };
  const first = await nextSequentialNo(client, {
    companyId: 'c1',
    table: 'erp_customer_invoices',
    column: 'invoice_no',
    prefix: 'INV',
  });
  seen.add(first);
  const second = await nextSequentialNo(client, {
    companyId: 'c1',
    table: 'erp_customer_invoices',
    column: 'invoice_no',
    prefix: 'INV',
  });
  assert.match(first, /^INV-2026-\d{4}$/);
  assert.notEqual(first, second);
});
