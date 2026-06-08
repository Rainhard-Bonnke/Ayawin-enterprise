const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { appendDocumentQr } = require('../lib/pdfQrFooter');
const { buildGrnVerificationHash, buildVerifyUrl } = require('./documentVerificationService');

const MARGIN = 48;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(n) {
  return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadGrnContext(companyId, grnId) {
  const grnResult = await pool.query(
    `SELECT g.*, po.po_number, v.name AS vendor_name, w.name AS warehouse_name
     FROM erp_goods_receipts g
     JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
     JOIN erp_vendors v ON v.id = g.vendor_id
     LEFT JOIN erp_warehouses w ON w.id = g.warehouse_id
     WHERE g.company_id = $1 AND g.id = $2 AND g.is_deleted = FALSE`,
    [companyId, grnId],
  );
  if (!grnResult.rowCount) throw new Error('Goods receipt not found');
  const grn = grnResult.rows[0];

  const lines = await pool.query(
    `SELECT gl.quantity, gl.unit_cost, gl.line_no, i.item_code, i.name AS item_name
     FROM erp_goods_receipt_lines gl
     JOIN erp_items i ON i.id = gl.item_id
     WHERE gl.goods_receipt_id = $1 AND gl.is_deleted = FALSE
     ORDER BY gl.line_no`,
    [grn.id],
  );

  const companyResult = await pool.query(
    `SELECT c.name, c.legal_name, c.tax_registration_no, c.logo_url
     FROM erp_companies c WHERE c.id = $1`,
    [companyId],
  );

  return { grn, lines: lines.rows, company: companyResult.rows[0] || {} };
}

async function renderGrnPdfBuffer({ companyId, grnId }) {
  const { grn, lines, company } = await loadGrnContext(companyId, grnId);
  const verifyHash = buildGrnVerificationHash(grn);
  const grnNo = grn.grn_number || grn.receipt_no || String(grn.id);
  const verifyUrl = buildVerifyUrl(
    `/api/v1/procurement/goods-receipts/${grn.id}/verify`,
    verifyHash,
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    (async () => {
      if (company.logo_url) {
        const logoPath = company.logo_url.startsWith('/')
          ? path.join(process.cwd(), company.logo_url.replace(/^\//, ''))
          : company.logo_url;
        try {
          if (fs.existsSync(logoPath)) doc.image(logoPath, MARGIN, MARGIN, { width: 48, height: 48 });
        } catch {
          /* skip */
        }
      }

      doc.fontSize(16).font('Helvetica-Bold').text(company.legal_name || company.name || 'Ayawin ERP', MARGIN, MARGIN + (company.logo_url ? 56 : 0));
      doc.fontSize(12).text('GOODS RECEIPT NOTE (GRN)', { align: 'right' });
      doc.fontSize(10).font('Helvetica').text(grnNo, { align: 'right' });
      doc.text(`Status: ${grn.status || '—'}`, { align: 'right' });
      doc.text(`Received: ${String(grn.received_date || '').slice(0, 10)}`, { align: 'right' });
      doc.moveDown();
      doc.text(`Vendor: ${grn.vendor_name || '—'}`);
      doc.text(`PO: ${grn.po_number || '—'}`);
      doc.text(`Warehouse: ${grn.warehouse_name || '—'}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(9);
      doc.text('Item', MARGIN, doc.y, { continued: true, width: 280 });
      doc.text('Qty', { align: 'right', width: 60 });
      doc.text('Unit cost', { align: 'right', width: 80 });
      doc.text('Line total', { align: 'right', width: 90 });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8);

      let total = 0;
      for (const line of lines) {
        const lineTotal = Number(line.quantity) * Number(line.unit_cost);
        total += lineTotal;
        doc.text(`${line.item_code} — ${line.item_name}`, MARGIN, doc.y, { width: 280 });
        const y = doc.y - doc.currentLineHeight();
        doc.text(String(Number(line.quantity)), MARGIN + 280, y, { width: 60, align: 'right' });
        doc.text(money(line.unit_cost), MARGIN + 340, y, { width: 80, align: 'right' });
        doc.text(money(lineTotal), MARGIN + 420, y, { width: 90, align: 'right' });
        doc.moveDown(0.15);
      }

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text(`GRN value: ${money(total)}`, { align: 'right' });
      if (grn.notes) {
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(8).text(`Notes: ${grn.notes}`, { width: CONTENT_WIDTH });
      }

      await appendDocumentQr(doc, { verifyUrl, hash: verifyHash, label: 'Scan to verify GRN' });
      doc.end();
    })().catch(reject);
  });
}

module.exports = { loadGrnContext, renderGrnPdfBuffer };
