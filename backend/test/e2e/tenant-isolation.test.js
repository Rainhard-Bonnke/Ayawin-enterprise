const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../../src/db");
const { ensureErpFoundation } = require("../../src/erpBootstrap");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
if (!process.env.MFA_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY.length < 32 || process.env.MFA_ENCRYPTION_KEY === process.env.JWT_SECRET) process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(48).toString("hex");
if (!process.env.INTEGRATION_ENCRYPTION_KEY || process.env.INTEGRATION_ENCRYPTION_KEY.length < 32 || process.env.INTEGRATION_ENCRYPTION_KEY === process.env.JWT_SECRET) process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(48).toString("hex");

const userService = require("../../src/services/userService");
const tokenService = require("../../src/services/tokenService");
const { app } = require("../../src/index");

test("tenant-scoped routes hide other-company records and ignore import company spoofing", async () => {
  await ensureErpFoundation();
  const userResult = await pool.query(
    `SELECT c.id AS company_id, u.id AS user_id
     FROM erp_companies c
     JOIN erp_users u ON u.company_id = c.id AND LOWER(u.email) = LOWER($2) AND u.is_deleted = FALSE
     WHERE c.code = $1 AND c.is_deleted = FALSE
     LIMIT 1`,
    ["MARTIN", process.env.ADMIN_EMAIL],
  );
  assert.equal(userResult.rowCount, 1, "E2E administrator must exist in the seeded ERP company");
  const context = { companyId: userResult.rows[0].company_id, userId: userResult.rows[0].user_id };
  const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const foreignCompany = await pool.query(
    "INSERT INTO erp_companies (code, name) VALUES ($1, $2) RETURNING id",
    [`ISO-${unique}`, `Isolation test ${unique}`],
  );
  const foreignCompanyId = foreignCompany.rows[0].id;
  const foreignCustomer = await pool.query(
    `INSERT INTO erp_customers (company_id, customer_code, name)
     VALUES ($1, $2, $3) RETURNING id`,
    [foreignCompanyId, `FOREIGN-${unique}`, `Foreign ${unique}`],
  );
  const importedCode = `IMPORT-${unique}`;
  const importFileName = `tenant-isolation-${unique}.csv`;
  const user = await userService.findUserById(context.userId);
  const accessToken = tokenService.generateAccessToken(user);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  try {
    const foreignRecord = await fetch(`${baseUrl}/api/v1/master/customers/${foreignCustomer.rows[0].id}`, { headers });
    assert.equal(foreignRecord.status, 404);

    const importResponse = await fetch(`${baseUrl}/api/v1/platform/import`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        company_id: foreignCompanyId,
        entity_type: "customers",
        file_name: importFileName,
        rows: [{ customer_code: importedCode, name: "Authenticated tenant import" }],
      }),
    });
    assert.equal(importResponse.status, 201, await importResponse.text());

    const importedRows = await pool.query(
      "SELECT company_id FROM erp_customers WHERE customer_code = $1",
      [importedCode],
    );
    assert.equal(importedRows.rowCount, 1);
    assert.equal(importedRows.rows[0].company_id, context.companyId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("DELETE FROM erp_import_jobs WHERE company_id = $1 AND file_name = $2", [context.companyId, importFileName]);
    await pool.query("DELETE FROM erp_customers WHERE company_id = $1 AND customer_code = $2", [context.companyId, importedCode]);
    await pool.query("DELETE FROM erp_customers WHERE company_id = $1 AND customer_code = $2", [foreignCompanyId, `FOREIGN-${unique}`]);
    await pool.query("DELETE FROM erp_companies WHERE id = $1", [foreignCompanyId]);
  }
});