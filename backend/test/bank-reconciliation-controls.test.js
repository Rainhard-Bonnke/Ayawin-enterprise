const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listCashBook,
  normalizeCashBookFilters,
  normalizeStatementLine,
} = require("../src/services/bankReconciliationService");
const {
  normalizeBudgetForecastFilters,
  getBudgetForecastSnapshot,
} = require("../src/services/budgetForecastService");

test("cash book filters normalize optional account and enforce a bounded date range", () => {
  const accountId = "9a62cc7a-fdc2-426a-9899-0b825d98c321";
  assert.deepEqual(
    normalizeCashBookFilters({
      accountId: ` ${accountId} `,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    }),
    {
      accountId,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      limit: 1000,
    },
  );
  assert.throws(
    () => normalizeCashBookFilters({ startDate: "2026-02-31", endDate: "2026-03-01" }),
    /valid cash book date range/i,
  );
  assert.throws(
    () => normalizeCashBookFilters({ startDate: "2026-12-01", endDate: "2026-11-30" }),
    /valid cash book date range/i,
  );
  assert.throws(
    () =>
      normalizeCashBookFilters({
        accountId: "not-an-id",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
      }),
    /valid cash or bank account/i,
  );
  assert.throws(
    () => normalizeCashBookFilters({ startDate: "2026-11-01", endDate: "2026-11-30", limit: 5001 }),
    /between 1 and 5,000/i,
  );
});

test("cash book query scopes posted lines and uses parameterized date, account, and limit filters", async () => {
  const accountId = "9a62cc7a-fdc2-426a-9899-0b825d98c321";
  const calls = [];
  const database = {
    async query(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1
        ? {
            rowCount: 1,
            rows: [
              {
                id: accountId,
                account_code: "1100",
                account_name: "Bank",
                currency_code: "KES",
                opening_balance: "1000.00",
              },
            ],
          }
        : {
            rowCount: 1,
            rows: [{ journal_no: "JRN-001", running_balance: "1125.00" }],
          };
    },
  };

  const result = await listCashBook(
    "company-1",
    {
      accountId,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      limit: 250,
    },
    database,
  );

  assert.equal(result.accounts[0].opening_balance, "1000.00");
  assert.equal(result.lines[0].running_balance, "1125.00");
  assert.deepEqual(calls[0].params, ["company-1", accountId, "2026-11-01"]);
  assert.deepEqual(calls[1].params, ["company-1", accountId, "2026-11-01", "2026-11-30", 250]);
  assert.match(calls[1].sql, /j\.status = 'posted'/);
  assert.match(calls[1].sql, /SUM\(p\.debit - p\.credit\) OVER/);
  assert.match(calls[1].sql, /LIMIT \$5/);
});

test("bank statement lines accept valid in-range calendar dates", () => {
  assert.deepEqual(
    normalizeStatementLine(
      {
        transaction_date: "2026-11-13",
        debit: 0,
        credit: 125.25,
        description: "Customer transfer",
        reference: "TRX-001",
      },
      0,
      "2026-11-01",
      "2026-11-30",
    ),
    {
      lineNo: 1,
      transactionDate: "2026-11-13",
      reference: "TRX-001",
      description: "Customer transfer",
      debit: 0,
      credit: 125.25,
    },
  );
});

test("bank statement lines reject impossible dates before persistence", () => {
  assert.throws(
    () =>
      normalizeStatementLine(
        {
          transaction_date: "2026-02-31",
          debit: 20,
          credit: 0,
          description: "Invalid dated debit",
        },
        0,
        "2026-02-01",
        "2026-02-28",
      ),
    /valid calendar date/i,
  );
});

test("budget forecast filters normalize a valid period and reject invalid limits", () => {
  assert.deepEqual(
    normalizeBudgetForecastFilters({ periodStart: "2026-01-01", periodEnd: "2026-12-31", limit: 4 }),
    {
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      limit: 4,
    },
  );
  assert.throws(
    () => normalizeBudgetForecastFilters({ periodStart: "2026-02-31", periodEnd: "2026-12-31" }),
    /valid budget date range/i,
  );
  assert.throws(
    () => normalizeBudgetForecastFilters({ periodStart: "2026-01-01", periodEnd: "2026-12-31", limit: 0 }),
    /between 1 and 24/i,
  );
});

test("budget forecast snapshot returns totals and department rows in a stable contract", async () => {
  const result = await getBudgetForecastSnapshot(
    "company-1",
    { periodStart: "2026-01-01", periodEnd: "2026-12-31", limit: 4 },
    {
      async query(sql, params) {
        return {
          rows: [
            { department: "Operations", budget: 4200000, actual: 3950000, forecast: 4300000 },
            { department: "Sales", budget: 5200000, actual: 4900000, forecast: 5350000 },
            { department: "Procurement", budget: 3600000, actual: 3740000, forecast: 3680000 },
            { department: "Support", budget: 1600000, actual: 1550000, forecast: 1600000 },
          ],
        };
      },
    },
  );

  assert.equal(result.metrics.total_budget, 14600000);
  assert.equal(result.metrics.total_actual, 14140000);
  assert.equal(result.metrics.total_forecast, 14930000);
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[0].status, "On track");
  assert.match(result.assumptions[0].label, /Revenue growth/i);
  assert.deepEqual(result.filters, {
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    limit: 4,
  });
});

test("budget forecast falls back to generated department rows when no budget table data exists", async () => {
  const result = await getBudgetForecastSnapshot(
    "company-2",
    { periodStart: "2026-01-01", periodEnd: "2026-12-31", limit: 4 },
    {
      async query(sql) {
        if (String(sql).includes("FROM erp_budget_forecast_lines")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    },
  );

  assert.equal(result.metrics.total_budget, 14600000);
  assert.equal(result.metrics.total_actual, 14140000);
  assert.equal(result.metrics.total_forecast, 14930000);
  assert.equal(result.lines.length, 4);
  assert.ok(result.lines.every((line) => /Operations|Sales|Procurement|Support/.test(line.department)));
});
