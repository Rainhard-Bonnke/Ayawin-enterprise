function normalizeCurrencyCode(value, label) {
  const code = String(value || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`${label} must be a three-letter ISO currency code`);
  }
  return code;
}

function normalizeRateDirection(rateDirection) {
  const direction = String(rateDirection || "").trim();
  if (!["base_per_transaction", "transaction_per_base"].includes(direction)) {
    throw new Error("Exchange-rate direction must be base_per_transaction or transaction_per_base");
  }
  return direction;
}

function convertToBaseCurrencyAmount({
  amount,
  foreignCurrencyCode,
  baseCurrencyCode,
  rate,
  rateDirection,
}) {
  const numericAmount = Number(amount || 0);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new Error("FX amounts must be non-negative numbers");
  }
  const resolvedRate = Number(rate);
  if (!Number.isFinite(resolvedRate) || resolvedRate <= 0) {
    throw new Error("FX exchange rate must be a positive number");
  }
  const normalizedForeign = normalizeCurrencyCode(foreignCurrencyCode, "Foreign currency");
  const normalizedBase = normalizeCurrencyCode(baseCurrencyCode, "Base currency");
  if (normalizedForeign === normalizedBase) {
    return numericAmount;
  }
  const direction = normalizeRateDirection(rateDirection);
  return direction === "base_per_transaction"
    ? numericAmount * resolvedRate
    : numericAmount / resolvedRate;
}

function calculateRealizedSettlementVariance({
  foreignCurrencyCode,
  baseCurrencyCode,
  carryingBaseAmount,
  settlementForeignAmount,
  rate,
  rateDirection = "base_per_transaction",
}) {
  const carried = Number(carryingBaseAmount || 0);
  const settlementAmount = Number(settlementForeignAmount || 0);
  const settlementBaseAmount = convertToBaseCurrencyAmount({
    amount: settlementAmount,
    foreignCurrencyCode,
    baseCurrencyCode,
    rate,
    rateDirection,
  });
  const varianceBaseAmount = settlementBaseAmount - carried;
  return {
    foreignCurrencyCode: normalizeCurrencyCode(foreignCurrencyCode, "Foreign currency"),
    baseCurrencyCode: normalizeCurrencyCode(baseCurrencyCode, "Base currency"),
    carryingBaseAmount: carried,
    settlementForeignAmount: settlementAmount,
    settlementBaseAmount,
    varianceBaseAmount,
    gainBaseAmount: varianceBaseAmount > 0 ? varianceBaseAmount : 0,
    lossBaseAmount: varianceBaseAmount < 0 ? -varianceBaseAmount : 0,
    direction: varianceBaseAmount >= 0 ? "gain" : "loss",
  };
}

function createRealizedSettlementJournalPlan({
  foreignCurrencyCode,
  baseCurrencyCode,
  carryingBaseAmount,
  settlementForeignAmount,
  rate,
  rateDirection = "base_per_transaction",
  gainAccountId,
  lossAccountId,
  monetaryAccountId,
}) {
  const variance = calculateRealizedSettlementVariance({
    foreignCurrencyCode,
    baseCurrencyCode,
    carryingBaseAmount,
    settlementForeignAmount,
    rate,
    rateDirection,
  });

  const lines = [];
  const monetaryAccount = String(monetaryAccountId || "").trim();
  if (!monetaryAccount) throw new Error("Settlement journal requires the monetary account id");
  if (variance.gainBaseAmount > 0) {
    if (!gainAccountId) throw new Error("A realized gain account is required");
    lines.push({
      accountId: monetaryAccount,
      entry: "debit",
      baseAmount: variance.settlementBaseAmount,
    });
    lines.push({
      accountId: String(gainAccountId).trim(),
      entry: "credit",
      baseAmount: variance.gainBaseAmount,
    });
  } else if (variance.lossBaseAmount > 0) {
    if (!lossAccountId) throw new Error("A realized loss account is required");
    lines.push({
      accountId: monetaryAccount,
      entry: "credit",
      baseAmount: variance.settlementBaseAmount,
    });
    lines.push({
      accountId: String(lossAccountId).trim(),
      entry: "debit",
      baseAmount: variance.lossBaseAmount,
    });
  } else {
    lines.push({
      accountId: monetaryAccount,
      entry: "debit",
      baseAmount: variance.settlementBaseAmount,
    });
  }

  const gain = variance.gainBaseAmount > 0 && gainAccountId
    ? { accountId: String(gainAccountId).trim(), baseAmount: variance.gainBaseAmount, entry: "credit" }
    : null;
  const loss = variance.lossBaseAmount > 0 && lossAccountId
    ? { accountId: String(lossAccountId).trim(), baseAmount: variance.lossBaseAmount, entry: "debit" }
    : null;

  return {
    ...variance,
    gain,
    loss,
    gainAccountId: gainAccountId ? String(gainAccountId).trim() : null,
    lossAccountId: lossAccountId ? String(lossAccountId).trim() : null,
    monetaryAccountId: monetaryAccount,
    lines,
    reversalType: "next_period_start",
  };
}

function calculateUnrealizedRevaluationVariance({
  foreignCurrencyCode,
  baseCurrencyCode,
  foreignBalance,
  carryingBaseAmount,
  closingRate,
  rateDirection = "base_per_transaction",
}) {
  const foreignAmount = Number(foreignBalance || 0);
  const carryingValue = Number(carryingBaseAmount || 0);
  const closingValue = convertToBaseCurrencyAmount({
    amount: foreignAmount,
    foreignCurrencyCode,
    baseCurrencyCode,
    rate: closingRate,
    rateDirection,
  });
  const varianceBaseAmount = closingValue - carryingValue;
  return {
    foreignCurrencyCode: normalizeCurrencyCode(foreignCurrencyCode, "Foreign currency"),
    baseCurrencyCode: normalizeCurrencyCode(baseCurrencyCode, "Base currency"),
    foreignBalance: foreignAmount,
    carryingBaseAmount: carryingValue,
    closingBaseAmount: closingValue,
    varianceBaseAmount,
    gainBaseAmount: varianceBaseAmount > 0 ? varianceBaseAmount : 0,
    lossBaseAmount: varianceBaseAmount < 0 ? -varianceBaseAmount : 0,
    direction: varianceBaseAmount >= 0 ? "gain" : "loss",
  };
}

function createUnrealizedRevaluationJournalPlan({
  foreignCurrencyCode,
  baseCurrencyCode,
  foreignBalance,
  carryingBaseAmount,
  closingRate,
  rateDirection = "base_per_transaction",
  gainAccountId,
  lossAccountId,
  monetaryAccountId,
}) {
  const variance = calculateUnrealizedRevaluationVariance({
    foreignCurrencyCode,
    baseCurrencyCode,
    foreignBalance,
    carryingBaseAmount,
    closingRate,
    rateDirection,
  });

  const monetaryAccount = String(monetaryAccountId || "").trim();
  if (!monetaryAccount) throw new Error("Revaluation journal requires the monetary account id");

  const lines = [];
  if (variance.gainBaseAmount > 0) {
    if (!gainAccountId) throw new Error("An unrealized gain account is required");
    lines.push({
      accountId: monetaryAccount,
      entry: "debit",
      baseAmount: variance.closingBaseAmount,
    });
    lines.push({
      accountId: String(gainAccountId).trim(),
      entry: "credit",
      baseAmount: variance.gainBaseAmount,
    });
  } else if (variance.lossBaseAmount > 0) {
    if (!lossAccountId) throw new Error("An unrealized loss account is required");
    lines.push({
      accountId: monetaryAccount,
      entry: "credit",
      baseAmount: variance.closingBaseAmount,
    });
    lines.push({
      accountId: String(lossAccountId).trim(),
      entry: "debit",
      baseAmount: variance.lossBaseAmount,
    });
  } else {
    lines.push({
      accountId: monetaryAccount,
      entry: "debit",
      baseAmount: variance.closingBaseAmount,
    });
  }

  const gain = variance.gainBaseAmount > 0 && gainAccountId
    ? { accountId: String(gainAccountId).trim(), baseAmount: variance.gainBaseAmount, entry: "credit" }
    : null;
  const loss = variance.lossBaseAmount > 0 && lossAccountId
    ? { accountId: String(lossAccountId).trim(), baseAmount: variance.lossBaseAmount, entry: "debit" }
    : null;

  return {
    ...variance,
    gain,
    loss,
    gainAccountId: gainAccountId ? String(gainAccountId).trim() : null,
    lossAccountId: lossAccountId ? String(lossAccountId).trim() : null,
    monetaryAccountId: monetaryAccount,
    lines,
    reversalType: "next_period_start",
  };
}

module.exports = {
  normalizeCurrencyCode,
  convertToBaseCurrencyAmount,
  calculateRealizedSettlementVariance,
  createRealizedSettlementJournalPlan,
  calculateUnrealizedRevaluationVariance,
  createUnrealizedRevaluationJournalPlan,
};
