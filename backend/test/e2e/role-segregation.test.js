const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");

test("no seeded non-admin role holds order maker, approver, invoice poster and receipt maker permissions together", async () => {
  const ctx = await getTestContext();
  const result = await pool.query(
    `SELECT role.name,ARRAY_AGG(permission.code) FILTER(WHERE permission.code IS NOT NULL) AS codes
     FROM erp_roles role
     LEFT JOIN erp_role_permissions rp ON rp.role_id=role.id AND rp.company_id=role.company_id
     LEFT JOIN erp_permissions permission ON permission.id=rp.permission_id
     WHERE role.company_id=$1 AND role.is_deleted=FALSE GROUP BY role.id,role.name`, [ctx.companyId],
  );
  const forbiddenSet = ["sales.order.create","sales.order.approve","sales.invoice.post","sales.receipt.create"];
  for (const role of result.rows.filter((row) => !["Admin","System Administrator"].includes(row.name))) {
    const held = new Set(role.codes || []);
    assert.ok(!forbiddenSet.every((code) => held.has(code)), `${role.name} can create, approve, post and receipt the same flow`);
  }
});
