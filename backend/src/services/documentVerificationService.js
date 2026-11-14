const crypto = require("crypto");

function buildInvoiceIssuerDetails(company = {}, branch = {}) {
  const address = [branch.address_line1, branch.address_line2, branch.city, branch.country_code]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");

  return {
    legal_name: String(company.legal_name || company.name || "").trim() || "N/A",
    trading_name: String(company.name || "").trim() || "N/A",
    tax_registration_no: String(company.tax_registration_no || "").trim() || "N/A",
    address: address || "N/A",
    phone: String(branch.phone || "").trim() || "N/A",
    email: String(branch.email || "").trim() || "N/A",
    base_currency_code: String(company.base_currency_code || "").trim().toUpperCase() || "N/A",
  };
}

function buildInvoiceVerificationHash(invoice) {
  const secret = process.env.DOC_VERIFY_SECRET;
  if (!secret || secret.length < 32) throw new Error("DOC_VERIFY_SECRET must contain at least 32 characters");
  const payload = [
    String(invoice.company_id || ""),
    String(invoice.invoice_no || ""),
    String(invoice.customer_id || ""),
    String(invoice.invoice_date || "").slice(0, 10),
    Number(invoice.total_amount || 0).toFixed(2),
    String(invoice.status || ""),
  ];
  if (invoice.issuer_snapshot) {
    payload.push(JSON.stringify(invoice.issuer_snapshot));
  }
  return crypto.createHmac("sha256", secret).update(payload.join("|")).digest("hex");
}

function isFinalEtimsInvoice(invoice) {
  return invoice?.etims_status === "accepted"
    && Boolean(invoice.etims_cu_invoice_no)
    && Boolean(invoice.etims_receipt_signature)
    && Boolean(invoice.etims_internal_data)
    && Boolean(invoice.etims_cu_id)
    && Boolean(invoice.etims_verification_data);
}

module.exports = { buildInvoiceVerificationHash, buildInvoiceIssuerDetails, isFinalEtimsInvoice };
