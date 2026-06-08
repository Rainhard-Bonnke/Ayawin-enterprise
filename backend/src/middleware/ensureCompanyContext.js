const userService = require('../services/userService');

/**
 * Ensures req.user.company_id is set (ERP JWT / refreshed profile).
 * Legacy demo tokens and stale cache entries may omit company_id and break UUID queries ($2).
 */
async function ensureCompanyContext(req, res, next) {
  if (req.user?.company_id) return next();

  const email = typeof req.user?.email === 'string' ? req.user.email.trim().toLowerCase() : '';
  if (!email) {
    return res.status(403).json({
      error: 'Session is missing company context. Sign out and sign in again with your email and password.',
    });
  }

  try {
    const user = await userService.findUserByEmail(email);
    if (!user?.company_id) {
      return res.status(403).json({ error: 'No company is linked to this user account.' });
    }
    req.user = userService.sanitizeUser(user);
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { ensureCompanyContext };
