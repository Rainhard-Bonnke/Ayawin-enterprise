const test = require("node:test");
const assert = require("node:assert/strict");
const { roundMoney, sumMoney, lineMoney, toMinorUnits } = require("../src/lib/money");

test("money uses exact minor units and half-up line rounding", () => {
  assert.equal(sumMoney(["0.10", "0.20"]), 0.30);
  assert.equal(lineMoney("1.235", "10.00"), 12.35);
  assert.equal(lineMoney("0.333", "10.00"), 3.33);
  assert.equal(roundMoney("1.005"), 1.01);
  const net = lineMoney("3.333", "19.99");
  const vat = roundMoney(net * 16 / 100);
  assert.equal(toMinorUnits(sumMoney([net, vat])), toMinorUnits(net) + toMinorUnits(vat));
});
