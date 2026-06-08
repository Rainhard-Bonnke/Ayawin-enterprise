const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const { sameOriginMutations } = require('./sameOriginMutation');

const isDev = process.env.NODE_ENV !== 'production';

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || (isDev ? 5000 : 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
  skip: () => process.env.RATE_LIMIT_DISABLED === 'true',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts' },
});

function buildCorsOptions() {
  const raw = process.env.CORS_ORIGINS || '';
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production' && origins.length) {
    return {
      origin: origins,
      credentials: true,
    };
  }
  if (process.env.NODE_ENV === 'production') {
    return { origin: false };
  }
  return { origin: true, credentials: true };
}

function isLocalDevHost(host) {
  const h = String(host || '').split(':')[0].toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function enforceHttps(req, res, next) {
  if (process.env.NODE_ENV !== 'production' || process.env.DISABLE_HTTPS_REDIRECT === 'true') {
    return next();
  }
  const host = req.headers.host || 'localhost';
  if (isLocalDevHost(host)) return next();
  const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  if (proto === 'https') return next();
  return res.redirect(301, `https://${host}${req.originalUrl || req.url}`);
}

function applySecurity(app) {
  app.use(enforceHttps);
  app.use(cors(buildCorsOptions()));
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    hsts: process.env.NODE_ENV === 'production',
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1', sameOriginMutations);
  app.use('/api/v1/auth', authLimiter);
  app.use('/api/auth', authLimiter);
}

module.exports = { applySecurity, apiLimiter, authLimiter, buildCorsOptions, enforceHttps };
