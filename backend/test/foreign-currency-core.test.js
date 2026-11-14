const test = require("node:test");
const assert = require("node:assert/strict");
const {
  convertToBaseCurrencyAmount,
  buildJournalLineCurrencySnapshot,
} = require("../src/services/glPostingService");

test("foreign-currency journal conversion keeps the transaction currency and base-currency values aligned", () => {
  const baseValue = convertToBaseCurrencyAmount({
    amount: 1250,
    currencyCode: "USD",
    baseCurrencyCode: "KES",
    exchangeRate: 150.5,
  });

  assert.equal(baseValue, 188125);
  assert.throws(() => convertToBaseCurrencyAmount({
    amount: -1,
    currencyCode: "USD",
    baseCurrencyCode: "KES",
    exchangeRate: 150.5,
  }), /non-negative/i);
});

test("base conversion honors the policy rate direction for inverse quotes", () => {
  assert.equal(convertToBaseCurrencyAmount({
    amount: 125,
    currencyCode: "USD",
    baseCurrencyCode: "KES",
    exchangeRate: 0.01,
    rateDirection: "transaction_per_base",
  }), 12500);
  assert.throws(() => convertToBaseCurrencyAmount({
    amount: 125,
    currencyCode: "USD",
    baseCurrencyCode: "KES",
    exchangeRate: 0.01,
    rateDirection: "unknown",
  }), /rate direction/i);
});

test("journal line snapshots persist explicit transaction and base amounts for supported base-currency entries", () => {
  assert.deepEqual(buildJournalLineCurrencySnapshot({
    debit: 125.5,
    credit: 0,
    currencyCode: "KES",
    baseCurrencyCode: "KES",
    exchangeRate: 1,
    entryDate: "2026-11-13",
  }), {
    transaction_debit: 125.5,
    transaction_credit: 0,
    base_debit: 125.5,
    base_credit: 0,
    exchange_rate: 1,
    exchange_rate_source: "base_currency",
    exchange_rate_direction: "base_per_transaction",
    exchange_rate_id: null,
    exchange_rate_effective_date: "2026-11-13",
  });

  assert.throws(() => buildJournalLineCurrencySnapshot({
    debit: 125.5,
    credit: 0,
    currencyCode: "USD",
    baseCurrencyCode: "KES",
    exchangeRate: 150,
    entryDate: "2026-11-13",
  }), { code: "FOREIGN_CURRENCY_UNSUPPORTED" });
});
