const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  buildInvoiceIssuerDetails,
  buildInvoiceVerificationHash,
} = require("../src/services/documentVerificationService");

test("invoice issuer details use registered company and head-office legal metadata", () => {
  assert.deepEqual(buildInvoiceIssuerDetails({
    name: "Ayawin Trading",
    legal_name: "Ayawin Trading Limited",
    tax_registration_no: "P051000099Z",
    base_currency_code: "kes",
  }, {
    address_line1: "Industrial Area",
    address_line2: "Enterprise Road",
    city: "Nairobi",
    country_code: "KE",
    phone: "+254700000000",
    email: "finance@example.test",
  }), {
    legal_name: "Ayawin Trading Limited",
    trading_name: "Ayawin Trading",
    tax_registration_no: "P051000099Z",
    address: "Industrial Area, Enterprise Road, Nairobi, KE",
    phone: "+254700000000",
    email: "finance@example.test",
    base_currency_code: "KES",
  });
});

test("invoice issuer details do not invent unavailable registration or contact data", () => {
  assert.deepEqual(buildInvoiceIssuerDetails({ name: "Ayawin ERP" }), {
    legal_name: "Ayawin ERP",
    trading_name: "Ayawin ERP",
    tax_registration_no: "N/A",
    address: "N/A",
    phone: "N/A",
    email: "N/A",
    base_currency_code: "N/A",
  });
});

test("receipt verification hash covers issuer snapshots and preserves the legacy hash payload", () => {
  const priorSecret = process.env.DOC_VERIFY_SECRET;
  process.env.DOC_VERIFY_SECRET = "document-verification-test-secret-0123456789";
  const invoice = {
    company_id: "company-1",
    invoice_no: "INV-1",
    customer_id: "customer-1",
    invoice_date: "2026-11-13",
    total_amount: 100,
    status: "paid",
  };
  try {
    const legacyPayload = ["company-1", "INV-1", "customer-1", "2026-11-13", "100.00", "paid"].join("|");
    const legacyExpected = crypto.createHmac("sha256", process.env.DOC_VERIFY_SECRET).update(legacyPayload).digest("hex");
    assert.equal(buildInvoiceVerificationHash(invoice), legacyExpected);

    const withSnapshot = {
      ...invoice,
      issuer_snapshot: { version: 1, legal_name: "Ayawin Limited", tax_registration_no: "P051000099Z" },
    };
    assert.notEqual(buildInvoiceVerificationHash(withSnapshot), legacyExpected);
    assert.notEqual(buildInvoiceVerificationHash({
      ...withSnapshot,
      issuer_snapshot: { ...withSnapshot.issuer_snapshot, legal_name: "Tampered Limited" },
    }), buildInvoiceVerificationHash(withSnapshot));
  } finally {
    if (priorSecret === undefined) delete process.env.DOC_VERIFY_SECRET;
    else process.env.DOC_VERIFY_SECRET = priorSecret;
  }
});