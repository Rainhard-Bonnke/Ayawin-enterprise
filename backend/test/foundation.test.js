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
