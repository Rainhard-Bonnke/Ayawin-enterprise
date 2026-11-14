const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const bankReconciliation = require("../../src/services/bankReconciliationService");
const gl = require("../../src/services/glPostingService");

test("bank statements for one account cannot overlap an existing reconciliation period", async () => {
  const context = await getTestContext();
  const bank = await pool.query(
    `SELECT id FROM erp_chart_of_accounts
     WHERE company_id=$1 AND account_code='1100' AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE`,
    [context.companyId],
  );
  assert.ok(bank.rowCount, "test company needs a postable bank account");
  const suffix = Date.now();
  const references = [`E2E-BANK-A-${suffix}`, `E2E-BANK-B-${suffix}`];

  try {
    await bankReconciliation.createReconciliation({
      companyId: context.companyId,
      userId: context.userId,
      bankAccountId: bank.rows[0].id,
      statementReference: references[0],
      statementStart: "2026-10-01",
      statementEnd: "2026-10-31",
      openingBalance: 100,
      closingBalance: 110,
      lines: [{ transaction_date: "2026-10-15", description: "Deposit", debit: 0, credit: 10 }],
    });

    await assert.rejects(
      bankReconciliation.createReconciliation({
        companyId: context.companyId,
        userId: context.userId,
        bankAccountId: bank.rows[0].id,
        statementReference: references[1],
        statementStart: "2026-10-31",
        statementEnd: "2026-11-30",
        openingBalance: 110,
        closingBalance: 111,
        lines: [
          { transaction_date: "2026-11-01", description: "No movement", debit: 0, credit: 1 },
        ],
      }),
      /overlap/i,
    );
  } finally {
    await pool.query(
      "DELETE FROM erp_bank_reconciliations WHERE company_id=$1 AND statement_reference=ANY($2::text[])",
      [context.companyId, references],
    );
  }
});

test("concurrent overlapping bank statement imports serialize on the account", async () => {
  const context = await getTestContext();
  const bank = await pool.query(
    `SELECT id FROM erp_chart_of_accounts
     WHERE company_id=$1 AND account_code='1100' AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE`,
    [context.companyId],
  );
  assert.ok(bank.rowCount, "test company needs a postable bank account");
  const suffix = Date.now();
  const references = [`E2E-BANK-RACE-A-${suffix}`, `E2E-BANK-RACE-B-${suffix}`];
  const create = (index) =>
    bankReconciliation.createReconciliation({
      companyId: context.companyId,
      userId: context.userId,
      bankAccountId: bank.rows[0].id,
      statementReference: references[index],
      statementStart: "2026-12-01",
      statementEnd: "2026-12-31",
      openingBalance: 0,
      closingBalance: 10,
      lines: [
        {
          transaction_date: "2026-12-15",
          description: `Concurrent deposit ${index}`,
          debit: 0,
          credit: 10,
        },
      ],
    });

  try {
    const results = await Promise.allSettled([create(0), create(1)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.match(rejected.reason.message, /overlap/i);
  } finally {
    await pool.query(
      "DELETE FROM erp_bank_reconciliations WHERE company_id=$1 AND statement_reference=ANY($2::text[])",
      [context.companyId, references],
    );
  }
});

test("cash book includes posted cash journals and calculates running balances", async () => {
  const context = await getTestContext();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const accounts = await client.query(
      `SELECT id, account_code
       FROM erp_chart_of_accounts
       WHERE company_id = $1 AND account_code = ANY($2::text[])
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [context.companyId, ["1100", "4000"]],
    );
    const accountsByCode = Object.fromEntries(
      accounts.rows.map((account) => [account.account_code, account.id]),
    );
    assert.ok(accountsByCode["1100"], "test company needs a postable bank account");
    assert.ok(accountsByCode["4000"], "test company needs a postable income account");

    const posted = await gl.createJournalInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      entryDate: "2026-11-15",
      description: `Cash book posted fixture ${Date.now()}`,
      source: "manual",
      lines: [
        { account_id: accountsByCode["1100"], debit: 1250, credit: 0 },
        { account_id: accountsByCode["4000"], debit: 0, credit: 1250 },
      ],
    });
    await gl.postJournalInTransaction(client, {
      journalId: posted.id,
      companyId: context.companyId,
      userId: context.reviewerId,
    });

    const unposted = await gl.createJournalInTransaction(client, {
      companyId: context.companyId,
      userId: context.userId,
      entryDate: "2026-11-15",
      description: `Cash book draft fixture ${Date.now()}`,
      source: "manual",
      lines: [
        { account_id: accountsByCode["1100"], debit: 50, credit: 0 },
        { account_id: accountsByCode["4000"], debit: 0, credit: 50 },
      ],
    });

    const result = await bankReconciliation.listCashBook(
      context.companyId,
      {
        accountId: accountsByCode["1100"],
        startDate: "2026-11-15",
        endDate: "2026-11-15",
        limit: 5000,
      },
      client,
    );
    const postedLine = result.lines.find((line) => line.journal_id === posted.id);
    assert.ok(postedLine, "posted cash journal should appear in the cash book");
    assert.equal(
      result.lines.some((line) => line.journal_id === unposted.id),
      false,
    );

    const accountLines = result.lines.filter((line) => line.account_id === accountsByCode["1100"]);
    const lineIndex = accountLines.findIndex((line) => line.journal_id === posted.id);
    const previousBalance =
      lineIndex === 0
        ? Number(postedLine.opening_balance)
        : Number(accountLines[lineIndex - 1].running_balance);
    assert.equal(Number(postedLine.debit), 1250);
    assert.equal(Number(postedLine.running_balance), previousBalance + 1250);
    assert.equal(result.accounts[0].id, accountsByCode["1100"]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
