const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidCsrfRequest } = require("../src/services/authCookieService");

test("cookie-backed CSRF requests require the configured browser origin", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = "production";
  process.env.CORS_ORIGIN = "https://erp.ayawin.co.ke,https://admin.ayawin.co.ke";
  const token = "csrf-token";
  const request = (origin) => ({
    headers: {
      origin,
      cookie: `ayawin_csrf_token=${token}`,
      "x-csrf-token": token,
    },
  });

  try {
    assert.equal(isValidCsrfRequest(request("https://erp.ayawin.co.ke")), true);
    assert.equal(isValidCsrfRequest(request("https://attacker.example")), false);
    assert.equal(isValidCsrfRequest(request(undefined)), false);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  }
});
