const KRA_PIN_PATTERN = /^[AP][0-9]{9}[A-Z]$/;

function normalizeKraPin(value) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!KRA_PIN_PATTERN.test(normalized)) throw new Error("KRA PIN must match A/P followed by 9 digits and an uppercase letter");
  return normalized;
}

module.exports = { KRA_PIN_PATTERN, normalizeKraPin };
