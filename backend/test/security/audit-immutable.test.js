const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureErpFoundation } = require('../../src/erpBootstrap');
const { getTestContext, pool } = require('../e2e/helpers');

test('erp_audit_log rejects UPDATE and DELETE', async () => {
  await ensureErpFoundation();
  const ctx = await getTestContext();
  const row = await pool.query(
    `INSERT INTO erp_audit_log (company_id, user_id, entity_type, action, new_values)
     VALUES ($1, $2, 'test', 'security_check', '{"ok":true}'::jsonb)
     RETURNING id`,
    [ctx.companyId, ctx.userId],
  );
  const id = row.rows[0].id;

  await assert.rejects(
    () => pool.query('UPDATE erp_audit_log SET action = $1 WHERE id = $2', ['tamper', id]),
    /immutable/i,
  );
  await assert.rejects(
    () => pool.query('DELETE FROM erp_audit_log WHERE id = $1', [id]),
    /immutable/i,
  );
});
