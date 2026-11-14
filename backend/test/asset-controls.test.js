const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAssetDelete,
  buildAssetDepreciationSchedule,
  calculateDisposalImpact,
} = require("../src/services/fixedAssetService");

test("active assets cannot be deleted from the register without being disposed first", () => {
  assert.throws(
    () => validateAssetDelete({ status: "active" }),
    /active assets cannot be deleted/i,
  );

  assert.doesNotThrow(() => validateAssetDelete({ status: "disposed" }));
  assert.throws(
    () => validateAssetDelete({ status: "unknown" }),
    /valid fixed-asset status/i,
  );
});

test("monthly depreciation summary includes only active assets and totals the straight-line charge", () => {
  const summary = buildAssetDepreciationSchedule([
    {
      asset_code: "AST-001",
      name: "Delivery van",
      category: "Fleet",
      status: "active",
      acquisition_cost: "120000",
      residual_value: "20000",
      useful_life_months: 60,
    },
    {
      asset_code: "AST-002",
      name: "Laptop",
      category: "IT",
      status: "active",
      acquisition_cost: 30000,
      residual_value: 0,
      useful_life_months: 36,
    },
    {
      asset_code: "AST-003",
      name: "Disposed asset",
      category: "Office",
      status: "disposed",
      acquisition_cost: 50000,
      residual_value: 0,
      useful_life_months: 24,
    },
  ]);

  assert.equal(summary.activeAssets, 2);
  assert.equal(summary.totalMonthlyDepreciation, 2500);
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].monthly_depreciation, 1666.6666666666667);
  assert.equal(summary.rows[1].monthly_depreciation, 833.3333333333334);
});

test("disposal events produce a validated gain/loss and prevent invalid resale values", () => {
  const impact = calculateDisposalImpact({
    acquisition_cost: 120000,
    residual_value: 20000,
    useful_life_months: 60,
    disposal_value: 70000,
    disposal_type: "sale",
  });

  assert.equal(impact.gain_or_loss, 70000 - 100000);
  assert.equal(impact.net_book_value, 100000);
  assert.equal(impact.type, "sale");

  assert.throws(
    () =>
      calculateDisposalImpact({
        acquisition_cost: 120000,
        residual_value: 20000,
        useful_life_months: 60,
        disposal_value: -1000,
        disposal_type: "sale",
      }),
    /disposal value.*non-negative|non-negative.*disposal value/i,
  );
});
