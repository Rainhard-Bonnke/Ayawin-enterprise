const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");
const { applyDueFutureEffectiveEvents } = require("../src/services/hrComplianceService");
const payrollService = require("../src/services/payrollService");

const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

test("Phase G remaining workflows are available for claims, profile changes, scheduling, and retention", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");
  const admin = await userService.findUserByEmail(adminEmail);
  if (!admin) return t.skip("Requires the configured ERP administrator");

  const selfUserId = crypto.randomUUID();
  const reviewerId = crypto.randomUUID();
  const selfEmail = `phaseg-${unique.toLowerCase()}@example.test`;
  const selfUsername = `phaseg-${unique.toLowerCase()}`;
  const reviewerEmail = `phaseg-reviewer-${unique.toLowerCase()}@example.test`;
  const reviewerUsername = `phaseg-reviewer-${unique.toLowerCase()}`;
  const employeeCode = `PHASEG-${unique}`;
  let employeeId;
  let payrollRunId;
  let leaveApplicationId;
  let guardedLeaveApplicationId;
  let retentionPolicyId;
  const leaveRuleIds = [];
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    await pool.query(
      `INSERT INTO erp_users (id,company_id,role_id,username,email,full_name,status,created_by)
        VALUES ($1,$2,$3,$4,$5,'Phase G Employee','active',$6),
          ($7,$2,$3,$8,$9,'Phase G Reviewer','active',$6)
        ON CONFLICT (company_id, email) DO NOTHING`,
            [selfUserId, admin.company_id, admin.role_id, selfUsername, selfEmail, admin.id,
         reviewerId, reviewerUsername, reviewerEmail],
    );

    const employee = await pool.query(
      `INSERT INTO erp_employees
         (company_id,employee_code,first_name,last_name,email,department,job_title,employment_type,
          hire_date,basic_salary,is_active,created_by)
       VALUES ($1,$2,'Phase','G',$3,'Operations','Operator','permanent',CURRENT_DATE,50000,TRUE,$4)
       RETURNING id`,
      [admin.company_id, employeeCode, selfEmail, admin.id],
    );
    employeeId = employee.rows[0].id;
    await pool.query("UPDATE erp_employees SET user_id=$3 WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id, selfUserId]);

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const authHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
    const adminToken = tokenService.generateAccessToken(admin);
    const selfUser = await userService.findUserById(selfUserId);
    const selfToken = tokenService.generateAccessToken(selfUser);
    const reviewer = await userService.findUserById(reviewerId);
    const reviewerToken = tokenService.generateAccessToken(reviewer);

    const claimResponse = await fetch(`${baseUrl}/hr/me/claims`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({
        claim_date: "2026-11-14",
        description: "Field trip and mileage",
        currency_code: "KES",
        total_amount: 1250.50,
        category: "TRAVEL",
      }),
    });
    const claimBody = await claimResponse.text();
    assert.equal(claimResponse.status, 201, claimBody);
    const claim = JSON.parse(claimBody);
    assert.equal(claim.status, "submitted");
    const selfClaimsResponse = await fetch(`${baseUrl}/hr/me/claims`, { headers: authHeaders(selfToken) });
    const selfClaims = await selfClaimsResponse.json();
    assert.equal(selfClaimsResponse.status, 200);
    assert.equal(selfClaims.some((row) => row.id === claim.id), true);

    const claimDecision = await fetch(`${baseUrl}/hr/claims/${claim.id}/decision`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
      body: JSON.stringify({ decision: "approved", decision_note: "Approved by HR" }),
    });
    const claimDecisionBody = await claimDecision.text();
    assert.equal(claimDecision.status, 200, claimDecisionBody);
    assert.equal(JSON.parse(claimDecisionBody).status, "approved");

    const paidWithoutReference = await fetch(`${baseUrl}/hr/claims/${claim.id}/decision`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
      body: JSON.stringify({ decision: "paid" }),
    });
    assert.equal(paidWithoutReference.status, 400);

    const paidClaim = await fetch(`${baseUrl}/hr/claims/${claim.id}/decision`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
      body: JSON.stringify({ decision: "paid", payment_reference: `PAY-${unique}` }),
    });
    const paidClaimBody = await paidClaim.text();
    assert.equal(paidClaim.status, 200, paidClaimBody);
    assert.equal(JSON.parse(paidClaimBody).payment_reference, `PAY-${unique}`);

    const profileRequest = await fetch(`${baseUrl}/hr/me/profile-change-requests`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({
        field_name: "department",
        new_value: "Finance",
      }),
    });
    const profileRequestBody = await profileRequest.text();
    assert.equal(profileRequest.status, 201, profileRequestBody);
    const request = JSON.parse(profileRequestBody);
    assert.equal(request.status, "pending");
    const invalidProfileRequest = await fetch(`${baseUrl}/hr/me/profile-change-requests`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({ field_name: "email", new_value: "not-an-email" }),
    });
    assert.equal(invalidProfileRequest.status, 400);

    const requestDecision = await fetch(`${baseUrl}/hr/profile-change-requests/${request.id}/decision`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
      body: JSON.stringify({ decision: "approved", decision_note: "Department update approved" }),
    });
    const requestDecisionBody = await requestDecision.text();
    assert.equal(requestDecision.status, 200, requestDecisionBody);
    const updatedRequest = JSON.parse(requestDecisionBody);
    assert.equal(updatedRequest.status, "approved");
    const changedEmployee = await pool.query("SELECT department FROM erp_employees WHERE id=$1", [employeeId]);
    assert.equal(changedEmployee.rows[0].department, "Finance");

    const leaveRule = await fetch(`${baseUrl}/hr/payroll/leave-rules`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        leave_type_id: (await pool.query("SELECT id FROM erp_leave_types WHERE company_id=$1 AND is_active=TRUE AND is_deleted=FALSE ORDER BY code LIMIT 1", [admin.company_id])).rows[0].id,
        payroll_deduction_percent: 50,
        paid_leave_requires_balance: true,
      }),
    });
    const leaveRuleBody = await leaveRule.text();
    assert.equal(leaveRule.status, 201, leaveRuleBody);
    const rule = JSON.parse(leaveRuleBody);
    leaveRuleIds.push(rule.id);
    assert.equal(Number(rule.payroll_deduction_percent), 50);

    const invalidLeaveRule = await fetch(`${baseUrl}/hr/payroll/leave-rules`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ leave_type_id: rule.leave_type_id, payroll_deduction_percent: 150 }),
    });
    assert.equal(invalidLeaveRule.status, 400);

    const futurePayrollRuleResponse = await fetch(`${baseUrl}/hr/payroll/leave-rules`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        leave_type_id: rule.leave_type_id,
        payroll_deduction_percent: 50,
        paid_leave_requires_balance: true,
        minimum_balance_days: 5,
        effective_from: "9998-12-01",
      }),
    });
    const futurePayrollRuleBody = await futurePayrollRuleResponse.text();
    assert.equal(futurePayrollRuleResponse.status, 201, futurePayrollRuleBody);
    const futurePayrollRule = JSON.parse(futurePayrollRuleBody);
    leaveRuleIds.push(futurePayrollRule.id);

    await pool.query(
      `INSERT INTO erp_leave_balances (company_id,employee_id,leave_type_id,balance_days,created_by)
       VALUES ($1,$2,$3,6,$4) ON CONFLICT (employee_id,leave_type_id)
       DO UPDATE SET balance_days=6,updated_by=$4`,
      [admin.company_id, employeeId, rule.leave_type_id, admin.id],
    );
    const guardedLeaveResponse = await fetch(`${baseUrl}/hr/me/leave-applications`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({
        leave_type_id: rule.leave_type_id,
        start_date: "9998-12-10",
        end_date: "9998-12-11",
        days_requested: 2,
        reason: "Phase G minimum balance test",
      }),
    });
    const guardedLeaveBody = await guardedLeaveResponse.text();
    assert.equal(guardedLeaveResponse.status, 201, guardedLeaveBody);
    guardedLeaveApplicationId = JSON.parse(guardedLeaveBody).id;
    const blockedApproval = await fetch(`${baseUrl}/hr/leave-applications/${guardedLeaveApplicationId}/approve`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
    });
    assert.equal(blockedApproval.status, 400);
    assert.match((await blockedApproval.json()).error, /retain at least 5/);
    const unchangedLeave = await pool.query(
      `SELECT application.status,balance.balance_days
       FROM erp_leave_applications application
       JOIN erp_leave_balances balance ON balance.company_id=application.company_id
         AND balance.employee_id=application.employee_id AND balance.leave_type_id=application.leave_type_id
       WHERE application.id=$1`,
      [guardedLeaveApplicationId],
    );
    assert.equal(unchangedLeave.rows[0].status, "pending");
    assert.equal(Number(unchangedLeave.rows[0].balance_days), 6);

    const leaveApplication = await pool.query(
      `INSERT INTO erp_leave_applications
         (company_id,employee_id,leave_type_id,application_no,start_date,end_date,days_requested,status,created_by)
       VALUES ($1,$2,$3,$4,'9998-12-10','9998-12-11',2,'approved',$5) RETURNING id`,
      [admin.company_id, employeeId, rule.leave_type_id, `PHASEG-LA-${unique}`, admin.id],
    );
    leaveApplicationId = leaveApplication.rows[0].id;
    const payrollRun = await payrollService.runPayroll({
      companyId: admin.company_id,
      userId: admin.id,
      payrollMonth: "9998-12",
    });
    payrollRunId = payrollRun.run_id;
    const leaveSlip = await pool.query(
      `SELECT gross_pay,other_deductions,deductions_detail,payroll_rules
       FROM erp_payslips WHERE payroll_run_id=$1 AND employee_id=$2`,
      [payrollRunId, employeeId],
    );
    assert.equal(leaveSlip.rowCount, 1);
    const leaveDetail = leaveSlip.rows[0].deductions_detail.find((item) => item.code === "LEAVE");
    assert.equal(Number(leaveDetail.amount), 1612.9);
    assert.equal(leaveSlip.rows[0].payroll_rules.leave_rule_deductions.length, 1);

    const scheduleResponse = await fetch(`${baseUrl}/hr/future-events`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        entity_type: "erp_employees",
        entity_id: employeeId,
        field_name: "job_title",
        new_value: "Senior Operator",
        effective_date: new Date().toISOString().slice(0, 10),
      }),
    });
    const scheduleBody = await scheduleResponse.text();
    assert.equal(scheduleResponse.status, 201, scheduleBody);
    const schedule = JSON.parse(scheduleBody);
    assert.equal(schedule.entity_type, "erp_employees");
    assert.equal(schedule.status, "pending");
    const invalidSchedule = await fetch(`${baseUrl}/hr/future-events`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        entity_type: "erp_employees",
        entity_id: employeeId,
        field_name: "job_title",
        new_value: "Invalid Date Role",
        effective_date: "2026-99-99",
      }),
    });
    assert.equal(invalidSchedule.status, 400);

    const scheduleDecision = await fetch(`${baseUrl}/hr/future-events/${schedule.id}/decision`, {
      method: "POST",
      headers: authHeaders(reviewerToken),
      body: JSON.stringify({ decision: "approved", decision_note: "Approved effective today" }),
    });
    const scheduleDecisionBody = await scheduleDecision.text();
    assert.equal(scheduleDecision.status, 200, scheduleDecisionBody);
    assert.equal(JSON.parse(scheduleDecisionBody).status, "scheduled");

    const scheduleRun = await applyDueFutureEffectiveEvents({ companyId: admin.company_id, eventIds: [schedule.id] });
    assert.deepEqual(scheduleRun, { processed: 1, applied: 1, cancelled: 0 });
    const appliedSchedule = await pool.query(
      "SELECT status FROM erp_hr_future_effective_events WHERE id=$1",
      [schedule.id],
    );
    const scheduledEmployee = await pool.query("SELECT job_title FROM erp_employees WHERE id=$1", [employeeId]);
    assert.equal(appliedSchedule.rows[0].status, "applied");
    assert.equal(scheduledEmployee.rows[0].job_title, "Senior Operator");

    const retentionResponse = await fetch(`${baseUrl}/hr/retention-policies`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        policy_name: "HR file retention",
        data_type: "employee_documents",
        retention_days: 2555,
        archival_required: true,
      }),
    });
    const retentionBody = await retentionResponse.text();
    assert.equal(retentionResponse.status, 201, retentionBody);
    const policy = JSON.parse(retentionBody);
    retentionPolicyId = policy.id;
    assert.equal(policy.retention_days, 2555);
    const invalidPolicy = await fetch(`${baseUrl}/hr/retention-policies`, {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ policy_name: "Invalid target", data_type: "users", retention_days: 30 }),
    });
    assert.equal(invalidPolicy.status, 400);
    const policyStatus = await fetch(`${baseUrl}/hr/retention-policies/${policy.id}/status`, {
      method: "PATCH",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ status: "inactive" }),
    });
    assert.equal(policyStatus.status, 200);
    assert.equal((await policyStatus.json()).status, "inactive");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (payrollRunId) await pool.query("DELETE FROM erp_payroll_runs WHERE id=$1 AND company_id=$2", [payrollRunId, admin.company_id]);
    if (leaveApplicationId) await pool.query("DELETE FROM erp_leave_applications WHERE id=$1 AND company_id=$2", [leaveApplicationId, admin.company_id]);
    if (guardedLeaveApplicationId) await pool.query("DELETE FROM erp_leave_applications WHERE id=$1 AND company_id=$2", [guardedLeaveApplicationId, admin.company_id]);
    if (employeeId) {
      await pool.query("DELETE FROM erp_employee_profile_change_requests WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_hr_future_effective_events WHERE entity_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employee_claims WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_leave_balances WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id]);
    }
    if (leaveRuleIds.length) await pool.query("DELETE FROM erp_payroll_leave_rules WHERE id=ANY($1::uuid[])", [leaveRuleIds]);
    if (retentionPolicyId) await pool.query("DELETE FROM erp_hr_retention_policies WHERE id=$1 AND company_id=$2", [retentionPolicyId, admin.company_id]);
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [selfUserId, admin.company_id]);
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [reviewerId, admin.company_id]);
  }
});
