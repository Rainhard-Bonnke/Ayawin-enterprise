# Production Readiness Checklist

Last updated: 2026-05-28

This checklist tracks production readiness for the ERP modules and platform services.

Status legend:
- PASS: Implemented and functional in live API mode.
- PARTIAL: Core flow works, but production controls/coverage are incomplete.
- FAIL: Not yet production-ready.

## 1) Core Platform

- Authentication/session (live API tokens only): PASS
- Demo fallback behavior removed from frontend runtime paths: PASS
- Role-based route access: PASS
- Audit logging view and API: PASS
- Live connectivity indicator in app shell: PASS
- Centralized health and readiness dashboard: PARTIAL

## 2) Sales & Invoicing

- Create sales orders (live DB): PASS
- Confirm order flow: PASS
- Dispatch flow (delivery posting): PASS
- Invoice creation from delivered lines: PASS
- Payment posting against invoices: PASS
- One-click process order (confirm -> dispatch -> invoice): PASS
- Batch process ready orders: PASS
- Server-side invoice PDF download: PASS
- Server-side receipt PDF download (paid invoices): PASS
- Advanced compliance templates (legal fields, verifiable hash, QR): PARTIAL

## 3) Inventory & Procurement

- Live stock listing and warehouse transfer/stock-in: PASS
- Validation for transfer and stock operations: PASS
- Procurement PO listing/approve/receive actions: PASS
- Procurement fallback demo behavior removed in API: PASS
- Reorder automation with approval workflow: PARTIAL
- Concurrency/race-condition controls under load: PARTIAL

## 4) Finance & Accounting

- Accounting snapshot loaded from live API: PASS
- Static fallback accounting cards/charts removed: PASS
- Invoice GL posting: PASS (with account-code guardrails)
- Payment GL posting (cash vs AR): PASS
- Full reconciliation workflows (bank, suspense, adjustments): PARTIAL
- Financial period close controls and lock windows: PARTIAL

## 5) HR & Payroll

- Employees loaded from live API: PASS
- Mock employee fallback removed in HR screen: PASS
- Payroll calculations visible in UI: PARTIAL (UI-level calculations)
- Payroll posting + statutory filing workflows end-to-end: PARTIAL
- Payslip generation as immutable legal docs: FAIL

## 6) Reports & Analytics

- Report catalog from live API library: PASS
- Static fallback report groups removed: PASS
- Dashboard uses live data paths only: PASS
- Scheduled report jobs and exports with retention policy: FAIL
- Drill-down traceability from KPI to source transactions: PARTIAL

## 7) Security, Reliability, and Ops

- Input validation added for key sales/inventory mutations: PASS
- Error handling for key user flows: PASS
- Backup/restore operational runbooks: PARTIAL
- Observability (metrics, traces, alert routing): PARTIAL
- SLO/SLA definitions and incident response playbook: FAIL
- CI quality gates (lint/test/e2e/blocking): PARTIAL
- Load/performance test evidence: FAIL

## 8) Testing Coverage

- Lint checks on edited files: PASS
- Integration tests for critical posting paths: PASS
- E2E journey coverage:
  - order -> delivery -> invoice -> payment -> receipt: PASS (critical chain in CI covers payment + receipt allocation + verification hash integrity)
  - procurement -> receipt -> stock update: PASS
  - HR payroll run -> export artifacts: FAIL

## Priority Remaining Work (Execution Order)

1. Compliance-grade document templates:
   - Add legal metadata, verification hash, and QR for invoices/receipts.
2. End-to-end test packs for top critical flows:
   - Keep Sales + Procurement CI checks required (now includes payment + receipt verification integrity checks).
3. Platform reliability hardening:
   - Monitoring/alerting, runbooks, backup validation drills.
4. Finance close controls:
   - Period lock, adjustment journals, reconciliation workflows.
5. HR payroll completion:
   - Persisted payroll runs, statutory outputs, immutable payslips.

## Definition of "Production-Ready"

A module is production-ready when:
- It has no mock/demo runtime dependency.
- Critical mutations are validated and audited.
- End-to-end flow is automated in tests.
- User-facing documents are generated server-side with compliance metadata.
- Monitoring and operational recovery paths are documented and exercised.
