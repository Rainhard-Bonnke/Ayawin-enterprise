const crypto = require("crypto");
const pool = require("../db");
const integrationSettings = require("./integrationSettingsService");
const { logIntegration } = require("./integrationService");

function normalizeKenyanPhone(value) {
  const digits = String(value || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  if (!/^254[17]\d{8}$/.test(normalized)) {
    throw new Error("Enter a valid Kenyan mobile number, for example 0712345678");
  }
  return normalized;
}

function safeTokenEqual(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function extractCheckoutRequestId(payload) {
  return String(payload?.Body?.stkCallback?.CheckoutRequestID || "").trim();
}

async function createStkRequest({ companyId, userId, invoiceId, phone, amount, idempotencyKey }) {
  const normalizedPhone = normalizeKenyanPhone(phone);
  const key = String(idempotencyKey || "").trim();
  if (!invoiceId || !key || key.length > 128) {
    throw new Error("invoice_id and an idempotency_key of at most 128 characters are required");
  }
  if (amount != null && (!Number.isFinite(Number(amount)) || Number(amount) <= 0)) {
    throw new Error("Payment amount must be greater than zero");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoiceResult = await client.query(
      `SELECT id, customer_id, invoice_no, total_amount, amount_paid, credited_amount, status
       FROM erp_customer_invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [invoiceId, companyId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw new Error("Invoice not found");
    const existing = await client.query(
      `SELECT * FROM erp_mpesa_payment_requests
       WHERE company_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [companyId, key],
    );
    if (existing.rowCount) {
      const request = existing.rows[0];
      if (request.invoice_id !== invoiceId || request.phone_number !== normalizedPhone
        || (amount != null && Math.abs(Number(request.amount) - Number(amount)) > 0.0001)) {
        throw new Error("Idempotency key was already used for a different payment request");
      }
      await client.query("COMMIT");
      return {
        id: request.id,
        invoice_id: request.invoice_id,
        invoice_no: invoice.invoice_no,
        status: request.status,
        amount: Number(request.amount),
        phone_number: request.phone_number,
        checkout_request_id: request.checkout_request_id,
        configured: Boolean(process.env.MPESA_ADAPTER_MODULE),
        message: request.status === "confirmed"
          ? "M-Pesa payment is already confirmed."
          : request.status === "pending"
            ? "STK request is queued; no customer receipt is recorded until provider verification succeeds."
            : `Payment request is ${request.status}.`,
      };
    }
    if (!["posted", "partial", "overdue"].includes(invoice.status)) {
      throw new Error("M-Pesa payments require an open posted invoice");
    }
    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0) - Number(invoice.credited_amount || 0);
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      throw new Error("Invoice has no outstanding balance");
    }
    const paymentAmount = Math.round(outstanding * 100) / 100;
    if (!Number.isSafeInteger(paymentAmount)) {
      throw new Error("M-Pesa STK supports whole KES shillings; this invoice has a fractional outstanding balance");
    }
    if (amount != null && (!Number.isFinite(Number(amount)) || Math.abs(Number(amount) - paymentAmount) > 0.0001)) {
      throw new Error("M-Pesa payment amount is calculated from the server-side invoice balance");
    }

    const inserted = await client.query(
      `INSERT INTO erp_mpesa_payment_requests (
         company_id, invoice_id, idempotency_key, phone_number, amount,
         account_reference, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
       ON CONFLICT (company_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [companyId, invoiceId, key, normalizedPhone, paymentAmount, invoice.invoice_no, userId],
    );
    const request = inserted.rows[0];
    if (!request) throw new Error("Payment request was concurrently created; retry with the same idempotency key");
    await client.query("COMMIT");
    return {
      id: request.id,
      invoice_id: request.invoice_id,
      invoice_no: invoice.invoice_no,
      status: request.status,
      amount: Number(request.amount),
      phone_number: request.phone_number,
      checkout_request_id: request.checkout_request_id,
      configured: Boolean(process.env.MPESA_ADAPTER_MODULE),
      message: request.status === "pending"
        ? "STK request is queued; no customer receipt is recorded until provider verification succeeds."
        : `Payment request is ${request.status}.`,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function receiveStkCallback({ token, payload }) {
  if (!safeTokenEqual(process.env.MPESA_CALLBACK_TOKEN, token)) {
    const error = new Error("Invalid M-Pesa callback token");
    error.statusCode = 401;
    throw error;
  }
  const checkoutRequestId = extractCheckoutRequestId(payload);
  if (!checkoutRequestId) throw new Error("Callback does not contain a checkout request ID");

  const result = await pool.query(
    `UPDATE erp_mpesa_payment_requests
     SET callback_payload = COALESCE(callback_payload, $2::jsonb),
         status = CASE WHEN status = 'awaiting_callback' THEN 'callback_received' ELSE status END,
         processing_stage = NULL, next_attempt_at = NOW(), updated_at = NOW()
     WHERE checkout_request_id = $1
       AND status IN ('awaiting_callback','callback_received')
     RETURNING id, status`,
    [checkoutRequestId, JSON.stringify(payload)],
  );
  if (!result.rowCount) {
    const error = new Error("No awaiting M-Pesa payment request matches this callback");
    error.statusCode = 404;
    throw error;
  }
  return { received: true, request_id: result.rows[0].id, status: result.rows[0].status };
}

async function claimMpesaRequests(status, stage, limit, companyId = null, invoiceId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH due AS (
         SELECT id
         FROM erp_mpesa_payment_requests
         WHERE ((status = $1 AND next_attempt_at <= NOW())
             OR (status = 'processing' AND processing_stage = $2 AND updated_at < NOW() - INTERVAL '5 minutes'))
           AND ($4::uuid IS NULL OR company_id = $4)
           AND ($5::uuid IS NULL OR invoice_id = $5)
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE erp_mpesa_payment_requests request
         SET status = 'processing', processing_stage = $2,
           attempt_count = attempt_count + 1, updated_at = NOW()
       FROM due WHERE request.id = due.id
       RETURNING request.*`,
      [status, stage, limit, companyId, invoiceId],
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateInitiationResult(request, result, error = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE erp_mpesa_payment_requests
         SET status = $3, processing_stage = NULL,
           merchant_request_id = COALESCE($4, merchant_request_id),
           checkout_request_id = COALESCE($5, checkout_request_id),
           provider_payload = $6::jsonb, last_error = $7,
           next_attempt_at = CASE WHEN $8::int IS NULL THEN next_attempt_at ELSE NOW() + ($8::int * INTERVAL '1 second') END,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $9
       RETURNING id`,
      [request.id, request.company_id, result ? "awaiting_callback" : (error?.terminal ? "failed" : "pending"),
        result?.merchant_request_id || null, result?.checkout_request_id || null,
        JSON.stringify(result || {}), error?.message || null, error?.retryDelaySeconds ?? null,
        request.attempt_count],
    );
    await client.query("COMMIT");
    return Boolean(updated.rowCount);
  } catch (updateError) {
    await client.query("ROLLBACK");
    throw updateError;
  } finally {
    client.release();
  }
}

async function runMpesaInitiationBatch({ adapter, limit = 20, maxAttempts = 8, companyId = null, invoiceId = null } = {}) {
  if (!adapter || typeof adapter.initiateStkPush !== "function") {
    return { configured: false, processed: 0, initiated: 0, retrying: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const attemptsLimit = Math.max(1, Number(maxAttempts) || 8);
  const requests = await claimMpesaRequests("pending", "initiate", batchSize, companyId, invoiceId);
  const summary = { configured: true, processed: requests.length, initiated: 0, retrying: 0, failed: 0 };

  for (const request of requests) {
    try {
      const response = await adapter.initiateStkPush({
        phone: request.phone_number,
        amount: Number(request.amount),
        accountReference: request.account_reference,
        idempotencyKey: request.idempotency_key,
      });
      if (!response?.merchant_request_id || !response?.checkout_request_id) {
        throw new Error("M-Pesa adapter response must include merchant and checkout request IDs");
      }
      if (await updateInitiationResult(request, response)) summary.initiated += 1;
    } catch (error) {
      const terminal = request.attempt_count >= attemptsLimit;
      const retryDelaySeconds = terminal ? null : Math.min(60 * (2 ** (request.attempt_count - 1)), 86400);
      if (await updateInitiationResult(request, null, {
        message: String(error.message || "STK request failed").slice(0, 2000),
        terminal,
        retryDelaySeconds,
      })) summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

function parseKenyanTransactionDate(value) {
  const text = String(value || "");
  if (!/^\d{14}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

async function runMpesaCallbackBatch({ adapter, limit = 20, maxAttempts = 8, companyId = null, invoiceId = null } = {}) {
  if (!adapter || typeof adapter.verifyPayment !== "function") {
    return { configured: false, processed: 0, confirmed: 0, retrying: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const attemptsLimit = Math.max(1, Number(maxAttempts) || 8);
  const requests = await claimMpesaRequests("callback_received", "verify", batchSize, companyId, invoiceId);
  const summary = { configured: true, processed: requests.length, confirmed: 0, retrying: 0, failed: 0 };

  for (const request of requests) {
    try {
      const verification = await adapter.verifyPayment({
        merchantRequestId: request.merchant_request_id,
        checkoutRequestId: request.checkout_request_id,
        callbackPayload: request.callback_payload,
        idempotencyKey: request.idempotency_key,
      });
      if (verification?.retryable === true) {
        const terminal = request.attempt_count >= attemptsLimit;
        await pool.query(
          `UPDATE erp_mpesa_payment_requests SET status = $3, processing_stage = NULL, last_error = $4,
             next_attempt_at = CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE NOW() + ($5::int * INTERVAL '1 second') END,
             verification_payload = $6::jsonb, updated_at = NOW()
           WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $7`,
          [request.id, request.company_id, terminal ? "failed" : "callback_received",
            String(verification.message || "Provider status is not final").slice(0, 2000),
            terminal ? null : Math.min(60 * (2 ** (request.attempt_count - 1)), 86400),
            JSON.stringify(verification), request.attempt_count],
        );
        summary[terminal ? "failed" : "retrying"] += 1;
        continue;
      }
      if (verification?.confirmed !== true) {
        await pool.query(
          `UPDATE erp_mpesa_payment_requests SET status = 'failed', processing_stage = NULL, last_error = $3,
             verification_payload = $4::jsonb, updated_at = NOW()
           WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $5`,
          [request.id, request.company_id, String(verification?.message || "Payment was not confirmed").slice(0, 2000),
            JSON.stringify(verification || {}), request.attempt_count],
        );
        summary.failed += 1;
        continue;
      }

      const verifiedPhone = normalizeKenyanPhone(verification.phone);
      const receiptNumber = String(verification.receipt_number || "").trim();
      const verifiedAmount = Math.round(Number(verification.amount) * 100) / 100;
      if (
        !receiptNumber ||
        verifiedPhone !== request.phone_number ||
        Math.abs(verifiedAmount - Number(request.amount)) > 0.01
      ) {
        throw new Error("Verified M-Pesa payment details do not match the invoice request");
      }
      const paymentDate = parseKenyanTransactionDate(verification.transaction_date);
      if (!paymentDate) throw new Error("Verified M-Pesa transaction date is invalid");

      const sales = require("./salesService");
      const receipt = await sales.recordCustomerPayment({
        companyId: request.company_id,
        userId: request.created_by,
        invoiceId: request.invoice_id,
        paymentDate,
        amount: verifiedAmount,
        referenceNo: receiptNumber,
        providerReceiptNo: receiptNumber,
        paymentMethod: "mpesa",
        notes: `M-Pesa STK payment ${receiptNumber}`,
      });
      const saved = await pool.query(
          `UPDATE erp_mpesa_payment_requests SET status = 'confirmed', processing_stage = NULL,
            provider_receipt_no = $3,
           receipt_id = $4, verification_payload = $5::jsonb, last_error = NULL, updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $6
         RETURNING id`,
        [request.id, request.company_id, receiptNumber, receipt.receipt_id || null,
          JSON.stringify(verification), request.attempt_count],
      );
      if (saved.rowCount) summary.confirmed += 1;
    } catch (error) {
      const terminal = request.attempt_count >= attemptsLimit;
      const retryDelaySeconds = terminal ? null : Math.min(60 * (2 ** (request.attempt_count - 1)), 86400);
      await pool.query(
        `UPDATE erp_mpesa_payment_requests SET status = $3, processing_stage = NULL, last_error = $4,
           next_attempt_at = CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE NOW() + ($5::int * INTERVAL '1 second') END,
           updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $6`,
        [request.id, request.company_id, terminal ? "failed" : "callback_received",
          String(error.message || "M-Pesa verification failed").slice(0, 2000), retryDelaySeconds,
          request.attempt_count],
      );
      summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

async function getMpesaPaymentRequest({ companyId, requestId }) {
  const result = await pool.query(
    `SELECT id, invoice_id, idempotency_key, phone_number, amount, account_reference,
            status, merchant_request_id, checkout_request_id, provider_receipt_no,
            receipt_id, attempt_count, next_attempt_at, last_error, created_at, updated_at
     FROM erp_mpesa_payment_requests WHERE id = $1 AND company_id = $2`,
    [requestId, companyId],
  );
  return result.rows[0] || null;
}

async function validateCompanyCallbackToken({ companyId, token }) {
  if (!companyId) return safeTokenEqual(process.env.MPESA_CALLBACK_TOKEN, token);
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa" });
  return Boolean(config.secrets.callbackToken) && safeTokenEqual(config.secrets.callbackToken, token);
}

function parseKenyanTransactionTimestamp(value) {
  const date = parseKenyanTransactionDate(value);
  if (!date) return null;
  const text = String(value);
  const hour = Number(text.slice(8, 10));
  const minute = Number(text.slice(10, 12));
  const second = Number(text.slice(12, 14));
  if (hour > 23 || minute > 59 || second > 59) return null;
  const localMs = Date.parse(`${date}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}Z`);
  return new Date(localMs - 3 * 60 * 60 * 1000);
}

async function receiveMpesaCallback({ companyId = null, token, payload }) {
  if (!(await validateCompanyCallbackToken({ companyId, token }))) {
    const error = new Error("Invalid M-Pesa callback token");
    error.statusCode = 401;
    throw error;
  }
  const callback = payload?.Body?.stkCallback;
  const checkoutRequestId = String(callback?.CheckoutRequestID || "").trim();
  const merchantRequestId = String(callback?.MerchantRequestID || "").trim();
  if (!callback || !checkoutRequestId || !merchantRequestId || !Number.isInteger(Number(callback.ResultCode))) {
    throw new Error("Invalid M-Pesa STK callback schema");
  }

  if (companyId) {
    const existing = await pool.query(
      `SELECT id, status FROM erp_mpesa_payment_requests
       WHERE company_id = $1 AND checkout_request_id = $2`,
      [companyId, checkoutRequestId],
    );
    const request = existing.rows[0];
    if (!request) {
      const error = new Error("No M-Pesa payment request matches this callback");
      error.statusCode = 404;
      throw error;
    }
    if (["confirmed", "failed", "cancelled", "timeout"].includes(request.status)) {
      await logIntegration({ companyId, provider: "mpesa", action: "stk_callback_duplicate", request: payload, response: { status: request.status }, status: "duplicate", correlationId: crypto.randomUUID(), outcome: "duplicate" });
      return { received: true, duplicate: true, request_id: request.id, status: request.status };
    }
  }

  const result = await pool.query(
    `UPDATE erp_mpesa_payment_requests
     SET callback_payload = COALESCE(callback_payload, $3::jsonb),
         status = CASE WHEN status = 'awaiting_callback' THEN 'callback_received' ELSE status END,
         processing_stage = NULL, next_attempt_at = NOW(), updated_at = NOW()
     WHERE checkout_request_id = $1
       AND ($2::uuid IS NULL OR company_id = $2)
       AND status IN ('awaiting_callback','callback_received')
     RETURNING id, company_id, status`,
    [checkoutRequestId, companyId, JSON.stringify(payload)],
  );
  if (!result.rowCount) {
    const error = new Error("No awaiting M-Pesa payment request matches this callback");
    error.statusCode = 404;
    throw error;
  }
  await logIntegration({
    companyId: result.rows[0].company_id,
    provider: "mpesa",
    action: "stk_callback",
    request: payload,
    response: { request_id: result.rows[0].id, status: result.rows[0].status },
    status: "received",
    correlationId: crypto.randomUUID(),
    outcome: "received",
  });
  return { received: true, request_id: result.rows[0].id, status: result.rows[0].status };
}

async function receiveC2bConfirmation({ companyId, token, payload }) {
  if (!(await validateCompanyCallbackToken({ companyId, token }))) {
    const error = new Error("Invalid M-Pesa callback token");
    error.statusCode = 401;
    throw error;
  }
  const transId = String(payload?.TransID || "").trim();
  const shortcode = String(payload?.BusinessShortCode || "").trim();
  const reference = String(payload?.BillRefNumber || "").trim().slice(0, 20);
  const amount = Number(payload?.TransAmount);
  const transTime = parseKenyanTransactionTimestamp(payload?.TransTime);
  if (!transId || transId.length > 32 || !/^\d{5,7}$/.test(shortcode)
    || !reference || !Number.isSafeInteger(amount) || amount <= 0 || !transTime) {
    throw new Error("Invalid M-Pesa C2B confirmation schema");
  }
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa" });
  if (String(config.public_config.shortcode || "") !== shortcode) throw new Error("C2B callback shortcode does not match company settings");

  const invoice = await pool.query(
    `SELECT inv.id, inv.customer_id FROM erp_customer_invoices inv
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE
       AND inv.status IN ('posted','partial','overdue')
       AND GREATEST(inv.total_amount - inv.amount_paid - inv.credited_amount, 0) > 0
     LIMIT 1`,
    [companyId, reference],
  );
  const customer = invoice.rowCount ? null : await pool.query(
    `SELECT id FROM erp_customers
     WHERE company_id = $1 AND customer_code = $2 AND is_deleted = FALSE AND is_active = TRUE
     LIMIT 1`,
    [companyId, reference],
  );
  const customerId = invoice.rows[0]?.customer_id || customer?.rows[0]?.id || null;
  const inserted = await pool.query(
    `INSERT INTO erp_mpesa_transactions (
       company_id, trans_id, trans_time, amount, msisdn_masked, bill_reference,
       shortcode, customer_id, invoice_id, status, callback_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (trans_id) DO NOTHING
     RETURNING id, status`,
    [companyId, transId, transTime, amount, String(payload.MSISDN || "").slice(0, 32) || null,
      reference, shortcode, customerId, invoice.rows[0]?.id || null,
      customerId ? "matched" : "unmatched", JSON.stringify(payload)],
  );
  const transaction = inserted.rows[0] || (await pool.query(
    "SELECT id, status FROM erp_mpesa_transactions WHERE trans_id = $1 AND company_id = $2",
    [transId, companyId],
  )).rows[0];
  if (!transaction) throw new Error("M-Pesa transaction ID is already recorded under another company");
  await logIntegration({
    companyId,
    provider: "mpesa",
    action: "c2b_confirmation",
    request: payload,
    response: { transaction_id: transaction.id, status: transaction.status },
    status: inserted.rowCount ? "received" : "duplicate",
    correlationId: crypto.randomUUID(),
    outcome: inserted.rowCount ? "received" : "duplicate",
  });
  return { received: true, duplicate: !inserted.rowCount, transaction_id: transaction.id, status: transaction.status };
}

module.exports = {
  normalizeKenyanPhone,
  createStkRequest,
  runMpesaInitiationBatch,
  runMpesaCallbackBatch,
  receiveMpesaCallback,
  receiveC2bConfirmation,
  getMpesaPaymentRequest,
  validateCompanyCallbackToken,
};