const pool = require('../db');

async function loadUserPermissions(userId, roleId) {
  if (!roleId) return [];
  const result = await pool.query(
    `SELECT p.code
     FROM erp_role_permissions rp
     JOIN erp_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1 AND rp.is_deleted = FALSE`,
    [roleId],
  );
  return result.rows.map((row) => row.code);
}

async function findUserByEmail(email, companyCode = null) {
  const params = [email.toLowerCase()];
  let companyFilter = '';
  if (companyCode) {
    companyFilter = 'AND c.code = $2';
    params.push(companyCode);
  }

  const result = await pool.query(
    `SELECT u.*, c.code AS company_code, c.name AS company_name, r.name AS role_name
     FROM erp_users u
     JOIN erp_companies c ON c.id = u.company_id AND c.is_deleted = FALSE
     LEFT JOIN erp_roles r ON r.id = u.role_id
     WHERE LOWER(u.email) = $1 AND u.is_deleted = FALSE ${companyFilter}
     LIMIT 1`,
    params,
  );

  const user = result.rows[0];
  if (!user) return null;
  user.permissions = await loadUserPermissions(user.id, user.role_id);
  return user;
}

async function findUserById(id) {
  const result = await pool.query(
    `SELECT u.*, c.code AS company_code, r.name AS role_name
     FROM erp_users u
     JOIN erp_companies c ON c.id = u.company_id
     LEFT JOIN erp_roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_deleted = FALSE`,
    [id],
  );
  const user = result.rows[0];
  if (!user) return null;
  user.permissions = await loadUserPermissions(user.id, user.role_id);
  return user;
}

async function checkIpWhitelist(user, ip) {
  if (!ip) return true;
  const result = await pool.query(
    `SELECT cidr FROM erp_ip_whitelist
     WHERE company_id = $1 AND is_deleted = FALSE
       AND (user_id = $2 OR role_id = $3)`,
    [user.company_id, user.id, user.role_id],
  );
  if (result.rowCount === 0) return true;
  // Simple prefix match for MVP; production should use inet operators
  return result.rows.some((row) => ip.startsWith(row.cidr.replace('/32', '').replace('*', '')));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    company_id: user.company_id,
    company_code: user.company_code,
    company_name: user.company_name,
    default_branch_id: user.default_branch_id,
    role_id: user.role_id,
    role_name: user.role_name,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone,
    status: user.status,
    locale: user.locale,
    mfa_enabled: user.mfa_enabled,
    permissions: user.permissions || [],
  };
}

module.exports = {
  findUserByEmail,
  findUserById,
  loadUserPermissions,
  checkIpWhitelist,
  sanitizeUser,
};
