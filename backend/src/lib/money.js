function parts(value) {
  const text = String(value ?? 0).trim().toLowerCase();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) throw new TypeError(`Invalid money value: ${value}`);
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] || "";
  const coefficient = BigInt((match[2] || "0") + fraction) * sign;
  return { coefficient, scale: fraction.length - Number(match[4] || 0) };
}

function roundedScaled(value, targetScale = 2) {
  const { coefficient, scale } = parts(value);
  const delta = targetScale - scale;
  if (delta >= 0) return coefficient * (10n ** BigInt(delta));
  const divisor = 10n ** BigInt(-delta);
  const abs = coefficient < 0n ? -coefficient : coefficient;
  const rounded = (abs + divisor / 2n) / divisor;
  return coefficient < 0n ? -rounded : rounded;
}

function fromMinorUnits(minor) {
  const n = BigInt(minor);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  return Number(`${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`);
}

const toMinorUnits = (value) => roundedScaled(value, 2);
const roundMoney = (value) => fromMinorUnits(toMinorUnits(value));
const sumMoney = (values) => fromMinorUnits(values.reduce((sum, value) => sum + toMinorUnits(value), 0n));
function lineMoney(quantity, unitPrice) {
  const a = parts(quantity), b = parts(unitPrice);
  const product = a.coefficient * b.coefficient;
  const scale = a.scale + b.scale;
  const delta = 2 - scale;
  if (delta >= 0) return fromMinorUnits(product * (10n ** BigInt(delta)));
  const divisor = 10n ** BigInt(-delta), abs = product < 0n ? -product : product;
  const rounded = (abs + divisor / 2n) / divisor;
  return fromMinorUnits(product < 0n ? -rounded : rounded);
}

module.exports = { toMinorUnits, fromMinorUnits, roundMoney, sumMoney, lineMoney };
