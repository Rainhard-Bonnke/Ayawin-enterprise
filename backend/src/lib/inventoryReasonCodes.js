const REASON_CODES = [
  { code: 'CYCLE_COUNT', label: 'Cycle count variance' },
  { code: 'DAMAGE', label: 'Damaged / write-off' },
  { code: 'THEFT', label: 'Theft / shrinkage' },
  { code: 'CORRECTION', label: 'Data correction' },
  { code: 'SAMPLE', label: 'Sample / marketing' },
  { code: 'OTHER', label: 'Other (describe in notes)' },
];

function normalizeReasonCode(code) {
  const c = String(code || '').trim().toUpperCase();
  const found = REASON_CODES.find((r) => r.code === c);
  if (!found) {
    const err = new Error(`Invalid reason_code. Allowed: ${REASON_CODES.map((r) => r.code).join(', ')}`);
    err.code = 'INVALID_REASON_CODE';
    throw err;
  }
  return found.code;
}

function formatReason(reasonCode, reasonText) {
  const code = normalizeReasonCode(reasonCode);
  const text = String(reasonText || '').trim();
  return text ? `${code}: ${text}` : code;
}

module.exports = { REASON_CODES, normalizeReasonCode, formatReason };
