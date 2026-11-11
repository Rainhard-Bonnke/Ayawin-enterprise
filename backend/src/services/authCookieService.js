const crypto = require("crypto");
const { JWT_REFRESH_EXPIRES_DAYS } = require("./tokenService");

const REFRESH_COOKIE = "ayawin_refresh_token";
const CSRF_COOKIE = "ayawin_csrf_token";
const COOKIE_PATH = "/api/v1/auth";

function cookieOptions(httpOnly, path = COOKIE_PATH) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
    path,
  };
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function isValidCsrfRequest(req) {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const configuredOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const developmentOrigin = process.env.NODE_ENV !== "production" && (
    /^https?:\/\/localhost:\d+$/.test(origin) ||
    /^https?:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    /^https?:\/\/(?:10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3})\.\d{1,3}:\d+$/.test(origin) ||
    /^https:\/\/[^/]+\.trycloudflare\.com$/.test(origin)
  );
  if (!origin || (!configuredOrigins.includes(origin) && !developmentOrigin)) return false;

  const cookieToken = readCookie(req, CSRF_COOKIE);
  const headerToken = typeof req.headers["x-csrf-token"] === "string"
    ? req.headers["x-csrf-token"]
    : "";
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}

function setSessionCookies(res, refreshToken, csrfToken = crypto.randomBytes(32).toString("base64url")) {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...cookieOptions(true),
    maxAge: JWT_REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  });
  res.cookie(CSRF_COOKIE, csrfToken, cookieOptions(false, "/"));
  return csrfToken;
}

function ensureCsrfCookie(req, res) {
  const existing = readCookie(req, CSRF_COOKIE);
  const csrfToken = existing || crypto.randomBytes(32).toString("base64url");
  if (!existing) res.cookie(CSRF_COOKIE, csrfToken, cookieOptions(false, "/"));
  return csrfToken;
}

function clearSessionCookies(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(true));
  res.clearCookie(CSRF_COOKIE, cookieOptions(false, "/"));
}

module.exports = {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  readCookie,
  isValidCsrfRequest,
  setSessionCookies,
  ensureCsrfCookie,
  clearSessionCookies,
};
