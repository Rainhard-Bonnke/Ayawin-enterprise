-- Module 6 seed: leave, holidays, contracts, May 2026 payroll

INSERT INTO erp_payroll_config (company_id, country_code, paye_bands, nhif_brackets)
SELECT c.id, 'KE',
  '[{"min":0,"max":24000,"rate":10},{"min":24001,"max":32333,"rate":25},{"min":32334,"max":500000,"rate":30},{"min":500001,"max":800000,"rate":32.5},{"min":800001,"max":null,"rate":35}]'::jsonb,
  '[{"min":0,"max":5999,"amount":150},{"min":6000,"max":7999,"amount":300},{"min":8000,"max":11999,"amount":400},{"min":12000,"max":14999,"amount":500},{"min":15000,"max":19999,"amount":600},{"min":20000,"max":24999,"amount":750},{"min":25000,"max":29999,"amount":850},{"min":30000,"max":34999,"amount":900},{"min":35000,"max":39999,"amount":950},{"min":40000,"max":44999,"amount":1000},{"min":45000,"max":49999,"amount":1100},{"min":50000,"max":59999,"amount":1200},{"min":60000,"max":69999,"amount":1300},{"min":70000,"max":79999,"amount":1400},{"min":80000,"max":89999,"amount":1500},{"min":90000,"max":99999,"amount":1600},{"min":100000,"max":null,"amount":1700}]'::jsonb
FROM erp_companies c WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_payroll_config pc WHERE pc.company_id = c.id);

INSERT INTO erp_leave_types (company_id, code, name, days_per_year, accrual_method)
SELECT c.id, v.code, v.name, v.days, v.method
FROM erp_companies c
CROSS JOIN (VALUES
  ('ANNUAL', 'Annual Leave', 21, 'annual'),
  ('SICK', 'Sick Leave', 14, 'annual'),
  ('MAT', 'Maternity Leave', 90, 'none')
) AS v(code, name, days, method)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_leave_types lt WHERE lt.company_id = c.id AND lt.code = v.code);

INSERT INTO erp_holidays (company_id, holiday_date, name)
SELECT c.id, v.dt::date, v.name
FROM erp_companies c
CROSS JOIN (VALUES
  ('2026-01-01', 'New Year'),
  ('2026-05-01', 'Labour Day'),
  ('2026-06-01', 'Madaraka Day'),
  ('2026-10-20', 'Mashujaa Day'),
  ('2026-12-12', 'Jamhuri Day'),
  ('2026-12-25', 'Christmas Day')
) AS v(dt, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_holidays h WHERE h.company_id = c.id AND h.holiday_date = v.dt::date);

INSERT INTO erp_employee_contracts (company_id, employee_id, contract_type, start_date, basic_salary, house_allowance, transport_allowance)
SELECT c.id, e.id, e.employment_type, COALESCE(e.hire_date, '2020-01-01'::date),
       e.basic_salary, e.basic_salary * 0.15, 3000
FROM erp_companies c
JOIN erp_employees e ON e.company_id = c.id AND e.is_active = TRUE
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_employee_contracts ec WHERE ec.employee_id = e.id AND ec.status = 'active');

INSERT INTO erp_leave_balances (company_id, employee_id, leave_type_id, balance_days)
SELECT c.id, e.id, lt.id, lt.days_per_year
FROM erp_companies c
JOIN erp_employees e ON e.company_id = c.id
JOIN erp_leave_types lt ON lt.company_id = c.id AND lt.code = 'ANNUAL'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_leave_balances b WHERE b.employee_id = e.id AND b.leave_type_id = lt.id);

-- May 2026 payroll run (posted)
INSERT INTO erp_payroll_runs (company_id, run_no, payroll_month, status, posted_at)
SELECT c.id, 'PR-2026-05', '2026-05-01'::date, 'posted', NOW()
FROM erp_companies c WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_payroll_runs pr WHERE pr.company_id = c.id AND pr.run_no = 'PR-2026-05');
