const net = require('net');

const SIGNATURES = [
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

function decodeBase64Payload(dataUrlOrB64) {
  const raw = String(dataUrlOrB64).trim();
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  return Buffer.from(b64, 'base64');
}

function verifyImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) {
    return { ok: false, error: 'Upload payload too small to verify' };
  }
  if (SIGNATURES[0].bytes.every((b, i) => buffer[i] === b)) {
    return { ok: true, type: 'jpeg' };
  }
  if (SIGNATURES[1].bytes.every((b, i) => buffer[i] === b)) {
    return { ok: true, type: 'png' };
  }
  if (SIGNATURES[2].bytes.every((b, i) => buffer[i] === b)
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { ok: true, type: 'webp' };
  }
  return { ok: false, error: 'File content does not match an allowed image format' };
}

function scanWithClamAv(buffer) {
  const host = process.env.CLAMAV_HOST;
  if (!host || process.env.CLAMAV_ENABLED !== 'true') {
    return Promise.resolve({ ok: true, skipped: true });
  }
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 10_000);

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write('zINSTREAM\0');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(buffer.length, 0);
      socket.write(len);
      socket.write(buffer);
      socket.write(Buffer.alloc(4));
      socket.end();
    });

    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: 'Antivirus scan timed out' });
    }, timeoutMs);

    socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'Antivirus service unavailable' });
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (response.includes('OK')) return resolve({ ok: true });
      if (response.includes('FOUND')) {
        return resolve({ ok: false, error: 'Upload rejected by antivirus scan' });
      }
      resolve({ ok: true, skipped: true });
    });
  });
}

async function scanUploadPayload(dataUrlOrB64) {
  let buffer;
  try {
    buffer = decodeBase64Payload(dataUrlOrB64);
  } catch {
    return { ok: false, error: 'Invalid base64 upload payload' };
  }
  const magic = verifyImageMagicBytes(buffer);
  if (!magic.ok) return magic;
  return scanWithClamAv(buffer);
}

module.exports = {
  decodeBase64Payload,
  verifyImageMagicBytes,
  scanWithClamAv,
  scanUploadPayload,
};
