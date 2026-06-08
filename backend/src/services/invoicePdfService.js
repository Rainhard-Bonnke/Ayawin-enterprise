const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const pool = require('../db');
const { appendDocumentQr } = require('../lib/pdfQrFooter');
const {
  buildInvoiceVerificationHash,
  buildVerifyUrl,
} = require('./documentVerificationService');

const MARGIN = 48;
const PAGE_WIDTH = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function money(n) {
  return `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadInvoiceContext(companyId, invoiceNo) {
  const invResult = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id,
            c.address_line1 AS customer_address, c.city AS customer_city
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [companyId, invoiceNo],
  );
  if (!invResult.rowCount) throw new Error('Invoice not found');
  const invoice = invResult.rows[0];

  const lines = await pool.query(
    `SELECT vil.line_no, vil.quantity, vil.unit_price, vil.excise_amount, vil.tax_amount, vil.line_total,
            i.item_code, i.name AS item_name
     FROM erp_customer_invoice_lines vil
     JOIN erp_items i ON i.id = vil.item_id
     WHERE vil.invoice_id = $1 AND vil.is_deleted = FALSE
     ORDER BY vil.line_no`,
    [invoice.id],
  );

  const companyResult = await pool.query(
    `SELECT c.name, c.legal_name, c.tax_registration_no, c.logo_url,
            b.address_line1, b.address_line2, b.city, b.phone, b.email
     FROM erp_companies c
     LEFT JOIN erp_branches b ON b.company_id = c.id AND b.code = 'HQ' AND b.is_deleted = FALSE
     WHERE c.id = $1`,
    [companyId],
  );
  const company = companyResult.rows[0] || { name: 'Ayawin Stock Solutions ERP' };

  return { invoice, lines: lines.rows, company };
}

async function renderInvoicePdfBuffer({ companyId, invoiceNo, receipt = false }) {
  const { invoice, lines, company } = await loadInvoiceContext(companyId, invoiceNo);

  let paymentReceiptNo = null;
  if (receipt) {
    const payLink = await pool.query(
      `SELECT r.receipt_no
       FROM erp_customer_receipts r
       JOIN erp_receipt_allocations ra ON ra.receipt_id = r.id
       WHERE ra.invoice_id = $1 AND r.company_id = $2 AND r.is_deleted = FALSE
       ORDER BY r.receipt_date DESC LIMIT 1`,
      [invoice.id, companyId],
    );
    paymentReceiptNo = payLink.rows[0]?.receipt_no || null;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    (async () => {
      const title = receipt ? 'PAYMENT RECEIPT' : (String(invoice.invoice_type) === 'proforma' ? 'PROFORMA INVOICE' : 'TAX INVOICE');
      const verifyHash = buildInvoiceVerificationHash(invoice);
      const verifyUrl = buildVerifyUrl(
        `/api/v1/sales/invoices/${encodeURIComponent(invoice.invoice_no)}/verify`,
        verifyHash,
      );

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
      doc.fontSize(16).font('Helvetica-Bold').text(company.legal_name || company.name, textX, headerY, { width: 280 });
      doc.fontSize(9).font('Helvetica').fillColor('#333333');
      const addr = [company.address_line1, company.address_line2, company.city].filter(Boolean).join(', ');
      if (addr) doc.text(addr, textX, doc.y + 2, { width: 280 });
      if (company.phone) doc.text(`Tel: ${company.phone}`, textX);
      if (company.tax_registration_no) doc.text(`PIN: ${company.tax_registration_no}`, textX);

      doc.fillColor('#000000');
      doc.fontSize(13).font('Helvetica-Bold').text(title, MARGIN, headerY, { width: CONTENT_WIDTH, align: 'right' });
      doc.fontSize(10).font('Helvetica').text(invoice.invoice_no, { align: 'right' });
      doc.text(`ETR/TIMS: ${invoice.etims_ref || '—'}`, { align: 'right' });
      doc.moveDown(0.8);
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#cccccc').stroke();
      doc.moveDown(0.6);

      doc.fontSize(10).font('Helvetica-Bold').text('Bill To');
      doc.font('Helvetica').text(invoice.customer_name || '—');
      doc.text(`KRA PIN: ${invoice.customer_tax_id || '—'}`);
      if (invoice.customer_address || invoice.customer_city) {
        doc.text([invoice.customer_address, invoice.customer_city].filter(Boolean).join(', '));
      }
      doc.moveDown(0.4);
      doc.text(`Invoice date: ${String(invoice.invoice_date || '').slice(0, 10)}`);
      doc.text(`Due date: ${String(invoice.due_date || '').slice(0, 10)}`);
      if (receipt) {
        doc.text(`Amount paid: ${money(invoice.amount_paid)}`);
        if (paymentReceiptNo) doc.text(`Payment receipt no: ${paymentReceiptNo}`);
      }
      doc.moveDown(0.8);

      const col = {
        item: MARGIN,
        qty: MARGIN + 248,
        unit: MARGIN + 300,
        excise: MARGIN + 360,
        vat: MARGIN + 420,
        total: MARGIN + 470,
      };
      doc.font('Helvetica-Bold').fontSize(8);
      doc.text('Item', col.item, doc.y, { width: 240 });
      doc.text('Qty', col.qty, doc.y - doc.currentLineHeight(), { width: 40, align: 'right' });
      doc.text('Unit', col.unit, doc.y - doc.currentLineHeight(), { width: 50, align: 'right' });
      doc.text('Excise', col.excise, doc.y - doc.currentLineHeight(), { width: 52, align: 'right' });
      doc.text('VAT', col.vat, doc.y - doc.currentLineHeight(), { width: 44, align: 'right' });
      doc.text('Total', col.total, doc.y - doc.currentLineHeight(), { width: 72, align: 'right' });
      doc.moveDown(0.3);
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor('#eeeeee').stroke();
      doc.moveDown(0.2);

      doc.font('Helvetica').fontSize(8);
      for (const line of lines) {
        const rowTop = doc.y;
        if (rowTop > 700) {
          doc.addPage();
        }
        const label = `${line.item_code} — ${line.item_name}`;
        doc.text(label, col.item, doc.y, { width: 236 });
        const rowY = doc.y - doc.currentLineHeight();
        doc.text(String(Number(line.quantity)), col.qty, rowY, { width: 40, align: 'right' });
        doc.text(money(line.unit_price), col.unit, rowY, { width: 50, align: 'right' });
        doc.text(money(line.excise_amount), col.excise, rowY, { width: 52, align: 'right' });
        doc.text(money(line.tax_amount), col.vat, rowY, { width: 44, align: 'right' });
        doc.text(money(line.line_total), col.total, rowY, { width: 72, align: 'right' });
        doc.moveDown(0.15);
      }

      doc.moveDown(0.6);
      const totalsX = MARGIN + 320;
      doc.font('Helvetica').fontSize(9);
      doc.text('Subtotal', totalsX, doc.y, { width: 100, continued: true }).text(money(invoice.subtotal), { align: 'right' });
      doc.text('Excise duty', totalsX, doc.y, { width: 100, continued: true }).text(money(invoice.excise_amount), { align: 'right' });
      doc.text('VAT (16%)', totalsX, doc.y, { width: 100, continued: true }).text(money(invoice.tax_amount), { align: 'right' });
      doc.font('Helvetica-Bold').text('Total', totalsX, doc.y, { width: 100, continued: true }).text(money(invoice.total_amount), { align: 'right' });
      if (Number(invoice.amount_paid) > 0) {
        doc.font('Helvetica').text('Paid', totalsX, doc.y, { width: 100, continued: true }).text(money(invoice.amount_paid), { align: 'right' });
        doc.text('Balance', totalsX, doc.y, { width: 100, continued: true }).text(
          money(Number(invoice.total_amount) - Number(invoice.amount_paid)),
          { align: 'right' },
        );
      }

      await appendDocumentQr(doc, {
        verifyUrl,
        hash: verifyHash,
        label: receipt ? 'Scan to verify payment receipt' : 'Scan to verify tax invoice',
      });
      doc.end();
    })().catch(reject);
  });
}

module.exports = { loadInvoiceContext, renderInvoicePdfBuffer };
