const test = require("node:test");
const assert = require("node:assert/strict");
const {
  summarizeDeliveryProof,
  reconcileRouteCollections,
  summarizeRouteClosure,
  createSalesOrder,
} = require("../src/services/salesService");

test("VAT calculation at 16%", () => {
  const subtotal = 100000;
  const tax = Math.round(subtotal * 0.16 * 100) / 100;
  assert.equal(tax, 16000);
  assert.equal(subtotal + tax, 116000);
});

test("credit exposure includes order total", () => {
  const outstanding = 50000;
  const orderTotal = 174000;
  const limit = 500000;
  assert.equal(outstanding + orderTotal <= limit, true);
});

test("sales orders require a valid required delivery date", async () => {
  await assert.rejects(
    () => createSalesOrder({ lines: [{ item_id: "item", quantity: 1, unit_price: 1 }] }),
    /valid required delivery date is required/,
  );
  await assert.rejects(
    () => createSalesOrder({
      requiredDate: "2026-02-31",
      lines: [{ item_id: "item", quantity: 1, unit_price: 1 }],
    }),
    /valid required delivery date is required/,
  );
  await assert.rejects(
    () => createSalesOrder({
      orderDate: "2026-10-10",
      requiredDate: "2026-10-09",
      lines: [{ item_id: "item", quantity: 1, unit_price: 1 }],
    }),
    /cannot be before the order date/,
  );
});

test("delivery proof classifies customer-confirmed discrepancies", () => {
  const result = summarizeDeliveryProof({
    customer_confirmed: true,
    route_code: "R-12",
    lines: [
      { delivered_quantity: 100, short_quantity: 5, damaged_quantity: 0, customer_accepted_quantity: 95 },
      { delivered_quantity: 80, short_quantity: 0, damaged_quantity: 3, customer_accepted_quantity: 77 },
    ],
  });

  assert.equal(result.route_code, "R-12");
  assert.equal(result.customer_confirmed, true);
  assert.equal(result.proof_status, "discrepancy_reported");
  assert.equal(result.discrepancy_quantity, 8);
  assert.equal(result.accepted_quantity, 172);
});

test("route close reconciliation flags collection gap on a route", () => {
  const result = reconcileRouteCollections({
    route_code: "R-12",
    deliveries: [
      { accepted_quantity: 100, discrepancy_quantity: 5, invoice_value: 150000, collected_amount: 120000 },
      { accepted_quantity: 60, discrepancy_quantity: 0, invoice_value: 90000, collected_amount: 90000 },
    ],
  });

  assert.equal(result.route_code, "R-12");
  assert.equal(result.confirmed_quantity, 160);
  assert.equal(result.discrepancy_quantity, 5);
  assert.equal(result.invoice_value, 240000);
  assert.equal(result.collected_amount, 210000);
  assert.equal(result.outstanding_amount, 30000);
  assert.equal(result.status, "collection_gap");
});

test("route closure records cash variance and blocks approval for missing proof", () => {
  const result = summarizeRouteClosure({
    declared_collection: 200000,
    matched_collection: 190000,
    proof_pending_count: 1,
    discrepancy_count: 2,
  });

  assert.equal(result.collection_variance, 10000);
  assert.equal(result.status, "proof_exceptions");
  assert.equal(result.can_approve, false);
});
