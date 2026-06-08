const test = require('node:test');
const assert = require('node:assert/strict');
const { REASON_CODES, normalizeReasonCode, formatReason } = require('../src/lib/inventoryReasonCodes');

test('weighted average cost calculation', () => {
  const oldQty = 100;
  const oldAvg = 10;
  const receiptQty = 50;
  const receiptCost = 12;
  const newQty = oldQty + receiptQty;
  const newAvg = ((oldQty * oldAvg) + (receiptQty * receiptCost)) / newQty;
  assert.equal(newAvg, 10.666666666666666);
  assert.equal(newQty, 150);
});

test('FEFO pick plan sorts earliest expiry first', () => {
  const batches = [
    { batch_no: 'B2', expiry_date: '2026-12-01', quantity: 20 },
    { batch_no: 'B1', expiry_date: '2026-06-01', quantity: 30 },
    { batch_no: 'B3', expiry_date: '2027-01-01', quantity: 50 },
  ].sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));

  const need = 45;
  let remaining = need;
  const picks = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(b.quantity));
    if (take > 0) {
      picks.push({ batch_no: b.batch_no, quantity: take });
      remaining -= take;
    }
  }
  assert.equal(picks[0].batch_no, 'B1');
  assert.equal(picks[0].quantity, 30);
  assert.equal(picks[1].batch_no, 'B2');
  assert.equal(picks[1].quantity, 15);
});

test('reason codes normalize and format', () => {
  assert.equal(normalizeReasonCode('damage'), 'DAMAGE');
  assert.equal(formatReason('CORRECTION', 'count fix'), 'CORRECTION: count fix');
  assert.throws(() => normalizeReasonCode('INVALID'));
  assert.equal(REASON_CODES.length >= 5, true);
});
