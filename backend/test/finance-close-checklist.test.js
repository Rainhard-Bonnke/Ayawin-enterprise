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