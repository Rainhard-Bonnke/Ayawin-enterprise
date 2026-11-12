const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const {
  buildReturnSummary,
  buildReturnLines,
  returnLinesToCsv,
  returnToCsv,
  returnToXlsx,
} = require("../src/services/vatReturnService");

test("VAT3 summary nets sales credits and separates claimable, held, and non-claimable input tax", () => {
  const summary = buildReturnSummary({
    invoices: [
      { tax_treatment: "standard", taxable_amount: 100, vat_amount: 16 },
      { tax_treatment: "zero_rated", taxable_amount: 50, vat_amount: 0 },
      { tax_treatment: "exempt", taxable_amount: 20, vat_amount: 0 },
    ],
    customerCredits: [{ tax_treatment: "standard", taxable_amount: 10, vat_amount: 1.6 }],
    supplierBills: [
      { claimable_input_vat: 8, held_input_vat: 0, non_claimable_input_vat: 0 },
      { claimable_input_vat: 0, held_input_vat: 3, non_claimable_input_vat: 2 },
    ],
    supplierCredits: [{ claimable_input_vat: 1, held_input_vat: 0.5, non_claimable_input_vat: 0.25 }],
    glBalances: [
      { account_code: "2200", debit: 0, credit: 14.4 },
      { account_code: "1400", debit: 7, credit: 0 },
      { account_code: "1401", debit: 2.5, credit: 0 },
    ],
  });

  assert.equal(summary.output_by_treatment.standard.taxable_amount, 90);
  assert.equal(summary.output_by_treatment.zero_rated.taxable_amount, 50);
  assert.equal(summary.output_by_treatment.exempt.taxable_amount, 20);
  assert.equal(summary.output_vat, 14.4);
  assert.equal(summary.claimable_input_vat, 7);
  assert.equal(summary.held_input_vat, 2.5);
  assert.equal(summary.non_claimable_input_vat, 1.75);
  assert.equal(summary.net_payable, 7.4);
  assert.equal(summary.variance_amount, 0);
});

test("VAT3 source lines retain document identifiers and export as escaped CSV", () => {
  const rows = buildReturnLines({
    invoices: [{ document_id: "invoice-1", source_line_id: "line-1", document_no: "INV,1", document_date: "2026-11-01", tax_treatment: "standard", taxable_amount: 10, vat_amount: 1.6 }],
    customerCredits: [],
    supplierBills: [],
    supplierCredits: [],
  });
  const csv = returnLinesToCsv(rows);

  assert.equal(rows[0].source_document_id, "invoice-1");
  assert.equal(rows[0].source_document_line_id, "line-1");
  assert.match(csv, /"INV,1"/);
  assert.match(csv, /customer_invoice/);
});

test("VAT3 XLSX export produces a workbook buffer with summary and source rows", async () => {
  const buffer = await returnToXlsx({
    return_no: "VAT3-2026-11",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    status: "draft",
    summary: { output_by_treatment: { standard: { taxable_amount: 100, vat_amount: 16 } } },
    lines: [{
      source_document_type: "customer_invoice",
      source_document_id: "invoice-1",
      source_document_line_id: "line-1",
      document_no: "INV-1",
      document_date: "2026-11-02",
      tax_treatment: "standard",
      taxable_amount: 100,
      output_vat: 16,
    }],
  });

  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets[0].getCell("A1").value, "VAT3 Working Paper - Not Filed");
  assert.equal(workbook.worksheets[0].getCell("A2").value, "Return");
  assert.equal(workbook.worksheets[0].getCell("B2").value, "VAT3-2026-11");
  assert.equal(workbook.worksheets[0].getCell("A19").value, "Source document lines");
});

test("VAT3 CSV filing worksheet includes return summary before source drill-down", () => {
  const csv = returnToCsv({
    return_no: "VAT3-2026-11",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
    status: "draft",
    summary: { claimable_input_vat: 12, output_vat: 20 },
    lines: [{
      source_document_type: "supplier_bill",
      source_document_id: "bill-1",
      source_document_line_id: "bill-line-1",
      document_no: "BILL-1",
      document_date: "2026-11-03",
      tax_treatment: "standard",
      evidence_status: "held_no_evidence",
      taxable_amount: 75,
      output_vat: 0,
      claimable_input_vat: 0,
      held_input_vat: 12,
      non_claimable_input_vat: 0,
    }],
  });

  assert.match(csv, /VAT3 Working Paper - Not Filed/);
  assert.match(csv, /Claimable input VAT/);
  assert.match(csv, /held_no_evidence/);
  assert.ok(csv.indexOf("Claimable input VAT") < csv.indexOf("supplier_bill"));
});
