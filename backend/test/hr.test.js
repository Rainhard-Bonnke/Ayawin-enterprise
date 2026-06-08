const test = require('node:test');
const assert = require('node:assert/strict');
const hr = require('../src/services/hrService');

test('employee completeness detects missing fields', () => {
  const r = hr.checkEmployeeCompleteness({ employee_code: 'E1', first_name: 'Jane', last_name: 'Doe' });
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes('hire_date'));
});

test('leave calendar returns daily availability', async () => {
  const { getTestContext } = require('./e2e/helpers');
  const ctx = await getTestContext();
  const cal = await hr.getLeaveCalendar(ctx.companyId, '2026-05-01', '2026-05-07');
  assert.ok(cal.days.length >= 7);
  assert.equal(typeof cal.days[0].available_count, 'number');
  assert.equal(typeof cal.days[0].on_leave_count, 'number');
});
