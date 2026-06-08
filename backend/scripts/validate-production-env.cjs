#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const failures = [];
const warns = [];

function req(label, ok, msg) {
  if (!ok) failures.push(`${label}: ${msg}`);
}

function warn(label, ok, msg) {
  if (!ok) warns.push(`${label}: ${msg}`);
}

const isProd = process.env.NODE_ENV === 'production';
req('NODE_ENV', isProd, `expected production, got ${process.env.NODE_ENV}`);
req('ENABLE_DEMO_MODE', process.env.ENABLE_DEMO_MODE === 'false', 'must be false');
req('JWT_SECRET', (process.env.JWT_SECRET || '').length >= 32, 'min 32 characters');
req('PII_ENCRYPTION_KEY', (process.env.PII_ENCRYPTION_KEY || '').length >= 32, 'min 32 characters');
req('CORS_ORIGINS', Boolean(process.env.CORS_ORIGINS && !process.env.CORS_ORIGINS.includes('localhost')), 'set production frontend URL(s)');
warn('ADMIN_PASSWORD', !process.env.ADMIN_PASSWORD, 'should be empty in .env; use NEW_ADMIN_PASSWORD once via go-live:password');
req('INTERNAL_API_KEY', (process.env.INTERNAL_API_KEY || '').length >= 16, 'set a strong internal key');
warn('APP_BASE_URL', Boolean(process.env.APP_BASE_URL), 'needed for password-reset emails');

const dbHost = (process.env.DATABASE_HOST || (process.env.DATABASE_URL || '').split('@')[1]?.split(':')[0] || 'localhost')
  .replace(/^\//, '');
const privateDb =
  dbHost === 'localhost'
  || dbHost === '127.0.0.1'
  || dbHost.endsWith('.internal')
  || dbHost.includes('postgres')
  || dbHost.includes('rds.amazonaws.com');
req('DATABASE_NETWORK', privateDb, `use private DB host/VPC, not public IP (${dbHost})`);
req('DISABLE_LEGACY_API', process.env.DISABLE_LEGACY_API !== 'false', 'set DISABLE_LEGACY_API=true');

if (failures.length) {
  console.error('\nProduction env validation FAILED:\n');
  failures.forEach((f) => console.error(`  ✗ ${f}`));
  if (warns.length) {
    console.error('\nWarnings:\n');
    warns.forEach((w) => console.error(`  ! ${w}`));
  }
  process.exit(1);
}

console.log('Production env validation PASS');
warns.forEach((w) => console.log(`  ! ${w}`));
