const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePodPhotoData } = require('../../src/lib/uploadValidation');

test('rejects non-image data URLs', () => {
  const r = validatePodPhotoData('data:text/plain;base64,abcd');
  assert.equal(r.ok, false);
});

test('rejects PNG header with wrong magic bytes', () => {
  const fake = 'data:image/png;base64,YWJjZGVmZ2hpams='; // not a real PNG
  const r = validatePodPhotoData(fake);
  assert.equal(r.ok, false);
});

test('accepts small PNG data URL', () => {
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = validatePodPhotoData(tiny);
  assert.equal(r.ok, true);
});
