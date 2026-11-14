const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeBankAccountInput } = require("../src/services/cashBankAccountService");

test("bank account validation rejects non-cash asset codes and invalid currencies", () => {
  assert.throws(
    () =>
      normalizeBankAccountInput({
        accountCode: "2000",
        accountName: "Trade receivables",
        currencyCode: "KES",
      }),
    /cash or bank account code must start with 11/i,
  );

  assert.throws(
    () =>
      normalizeBankAccountInput({
        accountCode: "1100",
        accountName: "Main bank",
        currencyCode: "XXX",
      }),
    /valid 3-letter ISO currency code/i,
  );
});

test("bank account validation accepts a valid postable cash account record", () => {
  const normalized = normalizeBankAccountInput({
    accountCode: "1110",
    accountName: "KCB Primary Account",
    currencyCode: "KES",
    isActive: true,
    isPostable: true,
  });

  assert.deepEqual(normalized, {
    account_code: "1110",
    account_name: "KCB Primary Account",
    account_type: "asset",
    level: 2,
    currency_code: "KES",
    is_active: true,
    is_postable: true,
  });
});
