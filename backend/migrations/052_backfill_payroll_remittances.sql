-- Backfill statutory obligations for payroll runs posted before the remittance register existed.
INSERT INTO erp_payroll_statutory_remittances (
  company_id, payroll_run_id, agency_code, liability_account_code, amount_due, created_by
)
SELECT pr.company_id, pr.id, v.agency_code, v.liability_account_code, v.amount_due, pr.created_by
FROM erp_payroll_runs pr
JOIN LATERAL (
  SELECT 'KRA_PAYE'::TEXT AS agency_code, '2110'::TEXT AS liability_account_code,
         COALESCE(SUM(ps.paye), 0)::numeric(18,2) AS amount_due
  FROM erp_payslips ps WHERE ps.payroll_run_id = pr.id AND ps.company_id = pr.company_id AND ps.is_deleted = FALSE
  UNION ALL
  SELECT 'NSSF', '2120', COALESCE(SUM(ps.nssf + ps.nssf_employer), 0)::numeric(18,2)
  FROM erp_payslips ps WHERE ps.payroll_run_id = pr.id AND ps.company_id = pr.company_id AND ps.is_deleted = FALSE
  UNION ALL
  SELECT 'SHA_SHIF', '2130', COALESCE(SUM(ps.shif + ps.nhif), 0)::numeric(18,2)
  FROM erp_payslips ps WHERE ps.payroll_run_id = pr.id AND ps.company_id = pr.company_id AND ps.is_deleted = FALSE
  UNION ALL
  SELECT 'AHL', '2140', COALESCE(SUM(ps.housing_levy + ps.housing_levy_employer), 0)::numeric(18,2)
  FROM erp_payslips ps WHERE ps.payroll_run_id = pr.id AND ps.company_id = pr.company_id AND ps.is_deleted = FALSE
) v ON v.amount_due > 0
WHERE pr.status = 'posted' AND pr.is_deleted = FALSE
ON CONFLICT (company_id, payroll_run_id, agency_code) DO NOTHING;
