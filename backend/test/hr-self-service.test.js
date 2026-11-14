const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

const unique = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const dateOnly = (value) => value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : String(value).slice(0, 10);

test("employee self-service exposes leave balances and encashments", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");
  const admin = await userService.findUserByEmail(adminEmail);
  if (!admin) return t.skip("Requires the configured ERP administrator");

  const leaveType = await pool.query(
    "SELECT id, name, days_per_year, accrual_method, encashment_allowed FROM erp_leave_types WHERE company_id=$1 AND is_active=TRUE AND is_deleted=FALSE ORDER BY code LIMIT 1",
    [admin.company_id],
  );
  if (!leaveType.rowCount) return t.skip("Requires an active leave type");

  const selfUserId = crypto.randomUUID();
  const selfEmail = `leave-balance-${unique.toLowerCase()}@example.test`;
  const selfUsername = `leave-balance-${unique.toLowerCase()}`;
  const employeeCode = `LEAVE-${unique}`;
  let employeeId;
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    await pool.query(
      `INSERT INTO erp_users (id,company_id,role_id,username,email,full_name,status,created_by)
       VALUES ($1,$2,$3,$4,$5,'Leave Balance Employee','active',$6)`,
      [selfUserId, admin.company_id, admin.role_id, selfUsername, selfEmail, admin.id],
    );
    const employee = await pool.query(
      `INSERT INTO erp_employees
         (company_id,employee_code,first_name,last_name,email,department,job_title,employment_type,
          hire_date,basic_salary,is_active,user_id,created_by)
       VALUES ($1,$2,'Leave','Balance',$3,'Operations','Operator','permanent',CURRENT_DATE,50000,TRUE,$4,$5)
       RETURNING id`,
      [admin.company_id, employeeCode, selfEmail, selfUserId, admin.id],
    );
    employeeId = employee.rows[0].id;

    await pool.query(
      `UPDATE erp_leave_types
       SET encashment_allowed = TRUE
       WHERE id=$1 AND company_id=$2`,
      [leaveType.rows[0].id, admin.company_id],
    );
    await pool.query(
      `INSERT INTO erp_leave_balances (company_id,employee_id,leave_type_id,balance_days,created_by,accrued_through)
       VALUES ($1,$2,$3,7,$4,CURRENT_DATE - INTERVAL '1 month')
       ON CONFLICT (employee_id, leave_type_id) DO UPDATE SET balance_days = EXCLUDED.balance_days, updated_at = NOW()`,
      [admin.company_id, employeeId, leaveType.rows[0].id, admin.id],
    );

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const selfToken = tokenService.generateAccessToken(await userService.findUserById(selfUserId));
    const balanceResponse = await fetch(`${baseUrl}/hr/me/leave-balances`, {
      headers: { Authorization: `Bearer ${selfToken}` },
    });
    const balanceBody = await balanceResponse.text();
    assert.equal(balanceResponse.status, 200, balanceBody);
    const balances = JSON.parse(balanceBody);
    assert.ok(Array.isArray(balances));
    assert.ok(balances.some((row) => String(row.leave_type_id) === String(leaveType.rows[0].id)));

    const encashResponse = await fetch(`${baseUrl}/hr/me/leave-balances/encash`, {
      method: "POST",
      headers: { Authorization: `Bearer ${selfToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ leave_type_id: leaveType.rows[0].id, days: 2 }),
    });
    const encashBody = await encashResponse.text();
    assert.equal(encashResponse.status, 200, encashBody);
    const encash = JSON.parse(encashBody);
    assert.equal(Number(encash.remaining_balance), 5);
    assert.equal(encash.leave_type_id, leaveType.rows[0].id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (employeeId) {
      await pool.query("DELETE FROM erp_leave_balances WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id]);
    }
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [selfUserId, admin.company_id]);
  }
});

test("employee self-service isolates records, submits leave, and exposes released payslips only", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");
  const admin = await userService.findUserByEmail(adminEmail);
  if (!admin) return t.skip("Requires the configured ERP administrator");

  const leaveType = await pool.query(
    "SELECT id FROM erp_leave_types WHERE company_id=$1 AND is_active=TRUE AND is_deleted=FALSE ORDER BY code LIMIT 1",
    [admin.company_id],
  );
  if (!leaveType.rowCount) return t.skip("Requires an active leave type");

  const selfUserId = crypto.randomUUID();
  const selfEmail = `self-service-${unique.toLowerCase()}@example.test`;
  const selfUsername = `self-service-${unique.toLowerCase()}`;
  const employeeCode = `SELF-${unique}`;
  let employeeId;
  let leaveApplicationId;
  const payrollRunIds = [];
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const authHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  try {
    await pool.query(
      `INSERT INTO erp_users (id,company_id,role_id,username,email,full_name,status,created_by)
       VALUES ($1,$2,$3,$4,$5,'Self Service Test Employee','active',$6)`,
      [selfUserId, admin.company_id, admin.role_id, selfUsername, selfEmail, admin.id],
    );
    const employee = await pool.query(
      `INSERT INTO erp_employees
         (company_id,employee_code,first_name,last_name,email,department,job_title,employment_type,
          hire_date,basic_salary,is_active,created_by)
       VALUES ($1,$2,'Self','Service',$3,'Operations','Operator','permanent',CURRENT_DATE,50000,TRUE,$4)
       RETURNING id`,
      [admin.company_id, employeeCode, selfEmail, admin.id],
    );
    employeeId = employee.rows[0].id;
    await pool.query(
      `INSERT INTO erp_leave_balances(company_id,employee_id,leave_type_id,balance_days,created_by)
       VALUES($1,$2,$3,5,$4)`,
      [admin.company_id, employeeId, leaveType.rows[0].id, admin.id],
    );
    await pool.query(
      `INSERT INTO erp_attendance(company_id,employee_id,attendance_date,hours_worked,status)
       VALUES($1,$2,CURRENT_DATE,8,'present')`,
      [admin.company_id, employeeId],
    );

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
    const mismatchedLink = await fetch(`${baseUrl}/hr/employees/${employeeId}/link-user`, {
      method: "POST",
      headers: authHeaders(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({ email: `wrong-${selfEmail}` }),
    });
    assert.equal(mismatchedLink.status, 400);
    assert.match((await mismatchedLink.json()).error, /exactly match/);

    const link = await fetch(`${baseUrl}/hr/employees/${employeeId}/link-user`, {
      method: "POST",
      headers: authHeaders(tokenService.generateAccessToken(admin)),
      body: JSON.stringify({ email: selfEmail }),
    });
    assert.equal(link.status, 200, await link.text());

    const selfToken = tokenService.generateAccessToken(await userService.findUserById(selfUserId));
    const profileResponse = await fetch(`${baseUrl}/hr/me`, { headers: authHeaders(selfToken) });
    assert.equal(profileResponse.status, 200);
    const profile = await profileResponse.json();
    assert.equal(profile.id, employeeId);
    assert.equal(profile.employee_code, employeeCode);
    assert.equal(Object.hasOwn(profile, "national_id_encrypted"), false);
    assert.equal(Object.hasOwn(profile, "bank_account_no"), false);

    const attendanceResponse = await fetch(`${baseUrl}/hr/me/attendance`, { headers: authHeaders(selfToken) });
    assert.equal(attendanceResponse.status, 200);
    const ownAttendance = await attendanceResponse.json();
    assert.equal(ownAttendance.length, 1);
    assert.equal(ownAttendance[0].hours_worked, "8.00");

    const from = await pool.query("SELECT (CURRENT_DATE + 10)::text AS start_date");
    const startDate = from.rows[0].start_date;
    const end = new Date(`${startDate}T12:00:00`);
    end.setDate(end.getDate() + 1);
    const endDate = dateOnly(end);
    const leaveRequest = await fetch(`${baseUrl}/hr/me/leave-applications`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({
        employee_id: crypto.randomUUID(),
        leave_type_id: leaveType.rows[0].id,
        start_date: startDate,
        end_date: endDate,
        days_requested: 2,
        reason: "Personal leave request for integration test",
      }),
    });
    const leave = await leaveRequest.json();
    assert.equal(leaveRequest.status, 201, JSON.stringify(leave));
    leaveApplicationId = leave.id;
    assert.match(leave.application_no, /^LA-\d{4}-\d{4}$/);

    const overlappingRequest = await fetch(`${baseUrl}/hr/me/leave-applications`, {
      method: "POST",
      headers: authHeaders(selfToken),
      body: JSON.stringify({
        leave_type_id: leaveType.rows[0].id,
        start_date: startDate,
        end_date: endDate,
        days_requested: 1,
        reason: "Overlapping leave request must be refused",
      }),
    });
    assert.equal(overlappingRequest.status, 400);
    assert.match((await overlappingRequest.json()).error, /overlaps/);

    const approve = await fetch(`${baseUrl}/hr/leave-applications/${leaveApplicationId}/approve`, {
      method: "POST",
      headers: authHeaders(tokenService.generateAccessToken(admin)),
    });
    assert.equal(approve.status, 200, await approve.text());
    const remaining = await pool.query(
      "SELECT balance_days FROM erp_leave_balances WHERE company_id=$1 AND employee_id=$2 AND leave_type_id=$3",
      [admin.company_id, employeeId, leaveType.rows[0].id],
    );
    assert.equal(Number(remaining.rows[0].balance_days), 3);

    for (const [runNo, status] of [[`SELF-REL-${unique}`, "released"], [`SELF-POST-${unique}`, "posted"]]) {
      const run = await pool.query(
        `INSERT INTO erp_payroll_runs(company_id,run_no,payroll_month,status,created_by)
         VALUES($1,$2,CURRENT_DATE,$3,$4) RETURNING id`,
        [admin.company_id, runNo, status, admin.id],
      );
      payrollRunIds.push(run.rows[0].id);
      await pool.query(
        `INSERT INTO erp_payslips(company_id,payroll_run_id,employee_id,gross_pay,paye,net_pay,created_by)
         VALUES($1,$2,$3,50000,5000,45000,$4)`,
        [admin.company_id, run.rows[0].id, employeeId, admin.id],
      );
    }
    const payslipsResponse = await fetch(`${baseUrl}/hr/me/payslips`, { headers: authHeaders(selfToken) });
    assert.equal(payslipsResponse.status, 200);
    const ownPayslips = await payslipsResponse.json();
    assert.equal(ownPayslips.length, 1);
    assert.equal(ownPayslips[0].run_no, `SELF-REL-${unique}`);
    assert.equal(Number(ownPayslips[0].net_pay), 45000);

    const unlinkedAdminResponse = await fetch(`${baseUrl}/hr/me`, {
      headers: authHeaders(tokenService.generateAccessToken(admin)),
    });
    assert.equal(unlinkedAdminResponse.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (leaveApplicationId) await pool.query("DELETE FROM erp_leave_applications WHERE id=$1 AND company_id=$2", [leaveApplicationId, admin.company_id]);
    if (payrollRunIds.length) await pool.query("DELETE FROM erp_payroll_runs WHERE id=ANY($1::uuid[]) AND company_id=$2", [payrollRunIds, admin.company_id]);
    if (employeeId) {
      await pool.query("DELETE FROM erp_attendance WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_leave_balances WHERE employee_id=$1 AND company_id=$2", [employeeId, admin.company_id]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1 AND company_id=$2", [employeeId, admin.company_id]);
    }
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [selfUserId, admin.company_id]);
  }
});
