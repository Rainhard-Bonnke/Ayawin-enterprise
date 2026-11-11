# HR Officer UAT

## Setup
- Sign in as HR Officer using synthetic employee data and a disposable payroll month.
- Confirm employee statutory identifiers are test values and not real personal data.

## Journey
- Create or update an employee record and verify it appears in the employee register.
- Record attendance and submit a leave application; verify status and employee association.
- Create a draft payroll run, inspect payslips and the statutory report, then post only under the approved test procedure.
- Review the remittance register and verify amounts reconcile to the posted run.

## Authorization checks
- Verify the HR Officer cannot approve accounting-period closure, manage user roles, or access unrelated integration secrets.
- Verify no statutory filing export is presented as agency-approved; exports remain disabled until templates are verified.

## Result
- Record tester, date, company, build, evidence links, pass/fail, and defects. Delete synthetic employee data after the test cycle.
