const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const gl = require("../../src/services/glPostingService");

test("rebuilding GL balances reproduces the persisted period balances", async () => {
  const { companyId } = await getTestContext();
  const before = await pool.query(
    `SELECT fiscal_period_id,account_id,opening_debit,opening_credit,period_debit,period_credit,closing_debit,closing_credit
     FROM erp_gl_balances WHERE company_id=$1 AND is_deleted=FALSE ORDER BY fiscal_period_id,account_id`, [companyId]);
  await gl.rebuildGlBalances(pool, companyId);
  const after = await pool.query(
    `SELECT fiscal_period_id,account_id,opening_debit,opening_credit,period_debit,period_credit,closing_debit,closing_credit
     FROM erp_gl_balances WHERE company_id=$1 AND is_deleted=FALSE ORDER BY fiscal_period_id,account_id`, [companyId]);
  assert.deepEqual(after.rows, before.rows);
});
