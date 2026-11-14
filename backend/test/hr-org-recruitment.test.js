const test = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/db");
const { app } = require("../src/index");
const userService = require("../src/services/userService");
const tokenService = require("../src/services/tokenService");

test("org structure and recruitment workflow create valid records and allow conversion to employee onboarding", async () => {
  const user = await userService.findUserByEmail(process.env.ADMIN_EMAIL);
  assert.ok(user, "configured administrator must exist");
  const token = tokenService.generateAccessToken(user);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let deptId = null;
  let positionId = null;
  let requisitionId = null;
  let vacancyId = null;
  let candidateId = null;
  let offerId = null;
  let employeeId = null;

  try {
    const department = await fetch(`${baseUrl}/api/v1/hr/org/departments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code: `HR-${Date.now()}`.slice(0, 12), name: "Operations" }),
    });
    const dept = await department.json();
    assert.equal(department.status, 201, JSON.stringify(dept));
    deptId = dept.id;

    const position = await fetch(`${baseUrl}/api/v1/hr/org/positions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ department_id: deptId, code: `POS-${Date.now()}`.slice(0, 12), title: "Operations Officer", grade: "G2", headcount_budget: 2, reports_to: null }),
    });
    const pos = await position.json();
    assert.equal(position.status, 201, JSON.stringify(pos));
    positionId = pos.id;

    const requisition = await fetch(`${baseUrl}/api/v1/hr/recruitment/requisitions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requisition_no: `REQ-${Date.now()}`, position_id: positionId, department_id: deptId, headcount_needed: 1, reason: "Growth required" }),
    });
    const req = await requisition.json();
    assert.equal(requisition.status, 201, JSON.stringify(req));
    requisitionId = req.id;

    const vacancy = await fetch(`${baseUrl}/api/v1/hr/recruitment/vacancies`, {
      method: "POST",
      headers,
      body: JSON.stringify({ position_id: positionId, department_id: deptId, title: "Operations Officer", description: "Operations coverage", closing_date: "2026-12-31" }),
    });
    const vac = await vacancy.json();
    assert.equal(vacancy.status, 201, JSON.stringify(vac));
    vacancyId = vac.id;

    const candidate = await fetch(`${baseUrl}/api/v1/hr/recruitment/candidates`, {
      method: "POST",
      headers,
      body: JSON.stringify({ vacancy_id: vacancyId, first_name: "Jane", last_name: "Kariuki", email: "jane.k@example.com", phone: "+254700000001", consent_signed: true }),
    });
    const cand = await candidate.json();
    assert.equal(candidate.status, 201, JSON.stringify(cand));
    candidateId = cand.id;

    const offer = await fetch(`${baseUrl}/api/v1/hr/recruitment/offers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ candidate_id: candidateId, offer_no: `OFF-${Date.now()}`, proposed_salary: 55000, status: "approved" }),
    });
    const off = await offer.json();
    assert.equal(offer.status, 201, JSON.stringify(off));
    offerId = off.id;

    const hire = await fetch(`${baseUrl}/api/v1/hr/recruitment/convert-candidate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ candidate_id: candidateId, employee_code: `EMP-${Date.now()}`.slice(0, 12), first_name: "Jane", last_name: "Kariuki", email: "jane.k@example.com", department: "Operations", job_title: "Operations Officer", hire_date: "2026-11-15", contract_type: "probation", basic_salary: 55000 }),
    });
    const hired = await hire.json();
    assert.equal(hire.status, 201, JSON.stringify(hired));
    employeeId = hired.id;

    const org = await fetch(`${baseUrl}/api/v1/hr/org/chart`, { headers });
    assert.equal(org.status, 200);
    const orgData = await org.json();
    assert.ok(Array.isArray(orgData));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (offerId) await pool.query("DELETE FROM erp_candidate_offers WHERE id=$1", [offerId]);
    if (candidateId) await pool.query("DELETE FROM erp_candidates WHERE id=$1", [candidateId]);
    if (vacancyId) await pool.query("DELETE FROM erp_vacancies WHERE id=$1", [vacancyId]);
    if (requisitionId) await pool.query("DELETE FROM erp_manpower_requisitions WHERE id=$1", [requisitionId]);
    if (positionId) await pool.query("DELETE FROM erp_org_positions WHERE id=$1", [positionId]);
    if (deptId) await pool.query("DELETE FROM erp_org_departments WHERE id=$1", [deptId]);
    if (employeeId) {
      await pool.query("DELETE FROM erp_employee_contracts WHERE employee_id=$1", [employeeId]);
      await pool.query("DELETE FROM erp_employees WHERE id=$1", [employeeId]);
    }
  }
});
