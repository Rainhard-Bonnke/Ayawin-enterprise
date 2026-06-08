const fs = require('fs');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

function emit(level, message, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  };
  const line = `${JSON.stringify(entry)}\n`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line);
  } else if (!isProd) {
    process.stdout.write(line);
  } else {
    process.stderr.write(line);
  }
  const logFile = process.env.LOG_FILE;
  if (logFile) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(logFile)), { recursive: true });
      fs.appendFileSync(logFile, line, { encoding: 'utf8' });
    } catch (_) {
      process.stderr.write(JSON.stringify({ ts: entry.ts, level: 'error', msg: 'LOG_FILE write failed' }) + '\n');
    }
  }
}

module.exports = {
  info: (message, meta) => emit('info', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  error: (message, meta) => {
    const errMeta = meta?.err instanceof Error
      ? { ...meta, err: meta.err.message, stack: meta.err.stack }
      : meta;
    emit('error', message, errMeta);
  },
};
