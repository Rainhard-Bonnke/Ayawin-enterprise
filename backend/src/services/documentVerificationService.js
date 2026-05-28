const crypto = require('crypto');

function buildInvoiceVerificationHash(invoice) {
  const secret = process.env.DOC_VERIFY_SECRET || 'ayawin-doc-verify-secret';
  const payload = [
    String(invoice.company_id || ''),
    String(invoice.invoice_no || ''),
    String(invoice.customer_id || ''),
    String(invoice.invoice_date || '').slice(0, 10),
    Number(invoice.total_amount || 0).toFixed(2),
    String(invoice.status || ''),
  ].join('|');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

module.exports = { buildInvoiceVerificationHash };
