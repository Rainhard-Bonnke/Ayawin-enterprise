const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts' },
});

function applySecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
    hsts: process.env.NODE_ENV === 'production',
  }));
  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', authLimiter);
}

module.exports = { applySecurity, apiLimiter, authLimiter };
