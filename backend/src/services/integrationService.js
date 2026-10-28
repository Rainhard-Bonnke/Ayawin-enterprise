const pool = require("../db");

async function logIntegration({ companyId, provider, action, request, response, status }) {
  const result = await pool.query(
    `INSERT INTO erp_integration_logs (company_id, provider, action, request_payload, response_payload, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, provider, action, request || {}, response || {}, status],
  );
  return result.rows[0].id;
}

async function submitEtimsInvoice({ companyId, invoice }) {
  const request = {
    invoice_no: invoice.invoice_no,
    customer_tax_id: invoice.tax_id,
    total: invoice.total_amount,
    lines: invoice.lines || [],
  };

  const response = {
    status: "not_configured",
    message: "No certified KRA eTIMS integration is configured.",
  };
  await logIntegration({
    companyId,
    provider: "etims",
    action: "submit_invoice",
    request,
    response,
    status: "skipped",
  });
  return { ok: false, configured: false, ...response };
}

async function initiateMpesaPayment({ companyId, phone, amount, reference }) {
  const request = { phone, amount, reference };
  const response = {
    status: "not_configured",
    message: "The Safaricom Daraja STK Push adapter is not implemented.",
  };
  await logIntegration({
    companyId,
    provider: "mpesa",
    action: "stk_push",
    request,
    response,
    status: "skipped",
  });
  return { ok: false, configured: false, ...response };
}

async function sendNotification({ companyId, channel, to, subject, body }) {
  const provider = channel === "sms" ? "sms" : "email";
  const response = {
    status: "not_configured",
    message: `No ${provider.toUpperCase()} delivery provider is configured.`,
  };
  await logIntegration({
    companyId,
    provider,
    action: "send",
    request: { to, subject, body: body?.slice(0, 200) },
    response,
    status: "skipped",
  });
  return { ok: false, configured: false, ...response };
}

module.exports = {
  logIntegration,
  submitEtimsInvoice,
  initiateMpesaPayment,
  sendNotification,
};
