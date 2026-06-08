const PDFDocument = require('pdfkit');

let XLSX;
try {
  XLSX = require('xlsx');
} catch {
  XLSX = null;
}

const MARGIN = 40;
const PAGE_WIDTH = 595.28;
const ROWS_PER_PAGE = 42;

function sanitizeSheetName(name) {
  return String(name || 'Report').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Report';
}

function rowsToCsv(rows, { bom = true } = {}) {
  if (!rows?.length) return bom ? '\uFEFF' : '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => {
      const v = row[h];
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(','));
  }
  const body = lines.join('\r\n');
  return bom ? `\uFEFF${body}` : body;
}

function rowsToXlsxBuffer(rows, sheetName = 'Report') {
  if (!XLSX) throw new Error('XLSX export not available — install xlsx package on server');
  const wb = XLSX.utils.book_new();
  const ws = rows?.length
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['No data for selected filters']]);
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function renderReportPdfBuffer({ title, subtitle, rows, meta = {} }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const headers = rows?.length ? Object.keys(rows[0]) : [];
    const colWidth = headers.length
      ? Math.min(120, Math.floor((PAGE_WIDTH - MARGIN * 2) / headers.length))
      : 100;

    const drawPageHeader = () => {
      doc.fontSize(14).font('Helvetica-Bold').text(title || 'Report', MARGIN, MARGIN);
      if (subtitle) doc.fontSize(9).font('Helvetica').text(subtitle, MARGIN, doc.y + 2);
      if (meta.period) doc.fontSize(8).fillColor('#555').text(`Period: ${meta.period}`, MARGIN);
      if (meta.generated_at) doc.text(`Generated: ${meta.generated_at}`, MARGIN);
      doc.fillColor('#000');
      doc.moveDown(0.5);
      if (headers.length) {
        doc.fontSize(7).font('Helvetica-Bold');
        let x = MARGIN;
        const y = doc.y;
        for (const h of headers) {
          doc.text(String(h), x, y, { width: colWidth, lineBreak: false });
          x += colWidth;
        }
        doc.moveDown(0.4);
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#ccc').stroke();
        doc.moveDown(0.2);
      }
    };

    drawPageHeader();
    doc.font('Helvetica').fontSize(7);

    let rowCount = 0;
    for (const row of rows || []) {
      if (doc.y > 760) {
        doc.addPage();
        drawPageHeader();
        doc.font('Helvetica').fontSize(7);
      }
      let x = MARGIN;
      const y = doc.y;
      for (const h of headers) {
        const val = row[h] == null ? '' : String(row[h]);
        doc.text(val.slice(0, 48), x, y, { width: colWidth, lineBreak: false });
        x += colWidth;
      }
      doc.moveDown(0.35);
      rowCount += 1;
      if (rowCount % ROWS_PER_PAGE === 0 && rowCount < rows.length) {
        doc.addPage();
        drawPageHeader();
        doc.font('Helvetica').fontSize(7);
      }
    }

    if (!rows?.length) {
      doc.text('No data for the selected filters.', MARGIN);
    }

    const company = meta.company_name || 'Ayawin Stock Solutions ERP';
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const footerY = doc.page.height - 36;
      doc.fontSize(7).fillColor('#666');
      doc.text(company, MARGIN, footerY, { width: (PAGE_WIDTH - MARGIN * 2) * 0.6, lineBreak: false });
      doc.text(
        `Page ${i - range.start + 1} of ${range.count}`,
        MARGIN,
        footerY,
        { width: PAGE_WIDTH - MARGIN * 2, align: 'right', lineBreak: false },
      );
    }

    doc.end();
  });
}

module.exports = {
  rowsToCsv,
  rowsToXlsxBuffer,
  renderReportPdfBuffer,
  sanitizeSheetName,
};
