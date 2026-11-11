const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBillTaxLine,
  resolveBillTaxLine,
  buildBillPostingLines,
} = require("../src/services/accountsPayableService");
const { splitVatByClaimableRatio } = require("../src/services/supplierReturnCreditService");
const { buildSupplierCreditVatReversalLines } = require("../src/services/supplierReturnCreditService");
const { validateLinesBalanced } = require("../src/services/glPostingService");

test("standard-rated supplier tax is split by the configured claimable ratio", () => {
  const line = normalizeBillTaxLine({
    quantity: 1,
    unit_price: 100,
    tax_rate: 16,
    tax_treatment: "standard",
    claimable_vat_ratio: 0.625,
  }, 1);

  assert.equal(line.tax, 16);
  assert.equal(line.claimableVat, 10);
  assert.equal(line.nonClaimableVat, 6);
});

test("purchase tax rejects invalid ratios and tax on non-standard categories", () => {
  assert.throws(
    () => normalizeBillTaxLine({ quantity: 1, unit_price: 100, tax_rate: 16, claimable_vat_ratio: 1.1 }, 1),
    /ratio must be between 0 and 1/,
  );
  assert.throws(
    () => normalizeBillTaxLine({ quantity: 1, unit_price: 100, tax_rate: 16, tax_treatment: "exempt" }, 1),
    /Only standard-rated/,
  );
});

test("receipt-linked bill tax defaults from the item's effective tax group", async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes("SELECT id, tax_group_id FROM erp_items")) {
        return { rowCount: 1, rows: [{ id: "item-1", tax_group_id: "group-1" }] };
      }
      if (sql.includes("SELECT id, code, tax_treatment FROM erp_tax_groups")) {
        return { rowCount: 1, rows: [{ id: "group-1", code: "STD-VAT", tax_treatment: "standard" }] };
      }
      if (sql.includes("FROM erp_tax_group_rates gr")) {
        return { rowCount: 1, rows: [{ id: "rate-1", code: "VAT16", rate: 16, tax_type: "vat", basis: "percentage" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const line = await resolveBillTaxLine(client, "company-1", {
    item_id: "item-1",
    quantity: 1,
    unit_price: 100,
    tax_rate: 0,
  }, "2026-11-09");

  assert.equal(line.tax_treatment, "standard");
  assert.equal(line.tax_rate, 16);
  assert.equal(line.claimable_vat_ratio, 1);
  assert.equal(line.taxOverride, false);
});

test("tax group deviations require tax.edit permission", async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes("SELECT id, tax_group_id FROM erp_items")) {
        return { rowCount: 1, rows: [{ id: "item-1", tax_group_id: "group-1" }] };
      }
      if (sql.includes("SELECT id, code, tax_treatment FROM erp_tax_groups")) {
        return { rowCount: 1, rows: [{ id: "group-1", code: "STD-VAT", tax_treatment: "standard" }] };
      }
      if (sql.includes("FROM erp_tax_group_rates gr")) {
        return { rowCount: 1, rows: [{ id: "rate-1", code: "VAT16", rate: 16, tax_type: "vat", basis: "percentage" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const override = { item_id: "item-1", quantity: 1, unit_price: 100, tax_rate: 8 };

  await assert.rejects(
    () => resolveBillTaxLine(client, "company-1", override, "2026-11-09"),
    /require tax.edit permission/,
  );
  const authorized = await resolveBillTaxLine(client, "company-1", override, "2026-11-09", ["tax.edit"]);
  assert.equal(authorized.tax_rate, 8);
  assert.equal(authorized.taxOverride, true);
});

test("unverified supplier VAT is held pending and non-claimable VAT is added to cost", () => {
  const journalLines = buildBillPostingLines({
    bill: { evidence_status: "unverified", subtotal: 100, total_amount: 116, supplier_invoice_no: "INV-1" },
    lines: [{
      account_id: "expense-1",
      description: "Materials",
      net_amount: 100,
      claimable_vat: 10,
      non_claimable_vat: 6,
    }],
    payableAccountId: "payable-2100",
    pendingVatAccountId: "pending-1401",
  });

  assert.deepEqual(journalLines, [
    { account_id: "expense-1", debit: 106, credit: 0, description: "Materials" },
    { account_id: "pending-1401", debit: 10, credit: 0, description: "Input VAT pending supplier invoice evidence" },
    { account_id: "payable-2100", debit: 0, credit: 116, description: "Supplier payable INV-1" },
  ]);
});

test("unmatched non-claimable VAT can post to the separate account when configured", () => {
  const journalLines = buildBillPostingLines({
    bill: { evidence_status: "unverified", subtotal: 100, total_amount: 116, supplier_invoice_no: "INV-SEPARATE" },
    lines: [{
      account_id: "expense-1",
      non_claimable_vat_account_id: "non-claimable-1402",
      description: "Materials",
      net_amount: 100,
      claimable_vat: 10,
      non_claimable_vat: 6,
    }],
    payableAccountId: "payable-2100",
    pendingVatAccountId: "pending-1401",
    nonClaimableVatTreatment: "separate_account",
  });

  assert.deepEqual(journalLines, [
    { account_id: "expense-1", debit: 100, credit: 0, description: "Materials" },
    { account_id: "non-claimable-1402", debit: 6, credit: 0, description: "Non-claimable VAT added to cost: Materials" },
    { account_id: "pending-1401", debit: 10, credit: 0, description: "Input VAT pending supplier invoice evidence" },
    { account_id: "payable-2100", debit: 0, credit: 116, description: "Supplier payable INV-SEPARATE" },
  ]);
});

test("verified supplier VAT posts to input VAT control and receipt-matched non-claimable VAT adds to cost", () => {
  const journalLines = buildBillPostingLines({
    bill: { evidence_status: "verified", subtotal: 100, total_amount: 116, supplier_invoice_no: "INV-2" },
    lines: [{
      account_id: "inventory-asset",
      description: "Stock",
      net_amount: 100,
      claimable_vat: 10,
      non_claimable_vat: 6,
    }],
    payableAccountId: "payable-2100",
    inputVatAccountId: "input-1400",
    accrualAccount: { id: "grni", account_code: "2200" },
  });

  assert.deepEqual(journalLines, [
    { account_id: "grni", debit: 100, credit: 0, description: "Clear 2200 receipt accrual for INV-2" },
    { account_id: "inventory-asset", debit: 6, credit: 0, description: "Non-claimable VAT added to cost: Stock" },
    { account_id: "input-1400", debit: 10, credit: 0, description: "Verified input VAT on supplier bill" },
    { account_id: "payable-2100", debit: 0, credit: 116, description: "Supplier payable INV-2" },
  ]);
});

test("supplier credits split VAT using the source line's stored claimable ratio", () => {
  assert.deepEqual(splitVatByClaimableRatio(8.02, 0.625), {
    claimableVat: 5.01,
    nonClaimableVat: 3.01,
  });
  assert.deepEqual(splitVatByClaimableRatio(8.02, 0), {
    claimableVat: 0,
    nonClaimableVat: 8.02,
  });
  assert.throws(() => splitVatByClaimableRatio(8.02, 1.01), /invalid claimable VAT ratio/);
});

test("supplier credit reverses the stored VAT fraction to the original accounts and balances", () => {
  const vatSplit = splitVatByClaimableRatio(8.02, 0.625);
  const vatLines = buildSupplierCreditVatReversalLines({
    claimableVatAmount: vatSplit.claimableVat,
    nonClaimableVatAmount: vatSplit.nonClaimableVat,
    claimableAccountId: "input-vat-1400",
    nonClaimableAccountId: "original-cost-account",
    invoiceNo: "INV-1",
  });
  const lines = [
    { account_id: "payable-2100", debit: 58.02, credit: 0 },
    { account_id: "supplier-claim", debit: 0, credit: 50 },
    ...vatLines,
  ];

  assert.equal(validateLinesBalanced(lines).totalDebit, 58.02);
  assert.deepEqual(vatLines.map((line) => [line.account_id, line.credit]), [
    ["input-vat-1400", 5.01],
    ["original-cost-account", 3.01],
  ]);
});
