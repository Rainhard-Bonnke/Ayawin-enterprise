const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeExchangeRate } = require("../src/services/exchangeRateService");
const { normalizeFxAccountingPolicy } = require("../src/services/fxAccountingPolicyService");

test("exchange-rate inputs normalize currency codes and retain exact rate provenance", () => {
  assert.deepEqual(normalizeExchangeRate({
    fromCurrencyCode: "usd",
    toCurrencyCode: "kes",
    rate: "151.25",
    effectiveDate: "2026-11-13",
    source: "Treasury closing quote",
  }), {
    from: "USD",
    to: "KES",
    rate: 151.25,
    effectiveDate: "2026-11-13",
    source: "Treasury closing quote",
  });
});

test("exchange-rate inputs reject invalid date, rate, source, and currency direction", () => {
  const valid = {
    fromCurrencyCode: "USD",
    toCurrencyCode: "KES",
    rate: 151.25,
    effectiveDate: "2026-11-13",
    source: "Treasury quote",
  };

  assert.throws(() => normalizeExchangeRate({ ...valid, effectiveDate: "2026-02-31" }), /valid YYYY-MM-DD/i);
  assert.throws(() => normalizeExchangeRate({ ...valid, rate: 0 }), /positive/i);
  assert.throws(() => normalizeExchangeRate({ ...valid, source: " " }), /source is required/i);
  assert.throws(() => normalizeExchangeRate({ ...valid, toCurrencyCode: "USD" }), /different/i);
});

test("FX accounting policy requires explicit supported rate, rounding, account, and reversal decisions", () => {
  const valid = {
    currencyCode: "usd",
    rateDirection: "base_per_transaction",
    rateSource: "Finance-approved treasury source",
    effectiveDatePolicy: "exact_date",
    roundingMethod: "currency_minor_half_up",
    realizedGainAccountId: "00000000-0000-4000-8000-000000000001",
    realizedLossAccountId: "00000000-0000-4000-8000-000000000002",
    unrealizedGainAccountId: "00000000-0000-4000-8000-000000000003",
    unrealizedLossAccountId: "00000000-0000-4000-8000-000000000004",
    monetaryAccountIds: ["00000000-0000-4000-8000-000000000005"],
    reversalPolicy: "next_period_start",
  };

  assert.equal(normalizeFxAccountingPolicy(valid).currencyCode, "USD");
  assert.throws(() => normalizeFxAccountingPolicy({ ...valid, rateDirection: "guess" }), /direction/i);
  assert.throws(() => normalizeFxAccountingPolicy({ ...valid, effectiveDatePolicy: "nearest_prior" }), /exact/i);
  assert.throws(() => normalizeFxAccountingPolicy({ ...valid, roundingMethod: "bankers" }), /rounding/i);
  assert.throws(() => normalizeFxAccountingPolicy({ ...valid, reversalPolicy: "never" }), /reversal/i);
  assert.throws(() => normalizeFxAccountingPolicy({ ...valid, monetaryAccountIds: [] }), /monetary account/i);
});