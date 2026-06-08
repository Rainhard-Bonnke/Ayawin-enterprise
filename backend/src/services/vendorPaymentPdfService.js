const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { appendDocumentQr } = require('../lib/pdfQrFooter');
const {
  buildVendorPaymentHash,
  buildVerifyUrl,
} = require('./documentVerificationService');

const MARGIN = 48;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(n) {
  return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadVendorPaymentContext(companyId, paymentNo) {
  const payResult = await pool.query(
    `SELECT p.*, v.name AS vendor_name, v.tax_id AS vendor_tax_id
     FROM erp_vendor_payments p
     JOIN erp_vendors v ON v.id = p.vendor_id
     WHERE p.company_id = $1 AND p.payment_no = $2 AND p.is_deleted = FALSE`,
    [companyId, paymentNo],
  );
  if (!payResult.rowCount) throw new Error('Vendor payment not found');
  const payment = payResult.rows[0];

  const allocations = await pool.query(
    `SELECT pa.amount, inv.bill_no, inv.bill_date
     FROM erp_vendor_payment_allocations pa
     JOIN erp_vendor_invoices inv ON inv.id = pa.invoice_id
     WHERE pa.payment_id = $1 AND pa.is_deleted = FALSE
     ORDER BY inv.bill_no`,
    [payment.id],
  );

  const companyResult = await pool.query(
    `SELECT c.name, c.legal_name, c.tax_registration_no, c.logo_url
     FROM erp_companies c WHERE c.id = $1`,
    [companyId],
  );

  return { payment, allocations: allocations.rows, company: companyResult.rows[0] || {} };
}

async function renderVendorPaymentPdfBuffer({ companyId, paymentNo }) {
  const { payment, allocations, company } = await loadVendorPaymentContext(companyId, paymentNo);
  const verifyHash = buildVendorPaymentHash(payment);
  const verifyUrl = buildVerifyUrl(
    `/api/v1/finance/vendor-payments/${encodeURIComponent(payment.payment_no)}/verify`,
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

      doc.fontSize(16).font('Helvetica-Bold').text(company.legal_name || company.name || 'Ayawin ERP');
      doc.fontSize(12).text('VENDOR PAYMENT RECEIPT', { align: 'right' });
      doc.fontSize(10).font('Helvetica').text(payment.payment_no, { align: 'right' });
      doc.text(`Date: ${String(payment.payment_date || '').slice(0, 10)}`, { align: 'right' });
      doc.moveDown();
      doc.text(`Paid to: ${payment.vendor_name || '—'}`);
      doc.text(`Vendor PIN: ${payment.vendor_tax_id || '—'}`);
      doc.text(`Method: ${payment.payment_method || 'bank_transfer'}`);
      if (payment.reference_no) doc.text(`Reference: ${payment.reference_no}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(14).text(`Amount paid: ${money(payment.amount)}`);
      doc.moveDown(0.4);
      if (allocations.length) {
        doc.fontSize(9).font('Helvetica-Bold').text('Applied to bills');
        doc.font('Helvetica').fontSize(8);
        for (const row of allocations) {
          doc.text(`${row.bill_no} — ${money(row.amount)}`);
        }
      }

      doc.moveDown(0.8);
      doc.fontSize(8).fillColor('#666666').text(
        'Official record of vendor payment. Retain for AP audit and supplier reconciliation.',
        MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
      doc.fillColor('#000000');

      await appendDocumentQr(doc, { verifyUrl, hash: verifyHash, label: 'Scan to verify payment' });
      doc.end();
    })().catch(reject);
  });
}

module.exports = { loadVendorPaymentContext, renderVendorPaymentPdfBuffer };
