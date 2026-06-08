const crypto = require('crypto');

const DOC_VERIFY_SECRET = () => process.env.DOC_VERIFY_SECRET || 'ayawin-doc-verify-secret';

function hmacHex(payload) {
  return crypto.createHmac('sha256', DOC_VERIFY_SECRET()).update(payload).digest('hex');
}

function getDocumentVerifyBaseUrl() {
  return (
    process.env.API_PUBLIC_URL ||
    process.env.API_BASE_URL ||
    'http://localhost:4000'
  ).replace(/\/+$/, '');
}

function buildVerifyUrl(apiPath, hash) {
  const base = getDocumentVerifyBaseUrl();
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${path}?hash=${encodeURIComponent(hash)}`;
}

function buildInvoiceVerificationHash(invoice) {
  const payload = [
    String(invoice.company_id || ''),
    String(invoice.invoice_no || ''),
    String(invoice.customer_id || ''),
    String(invoice.invoice_date || '').slice(0, 10),
    Number(invoice.total_amount || 0).toFixed(2),
    String(invoice.status || ''),
  ].join('|');
  return hmacHex(payload);
}

function buildPaymentReceiptHash(receipt) {
  const payload = [
    String(receipt.company_id || ''),
    String(receipt.receipt_no || ''),
    String(receipt.customer_id || ''),
    String(receipt.receipt_date || '').slice(0, 10),
    Number(receipt.amount || 0).toFixed(2),
    String(receipt.status || ''),
  ].join('|');
  return hmacHex(payload);
}

function buildGrnVerificationHash(grn) {
  const payload = [
    String(grn.company_id || ''),
    String(grn.grn_number || grn.receipt_no || ''),
    String(grn.purchase_order_id || ''),
    String(grn.received_date || '').slice(0, 10),
    String(grn.status || ''),
  ].join('|');
  return hmacHex(payload);
}

function buildVendorPaymentHash(payment) {
  const payload = [
    String(payment.company_id || ''),
    String(payment.payment_no || ''),
    String(payment.vendor_id || ''),
    String(payment.payment_date || '').slice(0, 10),
    Number(payment.amount || 0).toFixed(2),
    String(payment.status || ''),
  ].join('|');
  return hmacHex(payload);
}

function buildPayslipVerificationHash(payslip, run) {
  const payload = [
    String(payslip.company_id || ''),
    String(run?.id || payslip.payroll_run_id || ''),
    String(payslip.id || ''),
    String(payslip.employee_id || ''),
    String(run?.payroll_month || '').slice(0, 7),
    Number(payslip.net_pay || 0).toFixed(2),
  ].join('|');
  return hmacHex(payload);
}

module.exports = {
  getDocumentVerifyBaseUrl,
  buildVerifyUrl,
  buildInvoiceVerificationHash,
  buildPaymentReceiptHash,
  buildGrnVerificationHash,
  buildVendorPaymentHash,
  buildPayslipVerificationHash,
};
