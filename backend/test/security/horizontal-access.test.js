const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { getTestContext, pool } = require('../e2e/helpers');
const sales = require('../../src/services/salesService');

test('cross-company payment is rejected', async () => {
  const ctx = await getTestContext();
  const inv = await pool.query(
    `SELECT id FROM erp_customer_invoices WHERE company_id = $1 LIMIT 1`,
    [ctx.companyId],
  );
  if (!inv.rowCount) {
    return; // skip when no invoices in seed
  }
  const fakeCompany = randomUUID();
  await assert.rejects(
    () =>
      sales.recordCustomerPayment({
        companyId: fakeCompany,
        userId: ctx.userId,
        invoiceId: inv.rows[0].id,
        amount: 1,
      }),
    /Invoice not found/,
  );
});
