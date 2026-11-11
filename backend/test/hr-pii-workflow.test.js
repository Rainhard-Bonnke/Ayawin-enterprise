const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();

test("hire encrypts employee identifiers and every privileged PII read is audited", async () => {
  const user = await userService.findUserByEmail(process.env.ADMIN_EMAIL);
  assert.ok(user, "configured administrator must exist");
  const token = tokenService.generateAccessToken(user);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let employeeId;
  const nationalId = "12345678";
  const kraPin = "A123456789Z";
  const nssfNumber = "1234567890";
  const shaNumber = "SHA12345678";
  const bankAccount = "0123456789012";
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const hire = await fetch(`${baseUrl}/api/v1/hr/employees/hire`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        employee_code: `PII-${unique}`,
        first_name: "Privacy",
        last_name: "Test",
        hire_date: new Date().toISOString().slice(0, 10),
        contract_type: "probation",
        basic_salary: 50000,
        national_id: nationalId,
        kra_pin: kraPin,
        nssf_number: nssfNumber,
        sha_number: shaNumber,
        bank_account_no: bankAccount,
        onboarding_checklist: { contract_signed: true },
        documents: [{ document_type: "contract", storage_key: `test/${unique}/contract.pdf` }],
      }),
    });
    const hired = await hire.json();
    assert.equal(hire.status, 201, JSON.stringify(hired));
    employeeId = hired.id;

    const stored = await pool.query(
      `SELECT id_number,tax_pin,bank_account_no,national_id_encrypted,kra_pin_encrypted,
              nssf_number_encrypted,sha_number_encrypted,bank_account_no_encrypted
       FROM erp_employees WHERE id=$1 AND company_id=$2`,
      [employeeId, user.company_id],
    );
    assert.equal(stored.rows[0].id_number, null);
    assert.equal(stored.rows[0].tax_pin, null);
    assert.equal(stored.rows[0].bank_account_no, null);
    for (const column of ["national_id_encrypted", "kra_pin_encrypted", "nssf_number_encrypted", "sha_number_encrypted", "bank_account_no_encrypted"]) {
      assert.ok(stored.rows[0][column]);
    }
    assert.ok(!JSON.stringify(stored.rows[0]).includes(nationalId));

    const employees = await fetch(`${baseUrl}/api/v1/hr/employees?q=PII-${unique}`, { headers });
    assert.equal(employees.status, 200);
    const listed = await employees.json();
    assert.equal(listed.length, 1);
    assert.equal(JSON.stringify(listed).includes(nationalId), false);
    assert.equal(JSON.stringify(listed).includes(kraPin), false);
    assert.equal(JSON.stringify(listed).includes(bankAccount), false);

    const sensitive = await fetch(
      `${baseUrl}/api/v1/hr/employees/${employeeId}/sensitive?purpose=${encodeURIComponent("Payroll verification test")}`,
      { headers },
    );
    assert.equal(sensitive.status, 200);
    const pii = await sensitive.json();
    assert.equal(pii.national_id, nationalId);
    assert.equal(pii.kra_pin, kraPin);
    assert.equal(pii.nssf_number, nssfNumber);
    assert.equal(pii.sha_number, shaNumber);
    assert.equal(pii.bank_account_no, bankAccount);

    const accessLog = await pool.query(
      `SELECT COUNT(*)::int AS count FROM erp_employee_pii_access_log
       WHERE employee_id=$1 AND accessed_by=$2 AND purpose=$3`,
      [employeeId, user.id, "Payroll verification test"],
    );
    assert.equal(accessLog.rows[0].count, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (employeeId) {
      await pool.query("DELETE FROM erp_employee_pii_access_log WHERE employee_id=$1", [employeeId]);
      await pool.query("DELETE FROM erp_employee_lifecycle_events WHERE employee_id=$1", [employeeId]);
      await pool.query("DELETE FROM erp_employee_contracts WHERE employee_id=$1", [employeeId]);
      await pool.query("DELETE FROM erp_employee_onboarding WHERE employee_id=$1", [employeeId]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1", [employeeId]);
    }
  }
});
