const legacyAuth = require('../auth');
const tokenService = require('../services/tokenService');
const userService = require('../services/userService');
const { cacheGet, cacheSet } = require('../lib/redis');

const IS_DEMO_MODE = (process.env.ENABLE_DEMO_MODE === 'true') && (process.env.NODE_ENV !== 'production');

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

async function authenticateErp(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (token.startsWith('demo:')) {
      if (!IS_DEMO_MODE) return res.status(401).json({ error: 'Demo tokens are not allowed' });
      return legacyAuth.authenticateToken(req, res, next);
    }

    const payload = tokenService.verifyAccessToken(token);
    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const cacheKey = `erp:user:${payload.sub}`;
    let user = await cacheGet(cacheKey);
    if (!user) {
      user = await userService.findUserById(payload.sub);
      if (user) await cacheSet(cacheKey, user, 120);
    }

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const ip = getClientIp(req);
    const ipAllowed = await userService.checkIpWhitelist(user, ip);
    if (!ipAllowed) {
      return res.status(403).json({ error: 'Access denied from this IP address' });
    }

    req.user = userService.sanitizeUser(user);
    req.clientIp = ip;
    return next();
  } catch {
    // Fall back to legacy JWT for existing frontend routes
    return legacyAuth.authenticateToken(req, res, next);
  }
}

function requirePermission(...codes) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    const isLegacyAdmin = req.user?.role === 'Admin';
    const hasAll = codes.every((code) => perms.includes(code));
    if (hasAll || isLegacyAdmin || perms.includes('foundation.edit')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden', required: codes });
  };
}

function requireCompanyScope(req, res, next) {
  const companyId = req.params.companyId || req.body?.company_id || req.query.company_id;
  if (companyId && companyId !== req.user.company_id) {
    return res.status(403).json({ error: 'Cross-company access denied' });
  }
  return next();
}

module.exports = {
  authenticateErp,
  requirePermission,
  requireCompanyScope,
  getClientIp,
};
