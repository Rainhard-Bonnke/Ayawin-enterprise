const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const pool = require("../src/db");
const payroll = require("../src/services/payrollService");

const unique = crypto.randomUUID().replaceAll("-", "");

test("payroll requires independent approval and locking before posting", async (t) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return t.skip("Requires configured ADMIN_EMAIL");

  const companyResult = await pool.query(
    `SELECT c.id AS company_id,u.id AS user_id,u.role_id
     FROM erp_companies c
     JOIN erp_users u ON u.company_id=c.id AND LOWER(u.email)=LOWER($2) AND u.is_deleted=FALSE
     WHERE c.code=$1 AND c.is_deleted=FALSE LIMIT 1`,
    ["MARTIN", adminEmail],
  );
  if (!companyResult.rowCount) return t.skip("Requires the configured ERP administrator");

  const { company_id: companyId, user_id: preparerId, role_id: roleId } = companyResult.rows[0];
  const reviewerId = crypto.randomUUID();
  const reviewerEmail = `payroll-reviewer-${unique}@example.test`;
  const runNo = `PR-WORKFLOW-${unique}`;
  let runId;

  try {
    await pool.query(
      `INSERT INTO erp_users (id,company_id,role_id,username,email,full_name,status,created_by)
       VALUES ($1,$2,$3,$4,$5,'Payroll Reviewer Test','active',$6)`,
      [reviewerId, companyId, roleId, `reviewer-${unique}`, reviewerEmail, preparerId],
    );
    const run = await pool.query(
      `INSERT INTO erp_payroll_runs (company_id,run_no,payroll_month,status,created_by)
       VALUES ($1,$2,DATE_TRUNC('month',CURRENT_DATE)::date,'calculated',$3)
       RETURNING id`,
      [companyId, runNo, preparerId],
    );
    runId = run.rows[0].id;

    await assert.rejects(
      () => payroll.approvePayrollRun({ companyId, userId: preparerId, runId }),
      /creator cannot approve/,
    );

    const approved = await payroll.approvePayrollRun({ companyId, userId: reviewerId, runId });
    assert.equal(approved.status, "approved");
    assert.equal(approved.approved_by, reviewerId);

    await assert.rejects(
      () => payroll.approvePayrollRun({ companyId, userId: preparerId, runId }),
      /Only a calculated payroll run can be approved/,
    );

    const locked = await payroll.lockPayrollRun({ companyId, userId: reviewerId, runId });
    assert.equal(locked.status, "locked");
    assert.equal(locked.locked_by, reviewerId);

    await assert.rejects(
      () => payroll.approvePayrollRun({ companyId, userId: preparerId, runId }),
      /Only a calculated payroll run can be approved/,
    );
  } finally {
    if (runId) await pool.query("DELETE FROM erp_payroll_runs WHERE id=$1 AND company_id=$2", [runId, companyId]);
    await pool.query("DELETE FROM erp_users WHERE id=$1 AND company_id=$2", [reviewerId, companyId]);
  }
});
