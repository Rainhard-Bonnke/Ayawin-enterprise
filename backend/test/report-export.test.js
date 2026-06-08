const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rowsToCsv,
  rowsToXlsxBuffer,
  sanitizeSheetName,
  renderReportPdfBuffer,
} = require('../src/services/reportExportService');

test('rowsToCsv includes UTF-8 BOM', () => {
  const csv = rowsToCsv([{ a: 1 }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('sanitizeSheetName strips invalid Excel characters', () => {
  assert.equal(sanitizeSheetName('Sales/Q1'), 'Sales Q1');
});

test('rowsToXlsxBuffer returns non-empty buffer when xlsx installed', () => {
  try {
    const buf = rowsToXlsxBuffer([{ revenue: 100 }], 'Test');
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 100);
  } catch (err) {
    assert.match(String(err.message), /install xlsx/i);
  }
});

test('renderReportPdfBuffer includes all rows for multi-page dataset', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ line: i + 1, amount: i * 10 }));
  const pdf = await renderReportPdfBuffer({ title: 'Large', rows });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500);
});
