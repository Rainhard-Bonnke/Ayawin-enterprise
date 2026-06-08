process.env.NODE_ENV = 'test';
process.env.DISABLE_HTTPS_REDIRECT = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { ensureErpFoundation } = require('../../src/erpBootstrap');
const { getTestContext, pool } = require('../e2e/helpers');
const tokenService = require('../../src/services/tokenService');
const userService = require('../../src/services/userService');
const v1Routes = require('../../src/routes/v1');
const { applySecurity } = require('../../src/middleware/security');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function requestJson(server, method, path, body, headers = {}) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function tokenForRole(companyId, roleName) {
  const role = await pool.query(
    `SELECT id FROM erp_roles WHERE company_id = $1 AND name = $2 LIMIT 1`,
    [companyId, roleName],
  );
  if (!role.rowCount) return null;
  const user = await pool.query(
    `SELECT u.*, r.name AS role_name FROM erp_users u
     JOIN erp_roles r ON r.id = u.role_id
     WHERE u.company_id = $1 AND u.role_id = $2 AND u.is_deleted = FALSE LIMIT 1`,
    [companyId, role.rows[0].id],
  );
  if (!user.rowCount) return null;
  const perms = await pool.query(
    `SELECT p.code FROM erp_role_permissions rp
     JOIN erp_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [role.rows[0].id],
  );
  const row = user.rows[0];
  row.permissions = perms.rows.map((p) => p.code);
  return tokenService.generateAccessToken(row);
}

test('protected v1 routes reject anonymous access', async () => {
  await ensureErpFoundation();
  const app = express();
  app.use(express.json());
  applySecurity(app);
  app.use('/api/v1', v1Routes);
  const server = await listen(app);
  try {
    for (const path of ['/api/v1/sales/invoices', '/api/v1/users', '/api/v1/audit']) {
      const res = await requestJson(server, 'GET', path);
      assert.equal(res.status, 401, path);
    }
  } finally {
    server.close();
  }
});

test('admin-only route returns 403 for sales rep, not 404', async () => {
  await ensureErpFoundation();
  const ctx = await getTestContext();
  const salesToken = await tokenForRole(ctx.companyId, 'Sales Representative');
  if (!salesToken) return;

  const app = express();
  app.use(express.json());
  applySecurity(app);
  app.use('/api/v1', v1Routes);
  const server = await listen(app);
  try {
    const res = await requestJson(server, 'GET', '/api/v1/users', {}, {
      Authorization: `Bearer ${salesToken}`,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Forbidden');
    assert.notEqual(res.status, 404);
  } finally {
    server.close();
  }
});

test('logout revokes access token', async () => {
  await ensureErpFoundation();
  const ctx = await getTestContext();
  const user = await userService.findUserById(ctx.userId);
  const token = tokenService.generateAccessToken(user);

  const app = express();
  app.use(express.json());
  app.use('/api/v1', require('../../src/routes/v1'));
  const server = await listen(app);
  try {
    const logout = await requestJson(
      server,
      'POST',
      '/api/v1/auth/logout',
      {},
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(logout.status, 200);

    const me = await requestJson(server, 'GET', '/api/v1/auth/me', {}, {
      Authorization: `Bearer ${token}`,
    });
    assert.equal(me.status, 401);
  } finally {
    server.close();
  }
});
