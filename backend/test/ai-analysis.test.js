const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateInventoryFindings } = require("../src/services/aiAnalysisService");

test("inventory analysis flags stockout and reorder risk without mutating data", () => {
  const findings = calculateInventoryFindings([
    {
      stock_id: "stock-1",
      item_code: "COKE-500",
      warehouse_name: "Nairobi",
      quantity: 0,
      reorder_point: 20,
      units_sold_14d: 70,
    },
    {
      stock_id: "stock-2",
      item_code: "WATER-500",
      warehouse_name: "Mombasa",
      quantity: 10,
      reorder_point: 20,
      units_sold_14d: 14,
    },
  ]);

  assert.equal(findings[0].category, "stockout");
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[1].category, "reorder_risk");
  assert.equal(findings[1].severity, "medium");
});

test("inventory analysis flags near-expiry batches", () => {
  const findings = calculateInventoryFindings(
    [
      {
        stock_id: "stock-3",
        item_code: "JUICE-1L",
        warehouse_name: "Nairobi",
        quantity: 50,
        reorder_point: 0,
        units_sold_14d: 0,
        expiry_date: "2026-09-25",
      },
    ],
    { analysisDate: new Date("2026-09-18T00:00:00.000Z") },
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "expiry_risk");
  assert.equal(findings[0].severity, "high");
});
