/** Kenya ERP field validators — shared across routes and services. */

const KRA_PIN_REGEX = /^[A-Z]\d{9}[A-Z]$/i;

/** Kenyan mobile E.164: +254 + 9-digit national (starts with 7 or 1). */
const KENYA_MOBILE_E164 = /^\+254[17]\d{8}$/;

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeKraPin(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizePhone(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let d = phoneDigits(raw);
  if (!d) return raw;
  while (d.startsWith('254254')) d = d.slice(3);
  let national;
  if (d.startsWith('254')) {
    national = d.slice(3);
  } else if (d.startsWith('0')) {
    national = d.slice(1);
  } else {
    national = d;
  }
  while (national.startsWith('0') && national.length > 9) {
    national = national.slice(1);
  }
  if (national.length === 9 && /^[17]\d{8}$/.test(national)) {
    return `+254${national}`;
  }
  return raw;
}

function validateKraPin(value, { required = false } = {}) {
  const pin = normalizeKraPin(value);
  if (!pin) {
    if (required) return { ok: false, error: 'KRA PIN is required' };
    return { ok: true, value: null };
  }
  if (pin.length !== 11) {
    return { ok: false, error: `KRA PIN must be exactly 11 characters (you entered ${pin.length})` };
  }
  if (!KRA_PIN_REGEX.test(pin)) {
    return {
      ok: false,
      error: 'KRA PIN format: one letter + 9 digits + one letter (e.g. P051999999Z), not 11 digits only',
    };
  }
  return { ok: true, value: pin };
}

function validatePhone(value, { required = false } = {}) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    if (required) return { ok: false, error: 'Phone number is required' };
    return { ok: true, value: null };
  }
  const normalized = normalizePhone(raw);
  if (!KENYA_MOBILE_E164.test(normalized)) {
    return { ok: false, error: 'Enter a valid Kenya mobile (e.g. 0712 345 678 or +254 712 345 678)' };
  }
  return { ok: true, value: normalized };
}

function validateEmail(value, { required = false } = {}) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) {
    if (required) return { ok: false, error: 'Email is required' };
    return { ok: true, value: null };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Invalid email address' };
  }
  return { ok: true, value: email };
}

function validatePositiveAmount(value, fieldName = 'Amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${fieldName} must be zero or positive` };
  }
  return { ok: true, value: money2(n) };
}

/** Strictly positive (prices, quantities on orders). */
function validateStrictPositive(value, fieldName = 'Value') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `${fieldName} must be greater than zero` };
  }
  return { ok: true, value: n };
}

function money2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function validateRequiredString(value, fieldName, { maxLength = 255 } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return { ok: false, error: `${fieldName} is required` };
  if (s.length > maxLength) {
    return { ok: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { ok: true, value: s };
}

function validateOptionalString(value, fieldName, { maxLength = 255 } = {}) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const s = String(value).trim();
  if (s.length > maxLength) {
    return { ok: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }
  return { ok: true, value: s };
}

function validateDateRange(startDate, endDate, { startLabel = 'Start date', endLabel = 'End date' } = {}) {
  if (!startDate || !endDate) return { ok: true };
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: 'Invalid date' };
  }
  if (end < start) {
    return { ok: false, error: `${endLabel} cannot be before ${startLabel}` };
  }
  return { ok: true };
}

function validateCode(value, fieldName = 'Code') {
  return validateRequiredString(value, fieldName, { maxLength: 50 });
}

module.exports = {
  KRA_PIN_REGEX,
  normalizeKraPin,
  normalizePhone,
  money2,
  validateKraPin,
  validatePhone,
  validateEmail,
  validatePositiveAmount,
  validateStrictPositive,
  validateRequiredString,
  validateOptionalString,
  validateDateRange,
  validateCode,
};
