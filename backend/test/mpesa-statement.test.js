const test = require("node:test");
const assert = require("node:assert/strict");
const { parseMpesaStatementCsv } = require("../src/services/mpesaStatementService");

test("M-Pesa CSV parser normalizes Safaricom-style headings into reconciliation rows", () => {
  const rows = parseMpesaStatementCsv([
    "Transaction ID,Transaction Date,Transaction Type,Amount,Fee,Reference",
    "QAB123,20261109,payment,1000,0,INV-1",
    ",20261109,fee,25,25,CHARGE-1",
  ].join("\n"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    lineNo: 1,
    transactionId: "QAB123",
    transactionDate: "2026-11-09",
    transactionType: "payment",
    amount: 1000,
    feeAmount: 0,
    reference: "INV-1",
    rawRow: { transaction_id: "QAB123", transaction_type: "payment", transaction_date: "2026-11-09", amount: 1000, fee_amount: 0, reference: "INV-1" },
  });
  assert.equal(rows[1].transactionType, "fee");
  assert.equal(rows[1].feeAmount, 25);
});

test("M-Pesa CSV parser rejects invalid dates, transaction categories, and amounts", () => {
  assert.throws(() => parseMpesaStatementCsv("transaction_id,transaction_date,transaction_type,amount\nA,not-a-date,payment,1"), /invalid transaction date/);
  assert.throws(() => parseMpesaStatementCsv("transaction_date,transaction_type,amount\n20261109,unknown,1"), /must be payment/);
  assert.throws(() => parseMpesaStatementCsv("transaction_date,transaction_type,amount\n20261109,payment,nope"), /invalid amount/);
});