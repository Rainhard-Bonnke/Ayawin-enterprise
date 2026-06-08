# HR & Payroll checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Employee records complete — all mandatory fields | **PASS** | `validateEmployeeBody(..., { forCreate: true })` + `hrService.checkEmployeeCompleteness`; `GET /hr/employees` returns `profile_complete` / `missing_fields` |
| 2 | Attendance records link to correct employee and date | **PASS** | `UNIQUE (employee_id, attendance_date)`; import validates `assertEmployeeInCompany`; join on `employee_id` + `company_id` |
| 3 | Leave balance deducts correctly on approval | **PASS** | `hrService.approveLeaveApplication` — balance check, deduct `days_requested`, reject if insufficient |
| 4 | Leave calendar shows team availability | **PASS** | `GET /hr/leave-calendar?from_date=&to_date=`; UI **Team calendar** tab |
| 5 | Payroll computation: gross → PAYE → NHIF → NSSF → Housing → net | **PASS** | `computePayslip` in `payrollService.js` |
| 6 | PAYE tax bands apply correctly (Kenya 2024 rates) | **PASS** | Default bands in config/seed; `calculatePaye` progressive bands |
| 7 | NHIF deduction correct per salary band | **PASS** | `calculateNhif` + bracket table in `erp_payroll_config` |
| 8 | NSSF tier I and tier II correct | **PASS** | Tier I: 6% on first KES 7,000; Tier II: 6% on KES 7,001–36,000; itemized on payslip |
| 9 | Housing Levy 1.5% of gross correct | **PASS** | `calculateHousingLevy(gross, 1.5)` |
| 10 | Payslip PDF renders cleanly — all deductions itemized | **PASS** | `payslipPdfService` uses `deductions_detail` (PAYE, NHIF, NSSF tiers, housing, etc.) |
| 11 | Payroll cannot be processed twice for same month/employee | **PASS** | Blocks posted month; per-employee posted payslip check; `UNIQUE (payroll_run_id, employee_id)` |

## Mandatory employee fields

`employee_code`, `first_name`, `last_name`, `hire_date`, `department`, `job_title`, `id_number`, `tax_pin` (KRA format), `basic_salary`

## Key files

- `backend/src/services/hrService.js`
- `backend/src/services/payrollService.js`
- `backend/src/services/payslipPdfService.js`
- `backend/src/routes/v1/hr.js`
- `backend/src/routes/v1/payroll.js`
- `src/routes/_app.hr.tsx`

## Tests

- `backend/test/payroll.test.js`
- `backend/test/hr.test.js`
- `backend/test/e2e/payroll-flow.test.js`
