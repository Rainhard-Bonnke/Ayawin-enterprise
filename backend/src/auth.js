const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || ADMIN_EMAIL?.split("@")[0];
const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME || "System Administrator";
// A blank value means startup must preserve existing credentials. Set
// ADMIN_PASSWORD explicitly only for a deliberate admin bootstrap/reset.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

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
  if (!ADMIN_EMAIL) throw new Error("ADMIN_EMAIL is required to bootstrap the administrator");
  if (!ADMIN_PASSWORD) return;
  const result = await pool.query(
    "SELECT id, password_hash FROM users WHERE username = $1 OR email = $2 LIMIT 1",
    [ADMIN_USERNAME, ADMIN_EMAIL],
  );

  if (result.rowCount === 0) {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    await pool.query(
      "INSERT INTO users (username, full_name, email, role, status, password_hash) VALUES ($1, $2, $3, $4, $5, $6)",
      [ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_EMAIL, "Admin", "active", passwordHash],
    );
    console.log(`Created admin user ${ADMIN_EMAIL}`);
    return;
  }

  // An explicitly configured password is for first-time provisioning by
  // default. Existing passwords change only during a deliberate reset.
  if (process.env.RESET_ADMIN_PASSWORD !== "true") return;

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await pool.query(
    `UPDATE users
     SET username = $1, full_name = $2, email = $3, role = 'Admin', status = 'active', password_hash = $4
     WHERE id = $5`,
    [ADMIN_USERNAME, ADMIN_FULL_NAME, ADMIN_EMAIL, passwordHash, result.rows[0].id],
  );
  console.log(`Ensured admin credentials for ${ADMIN_EMAIL}`);
}

function authenticateToken(req, res, next) {
  if (req.erpAuthenticated) return next();
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
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
};
