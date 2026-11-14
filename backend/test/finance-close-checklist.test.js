const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChecklist } = require("../src/services/financeCloseService");

test("period close blocks unmatched bank lines, unposted payroll, and an unlocked VAT return", () => {
  const checklist = buildChecklist({
    id: "period-1",
    name: "November 2026",
    start_date: "2026-11-01",
    end_date: "2026-11-30",
    status: "open",
  }, {
    unmatched_bank_items: 2,
    unfinalized_payroll_runs: 1,
    vat_return_not_locked: 1,
  });

  assert.equal(checklist.ready_to_close, false);
  assert.deepEqual(checklist.blockers.map((check) => check.code), [
    "unfinalized_payroll_runs",
    "unmatched_bank_items",
    "vat_return_not_locked",
  ]);
});

test("period close does not require a VAT return when the period has no VAT-bearing documents", () => {
  const checklist = buildChecklist({ id: "period-2", name: "Empty", status: "open" }, {});
  assert.equal(checklist.ready_to_close, true);
});

test("Phase C readiness summary remains blocked until the full FX workflow is implemented", () => {
  const { buildPhaseCReadinessSummary } = require("../src/services/financeCloseService");

  const readyChecklist = buildChecklist({ id: "period-3", name: "Ready", status: "open" }, {});
  const blockedChecklist = buildChecklist({
    id: "period-4",
    name: "Blocked",
    start_date: "2026-12-01",
    end_date: "2026-12-31",
    status: "open",
  }, {
    vat_return_not_locked: 1,
  });

  const readySummary = buildPhaseCReadinessSummary({ checklist: readyChecklist });
  const blockedSummary = buildPhaseCReadinessSummary({ checklist: blockedChecklist });

  assert.equal(readySummary.status, "blocked");
  assert.ok(readySummary.blockers.some((item) => item.code === "foreign_currency_accounting"));
  assert.ok(readySummary.blockers.some((item) => item.code === "fx_policy_governance"));
  assert.equal(blockedSummary.status, "blocked");
  assert.ok(blockedSummary.blockers.some((item) => item.code === "finance_close_controls"));
  assert.ok(blockedSummary.blockers.some((item) => item.code === "vat_locking"));
});

test("Phase C readiness recognizes governed FX policies without claiming full FX accounting readiness", () => {
  const { buildPhaseCReadinessSummary } = require("../src/services/financeCloseService");
  const checklist = buildChecklist({ id: "period-5", name: "Ready", status: "open" }, {});
  const summary = buildPhaseCReadinessSummary({ checklist, fxPolicyGovernance: true });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.checks.find((check) => check.code === "fx_policy_governance").status, "pass");
  assert.ok(summary.blockers.some((item) => item.code === "foreign_currency_accounting"));
});

test("close checklist blocks the full close pack for WHT, depreciation, FX revaluation, and inventory variances", () => {
  const checklist = buildChecklist({
    id: "period-close-pack",
    name: "December 2026",
    start_date: "2026-12-01",
    end_date: "2026-12-31",
    status: "open",
  }, {
    wht_not_remitted: 2,
    depreciation_run_pending: 1,
    fx_revaluation_pending: 3,
    inventory_variances: 4,
  });

  assert.equal(checklist.ready_to_close, false);
  assert.deepEqual(checklist.blockers.map((check) => check.code), [
    "wht_not_remitted",
    "depreciation_run_pending",
    "fx_revaluation_pending",
    "inventory_variances",
  ]);
});