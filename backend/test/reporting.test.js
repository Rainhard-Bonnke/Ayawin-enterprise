const test = require("node:test");
const assert = require("node:assert/strict");
const { rowsToCsv, kpiStatus, METRICS } = require("../src/services/reportingService");

test("rowsToCsv produces header and row", () => {
  const csv = rowsToCsv([
    { a: 1, b: "hello" },
    { a: 2, b: "world" },
  ]);
  assert.match(csv, /^a,b/);
  assert.match(csv, /hello/);
});

test("kpiStatus green when above target", () => {
  assert.equal(kpiStatus(100, 80, 70, 60, true), "green");
});

test("kpiStatus red when below critical", () => {
  assert.equal(kpiStatus(50, 80, 70, 60, true), "red");
});

test("AP outstanding reads unpaid posted supplier bills, not purchase orders", async () => {
  const { query } = require("../src/db");
  const originalQuery = query;
  let capturedSql = "";
  require("../src/db").query = async (sql) => {
    capturedSql = sql;
    return { rows: [{ v: "125.50" }] };
  };

  try {
    assert.equal(await METRICS.ap_outstanding("company-id"), 125.5);
    assert.match(capturedSql, /FROM erp_supplier_bills/);
    assert.match(capturedSql, /total_amount\s*-\s*amount_paid/);
    assert.doesNotMatch(capturedSql, /FROM erp_purchase_orders/);
  } finally {
    require("../src/db").query = originalQuery;
  }
});

test("OTIF query requires full delivery by the sales order required date", async () => {
  const db = require("../src/db");
  const originalQuery = db.query;
  let capturedSql = "";
  db.query = async (sql) => {
    capturedSql = sql;
    return {
      rows: [{
        eligible_order_count: 4,
        dated_order_count: 3,
        due_order_count: 2,
        on_time_in_full_count: 1,
      }],
    };
  };

  try {
    assert.equal(await METRICS.otif("company-id"), 50);
    assert.equal(await METRICS.otif_coverage("company-id"), 75);
    assert.match(capturedSql, /required_date/);
    assert.match(capturedSql, /delivered_quantity\s*>?=/);
    assert.match(capturedSql, /last_delivery_date\s*<=\s*required_date/);
    assert.match(capturedSql, /eligible_order_count/);
    assert.match(capturedSql, /dated_order_count/);
    assert.match(capturedSql, /dn\.status\s*=\s*'posted'/);
  } finally {
    db.query = originalQuery;
  }
});
