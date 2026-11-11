const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOfficialEtimsSalesPayload } = require("../src/services/integrationService");

const invoice = {
  invoice_no: "INV-2026-00001",
  invoice_date: "2026-11-09",
  posted_at: new Date("2026-11-09T08:30:45.000Z"),
  subtotal: 90,
  discount_amount: 10,
  tax_amount: 14.4,
  total_amount: 104.4,
  customer_name: "Sample customer",
  customer_tax_id: "A123456789B",
};

const lines = [{
  item_code: "ITEM-1",
  description: "Sample item",
  etims_item_code: "KE1NTXU0000001",
  etims_item_classification_code: "5059690800",
  etims_item_type_code: "2",
  etims_packaging_unit_code: "NT",
  etims_package_quantity: 1,
  etims_quantity_unit_code: "U",
  etims_tax_type_code: "B",
  quantity: 2,
  unit_price: 50,
  discount_percent: 10,
  discount_amount: 10,
  line_total: 90,
  tax_rate: 16,
  tax_amount: 14.4,
}];

test("OSCU sales request uses KRA fields and exact discounted taxable/VAT totals", () => {
  const payload = buildOfficialEtimsSalesPayload({ invoice, lines, kraInvoiceNo: 77, paymentTypeCode: "02" });
  assert.equal(payload.trdInvcNo, invoice.invoice_no);
  assert.equal(payload.invcNo, 77);
  assert.equal(payload.orgInvcNo, 0);
  assert.equal(payload.custTin, invoice.customer_tax_id);
  assert.equal(payload.rcptTyCd, "S");
  assert.equal(payload.pmtTyCd, "02");
  assert.equal(payload.salesSttsCd, "02");
  assert.equal(payload.itemList[0].splyAmt, 100);
  assert.equal(payload.itemList[0].dcAmt, 10);
  assert.equal(payload.itemList[0].taxblAmt, 90);
  assert.equal(payload.itemList[0].totTaxAmt, 14.4);
  assert.equal(payload.taxblAmtB, 90);
  assert.equal(payload.taxAmtB, 14.4);
  assert.equal(payload.totTaxblAmt, invoice.subtotal);
  assert.equal(payload.totTaxAmt, invoice.tax_amount);
  assert.equal(payload.totAmt, invoice.total_amount);
  assert.equal(Object.hasOwn(payload, "cmcKey"), false);
});

test("OSCU sales request blocks invalid customer PIN and mismatched posted totals", () => {
  assert.throws(() => buildOfficialEtimsSalesPayload({
    invoice: { ...invoice, customer_tax_id: "invalid" }, lines, kraInvoiceNo: 77, paymentTypeCode: "02",
  }), /KRA PIN must match/);
  assert.throws(() => buildOfficialEtimsSalesPayload({
    invoice: { ...invoice, tax_amount: 15 }, lines, kraInvoiceNo: 77, paymentTypeCode: "02",
  }), /do not reconcile exactly/);
});