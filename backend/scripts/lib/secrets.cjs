const crypto = require('crypto');

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { randomSecret, randomHex };
