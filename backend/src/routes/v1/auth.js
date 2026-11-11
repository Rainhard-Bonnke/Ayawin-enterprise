const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../db");
const tokenService = require("../../services/tokenService");
const userService = require("../../services/userService");
const mfaService = require("../../services/mfaService");
const {
  REFRESH_COOKIE,
  readCookie,
  isValidCsrfRequest,
  setSessionCookies,
  ensureCsrfCookie,
  clearSessionCookies,
} = require("../../services/authCookieService");
const { logAudit } = require("../../services/auditService");
const { authenticateErp, getClientIp } = require("../../middleware/erpAuth");

const router = express.Router();

const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS) || 5;

router.get("/csrf", (req, res) => {
  return res.json({ csrf_token: ensureCsrfCookie(req, res) });
});

router.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const mfaToken = typeof req.body?.mfa_token === "string" ? req.body.mfa_token.trim() : "";
  const companyCode =
    typeof req.body?.company_code === "string" ? req.body.company_code.trim() : null;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  try {
    let user = await userService.findUserByEmail(email, companyCode);

    if (!user) {
      await bcrypt.hash(password, 12);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const accountLocked = user.status === "locked" && user.locked_until && new Date(user.locked_until) > new Date();
    if (accountLocked) return res.status(401).json({ error: "Invalid credentials" });
    if (user.status !== "active" && user.status !== "locked") return res.status(401).json({ error: "Invalid credentials" });

    if (!user.password_hash) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const attempts = (user.failed_login_attempts || 0) + 1;
      const lock = attempts >= MAX_FAILED_LOGINS;
      await pool.query(
        `UPDATE erp_users
         SET failed_login_attempts = $1,
             locked_until = CASE WHEN $2 THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END,
             status = CASE WHEN $2 THEN 'locked' ELSE status END,
             updated_at = NOW()
         WHERE id = $3`,
        [attempts, lock, user.id],
      );
      await userService.invalidateUserCache(user.id);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.mfa_enabled) {
      if (!mfaToken) {
        return res.status(401).json({ error: "MFA required", mfa_required: true });
      }
      const secret = await mfaService.getDecryptedSecret(user.id);
      const validTotp = secret && await mfaService.consumeTotp(user.id, secret, mfaToken);
      const validRecovery = !validTotp && await mfaService.consumeRecoveryCode(user.id, mfaToken);
      if (!validTotp && !validRecovery) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const lock = attempts >= MAX_FAILED_LOGINS;
        await pool.query(
          `UPDATE erp_users SET failed_login_attempts = $1,
             locked_until = CASE WHEN $2 THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END,
             status = CASE WHEN $2 THEN 'locked' ELSE status END, updated_at = NOW() WHERE id = $3`,
          [attempts, lock, user.id],
        );
        await userService.invalidateUserCache(user.id);
        return res.status(401).json({ error: "Invalid MFA token" });
      }
    }

    const ip = getClientIp(req);
    const sessionType = user.role_name === "POS Operator" ? "pos" : "user";
    if (sessionType === "pos") user.permissions = tokenService.permissionsForSession(user, sessionType);
    const refreshToken = tokenService.generateRefreshToken();
    await tokenService.storeRefreshToken({
      user,
      token: refreshToken,
      ipAddress: ip,
      deviceInfo: req.headers["user-agent"] || null,
      sessionType,
    });

    const accessToken = tokenService.generateAccessToken(user, { sessionType });

    await pool.query(
      `UPDATE erp_users
       SET failed_login_attempts = 0, locked_until = NULL, status = 'active',
           last_login_at = NOW(), last_login_ip = $1::inet, updated_at = NOW()
       WHERE id = $2`,
      [ip, user.id],
    );
    await userService.invalidateUserCache(user.id);

    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      entityType: "erp_users",
      entityId: user.id,
      action: "login",
      newValues: { email: user.email },
      ipAddress: ip,
      userAgent: req.headers["user-agent"],
    });

    const csrfToken = setSessionCookies(res, refreshToken);
    return res.json({
      access_token: accessToken,
      csrf_token: csrfToken,
      token_type: "Bearer",
      expires_in: process.env.JWT_ACCESS_EXPIRES || "15m",
      user: userService.sanitizeUser(user),
    });
  } catch (err) {
    console.error(JSON.stringify({ request_id: req.id, event: "login_error", error: err.message, code: err.code }));
    return res.status(503).json({ error: "Authentication service unavailable", request_id: req.id });
  }
});

router.post("/refresh", async (req, res) => {
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (!refreshToken) {
    clearSessionCookies(res);
    return res.status(401).json({ error: "Invalid refresh token" });
  }
  if (!isValidCsrfRequest(req)) {
    return res.status(403).json({ error: "CSRF validation failed" });
  }

  try {
    const row = await tokenService.findRefreshToken(refreshToken);
    if (!row) {
      clearSessionCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    if (row.revoked_at) {
      await tokenService.revokeUserRefreshTokens(row.user_id);
      await logAudit({ companyId: row.company_id, userId: row.user_id, entityType: "erp_refresh_tokens",
        entityId: row.token_id, action: "refresh_token_reuse_detected", ipAddress: getClientIp(req) });
      clearSessionCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }
    if (row.expires_at <= new Date() || row.status !== "active") {
      clearSessionCookies(res);
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = await userService.findUserById(row.user_id);
    if (!user) {
      clearSessionCookies(res);
      return res.status(401).json({ error: "User not found" });
    }
    if (user.status !== "active") {
      clearSessionCookies(res);
      return res.status(401).json({ error: "User is inactive" });
    }
    const ip = getClientIp(req);
    if (!(await userService.checkIpWhitelist(user, ip))) return res.status(403).json({ error: "Access denied from this IP address" });
    if (row.session_type === "pos" && user.role_name !== "POS Operator") {
      clearSessionCookies(res);
      return res.status(401).json({ error: "POS session is no longer valid" });
    }
    if (row.session_type === "pos") user.permissions = tokenService.permissionsForSession(user, "pos");

    const newRefresh = tokenService.generateRefreshToken();
    const stored = await tokenService.storeRefreshToken({
      user,
      token: newRefresh,
      ipAddress: ip,
      deviceInfo: req.headers["user-agent"] || null,
      sessionType: row.session_type,
    });
    await tokenService.revokeRefreshToken(tokenService.hashToken(refreshToken), stored.id);
    const csrfToken = setSessionCookies(res, newRefresh);

    return res.json({
      access_token: tokenService.generateAccessToken(user, { sessionType: row.session_type }),
      csrf_token: csrfToken,
      token_type: "Bearer",
    });
  } catch (err) {
    const unavailable = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01"].includes(err.code) || err.code?.startsWith("08");
    console.error(JSON.stringify({ request_id: req.id, event: "refresh_error", error: err.message, code: err.code }));
    return res.status(unavailable ? 503 : 500).json({
      error: unavailable ? "Authentication service unavailable" : "Unable to refresh token",
      request_id: req.id,
    });
  }
});

router.post("/logout", authenticateErp, async (req, res) => {
  if (!isValidCsrfRequest(req)) {
    return res.status(403).json({ error: "CSRF validation failed" });
  }
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (refreshToken) {
    await tokenService.revokeRefreshToken(tokenService.hashToken(refreshToken));
  }
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_users",
    entityId: req.user.id,
    action: "logout",
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
  clearSessionCookies(res);
  return res.json({ ok: true });
});

router.get("/me", authenticateErp, async (req, res) => {
  return res.json(req.user);
});

router.post("/mfa/setup", authenticateErp, async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = await userService.findUserByEmail(req.user.email);
  if (!password || !user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Current password is required" });
  }
  if (user.mfa_enabled) {
    const currentTotp = typeof req.body?.current_totp === "string" ? req.body.current_totp.trim() : "";
    const activeSecret = await mfaService.getDecryptedSecret(req.user.id);
    if (!activeSecret || !mfaService.verifyTotpStep(activeSecret, currentTotp)) {
      return res.status(401).json({ error: "Current MFA token is required" });
    }
  }
  const secret = mfaService.generateMfaSecret();
  await mfaService.enableMfaPending(req.user.id, req.user.company_id, secret);
  const otpauthUrl = mfaService.getOtpAuthUrl({ secret, email: req.user.email });
  return res.json({ secret, otpauth_url: otpauthUrl });
});

router.post("/mfa/verify", authenticateErp, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) return res.status(400).json({ error: "token is required" });

  const secret = await mfaService.getPendingSecret(req.user.id);
  if (!secret || !mfaService.verifyTotpStep(secret, token)) {
    return res.status(400).json({ error: "Invalid MFA token" });
  }

  const recoveryCodes = await mfaService.confirmMfa(req.user.id, req.user.company_id);
  await userService.invalidateUserCache(req.user.id);
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_user_mfa",
    entityId: req.user.id,
    action: "mfa_enabled",
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
  return res.json({ ok: true, mfa_enabled: true, recovery_codes: recoveryCodes });
});

router.patch("/profile", authenticateErp, async (req, res) => {
  const { full_name, phone, locale, job_title, department, notification_preferences } =
    req.body || {};

  const client = await pool.connect();
  try {
    if (full_name || phone || locale) {
      await client.query(
        `UPDATE erp_users
         SET full_name = COALESCE($1, full_name),
             phone = COALESCE($2, phone),
             locale = COALESCE($3, locale),
             updated_at = NOW(), updated_by = $4
         WHERE id = $4`,
        [full_name, phone, locale, req.user.id],
      );
    }
    if (job_title || department || notification_preferences) {
      await client.query(
        `INSERT INTO erp_user_profiles (company_id, user_id, job_title, department, notification_preferences, created_by)
         VALUES ($1, $2, $3, $4, $5, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           job_title = COALESCE(EXCLUDED.job_title, erp_user_profiles.job_title),
           department = COALESCE(EXCLUDED.department, erp_user_profiles.department),
           notification_preferences = COALESCE(EXCLUDED.notification_preferences, erp_user_profiles.notification_preferences),
           updated_at = NOW(), updated_by = $2`,
        [
          req.user.company_id,
          req.user.id,
          job_title,
          department,
          notification_preferences ? JSON.stringify(notification_preferences) : null,
        ],
      );
    }
    await client.query("COMMIT");
    await userService.invalidateUserCache(req.user.id);
    const user = await userService.findUserById(req.user.id);
    return res.json(userService.sanitizeUser(user));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Unable to update profile" });
  } finally {
    client.release();
  }
});

module.exports = router;
