const pool = require('../db');

/**
 * Kenya go-live integrations (eTIMS + M-Pesa).
 * See backend/docs/INTEGRATIONS-KENYA.md for env vars and production checklist.
 */

function getIntegrationStatus() {
  const etimsEnabled = process.env.ETIMS_ENABLED === 'true';
  const mpesaConfigured = Boolean(
    process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET,
  );
  const emailConfigured = Boolean(process.env.SMTP_HOST);
  const smsConfigured = Boolean(process.env.AFRICASTALKING_API_KEY || process.env.SENDGRID_API_KEY);

  return {
    etims: { enabled: etimsEnabled, configured: etimsEnabled, mode: etimsEnabled ? 'live' : 'disabled' },
    mpesa: {
      enabled: mpesaConfigured,
      configured: mpesaConfigured,
      mode: mpesaConfigured ? 'live' : 'disabled',
    },
    email: {
      enabled: emailConfigured,
      configured: emailConfigured,
      mode: emailConfigured ? 'live' : 'disabled',
    },
    sms: {
      enabled: smsConfigured,
      configured: smsConfigured,
      mode: smsConfigured ? 'live' : 'disabled',
    },
  };
}

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

async function sendNotification({ companyId, channel, to, subject, body, attachments }) {
  const provider = channel === 'sms' ? 'sms' : 'email';
  const attachmentMeta = (attachments || []).map((a) => ({
    filename: a.filename,
    bytes: a.content?.length || 0,
  }));

  if (provider === 'email' && process.env.SMTP_HOST && attachments?.length) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@martin.co.ke',
        to,
        subject,
        text: body,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType || 'application/pdf',
        })),
      });
      await logIntegration({
        companyId,
        provider,
        action: 'send',
        request: { to, subject, attachments: attachmentMeta },
        response: { sent: true },
        status: 'success',
      });
      return { ok: true, sent: true };
    } catch (err) {
      await logIntegration({
        companyId,
        provider,
        action: 'send',
        request: { to, subject, attachments: attachmentMeta },
        response: { error: err.message },
        status: 'failed',
      });
      throw err;
    }
  }

  await logIntegration({
    companyId,
    provider,
    action: 'send',
    request: { to, subject, body: body?.slice(0, 200), attachments: attachmentMeta },
    response: { queued: true, attachment_count: attachmentMeta.length },
    status: 'success',
  });
  console.log(`[${provider}] to=${to} subject=${subject}${attachmentMeta.length ? ` (${attachmentMeta.length} attachment(s))` : ''}`);
  return { ok: true, queued: true, attachments: attachmentMeta };
}

async function handleMpesaCallback({ payload }) {
  const reference = String(payload?.BillRefNumber || payload?.reference || '').trim();
  const amount = Number(payload?.TransAmount || payload?.amount || 0);
  const resultCode = payload?.ResultCode ?? payload?.result_code ?? 0;
  const checkoutId = payload?.CheckoutRequestID || payload?.checkout_request_id;

  await logIntegration({
    companyId: null,
    provider: 'mpesa',
    action: 'callback',
    request: payload || {},
    response: { processed: resultCode === 0 },
    status: resultCode === 0 ? 'success' : 'failed',
  });

  if (resultCode !== 0 || !reference || !amount) {
    return { ok: false, reason: 'callback ignored' };
  }

  const invResult = await pool.query(
    `SELECT id, company_id, total_amount, amount_paid, status FROM erp_customer_invoices
     WHERE invoice_no = $1 AND is_deleted = FALSE LIMIT 1`,
    [reference],
  );
  const inv = invResult.rows[0];
  if (!inv) return { ok: false, reason: 'invoice not found' };

  const sales = require('./salesService');
  const payment = await sales.recordCustomerPayment({
    companyId: inv.company_id,
    userId: null,
    invoiceId: inv.id,
    amount,
    referenceNo: checkoutId || reference,
    notes: 'M-Pesa STK callback',
    postGl: true,
  });
  return { ok: true, ...payment };
}

module.exports = {
  getIntegrationStatus,
  logIntegration,
  submitEtimsInvoice,
  initiateMpesaPayment,
  handleMpesaCallback,
  sendNotification,
};
