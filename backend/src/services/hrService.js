const pool = require('../db');
const { validateDateRange } = require('../lib/validators');
const piiCrypto = require('../lib/piiCrypto');

const EMPLOYEE_MANDATORY_FIELDS = [
  'employee_code',
  'first_name',
  'last_name',
  'hire_date',
  'department',
  'job_title',
  'id_number',
  'tax_pin',
  'basic_salary',
];

function checkEmployeeCompleteness(row) {
  const missing = EMPLOYEE_MANDATORY_FIELDS.filter((f) => {
    const v = row[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  return { complete: missing.length === 0, missing };
}

async function assertEmployeeInCompany(companyId, employeeId) {
  const r = await pool.query(
    `SELECT id FROM erp_employees WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [employeeId, companyId],
  );
  if (!r.rowCount) throw new Error('Employee not found');
  return r.rows[0];
}

async function getLeaveBalance(client, employeeId, leaveTypeId) {
  const r = await client.query(
    `SELECT * FROM erp_leave_balances WHERE employee_id = $1 AND leave_type_id = $2`,
    [employeeId, leaveTypeId],
  );
  return r.rows[0] || null;
}

async function approveLeaveApplication({ companyId, userId, applicationId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const app = await client.query(
      `SELECT * FROM erp_leave_applications WHERE id = $1 AND company_id = $2 AND status = 'pending' FOR UPDATE`,
      [applicationId, companyId],
    );
    if (!app.rowCount) throw new Error('Application not found or not pending');

    const row = app.rows[0];
    await assertEmployeeInCompany(companyId, row.employee_id);

    const balance = await getLeaveBalance(client, row.employee_id, row.leave_type_id);
    const days = Number(row.days_requested || 0);
    if (!balance) {
      throw new Error('No leave balance record for this employee and leave type');
    }
    if (Number(balance.balance_days) < days) {
      throw new Error(`Insufficient leave balance (${balance.balance_days} days available, ${days} requested)`);
    }

    await client.query(
      `UPDATE erp_leave_applications SET status = 'approved', approved_by = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [applicationId, companyId, userId],
    );

    await client.query(
      `UPDATE erp_leave_balances SET balance_days = balance_days - $3, updated_at = NOW()
       WHERE employee_id = $1 AND leave_type_id = $2`,
      [row.employee_id, row.leave_type_id, days],
    );

    const dr = validateDateRange(row.start_date, row.end_date, { startLabel: 'Start', endLabel: 'End' });
    if (!dr.ok) throw new Error(dr.error);

    for (let d = new Date(row.start_date); d <= new Date(row.end_date); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      await client.query(
        `INSERT INTO erp_attendance (company_id, employee_id, attendance_date, status, hours_worked, source, created_by)
         VALUES ($1,$2,$3,'leave',0,'leave_approval',$4)
         ON CONFLICT (employee_id, attendance_date) DO UPDATE SET status = 'leave', hours_worked = 0, updated_at = NOW()`,
        [companyId, row.employee_id, dateStr, userId],
      );
    }

    await client.query('COMMIT');
    const balAfter = await getLeaveBalance(client, row.employee_id, row.leave_type_id);
    return { ok: true, balance_after: Number(balAfter?.balance_days ?? 0) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function resolveEmployeeId(companyId, row) {
  if (row.employee_id) return row.employee_id;
  const code = row.employee_code || row.code;
  if (!code) return null;
  const emp = await pool.query(
    `SELECT id FROM erp_employees WHERE company_id = $1 AND employee_code = $2 AND is_deleted = FALSE LIMIT 1`,
    [companyId, code],
  );
  return emp.rows[0]?.id || null;
}

async function importAttendance({ companyId, userId, rows }) {
  if (!rows?.length) throw new Error('rows array required');
  let imported = 0;
  for (const row of rows) {
    const employeeId = await resolveEmployeeId(companyId, row);
    if (!employeeId || !row.attendance_date) {
      throw new Error('Each row requires employee_id or employee_code and attendance_date');
    }
    await assertEmployeeInCompany(companyId, employeeId);
    await pool.query(
      `INSERT INTO erp_attendance (company_id, employee_id, attendance_date, check_in, check_out, hours_worked, overtime_hours, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import',$9)
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         hours_worked = EXCLUDED.hours_worked,
         overtime_hours = EXCLUDED.overtime_hours,
         status = EXCLUDED.status,
         company_id = EXCLUDED.company_id,
         updated_at = NOW()`,
      [
        companyId,
        employeeId,
        row.attendance_date,
        row.check_in || null,
        row.check_out || null,
        row.hours_worked ?? 8,
        row.overtime_hours ?? 0,
        row.status || 'present',
        userId,
      ],
    );
    imported += 1;
  }
  return { ok: true, imported };
}

async function getLeaveCalendar(companyId, fromDate, toDate) {
  const from = fromDate || new Date().toISOString().slice(0, 10);
  const to = toDate || from;

  const [employees, onLeave, holidays] = await Promise.all([
    pool.query(
      `SELECT id, employee_code, first_name, last_name, department, job_title
       FROM erp_employees WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE
       ORDER BY department, last_name`,
      [companyId],
    ),
    pool.query(
      `SELECT la.employee_id, la.start_date, la.end_date, la.days_requested, la.status,
              e.first_name, e.last_name, e.department, lt.name AS leave_type_name
       FROM erp_leave_applications la
       JOIN erp_employees e ON e.id = la.employee_id
       JOIN erp_leave_types lt ON lt.id = la.leave_type_id
       WHERE la.company_id = $1 AND la.status = 'approved' AND la.is_deleted = FALSE
         AND la.end_date >= $2::date AND la.start_date <= $3::date`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT holiday_date, name FROM erp_holidays
       WHERE company_id = $1 AND is_deleted = FALSE AND holiday_date BETWEEN $2::date AND $3::date`,
      [companyId, from, to],
    ),
  ]);

  const days = [];
  const cursor = new Date(from);
  const end = new Date(to);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const holiday = holidays.rows.find((h) => String(h.holiday_date).slice(0, 10) === dateStr);
    const away = onLeave.rows.filter((l) => {
      const s = String(l.start_date).slice(0, 10);
      const e = String(l.end_date).slice(0, 10);
      return dateStr >= s && dateStr <= e;
    });
    const awayIds = new Set(away.map((a) => a.employee_id));
    const available = employees.rows.filter((e) => !awayIds.has(e.id));
    days.push({
      date: dateStr,
      is_holiday: Boolean(holiday),
      holiday_name: holiday?.name || null,
      on_leave_count: away.length,
      available_count: available.length,
      total_active: employees.rowCount,
      on_leave: away.map((a) => ({
        employee_id: a.employee_id,
        name: `${a.first_name} ${a.last_name}`.trim(),
        department: a.department,
        leave_type: a.leave_type_name,
      })),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { from, to, days, employees: employees.rows };
}

async function listEmployeesWithCompleteness(companyId, q = '') {
  const result = await pool.query(
    `SELECT e.*, b.name AS branch_name
     FROM erp_employees e
     LEFT JOIN erp_branches b ON b.id = e.branch_id
     WHERE e.company_id = $1 AND e.is_deleted = FALSE
       AND ($2 = '' OR e.first_name ILIKE '%' || $2 || '%' OR e.last_name ILIKE '%' || $2 || '%' OR e.employee_code ILIKE '%' || $2 || '%')
     ORDER BY e.last_name, e.first_name`,
    [companyId, q],
  );
  return result.rows.map((row) => {
    const decrypted = piiCrypto.mergeEmployeeRow(row);
    const { complete, missing } = checkEmployeeCompleteness(decrypted);
    return { ...decrypted, profile_complete: complete, missing_fields: missing };
  });
}

module.exports = {
  EMPLOYEE_MANDATORY_FIELDS,
  checkEmployeeCompleteness,
  approveLeaveApplication,
  importAttendance,
  getLeaveCalendar,
  listEmployeesWithCompleteness,
  assertEmployeeInCompany,
};
