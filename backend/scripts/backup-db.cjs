const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const backupDir = process.env.BACKUP_DIR || path.resolve(__dirname, '..', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(backupDir, `ayawin-enterprise-${stamp}.sql`);

const env = {
  ...process.env,
  PGPASSWORD: process.env.DATABASE_PASSWORD || process.env.PGPASSWORD || 'postgres',
};

const args = [
  '--host', process.env.DATABASE_HOST || 'localhost',
  '--port', String(process.env.DATABASE_PORT || 5432),
  '--username', process.env.DATABASE_USER || 'postgres',
  '--dbname', process.env.DATABASE_DB || 'ayawin_enterprise',
  '--format', 'plain',
  '--file', output,
  '--no-owner',
  '--no-privileges',
];

const child = spawn('pg_dump', args, { env, stdio: 'inherit', shell: process.platform === 'win32' });

child.on('exit', (code) => {
  if (code === 0) {
    console.log(`Backup written to ${output}`);
    return;
  }
  console.error(`pg_dump failed with exit code ${code}. Ensure PostgreSQL client tools are installed and on PATH.`);
  process.exit(code || 1);
});
