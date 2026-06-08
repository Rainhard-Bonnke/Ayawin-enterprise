const KRA_PIN_REGEX = /^[A-Z]\d{9}[A-Z]$/i;
const KENYA_MOBILE_E164 = /^\+254[17]\d{8}$/;

function kenyaPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeKraPin(value: string) {
  return value.trim().toUpperCase();
}

/** Normalize to +2547XXXXXXXX; strips spaces, dashes, and duplicate 254 prefixes. */
export function normalizeKenyaPhone(value: string) {
  const raw = (value || "").trim();
  if (!raw) return "";
  let d = kenyaPhoneDigits(raw);
  if (!d) return raw;
  while (d.startsWith("254254")) d = d.slice(3);
  let national: string;
  if (d.startsWith("254")) {
    national = d.slice(3);
  } else if (d.startsWith("0")) {
    national = d.slice(1);
  } else {
    national = d;
  }
  while (national.startsWith("0") && national.length > 9) {
    national = national.slice(1);
  }
  if (national.length === 9 && /^[17]\d{8}$/.test(national)) {
    return `+254${national}`;
  }
  return raw;
}

export function validateKraPin(value: string, { required = false } = {}) {
  const pin = normalizeKraPin(value || "");
  if (!pin) {
    return required ? { ok: false as const, error: "KRA PIN is required" } : { ok: true as const, value: "" };
  }
  if (pin.length !== 11) {
    return {
      ok: false as const,
      error: `KRA PIN must be exactly 11 characters (you entered ${pin.length})`,
    };
  }
  if (!KRA_PIN_REGEX.test(pin)) {
    return {
      ok: false as const,
      error: "Use format: letter + 9 digits + letter (e.g. P051999999Z), not 11 numbers only",
    };
  }
  return { ok: true as const, value: pin };
}

export function validateKenyaPhone(value: string, { required = false } = {}) {
  const raw = (value || "").trim();
  if (!raw) {
    return required ? { ok: false as const, error: "Phone number is required" } : { ok: true as const, value: "" };
  }
  const normalized = normalizeKenyaPhone(raw);
  if (!KENYA_MOBILE_E164.test(normalized)) {
    return {
      ok: false as const,
      error: "Enter a valid Kenya mobile (e.g. 0712 345 678 or +254 712 345 678)",
    };
  }
  return { ok: true as const, value: normalized };
}
