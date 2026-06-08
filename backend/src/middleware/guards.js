const crypto = require('crypto');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Legacy /api/* disabled in production unless ENABLE_LEGACY_API=true */
const LEGACY_API_ENABLED =
  process.env.ENABLE_LEGACY_API === 'true' ||
  (!IS_PRODUCTION && process.env.DISABLE_LEGACY_API !== 'true');

function requireInternalApiKey(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    if (IS_PRODUCTION) {
      return res.status(503).json({ error: 'Internal API not configured' });
    }
    return next();
  }
  const provided =
    req.headers['x-internal-api-key'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
    '';
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function requireMpesaCallbackSecret(req, res, next) {
  const expected = process.env.MPESA_CALLBACK_SECRET;
  if (!expected) {
    if (IS_PRODUCTION) {
      return res.status(503).json({ error: 'M-Pesa callback not configured' });
    }
    return next();
  }
  const provided = req.headers['x-mpesa-signature'] || req.query.secret || req.body?.Passkey;
  if (provided !== expected) {
    return res.status(401).json({ error: 'Invalid callback signature' });
  }
  return next();
}

function blockLegacyApi(req, res, next) {
  if (LEGACY_API_ENABLED) return next();
  const path = req.path || '';
  if (path.startsWith('/api/v1') || path.startsWith('/api/docs')) return next();
  if (path === '/api/integrations/mpesa/callback') return next();
  if (path.startsWith('/api/')) {
    return res.status(410).json({
      error: 'Legacy API is disabled. Use /api/v1 endpoints.',
    });
  }
  return next();
}

function assertProductionSecrets() {
  if (!IS_PRODUCTION) return;
  const weak = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    weak.push('JWT_SECRET (min 32 chars)');
  }
  if (process.env.ENABLE_DEMO_MODE === 'true') {
    weak.push('ENABLE_DEMO_MODE must be false in production');
  }
  if (weak.length) {
    console.error(`[security] Production misconfiguration: ${weak.join(', ')}`);
    if (process.env.STRICT_PRODUCTION_CONFIG === 'true') {
      process.exit(1);
    }
  }
}

module.exports = {
  LEGACY_API_ENABLED,
  IS_PRODUCTION,
  requireInternalApiKey,
  requireMpesaCallbackSecret,
  blockLegacyApi,
  assertProductionSecrets,
};
