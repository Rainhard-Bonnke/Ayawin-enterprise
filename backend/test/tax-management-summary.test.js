const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTaxManagementSummary } = require("../src/services/taxManagementService");

test("tax summary includes live VAT and WHT obligations and the due-date calendar", () => {
  const summary = buildTaxManagementSummary({
    latestVatReturn: {
      summary: {
        net_payable: 482500,
        net_refundable: 0,
        claimable_input_vat: 618900,
        output_vat: 1101400,
      },
      period_end: "2026-04-30",
      status: "draft",
    },
    withholdingTax: {
      payable: 214300,
      certificatesPending: 14,
      remittanceStatus: "pending_approval",
    },
    calendar: [
      { name: "VAT return — Apr 2026", due_date: "2026-05-20", status: "Draft ready" },
      { name: "WHT remittance", due_date: "2026-05-10", status: "Pending approval" },
    ],
  });

  assert.equal(summary.summary[0].label, "VAT due");
  assert.equal(summary.summary[0].value, 482500);
  assert.equal(summary.summary[1].label, "WHT payable");
  assert.equal(summary.summary[1].value, 214300);
  assert.equal(summary.summary[2].label, "Input VAT claim");
  assert.equal(summary.summary[2].value, 618900);
  assert.equal(summary.obligations[0].type, "Output VAT");
  assert.equal(summary.deadlines[0].name, "VAT return — Apr 2026");
  assert.equal(summary.followUps[0].label, "WHT certificates pending matching");
});

test("tax summary does not invent a withholding balance or deadline when WHT is not configured", () => {
  const summary = buildTaxManagementSummary({
    latestVatReturn: {
      summary: { net_payable: 1200, output_vat: 1200 },
      period_end: "2026-10-31",
      status: "draft",
    },
    withholdingTax: {
      payable: 0,
      certificatesPending: 0,
      outstandingRemittances: 0,
      remittanceStatus: "not_configured",
    },
  });

  assert.equal(summary.summary.find((item) => item.label === "WHT payable").value, 0);
  assert.equal(summary.obligations.find((item) => item.type === "Withholding tax").status, "Not configured");
  assert.equal(summary.deadlines.some((item) => item.name.toLowerCase().includes("wht")), false);
  assert.equal(summary.followUps.find((item) => item.label === "Outstanding remittances").value, 0);
});
