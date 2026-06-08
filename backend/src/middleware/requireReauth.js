const bcrypt = require('bcryptjs');
const pool = require('../db');

/**
 * Requires X-Reauth-Password header matching the current user's password.
 * Used for month-end close, payroll post, and high-value approvals.
 */
function requireReauth() {
  return async (req, res, next) => {
    const password = req.headers['x-reauth-password'];
    if (!password || typeof password !== 'string') {
      return res.status(401).json({ error: 'Password confirmation required (X-Reauth-Password)' });
    }
    try {
      const result = await pool.query(
        'SELECT password_hash FROM erp_users WHERE id = $1 AND is_deleted = FALSE',
        [req.user.id],
      );
      if (!result.rowCount) return res.status(401).json({ error: 'User not found' });
      const ok = await bcrypt.compare(password, result.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid password confirmation' });
      return next();
    } catch {
      return res.status(500).json({ error: 'Unable to verify password' });
    }
  };
}

module.exports = { requireReauth };
