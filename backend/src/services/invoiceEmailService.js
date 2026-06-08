const pool = require('../db');
const integration = require('./integrationService');
const { renderInvoicePdfBuffer } = require('./invoicePdfService');

async function emailInvoicePdf({ companyId, invoiceNo, toEmail }) {
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.email AS customer_email
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [companyId, invoiceNo],
  );
  if (!result.rowCount) throw new Error('Invoice not found');
  const invoice = result.rows[0];
  const recipient = toEmail || invoice.customer_email;
  if (!recipient) throw new Error('Customer has no email; provide to_email');

  const pdfBuffer = await renderInvoicePdfBuffer({ companyId, invoiceNo });

  const subject = `Tax invoice ${invoice.invoice_no} — ${invoice.customer_name}`;
  const body = [
    `Dear ${invoice.customer_name},`,
    '',
    `Please find attached invoice ${invoice.invoice_no} for ${Number(invoice.total_amount).toLocaleString('en-KE', { style: 'currency', currency: 'KES' })}.`,
    `Due date: ${invoice.due_date || 'as agreed'}.`,
    '',
    'Ayawin Stock Solutions',
  ].join('\n');

  await integration.sendNotification({
    companyId,
    channel: 'email',
    to: recipient,
    subject,
    body,
    attachments: [
      {
        filename: `invoice-${invoice.invoice_no}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  await pool.query(
    `UPDATE erp_customer_invoices SET updated_at = NOW() WHERE id = $1`,
    [invoice.id],
  );

  return { ok: true, to: recipient, invoice_no: invoice.invoice_no, pdf_bytes: pdfBuffer.length };
}

module.exports = { emailInvoicePdf };
