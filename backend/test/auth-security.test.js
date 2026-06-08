const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureErpFoundation } = require('../src/erpBootstrap');
const { getTestContext, pool } = require('./e2e/helpers');
const tokenService = require('../src/services/tokenService');
const passwordResetService = require('../src/services/passwordResetService');
const { requirePermission } = require('../src/middleware/erpAuth');
const { PASSWORD_RESET_HOURS } = require('../src/constants');

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
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('login wrong password returns generic error without stack', async () => {
  await ensureErpFoundation();
  const ctx = await getTestContext();
  const email = `wrong-pass-${Date.now()}@martin.co.ke`;
  const hash = await bcrypt.hash('CorrectPass123!', 10);
  const ins = await pool.query(
    `INSERT INTO erp_users (company_id, role_id, username, email, full_name, password_hash, status)
     SELECT $1, r.id, $2, $3, 'Wrong Pass Test', $4, 'active'
     FROM erp_roles r WHERE r.company_id = $1 AND r.name = 'System Administrator' LIMIT 1
     RETURNING id`,
    [ctx.companyId, `wrong${Date.now()}`, email, hash],
  );
  const userId = ins.rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/v1/auth'));
  const server = await listen(app);
  try {
    const res = await requestJson(server, 'POST', '/auth/login', {
      email,
      password: 'definitely-wrong-password',
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid credentials');
    assert.equal(res.body.stack, undefined);
    assert.equal(String(res.body.raw || '').includes('at '), false);
  } finally {
    server.close();
    await pool.query('DELETE FROM erp_users WHERE id = $1', [userId]);
  }
});

test('account locks after five failed login attempts', async () => {
  await ensureErpFoundation();
  const ctx = await getTestContext();
  const email = `lock-test-${Date.now()}@martin.co.ke`;
  const hash = await bcrypt.hash('CorrectPass123!', 10);
  const ins = await pool.query(
    `INSERT INTO erp_users (company_id, role_id, username, email, full_name, password_hash, status)
     SELECT $1, r.id, $2, $3, 'Lock Test', $4, 'active'
     FROM erp_roles r WHERE r.company_id = $1 AND r.name = 'System Administrator' LIMIT 1
     RETURNING id`,
    [ctx.companyId, `lock${Date.now()}`, email, hash],
  );
  const userId = ins.rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/auth', require('../src/routes/v1/auth'));
  const server = await listen(app);
  try {
    for (let i = 0; i < 5; i += 1) {
      const res = await requestJson(server, 'POST', '/auth/login', { email, password: 'wrong' });
      assert.equal(res.status, 401);
    }
    const locked = await requestJson(server, 'POST', '/auth/login', {
      email,
      password: 'CorrectPass123!',
    });
    assert.equal(locked.status, 403);
    assert.match(locked.body.error, /locked/i);

    const row = await pool.query('SELECT failed_login_attempts, status FROM erp_users WHERE id = $1', [userId]);
    assert.equal(row.rows[0].status, 'locked');
    assert.ok(Number(row.rows[0].failed_login_attempts) >= 5);
  } finally {
    server.close();
    await pool.query('DELETE FROM erp_users WHERE id = $1', [userId]);
  }
});

test('password reset token expires per PASSWORD_RESET_HOURS', async () => {
  assert.equal(PASSWORD_RESET_HOURS, 24);
  const ctx = await getTestContext();
  const row = await pool.query(
    `SELECT expires_at FROM erp_password_reset_tokens
     WHERE user_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [ctx.userId],
  );
  if (!row.rowCount) {
    await passwordResetService.requestPasswordReset('admin@martin.co.ke');
  }
  const after = await pool.query(
    `SELECT expires_at, created_at FROM erp_password_reset_tokens
     WHERE user_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [ctx.userId],
  );
  const created = new Date(after.rows[0].created_at);
  const expires = new Date(after.rows[0].expires_at);
  const hours = (expires - created) / (1000 * 60 * 60);
  assert.ok(Math.abs(hours - 24) < 0.1);
});

test('expired access JWT is rejected', async () => {
  const ctx = await getTestContext();
  const user = await pool.query(
    `SELECT u.*, r.name AS role_name FROM erp_users u
     LEFT JOIN erp_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [ctx.userId],
  );
  const expired = jwt.sign(
    {
      sub: user.rows[0].id,
      companyId: user.rows[0].company_id,
      type: 'access',
      jti: 'test-expired',
    },
    tokenService.JWT_SECRET,
    { expiresIn: '1ms' },
  );
  await new Promise((r) => setTimeout(r, 5));
  assert.throws(() => tokenService.verifyAccessToken(expired), /jwt expired/i);
});

test('sales rep role cannot pass hr.view permission gate', async () => {
  const ctx = await getTestContext();
  const role = await pool.query(
    `SELECT id FROM erp_roles WHERE company_id = $1 AND name = 'Sales Representative' LIMIT 1`,
    [ctx.companyId],
  );
  if (!role.rowCount) return;

  const perms = await pool.query(
    `SELECT p.code FROM erp_role_permissions rp
     JOIN erp_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [role.rows[0].id],
  );
  const codes = perms.rows.map((r) => r.code);
  assert.ok(!codes.includes('hr.view'));
  assert.ok(codes.includes('sales.view'));

  const req = { user: { permissions: codes, role: 'Sales Representative' } };
  let statusCode = 200;
  let nextCalled = false;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json() {
      return this;
    },
  };
  requirePermission('hr.view')(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});
