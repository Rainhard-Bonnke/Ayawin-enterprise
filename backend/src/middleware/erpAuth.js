const tokenService = require("../services/tokenService");
const userService = require("../services/userService");
const { cacheGet, cacheSet } = require("../lib/redis");

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

async function authenticateErp(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = tokenService.verifyAccessToken(token);
    if (payload.type !== "access") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const cacheKey = `erp:user:${payload.sub}`;
    let user = await cacheGet(cacheKey);
    if (!user) {
      const loadedUser = await userService.findUserById(payload.sub);
      user = loadedUser ? userService.sanitizeUser(loadedUser) : null;
      if (user) await cacheSet(cacheKey, user, 30);
    }

    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    const ip = getClientIp(req);
    const ipAllowed = await userService.checkIpWhitelist(user, ip);
    if (!ipAllowed) {
      return res.status(403).json({ error: "Access denied from this IP address" });
    }

    req.user = user;
    req.user.role = user.role_name === "System Administrator" ? "Admin" : user.role_name;
    req.user.session_type = payload.session_type || "user";
    if (req.user.session_type === "pos") {
      if (user.role_name !== "POS Operator") return res.status(401).json({ error: "POS session is no longer valid" });
      req.user.permissions = tokenService.permissionsForSession(user, "pos");
    }
    req.erpAuthenticated = true;
    req.clientIp = ip;
    return next();
  } catch (error) {
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01"].includes(error.code) || error.code?.startsWith("08")) {
      return res.status(503).json({ error: "Authentication service unavailable" });
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requirePermission(...codes) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    const isLegacyAdmin = req.user?.role === "Admin";
    const hasAll = codes.every((code) => perms.includes(code));
    if (hasAll || isLegacyAdmin) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden", required: codes });
  };
}

function requireAnyPermission(...codes) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    const isLegacyAdmin = req.user?.role === "Admin";
    if (codes.some((code) => perms.includes(code)) || isLegacyAdmin) {
      return next();
    }
    return res.status(403).json({ error: "Forbidden", required_any: codes });
  };
}

function requireCompanyScope(req, res, next) {
  const companyId = req.params.companyId || req.body?.company_id || req.query.company_id;
  if (companyId && companyId !== req.user.company_id) {
    return res.status(403).json({ error: "Cross-company access denied" });
  }
  return next();
}

module.exports = {
  authenticateErp,
  requirePermission,
  requireAnyPermission,
  requireCompanyScope,
  getClientIp,
};
