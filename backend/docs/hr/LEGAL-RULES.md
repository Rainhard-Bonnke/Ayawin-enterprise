# HR legal rules and policy sources for Kenya

This file records the official legal and regulatory sources used for the HR module. The values are stored as configurable data in the database table erp_hr_legal_rules and are designed to be changed without code changes when labour rules or policy rates change.

## Source policy records

### Leave and working time
- Rule: annual_leave_days = 21
  - Source: Employment Act, 2007
  - Source date: 2007-01-01
  - URL: https://www.kenyalaw.org/kl/index.php?id=327
  - Note: Annual leave entitlement is a legal rule and is configurable via the legal-rules table.
- Rule: overtime_normal_rate_multiplier = 1.5
  - Source: Employment Act, 2007
  - Source date: 2007-01-01
  - URL: https://www.kenyalaw.org/kl/index.php?id=327
  - Note: Normal overtime premium applies beyond normal working hours.
- Rule: overtime_rest_day_multiplier = 2
  - Source: Employment Act, 2007
  - Source date: 2007-01-01
  - URL: https://www.kenyalaw.org/kl/index.php?id=327
  - Note: Rest day or public holiday overtime premium is higher than normal overtime.

### Termination and final dues
- Rule: notice_period_days = 30
  - Source: Employment Act, 2007
  - Source date: 2007-01-01
  - URL: https://www.kenyalaw.org/kl/index.php?id=327
  - Note: Termination notice is configured as a formal legal value, not a hard-coded service rule.
- Rule: minimum_final_dues_days = 14
  - Source: Employment Act, 2007
  - Source date: 2007-01-01
  - URL: https://www.kenyalaw.org/kl/index.php?id=327
  - Note: Final dues and leave accruals are subject to legal calculation and review.

### Payroll statutory rules
- Rule: nssf_employee_rate = 0.06
  - Source: National Social Security Fund Act / NSSF rates guidance
  - Source date: 2024-01-01
  - URL: https://www.nssf.or.ke/
  - Note: Used as a configurable payroll statutory parameter.
- Rule: housing_levy_rate = 0.015
  - Source: Housing Levy Act
  - Source date: 2024-01-01
  - URL: https://www.kenya.go.ke/
  - Note: Housing levy is a configurable statutory payroll input.

## Governance
- All values above are stored in erp_hr_legal_rules by company and rule group.
- Changes require approval and are reviewed against the legal source and effective date before being promoted.
- Application logic reads the table values instead of embedding legal numbers directly in code.
- This protects the HR implementation against statutory changes without a code deployment.
