const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'ayawin-enterprise-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const DEMO_USER = {
  id: 0,
  username: 'admin',
  full_name: 'System Administrator',
  email: 'admin@martin.co.ke',
  role: 'Admin',
};

const DEMO_ROLES = {
  'admin@martin.co.ke': 'Admin',
  'manager@martin.co.ke': 'Manager',
  'accountant@martin.co.ke': 'Accountant',
  'hr@martin.co.ke': 'HR Officer',
  'store@martin.co.ke': 'Store Manager',
  'sales@martin.co.ke': 'Sales Rep',
  'warehouse@martin.co.ke': 'Warehouse',
  'driver@martin.co.ke': 'Driver',
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@martin.co.ke';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || ADMIN_EMAIL.split('@')[0];
const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME || 'System Administrator';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

const IS_DEMO_MODE = (process.env.ENABLE_DEMO_MODE === 'true') && (process.env.NODE_ENV !== 'production');

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function ensureDefaultAdmin() {
  if (!IS_DEMO_MODE && !ADMIN_PASSWORD) return;

  const password = IS_DEMO_MODE ? 'demo' : ADMIN_PASSWORD;
  const result = await pool.query(
    'SELECT id, password_hash FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [ADMIN_USERNAME, ADMIN_EMAIL],
  );

  if (result.rowCount === 0) {
    const passwordHash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (username, full_name, email, role, status, password_hash) VALUES ($1, $2, $3, $4, $5, $6)',
      [ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_EMAIL, 'Admin', 'active', passwordHash],
    );
    console.log(`Created admin user ${ADMIN_EMAIL}`);
    return;
  }

  const passwordHash = await hashPassword(password);
  await pool.query(
    `UPDATE users
     SET username = $1, full_name = $2, email = $3, role = 'Admin', status = 'active', password_hash = $4
     WHERE id = $5`,
    [ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_EMAIL, passwordHash, result.rows[0].id],
  );
  console.log(`Ensured admin credentials for ${ADMIN_EMAIL}`);
}

function createDemoUser(email = DEMO_USER.email) {
  const normalized = email.toLowerCase();
  const role = DEMO_ROLES[normalized] || DEMO_USER.role;
  return {
    ...DEMO_USER,
    email,
    username: email.split('@')[0],
    full_name: role === 'Admin' ? DEMO_USER.full_name : `${role} Demo User`,
    role,
  };
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    if (token.startsWith('demo:')) {
      if (!IS_DEMO_MODE) {
        return res.status(401).json({ error: 'Demo tokens are not allowed' });
      }
      const [, rawEmail, rawRole] = token.split(':');
      const email = rawEmail?.trim() || DEMO_USER.email;
      const role = rawRole || DEMO_ROLES[email.toLowerCase()] || DEMO_USER.role;
      req.user = {
        id: DEMO_USER.id,
        username: email.split('@')[0],
        email,
        role,
        full_name: role === 'Admin' ? DEMO_USER.full_name : `${role} Demo User`,
      };
      return next();
    }
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  authenticateToken,
  authorizeRoles,
  ensureDefaultAdmin,
  createDemoUser,
};
