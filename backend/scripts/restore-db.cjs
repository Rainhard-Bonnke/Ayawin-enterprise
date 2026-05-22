const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const input = process.argv[2];

if (!input) {
  console.error('Usage: npm run db:restore -- <path-to-backup.sql>');
  process.exit(1);
}

const backupPath = path.resolve(process.cwd(), input);
if (!fs.existsSync(backupPath)) {
  console.error(`Backup file not found: ${backupPath}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PGPASSWORD: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || 'postgres',
};

const args = [
  '--host', process.env.DATABASE_HOST || 'localhost',
  '--port', String(process.env.DATABASE_PORT || 5432),
  '--username', process.env.DATABASE_USER || 'postgres',
  '--dbname', process.env.DATABASE_DB || 'ayawin_enterprise',
  '--file', backupPath,
  '--set', 'ON_ERROR_STOP=on',
];

const child = spawn('psql', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });

child.on('exit', (code) => {
  if (code === 0) {
    console.log(`Restore completed from ${backupPath}`);
    return;
  }
  console.error(`psql restore failed with exit code ${code}. Review the database state before retrying.`);
  process.exit(code || 1);
});
