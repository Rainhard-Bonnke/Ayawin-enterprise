const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateRealizedSettlementVariance,
  createRealizedSettlementJournalPlan,
  calculateUnrealizedRevaluationVariance,
  createUnrealizedRevaluationJournalPlan,
} = require("../src/services/fxSettlementRevaluationService");

test("realized settlement computes the gain or loss on settlement value vs carrying base amount", () => {
  const result = calculateRealizedSettlementVariance({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    carryingBaseAmount: 120000,
    settlementForeignAmount: 1200,
    rate: 100,
    rateDirection: "base_per_transaction",
  });

  assert.equal(result.varianceBaseAmount, 0);
  assert.equal(result.gainBaseAmount, 0);
  assert.equal(result.lossBaseAmount, 0);

  const gain = calculateRealizedSettlementVariance({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    carryingBaseAmount: 100000,
    settlementForeignAmount: 1000,
    rate: 110,
    rateDirection: "base_per_transaction",
  });
  assert.equal(gain.varianceBaseAmount, 10000);
  assert.equal(gain.gainBaseAmount, 10000);
  assert.equal(gain.lossBaseAmount, 0);

  const loss = calculateRealizedSettlementVariance({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    carryingBaseAmount: 120000,
    settlementForeignAmount: 1000,
    rate: 95,
    rateDirection: "base_per_transaction",
  });
  assert.equal(loss.varianceBaseAmount, -25000);
  assert.equal(loss.gainBaseAmount, 0);
  assert.equal(loss.lossBaseAmount, 25000);
});

test("revaluation prepares the unrealized gain or loss and the reversal entry using the closing rate", () => {
  const variance = calculateUnrealizedRevaluationVariance({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    carryingBaseAmount: 100000,
    closingRate: 108,
    rateDirection: "base_per_transaction",
    foreignBalance: 1000,
  });
  assert.equal(variance.varianceBaseAmount, 8000);
  assert.equal(variance.gainBaseAmount, 8000);
  assert.equal(variance.lossBaseAmount, 0);

  const journal = createUnrealizedRevaluationJournalPlan({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    foreignBalance: 1000,
    carryingBaseAmount: 100000,
    closingRate: 108,
    rateDirection: "base_per_transaction",
    gainAccountId: "11111111-1111-4111-8111-111111111111",
    lossAccountId: "22222222-2222-4222-8222-222222222222",
    monetaryAccountId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(journal.gain.baseAmount, 8000);
  assert.equal(journal.lines.length, 2);
  assert.equal(journal.lines[0].accountId, "33333333-3333-4333-8333-333333333333");
  assert.equal(journal.lines[1].accountId, "11111111-1111-4111-8111-111111111111");
  assert.equal(journal.reversalType, "next_period_start");
});

test("settlement journal plan produces a balanced realized gain or loss entry", () => {
  const plan = createRealizedSettlementJournalPlan({
    foreignCurrencyCode: "USD",
    baseCurrencyCode: "KES",
    carryingBaseAmount: 100000,
    settlementForeignAmount: 1000,
    rate: 110,
    rateDirection: "base_per_transaction",
    gainAccountId: "11111111-1111-4111-8111-111111111111",
    lossAccountId: "22222222-2222-4222-8222-222222222222",
    monetaryAccountId: "33333333-3333-4333-8333-333333333333",
  });

  assert.equal(plan.gainBaseAmount, 10000);
  assert.equal(plan.lossBaseAmount, 0);
  assert.equal(plan.lines.length, 2);
  assert.equal(plan.lines[0].accountId, "33333333-3333-4333-8333-333333333333");
  assert.equal(plan.lines[1].accountId, "11111111-1111-4111-8111-111111111111");
});
