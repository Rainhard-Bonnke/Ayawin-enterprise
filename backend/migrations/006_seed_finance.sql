-- Module 3 seed: fiscal year 2026 + sample GL entries

INSERT INTO erp_fiscal_years (company_id, year_label, start_date, end_date)
SELECT c.id, 'FY2026', '2026-01-01'::date, '2026-12-31'::date
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_fiscal_years fy WHERE fy.company_id = c.id AND fy.year_label = 'FY2026');

INSERT INTO erp_fiscal_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date, status)
SELECT c.id, fy.id, m.period_no,
       TO_CHAR(TO_DATE(m.period_no::text, 'MM'), 'Month YYYY'),
       (DATE '2026-01-01' + ((m.period_no - 1) || ' months')::interval)::date,
       ((DATE '2026-01-01' + (m.period_no || ' months')::interval) - INTERVAL '1 day')::date,
       CASE WHEN m.period_no <= 5 THEN 'open' ELSE 'open' END
FROM erp_companies c
JOIN erp_fiscal_years fy ON fy.company_id = c.id AND fy.year_label = 'FY2026'
CROSS JOIN generate_series(1, 12) AS m(period_no)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_fiscal_periods fp WHERE fp.fiscal_year_id = fy.id AND fp.period_no = m.period_no
  );

INSERT INTO erp_dimensions (company_id, dimension_type, code, name)
SELECT c.id, v.dtype, v.code, v.name
FROM erp_companies c
CROSS JOIN (VALUES
  ('department', 'SALES', 'Sales'),
  ('department', 'FINANCE', 'Finance'),
  ('department', 'WAREHOUSE', 'Warehouse'),
  ('cost_centre', 'CC-HQ', 'Head Office'),
  ('cost_centre', 'CC-MBA', 'Mombasa'),
  ('project', 'PRJ-001', 'ERP Rollout')
) AS v(dtype, code, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_dimensions d
    WHERE d.company_id = c.id AND d.dimension_type = v.dtype AND d.code = v.code
  );

-- Sample posted sales journal (May 2026)
INSERT INTO erp_journals (
  company_id, fiscal_period_id, journal_no, journal_type, entry_date, reference_no,
  description, status, posted_at, total_debit, total_credit
)
SELECT c.id, fp.id, 'JE-2026-0001', 'sales', '2026-05-19'::date, 'INV-2026-0531',
       'Invoice raised - Mombasa Liquor Distributors', 'posted', NOW(), 1350820, 1350820
FROM erp_companies c
JOIN erp_fiscal_periods fp ON fp.company_id = c.id AND fp.period_no = 5
JOIN erp_fiscal_years fy ON fy.id = fp.fiscal_year_id AND fy.year_label = 'FY2026'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_journals j WHERE j.company_id = c.id AND j.journal_no = 'JE-2026-0001');

INSERT INTO erp_journal_lines (
  company_id, journal_id, line_no, account_id, description, debit, credit, department
)
SELECT c.id, j.id, v.lno, a.id, v.descr, v.dr, v.cr, v.dept
FROM erp_journals j
JOIN erp_companies c ON c.id = j.company_id AND c.code = 'MARTIN'
CROSS JOIN (VALUES
  (1, '1200', 'AR - MLD invoice', 1350820, 0, 'SALES'),
  (2, '4000', 'Sales revenue', 0, 980000, 'SALES'),
  (3, '2200', 'VAT output', 0, 186320, 'FINANCE'),
  (4, '2100', 'Excise accrual placeholder', 0, 184500, 'FINANCE')
) AS v(lno, acode, descr, dr, cr, dept)
JOIN erp_chart_of_accounts a ON a.company_id = c.id AND a.account_code = v.acode
WHERE j.journal_no = 'JE-2026-0001'
  AND NOT EXISTS (
    SELECT 1 FROM erp_journal_lines jl WHERE jl.journal_id = j.id AND jl.line_no = v.lno
  );

-- GL balances for period 5
INSERT INTO erp_gl_balances (company_id, fiscal_period_id, account_id, period_debit, period_credit, closing_debit, closing_credit)
SELECT c.id, fp.id, a.id, v.pdr, v.pcr, v.pdr, v.pcr
FROM erp_companies c
JOIN erp_fiscal_periods fp ON fp.company_id = c.id AND fp.period_no = 5
JOIN erp_fiscal_years fy ON fy.id = fp.fiscal_year_id AND fy.year_label = 'FY2026'
JOIN erp_chart_of_accounts a ON a.company_id = c.id
JOIN (VALUES
  ('1200', 1350820, 0),
  ('4000', 0, 980000),
  ('2200', 0, 186320),
  ('2100', 0, 184500)
) AS v(acode, pdr, pcr) ON a.account_code = v.acode
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_gl_balances b WHERE b.fiscal_period_id = fp.id AND b.account_id = a.id
  );
