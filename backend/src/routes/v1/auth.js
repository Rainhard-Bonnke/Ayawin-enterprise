const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../db');
const tokenService = require('../../services/tokenService');
const userService = require('../../services/userService');
const mfaService = require('../../services/mfaService');
const { logAudit } = require('../../services/auditService');
const { authenticateErp, getClientIp } = require('../../middleware/erpAuth');

const router = express.Router();

const IS_DEMO_MODE = (process.env.ENABLE_DEMO_MODE === 'true') && (process.env.NODE_ENV !== 'production');
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS) || 5;

async function setUserPassword(userId, password) {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `UPDATE erp_users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [hash, userId],
  );
}

router.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const mfaToken = typeof req.body?.mfa_token === 'string' ? req.body.mfa_token.trim() : '';
  const companyCode = typeof req.body?.company_code === 'string' ? req.body.company_code.trim() : null;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    let user = await userService.findUserByEmail(email, companyCode);

    if (!user && IS_DEMO_MODE && password === 'demo' && email === 'admin@martin.co.ke') {
      await pool.query('SELECT 1');
      user = await userService.findUserByEmail(email);
      if (user && !user.password_hash) {
        await setUserPassword(user.id, 'demo');
        user = await userService.findUserByEmail(email);
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'locked' && user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: 'Account is temporarily locked' });
    }

    if (!user.password_hash) {
      if (IS_DEMO_MODE && password === 'demo') {
        await setUserPassword(user.id, 'demo');
        user.password_hash = await bcrypt.hash('demo', 10);
      } else {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }

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
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.mfa_enabled) {
      if (!mfaToken) {
        return res.status(401).json({ error: 'MFA required', mfa_required: true });
      }
      const secret = await mfaService.getDecryptedSecret(user.id);
      if (!secret || !mfaService.verifyTotp(secret, mfaToken)) {
        return res.status(401).json({ error: 'Invalid MFA token' });
      }
    }

    const ip = getClientIp(req);
    const refreshToken = tokenService.generateRefreshToken();
    await tokenService.storeRefreshToken({
      user,
      token: refreshToken,
      ipAddress: ip,
      deviceInfo: req.headers['user-agent'] || null,
    });

    const accessToken = tokenService.generateAccessToken(user);

    await pool.query(
      `UPDATE erp_users
       SET failed_login_attempts = 0, locked_until = NULL, status = 'active',
           last_login_at = NOW(), last_login_ip = $1::inet, updated_at = NOW()
       WHERE id = $2`,
      [ip, user.id],
    );

    await logAudit({
      companyId: user.company_id,
      userId: user.id,
      entityType: 'erp_users',
      entityId: user.id,
      action: 'login',
      newValues: { email: user.email },
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: process.env.JWT_ACCESS_EXPIRES || '15m',
      user: userService.sanitizeUser(user),
    });
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: 'Authentication service unavailable' });
  }
});

router.post('/refresh', async (req, res) => {
  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
  if (!refreshToken) {
    return res.status(400).json({ error: 'refresh_token is required' });
  }

  try {
    const row = await tokenService.findValidRefreshToken(refreshToken);
    if (!row || row.status !== 'active') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await userService.findUserById(row.id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newRefresh = tokenService.generateRefreshToken();
    const stored = await tokenService.storeRefreshToken({
      user,
      token: newRefresh,
      ipAddress: getClientIp(req),
      deviceInfo: req.headers['user-agent'] || null,
    });
    await tokenService.revokeRefreshToken(tokenService.hashToken(refreshToken), stored.id);

    return res.json({
      access_token: tokenService.generateAccessToken(user),
      refresh_token: newRefresh,
      token_type: 'Bearer',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to refresh token' });
  }
});

router.post('/logout', authenticateErp, async (req, res) => {
  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
  if (refreshToken) {
    await tokenService.revokeRefreshToken(tokenService.hashToken(refreshToken));
  }
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: 'erp_users',
    entityId: req.user.id,
    action: 'logout',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'],
  });
  return res.json({ ok: true });
});

router.get('/me', authenticateErp, async (req, res) => {
  const user = await userService.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(userService.sanitizeUser(user));
});

router.post('/mfa/setup', authenticateErp, async (req, res) => {
  const secret = mfaService.generateMfaSecret();
  await mfaService.enableMfaPending(req.user.id, req.user.company_id, secret);
  const otpauthUrl = mfaService.getOtpAuthUrl({ secret, email: req.user.email });
  return res.json({ secret, otpauth_url: otpauthUrl });
});

router.post('/mfa/verify', authenticateErp, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) return res.status(400).json({ error: 'token is required' });

  const secret = await mfaService.getDecryptedSecret(req.user.id);
  if (!secret || !mfaService.verifyTotp(secret, token)) {
    return res.status(400).json({ error: 'Invalid MFA token' });
  }

  await mfaService.confirmMfa(req.user.id, req.user.company_id);
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: 'erp_user_mfa',
    entityId: req.user.id,
    action: 'mfa_enabled',
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'],
  });
  return res.json({ ok: true, mfa_enabled: true });
});

router.patch('/profile', authenticateErp, async (req, res) => {
  const { full_name, phone, locale, job_title, department, notification_preferences } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
    await client.query('COMMIT');
    const user = await userService.findUserById(req.user.id);
    return res.json(userService.sanitizeUser(user));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Unable to update profile' });
  } finally {
    client.release();
  }
});

module.exports = router;
