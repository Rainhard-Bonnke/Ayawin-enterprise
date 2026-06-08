const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { authenticator } = require('otplib');

test('permission codes follow module.action pattern', () => {
  const samples = ['foundation.view', 'finance.approve', 'users.create'];
  for (const code of samples) {
    assert.match(code, /^[a-z_]+\.(view|create|edit|delete|approve|export)$/);
  }
});

test('TOTP verification round-trip', () => {
  const secret = authenticator.generateSecret();
  const token = authenticator.generate(secret);
  assert.equal(authenticator.verify({ token, secret }), true);
});

test('password hashing', async () => {
  const hash = await bcrypt.hash('demo', 4);
  assert.equal(await bcrypt.compare('demo', hash), true);
  assert.equal(await bcrypt.compare('wrong', hash), false);
});

test('access token includes jti without sign conflict', () => {
  const tokenService = require('../src/services/tokenService');
  const token = tokenService.generateAccessToken({
    id: '00000000-0000-0000-0000-000000000001',
    company_id: '00000000-0000-0000-0000-000000000002',
    email: 'test@example.com',
    permissions: ['foundation.view'],
  });
  const payload = tokenService.verifyAccessToken(token);
  assert.ok(payload.jti);
  assert.equal(payload.type, 'access');
});
