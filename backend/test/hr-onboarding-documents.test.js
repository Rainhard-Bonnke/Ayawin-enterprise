const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

test("employee onboarding checklist and private documents are stored and visible to the linked employee", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");

  const admin = await userService.findUserByEmail(adminEmail);
  if (!admin) return t.skip("Requires the configured ERP administrator");

  const selfUserId = crypto.randomUUID();
  const selfEmail = `onboarding-${unique.toLowerCase()}@example.test`;
  const selfUsername = `onboarding-${unique.toLowerCase()}`;
  const employeeCode = `ONBOARD-${unique}`;
  let employeeId;
  let server;

  const headers = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  try {
    server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });

    await pool.query(
      `INSERT INTO erp_users (id, company_id, role_id, username, email, full_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Onboarding Employee', 'active', $6)`,
      [selfUserId, admin.company_id, admin.role_id, selfUsername, selfEmail, admin.id],
    );

    const hire = await pool.query(
      `INSERT INTO erp_employees (
         company_id, employee_code, first_name, last_name, email, department, job_title,
         employment_type, hire_date, basic_salary, is_active, created_by
       ) VALUES ($1, $2, 'Onboarding', 'Employee', $3, 'Operations', 'Coordinator',
         'permanent', CURRENT_DATE, 50000, TRUE, $4) RETURNING id`,
      [admin.company_id, employeeCode, selfEmail, admin.id],
    );
    employeeId = hire.rows[0].id;

    const link = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/employees/${employeeId}/link-user`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({ email: selfEmail }),
    });
    assert.equal(link.status, 200, await link.text());

    const selfToken = tokenService.generateAccessToken(await userService.findUserById(selfUserId));

    const docCreate = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/employees/${employeeId}/documents`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        document_type: "national_id",
        document_name: "ID copy",
        file_url: "https://example.test/docs/id.pdf",
        expiry_date: "2035-01-01",
        status: "active",
      }),
    });
    const createdDoc = await docCreate.json();
    assert.equal(docCreate.status, 201, JSON.stringify(createdDoc));

    const onboardingUpsert = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/employees/${employeeId}/onboarding`, {
      method: "PUT",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        status: "completed",
        checklist: {
          offer_accepted: true,
          contract_signed: true,
          induction_completed: true,
        },
        document_metadata: [
          { document_type: "national_id", document_name: "ID copy", verified: true },
        ],
      }),
    });
    const onboarding = await onboardingUpsert.json();
    assert.equal(onboardingUpsert.status, 200, JSON.stringify(onboarding));
    assert.equal(onboarding.status, "completed");
    assert.equal(onboarding.checklist.offer_accepted, true);

    const hrRead = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/employees/${employeeId}/onboarding`, {
      headers: headers(tokenService.generateAccessToken(admin)),
    });
    assert.equal(hrRead.status, 200);
    const hrOnboarding = await hrRead.json();
    assert.equal(hrOnboarding.status, "completed");

    const selfRead = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/me/onboarding`, {
      headers: headers(selfToken),
    });
    assert.equal(selfRead.status, 200);
    const selfOnboarding = await selfRead.json();
    assert.equal(selfOnboarding.status, "completed");

    const selfDocs = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/hr/me/documents`, {
      headers: headers(selfToken),
    });
    assert.equal(selfDocs.status, 200);
    const docs = await selfDocs.json();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].document_type, "national_id");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (employeeId) {
      await pool.query("DELETE FROM erp_employee_documents WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employee_onboarding WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id]);
    }
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [selfUserId, admin.company_id]);
  }
});
