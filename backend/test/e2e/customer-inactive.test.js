const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestContext, getCustomerId, getItemId, pool } = require('./helpers');
const sales = require('../../src/services/salesService');

test('E2E inactive customer cannot create sales order', async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'COKE-500');

  await pool.query(
    `UPDATE erp_customers SET is_active = FALSE WHERE id = $1 AND company_id = $2`,
    [customerId, ctx.companyId],
  );

  await assert.rejects(
    () => sales.createSalesOrder({
      companyId: ctx.companyId,
      userId: ctx.userId,
      customerId,
      warehouseId: ctx.warehouseId,
      lines: [{ item_id: itemId, quantity: 1, unit_price: 70 }],
    }),
    /inactive/i,
  );

  await pool.query(
    `UPDATE erp_customers SET is_active = TRUE WHERE id = $1 AND company_id = $2`,
    [customerId, ctx.companyId],
  );
});
