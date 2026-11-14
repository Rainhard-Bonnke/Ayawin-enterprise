const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDepreciationRunInput,
  buildDepreciationRun,
} = require("../src/services/fixedAssetDepreciationRunService");

test("depreciation run validation rejects invalid ranges and negative values", () => {
  assert.throws(
    () =>
      normalizeDepreciationRunInput({
        periodStart: "2026-02-31",
        periodEnd: "2026-02-28",
        assets: [],
      }),
    /valid depreciation period/i,
  );

  assert.throws(
    () =>
      normalizeDepreciationRunInput({
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        assets: [
          { asset_code: "AST-001", name: "Truck", acquisition_cost: -1000, residual_value: 0, useful_life_months: 12 },
        ],
      }),
    /non-negative acquisition cost/i,
  );
});

test("depreciation run summarizes monthly charges for active assets within the period", () => {
  const summary = buildDepreciationRun({
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    assets: [
      { id: "a1", asset_code: "AST-001", name: "Truck", status: "active", acquisition_cost: 120000, residual_value: 20000, useful_life_months: 60 },
      { id: "a2", asset_code: "AST-002", name: "Server", status: "disposed", acquisition_cost: 60000, residual_value: 0, useful_life_months: 24 },
      { id: "a3", asset_code: "AST-003", name: "Printer", status: "active", acquisition_cost: 48000, residual_value: 5000, useful_life_months: 48 },
    ],
  });

  assert.equal(summary.total_depreciation, 2562.5);
  assert.equal(summary.line_count, 2);
  assert.equal(summary.lines[0].asset_code, "AST-001");
  assert.equal(summary.lines[1].asset_code, "AST-003");
  assert.equal(summary.lines[0].monthly_depreciation, 1666.6666666666667);
  assert.equal(summary.period_start, "2026-11-01");
  assert.equal(summary.period_end, "2026-11-30");
});

test("depreciation run handles multi-month periods, acquisition timing, and prior depreciation", () => {
  const summary = buildDepreciationRun({
    periodStart: "2099-01-01",
    periodEnd: "2099-06-30",
    assets: [
      {
        id: "a1",
        asset_code: "AST-001",
        status: "active",
        acquisition_date: "2098-10-15",
        acquisition_cost: 1200,
        residual_value: 0,
        useful_life_months: 12,
        accumulated_depreciation: 300,
      },
      {
        id: "a2",
        asset_code: "AST-002",
        status: "active",
        acquisition_date: "2099-04-15",
        acquisition_cost: 1200,
        residual_value: 0,
        useful_life_months: 12,
      },
      {
        id: "a3",
        asset_code: "AST-003",
        status: "active",
        acquisition_date: "2099-07-01",
        acquisition_cost: 1200,
        residual_value: 0,
        useful_life_months: 12,
      },
    ],
  });

  assert.equal(summary.line_count, 2);
  assert.equal(summary.total_depreciation, 900);
  assert.equal(summary.lines[0].depreciation_amount, 600);
  assert.equal(summary.lines[0].months_in_period, 6);
  assert.equal(summary.lines[1].depreciation_amount, 300);
  assert.equal(summary.lines[1].months_in_period, 3);
});

test("depreciation reaches the full depreciable basis within useful life after cent rounding", () => {
  const asset = {
    id: "rounding-asset",
    asset_code: "AST-ROUND",
    status: "active",
    acquisition_date: "2099-01-01",
    acquisition_cost: 10,
    residual_value: 0,
    useful_life_months: 3,
  };
  const january = buildDepreciationRun({
    periodStart: "2099-01-01",
    periodEnd: "2099-01-31",
    assets: [asset],
  });
  const february = buildDepreciationRun({
    periodStart: "2099-02-01",
    periodEnd: "2099-02-28",
    assets: [{ ...asset, accumulated_depreciation: january.total_depreciation }],
  });
  const march = buildDepreciationRun({
    periodStart: "2099-03-01",
    periodEnd: "2099-03-31",
    assets: [{ ...asset, accumulated_depreciation: january.total_depreciation + february.total_depreciation }],
  });

  assert.equal(january.total_depreciation, 3.33);
  assert.equal(february.total_depreciation, 3.33);
  assert.equal(march.total_depreciation, 3.34);
  assert.equal(january.total_depreciation + february.total_depreciation + march.total_depreciation, 10);
});
