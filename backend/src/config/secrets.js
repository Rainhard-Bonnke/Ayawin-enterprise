const PLACEHOLDERS = new Set([
  "your_jwt_secret_here_min_32_chars",
  "ayawin-enterprise-secret",
  "dev_jwt_secret_change_in_production",
  "change-me",
  "changeme",
  "secret",
  "replace-me",
]);

function validateSecrets(env = process.env) {
  const jwtSecret = env.JWT_SECRET;
  const isPlaceholder = (value) => !value || value.length < 32 || PLACEHOLDERS.has(value.toLowerCase()) ||
    /(change.?me|placeholder|your.*secret|replace.?with|example.*secret)/i.test(value);
  if (isPlaceholder(jwtSecret)) {
    throw new Error("JWT_SECRET must be at least 32 characters and must not be a placeholder");
  }

  const mfaKey = env.MFA_ENCRYPTION_KEY;
  if (isPlaceholder(mfaKey)) {
    throw new Error("MFA_ENCRYPTION_KEY must be at least 32 characters and must not be a placeholder");
  }
  if (mfaKey === jwtSecret) throw new Error("MFA_ENCRYPTION_KEY must be separate from JWT_SECRET");
}

module.exports = { validateSecrets };
