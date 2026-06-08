/**
 * CSRF defense-in-depth for browser clients not using Bearer JWT.
 * SPA with Authorization: Bearer is exempt (token not sent automatically by browsers).
 */
function getAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

function sameOriginMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  const allowed = getAllowedOrigins();
  if (!allowed.length && process.env.NODE_ENV !== 'production') return next();
  if (allowed.includes(origin)) return next();

  return res.status(403).json({ error: 'Cross-site request blocked (origin not allowed)' });
}

module.exports = { sameOriginMutations, getAllowedOrigins };
