const { verifyImageMagicBytes, scanUploadPayload, decodeBase64Payload } = require('./uploadScan');

const MAX_POD_PHOTO_BYTES = Number(process.env.MAX_POD_PHOTO_BYTES) || 2 * 1024 * 1024;

const ALLOWED_DATA_URL_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];

function validatePodPhotoData(value) {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'pod_photo_data must be a string' };
  }
  const trimmed = value.trim();
  const prefix = ALLOWED_DATA_URL_PREFIXES.find((p) => trimmed.startsWith(p));
  if (!prefix) {
    return { ok: false, error: 'pod_photo_data must be a JPEG, PNG, or WebP data URL' };
  }
  const b64 = trimmed.slice(prefix.length);
  const approxBytes = Math.ceil((b64.length * 3) / 4);
  if (approxBytes > MAX_POD_PHOTO_BYTES) {
    return {
      ok: false,
      error: `pod_photo_data exceeds ${MAX_POD_PHOTO_BYTES} bytes (approx ${approxBytes})`,
    };
  }
  try {
    const buf = decodeBase64Payload(trimmed);
    const magic = verifyImageMagicBytes(buf);
    if (!magic.ok) return magic;
  } catch {
    return { ok: false, error: 'Invalid base64 in pod_photo_data' };
  }

  return { ok: true, value: trimmed };
}

async function validateAndScanPodPhoto(value) {
  const base = validatePodPhotoData(value);
  if (!base.ok || !base.value) return base;
  const scan = await scanUploadPayload(base.value);
  if (!scan.ok) return scan;
  return base;
}

module.exports = { validatePodPhotoData, validateAndScanPodPhoto, MAX_POD_PHOTO_BYTES };
