const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requiresMdApproval,
  allocateLandedCost,
  PO_MD_THRESHOLD,
} = require('../src/services/procurementService');

test('MD approval required above threshold', () => {
  assert.equal(requiresMdApproval(PO_MD_THRESHOLD), false);
  assert.equal(requiresMdApproval(PO_MD_THRESHOLD + 1), true);
});

test('landed cost allocated by line value share', () => {
  const lines = [
    { quantity: 10, unit_cost: 100 },
    { quantity: 5, unit_cost: 200 },
  ];
  const costed = allocateLandedCost(lines, 1500);
  const totalLanded = costed.reduce((s, l) => s + (l.effectiveUnitCost - l.unit_cost) * l.quantity, 0);
  assert.ok(Math.abs(totalLanded - 1500) < 0.01);
  assert.ok(costed.every((l) => l.effectiveUnitCost >= l.unit_cost));
});
