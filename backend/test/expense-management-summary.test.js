const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildExpenseManagementSummary,
  normalizeExpenseClaimInput,
} = require("../src/services/expenseManagementService");

test("expense claims are summarized with policy risk and budget performance", () => {
  const result = buildExpenseManagementSummary({
    claims: [
      { employee: "Nancy Wambui", category: "Travel", amount: 24500, status: "Approved", date: "2026-05-04" },
      { employee: "Daniel Otieno", category: "Meals", amount: 12800, status: "Pending", date: "2026-05-05" },
      { employee: "Grace Kibet", category: "Staff welfare", amount: 7600, status: "Approved", date: "2026-05-07" },
      { employee: "Juma Mwangi", category: "Mobile data", amount: 4200, status: "Rejected", date: "2026-05-08" },
    ],
    budgets: [
      { category: "Travel", allocated: 280000, used: 182400, remaining: 97600 },
      { category: "Meals", allocated: 165000, used: 98540, remaining: 66460 },
      { category: "Medical", allocated: 85000, used: 21400, remaining: 63600 },
      { category: "Marketing", allocated: 120000, used: 93250, remaining: 26750 },
    ],
  });

  assert.equal(result.summary[0].label, "Claims submitted");
  assert.equal(result.summary[0].value, 3);
  assert.equal(result.summary[1].label, "Approved");
  assert.equal(result.summary[1].value, 2);
  assert.equal(result.summary[2].label, "Pending amount");
  assert.equal(result.summary[2].value, 44900);
  assert.equal(result.summary[3].label, "Policy adherence");
  assert.equal(result.summary[3].value, 94);
  assert.equal(result.claims.length, 4);
  assert.equal(result.budgets.length, 4);
  assert.ok(result.status.includes("Within") || result.status.includes("On track"));
});

test("expense claim input validates dates and exact multi-line currency totals", () => {
  const claim = normalizeExpenseClaimInput({
    claim_date: "2026-11-13",
    description: "Branch travel and accommodation",
    currency_code: "kes",
    lines: [
      { category_id: "travel", description: "Fuel", amount: 1250.25, cost_centre: "NBO" },
      { category_id: "lodging", description: "Hotel", amount: 4500.5 },
    ],
  });

  assert.equal(claim.currency_code, "KES");
  assert.equal(claim.total_amount, 5750.75);
  assert.equal(claim.lines[0].cost_centre, "NBO");
  assert.equal(claim.lines[1].cost_centre, null);
});

test("expense claim input rejects impossible dates, missing categories, and non-positive amounts", () => {
  assert.throws(() => normalizeExpenseClaimInput({ claim_date: "2026-02-31" }), /valid expense claim date/i);
  assert.throws(() => normalizeExpenseClaimInput({
    claim_date: "2026-11-13",
    description: "Valid",
    currency_code: "KES",
    lines: [{ category_id: "", description: "Fuel", amount: 1 }],
  }), /each expense line needs a category/i);
});
