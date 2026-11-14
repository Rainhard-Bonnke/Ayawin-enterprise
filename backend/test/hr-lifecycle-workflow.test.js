const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const dateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

test("employee lifecycle changes require independent review and effective-date application", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");

  const admin = await userService.findUserByEmail(adminEmail);
  if (!admin) return t.skip("Requires the configured ERP administrator");
  const branches = await pool.query(
    "SELECT id FROM erp_branches WHERE company_id=$1 AND is_deleted=FALSE ORDER BY code LIMIT 2",
    [admin.company_id],
  );
  if (!branches.rowCount) return t.skip("Requires an ERP branch");

  const reviewerId = crypto.randomUUID();
  const linkedUserId = crypto.randomUUID();
  const reviewerEmail = `lifecycle-reviewer-${unique}@example.test`;
  const linkedEmail = `lifecycle-employee-${unique}@example.test`;
  let employeeId;
  let refreshTokenId;
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    await pool.query(
      `INSERT INTO erp_users (id,company_id,role_id,username,email,full_name,status,created_by)
       VALUES ($1,$2,$3,$4,$5,'Lifecycle Reviewer','active',$6),
              ($7,$2,$3,$8,$9,'Lifecycle Employee Account','active',$6)`,
      [reviewerId, admin.company_id, admin.role_id, `lifecycle-reviewer-${unique.toLowerCase()}`,
        reviewerEmail, admin.id, linkedUserId, `lifecycle-employee-${unique.toLowerCase()}`, linkedEmail],
    );
    const reviewer = await userService.findUserById(reviewerId);
    const headers = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/hr`;
    const hireDate = "2020-01-01";
    const hire = await fetch(`${baseUrl}/employees/hire`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        employee_code: `LIFECYCLE-${unique}`,
        first_name: "Lifecycle",
        last_name: "Test",
        hire_date: hireDate,
        contract_type: "probation",
        basic_salary: 50000,
        branch_id: branches.rows[0].id,
      }),
    });
    const hired = await hire.json();
    assert.equal(hire.status, 201, JSON.stringify(hired));
    employeeId = hired.id;
    await pool.query("UPDATE erp_employees SET user_id=$3 WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id, linkedUserId]);

    const today = new Date();
    const todayString = dateString(today);
    const salaryRequest = await fetch(`${baseUrl}/employees/${employeeId}/lifecycle-events`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        event_type: "salary_change",
        effective_date: todayString,
        requested_values: { basic_salary: 62000 },
      }),
    });
    const salaryEvent = await salaryRequest.json();
    assert.equal(salaryRequest.status, 201, JSON.stringify(salaryEvent));

    const selfApproval = await fetch(`${baseUrl}/employee-lifecycle-events/${salaryEvent.id}/decision`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({ decision: "approved", decision_note: "Reviewed the salary change" }),
    });
    assert.equal(selfApproval.status, 400);
    assert.match((await selfApproval.json()).error, /creator cannot approve/);

    const approveSalary = await fetch(`${baseUrl}/employee-lifecycle-events/${salaryEvent.id}/decision`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
      body: JSON.stringify({ decision: "approved", decision_note: "Approved after manager review" }),
    });
    assert.equal(approveSalary.status, 200);
    assert.equal((await approveSalary.json()).status, "approved");

    const applySalary = await fetch(`${baseUrl}/employee-lifecycle-events/${salaryEvent.id}/apply`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
    });
    const salaryApplied = await applySalary.json();
    assert.equal(applySalary.status, 200, JSON.stringify(salaryApplied));
    assert.equal(salaryApplied.status, "applied");

    const salaryState = await pool.query(
      `SELECT employee.basic_salary,contract.basic_salary AS contract_salary,contract.start_date::text AS start_date
       FROM erp_employees employee
       JOIN erp_employee_contracts contract ON contract.employee_id=employee.id AND contract.company_id=employee.company_id
       WHERE employee.id=$1 AND contract.status='active' AND contract.is_deleted=FALSE`,
      [employeeId],
    );
    assert.equal(Number(salaryState.rows[0].basic_salary), 62000);
    assert.equal(Number(salaryState.rows[0].contract_salary), 62000);
    assert.equal(salaryState.rows[0].start_date, todayString);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const destinationBranch = branches.rows[1]?.id || branches.rows[0].id;
    const futureRequest = await fetch(`${baseUrl}/employees/${employeeId}/lifecycle-events`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        event_type: "branch_transfer",
        effective_date: dateString(tomorrow),
        requested_values: { branch_id: destinationBranch },
      }),
    });
    const futureEvent = await futureRequest.json();
    assert.equal(futureRequest.status, 201, JSON.stringify(futureEvent));
    const approveFuture = await fetch(`${baseUrl}/employee-lifecycle-events/${futureEvent.id}/decision`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
      body: JSON.stringify({ decision: "approved", decision_note: "Approved for the scheduled branch move" }),
    });
    assert.equal(approveFuture.status, 200);
    const applyFuture = await fetch(`${baseUrl}/employee-lifecycle-events/${futureEvent.id}/apply`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
    });
    assert.equal(applyFuture.status, 400);
    assert.match((await applyFuture.json()).error, /not effective yet/);
    const branchState = await pool.query("SELECT branch_id FROM erp_employees WHERE id=$1", [employeeId]);
    assert.equal(branchState.rows[0].branch_id, branches.rows[0].id);

    const terminationRequest = await fetch(`${baseUrl}/employees/${employeeId}/lifecycle-events`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({
        event_type: "termination",
        effective_date: todayString,
        requested_values: { reason: "Employment ended after an approved separation review" },
      }),
    });
    const terminationEvent = await terminationRequest.json();
    assert.equal(terminationRequest.status, 201, JSON.stringify(terminationEvent));
    const approveTermination = await fetch(`${baseUrl}/employee-lifecycle-events/${terminationEvent.id}/decision`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
      body: JSON.stringify({ decision: "approved", decision_note: "Approved after independent HR review" }),
    });
    assert.equal(approveTermination.status, 200);

    const tokenRecord = await pool.query(
      `INSERT INTO erp_refresh_tokens (company_id,user_id,token_hash,expires_at,created_by)
       VALUES ($1,$2,$3,NOW()+INTERVAL '1 day',$4) RETURNING id`,
      [admin.company_id, linkedUserId, crypto.createHash("sha256").update(unique).digest("hex"), admin.id],
    );
    refreshTokenId = tokenRecord.rows[0].id;
    const applyTermination = await fetch(`${baseUrl}/employee-lifecycle-events/${terminationEvent.id}/apply`, {
      method: "POST",
      headers: headers(tokenService.generateAccessToken(reviewer)),
    });
    const terminationApplied = await applyTermination.json();
    assert.equal(applyTermination.status, 200, JSON.stringify(terminationApplied));
    assert.equal(terminationApplied.status, "applied");

    const offboarding = await pool.query(
      `SELECT employee.is_active,employee.termination_date::text AS termination_date,account.status,token.revoked_at
       FROM erp_employees employee
       JOIN erp_users account ON account.id=employee.user_id AND account.company_id=employee.company_id
       JOIN erp_refresh_tokens token ON token.user_id=account.id AND token.company_id=account.company_id
       WHERE employee.id=$1 AND token.id=$2`,
      [employeeId, refreshTokenId],
    );
    assert.equal(offboarding.rows[0].is_active, false);
    assert.equal(offboarding.rows[0].termination_date, todayString);
    assert.equal(offboarding.rows[0].status, "inactive");
    assert.ok(offboarding.rows[0].revoked_at);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (employeeId) {
      await pool.query("DELETE FROM erp_employee_lifecycle_events WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employee_contracts WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employee_onboarding WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id]);
    }
    if (refreshTokenId) await pool.query("DELETE FROM erp_refresh_tokens WHERE id=$1", [refreshTokenId]);
    await pool.query("DELETE FROM erp_users WHERE id=ANY($1::uuid[])", [[reviewerId, linkedUserId]]);
  }
});
