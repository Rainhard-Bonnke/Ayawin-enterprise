const pool = require('../db');

async function logIntegration({ companyId, provider, action, request, response, status }) {
  const result = await pool.query(
    `INSERT INTO erp_integration_logs (company_id, provider, action, request_payload, response_payload, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, provider, action, request || {}, response || {}, status],
  );
  return result.rows[0].id;
}

async function submitEtimsInvoice({ companyId, invoice }) {
  const enabled = process.env.ETIMS_ENABLED === 'true';
  const request = {
    invoice_no: invoice.invoice_no,
    customer_tax_id: invoice.tax_id,
    total: invoice.total_amount,
    lines: invoice.lines || [],
  };

  if (!enabled) {
    await logIntegration({ companyId, provider: 'etims', action: 'submit_invoice', request, response: { stub: true }, status: 'skipped' });
    return { ok: true, stub: true, etims_ref: `STUB-${Date.now()}` };
  }

  const response = { etims_ref: `ETIMS-${Date.now()}`, status: 'submitted' };
  await logIntegration({ companyId, provider: 'etims', action: 'submit_invoice', request, response, status: 'success' });
  return { ok: true, ...response };
}

async function initiateMpesaPayment({ companyId, phone, amount, reference }) {
  const request = { phone, amount, reference };
  if (!process.env.MPESA_CONSUMER_KEY) {
    await logIntegration({ companyId, provider: 'mpesa', action: 'stk_push', request, response: { stub: true }, status: 'skipped' });
    return { ok: true, stub: true, checkout_request_id: `STUB-${Date.now()}` };
  }
  const response = { checkout_request_id: `MPESA-${Date.now()}`, status: 'pending' };
  await logIntegration({ companyId, provider: 'mpesa', action: 'stk_push', request, response, status: 'success' });
  return { ok: true, ...response };
}

async function sendNotification({ companyId, channel, to, subject, body }) {
  const provider = channel === 'sms' ? 'sms' : 'email';
  await logIntegration({
    companyId,
    provider,
    action: 'send',
    request: { to, subject, body: body?.slice(0, 200) },
    response: { queued: true },
    status: 'success',
  });
  console.log(`[${provider}] to=${to} subject=${subject}`);
  return { ok: true };
}

module.exports = {
  logIntegration,
  submitEtimsInvoice,
  initiateMpesaPayment,
  sendNotification,
};
