#!/usr/bin/env node
/**
 * Merge backend/.env.example into backend/.env — keeps existing values, fills missing keys with secure defaults.
 */
const fs = require('fs');
const path = require('path');
const { randomSecret, randomHex } = require('./lib/secrets.cjs');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1));
  }
  return map;
}

function serializeEnv(exampleText, values) {
  const lines = [];
  for (const raw of exampleText.split(/\r?\n/)) {
    if (!raw || raw.trim().startsWith('#') || !raw.includes('=')) {
      lines.push(raw);
      continue;
    }
    const key = raw.slice(0, raw.indexOf('=')).trim();
    if (values.has(key) && values.get(key) !== '') {
      lines.push(`${key}=${values.get(key)}`);
    } else {
      lines.push(raw);
    }
  }
  const extraKeys = [...values.keys()].filter((k) => !exampleText.includes(`${k}=`));
  if (extraKeys.length) {
    lines.push('');
    lines.push('# Additional local overrides');
    for (const k of extraKeys.sort()) {
      lines.push(`${k}=${values.get(k)}`);
    }
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const example = fs.readFileSync(examplePath, 'utf8');
const existing = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : new Map();
const merged = parseEnv(example);

for (const [k, v] of existing) {
  if (v) merged.set(k, v);
}

const generated = {
  PII_ENCRYPTION_KEY: randomHex(32),
  MFA_ENCRYPTION_KEY: randomHex(32),
  INTERNAL_API_KEY: randomSecret(24),
  MPESA_CALLBACK_SECRET: randomSecret(24),
};

for (const [k, v] of Object.entries(generated)) {
  if (!merged.get(k) || merged.get(k).includes('change_me')) {
    merged.set(k, v);
  }
}

merged.set('NODE_ENV', 'development');
merged.set('ENABLE_DEMO_MODE', 'false');
merged.set('STRICT_PRODUCTION_CONFIG', 'false');
merged.set('DISABLE_HTTPS_REDIRECT', 'true');
merged.set('DISABLE_LEGACY_API', 'true');
merged.set('ENABLE_LEGACY_API', 'false');
merged.set('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000');
merged.set('APP_BASE_URL', 'http://localhost:3000');
merged.set('API_PUBLIC_URL', 'http://localhost:4000');
merged.set('RATE_LIMIT_MAX', '5000');
merged.set('JWT_ACCESS_EXPIRES', merged.get('JWT_ACCESS_EXPIRES') || '8h');
merged.set('JWT_EXPIRES_IN', merged.get('JWT_EXPIRES_IN') || '8h');
merged.set('ETIMS_ENABLED', 'false');
merged.set('REDIS_ENABLED', 'false');
merged.set('REDIS_HOST', '');
merged.set('REDIS_URL', '');

if (!merged.get('ADMIN_PASSWORD')) {
  merged.set('ADMIN_PASSWORD', 'MartinERP2026!');
}

if (!merged.get('JWT_SECRET') || (merged.get('JWT_SECRET') || '').length < 32) {
  merged.set('JWT_SECRET', randomSecret(48));
}

const extras = new Map();
if (existing.has('INTELLIGENCE_PROVIDER')) extras.set('INTELLIGENCE_PROVIDER', existing.get('INTELLIGENCE_PROVIDER'));
for (const [k, v] of existing) {
  if (!example.includes(`${k}=`) && v) extras.set(k, v);
}

const out = serializeEnv(example, merged);
const extraBlock = [...extras.entries()].map(([k, v]) => `${k}=${v}`).join('\n');
const final = extraBlock ? `${out.trim()}\n\n# Preserved from previous .env\n${extraBlock}\n` : out;

if (fs.existsSync(envPath)) {
  fs.copyFileSync(envPath, `${envPath}.backup-${Date.now()}`);
}
fs.writeFileSync(envPath, final, 'utf8');
console.log(`Updated ${envPath}`);
console.log('  ENABLE_DEMO_MODE=false (live ERP)');
console.log(`  ADMIN_PASSWORD=${merged.get('ADMIN_PASSWORD')} (bootstrap on migrate)`);
console.log('  Generated/filled: PII_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY, INTERNAL_API_KEY, MPESA_CALLBACK_SECRET');
