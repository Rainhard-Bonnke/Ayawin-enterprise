const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { appendDocumentQr } = require('../lib/pdfQrFooter');
const {
  buildPaymentReceiptHash,
  buildVerifyUrl,
} = require('./documentVerificationService');

const MARGIN = 48;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(n) {
  return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadPaymentReceiptContext(companyId, receiptNo) {
  const receiptResult = await pool.query(
    `SELECT r.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_receipts r
     JOIN erp_customers c ON c.id = r.customer_id
     WHERE r.company_id = $1 AND r.receipt_no = $2 AND r.is_deleted = FALSE`,
    [companyId, receiptNo],
  );
  if (!receiptResult.rowCount) throw new Error('Payment receipt not found');
  const receipt = receiptResult.rows[0];

  const allocations = await pool.query(
    `SELECT ra.amount, inv.invoice_no, inv.invoice_date
     FROM erp_receipt_allocations ra
     JOIN erp_customer_invoices inv ON inv.id = ra.invoice_id
     WHERE ra.receipt_id = $1 AND ra.is_deleted = FALSE
     ORDER BY inv.invoice_no`,
    [receipt.id],
  );

  const companyResult = await pool.query(
    `SELECT c.name, c.legal_name, c.tax_registration_no, c.logo_url,
            b.address_line1, b.address_line2, b.city, b.phone, b.email
     FROM erp_companies c
     LEFT JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ' AND b.is_deleted = FALSE
     WHERE c.id = $1`,
    [companyId],
  );

  return { receipt, allocations: allocations.rows, company: companyResult.rows[0] || {} };
}

async function renderPaymentReceiptPdfBuffer({ companyId, receiptNo }) {
  const { receipt, allocations, company } = await loadPaymentReceiptContext(companyId, receiptNo);
  const verifyHash = buildPaymentReceiptHash(receipt);
  const verifyUrl = buildVerifyUrl(
    `/api/v1/sales/receipts/${encodeURIComponent(receipt.receipt_no)}/verify`,
    verifyHash,
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    (async () => {
      let headerY = MARGIN;
      let logoRendered = false;
      if (company.logo_url) {
        const logoPath = company.logo_url.startsWith('/')
          ? path.join(process.cwd(), company.logo_url.replace(/^\//, ''))
          : company.logo_url;
        try {
          if (fs.existsSync(logoPath)) {
            doc.image(logoPath, MARGIN, headerY, { fit: [56, 56], width: 56, height: 56 });
            logoRendered = true;
          }
        } catch {
          logoRendered = false;
        }
      }

      const textX = logoRendered ? MARGIN + 64 : MARGIN;
      doc.fontSize(16).font('Helvetica-Bold').text(company.legal_name || company.name || 'Ayawin ERP', textX, headerY, { width: 280 });
      doc.fontSize(9).font('Helvetica').fillColor('#333333');
      const addr = [company.address_line1, company.address_line2, company.city].filter(Boolean).join(', ');
      if (addr) doc.text(addr, textX, doc.y + 2, { width: 280 });
      if (company.phone) doc.text(`Tel: ${company.phone}`, textX);
      if (company.tax_registration_no) doc.text(`PIN: ${company.tax_registration_no}`, textX);

      doc.fillColor('#000000');
      doc.fontSize(13).font('Helvetica-Bold').text('OFFICIAL PAYMENT RECEIPT', MARGIN, headerY, { width: CONTENT_WIDTH, align: 'right' });
      doc.fontSize(10).font('Helvetica').text(receipt.receipt_no, { align: 'right' });
      doc.text(`Date: ${String(receipt.receipt_date || '').slice(0, 10)}`, { align: 'right' });
      doc.moveDown(0.8);
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.6);

      doc.fontSize(10).font('Helvetica-Bold').text('Received from');
      doc.font('Helvetica').text(receipt.customer_name || '—');
      doc.text(`KRA PIN: ${receipt.customer_tax_id || '—'}`);
      doc.moveDown(0.4);
      doc.text(`Payment method: ${receipt.payment_method || '—'}`);
      if (receipt.reference_no) doc.text(`Bank / M-Pesa ref: ${receipt.reference_no}`);
      doc.moveDown(0.8);

      const boxTop = doc.y;
      doc.fillColor('#f8fafc').rect(MARGIN, boxTop, CONTENT_WIDTH, 56).fill();
      doc.strokeColor('#cccccc').rect(MARGIN, boxTop, CONTENT_WIDTH, 56).stroke();
      doc.fillColor('#000000');
      doc.font('Helvetica-Bold').fontSize(14);
      doc.text('Amount received', MARGIN + 14, boxTop + 16);
      doc.text(money(receipt.amount), PAGE_WIDTH - MARGIN - 14, boxTop + 16, { align: 'right', width: 200 });
      doc.y = boxTop + 64;

      if (allocations.length) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(9).text('Applied to invoices');
        doc.font('Helvetica').fontSize(8);
        for (const row of allocations) {
          doc.text(
            `${row.invoice_no} (${String(row.invoice_date || '').slice(0, 10)}) — ${money(row.amount)}`,
          );
        }
      }

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666666').text(
        'This receipt confirms payment received and posted to accounts receivable. Retain for audit and KRA reconciliation.',
        MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
      doc.fillColor('#000000');

      await appendDocumentQr(doc, { verifyUrl, hash: verifyHash });
      doc.end();
    })().catch(reject);
  });
}

module.exports = { loadPaymentReceiptContext, renderPaymentReceiptPdfBuffer };
