const pool = require("../db");

function maskPhone(value) {
  const text = String(value);
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return "[REDACTED]";
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(3, digits.length - 7))}${digits.slice(-4)}`;
}

function redactIntegrationPayload(value, key = "") {
  if (/secret|pass(key|word)|credential|token|cmcKey|key$|^(tin|kraPin|taxpayerPin)$/i.test(key)) return "[REDACTED]";
  if (/phone|msisdn/i.test(key) && value != null) return maskPhone(value);
  if (Array.isArray(value)) return value.map((entry) => redactIntegrationPayload(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    redactIntegrationPayload(childValue, childKey),
  ]));
}

async function logIntegrationInTransaction(client, { companyId, provider, action, request, response, status, durationMs, correlationId, outcome }) {
  const result = await client.query(
    `INSERT INTO erp_integration_logs (
       company_id, provider, action, request_payload, response_payload, status,
       duration_ms, correlation_id, outcome
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [companyId, provider, action, JSON.stringify(redactIntegrationPayload(request || {})),
      JSON.stringify(redactIntegrationPayload(response || {})), status, durationMs ?? null,
      correlationId || null, outcome || status],
  );
  return result.rows[0].id;
}

async function logIntegration({ companyId, provider, action, request, response, status, durationMs, correlationId, outcome }) {
  const result = await pool.query(
    `INSERT INTO erp_integration_logs (
       company_id, provider, action, request_payload, response_payload, status,
       duration_ms, correlation_id, outcome
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [companyId, provider, action, JSON.stringify(redactIntegrationPayload(request || {})),
      JSON.stringify(redactIntegrationPayload(response || {})), status, durationMs ?? null,
      correlationId || null, outcome || status],
  );
  return result.rows[0].id;
}

async function buildEtimsPayload(client, companyId, invoiceId) {
  const invoiceResult = await client.query(
    `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.due_date, inv.currency_code,
            inv.subtotal, inv.tax_amount, inv.total_amount, inv.status,
            customer.name AS customer_name, customer.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers customer ON customer.id = inv.customer_id AND customer.company_id = inv.company_id
     WHERE inv.id = $1 AND inv.company_id = $2 AND inv.is_deleted = FALSE
       AND inv.status IN ('posted','partial','paid','overdue','credited')`,
    [invoiceId, companyId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new Error("Only a posted customer invoice can be queued for eTIMS");

  const linesResult = await client.query(
    `SELECT item.item_code, item.name AS description, line.quantity, line.unit_price,
            line.line_total, line.tax_code, line.tax_treatment, line.tax_rate, line.tax_amount
     FROM erp_customer_invoice_lines line
     JOIN erp_items item ON item.id = line.item_id AND item.company_id = line.company_id
     WHERE line.invoice_id = $1 AND line.company_id = $2 AND line.is_deleted = FALSE
     ORDER BY line.line_no`,
    [invoiceId, companyId],
  );
  if (!linesResult.rowCount) throw new Error("Invoice has no lines to submit to eTIMS");

  return {
    invoice_no: invoice.invoice_no,
    invoice_date: String(invoice.invoice_date).slice(0, 10),
    due_date: invoice.due_date ? String(invoice.due_date).slice(0, 10) : null,
    currency_code: invoice.currency_code,
    customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id,
    subtotal: Number(invoice.subtotal),
    tax_amount: Number(invoice.tax_amount),
    total_amount: Number(invoice.total_amount),
    lines: linesResult.rows.map((line) => ({
      item_code: line.item_code,
      description: line.description,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      line_total: Number(line.line_total),
      tax_code: line.tax_code,
      tax_treatment: line.tax_treatment,
      tax_rate: Number(line.tax_rate),
      tax_amount: Number(line.tax_amount),
    })),
  };
}

async function enqueueEtimsInvoiceInTransaction(client, { companyId, userId, invoiceId }) {
  if (!invoiceId) throw new Error("invoice_id is required");
  const payload = await buildEtimsPayload(client, companyId, invoiceId);
  const idempotencyKey = `etims:${companyId}:${invoiceId}`;
  const inserted = await client.query(
    `INSERT INTO erp_etims_submissions (
       company_id, invoice_id, idempotency_key, status, payload, created_by
     ) VALUES ($1,$2,$3,'pending',$4::jsonb,$5)
     ON CONFLICT (company_id, invoice_id) DO NOTHING
     RETURNING *`,
    [companyId, invoiceId, idempotencyKey, JSON.stringify(payload), userId],
  );

  let submission = inserted.rows[0] || (await client.query(
    `SELECT * FROM erp_etims_submissions WHERE company_id = $1 AND invoice_id = $2 FOR UPDATE`,
    [companyId, invoiceId],
  )).rows[0];
  if (!submission) throw new Error("Unable to create or load eTIMS submission");

  if (["retry", "failed"].includes(submission.status)) {
    const requeued = await client.query(
      `UPDATE erp_etims_submissions
       SET status = 'pending', next_attempt_at = NOW(), last_error = NULL,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
        [submission.id, companyId],
    );
    submission = requeued.rows[0];
  }

  const invoiceStatus = submission.status === "accepted"
    ? "accepted"
    : submission.status === "rejected"
      ? "rejected"
      : submission.status === "failed"
        ? "failed"
        : submission.status === "processing"
          ? "processing"
          : "pending";
  await client.query(
    `UPDATE erp_customer_invoices
     SET etims_status = $3, etims_updated_at = NOW(),
         etims_ref = COALESCE($4, etims_ref), updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId, invoiceStatus, submission.provider_reference || null],
  );

  return {
    ok: true,
    queued: ["pending", "retry"].includes(submission.status),
    configured: submission.status === "accepted",
    message: submission.status === "accepted"
      ? "KRA eTIMS acceptance is already recorded for this invoice."
      : submission.status === "rejected"
        ? "KRA eTIMS rejected this invoice; review the provider response and issue a corrected document if required."
        : submission.status === "processing"
          ? "An eTIMS provider submission is already in progress."
          : "Invoice submission is queued. It is not KRA-accepted until a certified eTIMS provider confirms acceptance.",
    submission_id: submission.id,
    invoice_id: invoiceId,
    status: submission.status,
    idempotency_key: submission.idempotency_key,
  };
}

async function queueEtimsInvoice({ companyId, userId, invoiceId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await enqueueEtimsInvoiceInTransaction(client, { companyId, userId, invoiceId });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getEtimsSubmission({ companyId, invoiceId }) {
  const result = await pool.query(
    `SELECT submission.id, submission.invoice_id, submission.status, submission.provider_reference,
            submission.qr_code, submission.attempt_count, submission.next_attempt_at,
            submission.last_error, submission.queued_at, submission.submitted_at, submission.accepted_at,
            inv.invoice_no, inv.etims_status, inv.etims_ref
     FROM erp_etims_submissions submission
     JOIN erp_customer_invoices inv ON inv.id = submission.invoice_id AND inv.company_id = submission.company_id
     WHERE submission.company_id = $1 AND submission.invoice_id = $2`,
    [companyId, invoiceId],
  );
  return result.rows[0] || null;
}

async function updateEtimsAttempt({ submission, status, response, providerReference, qrCode, errorMessage, retryDelaySeconds }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE erp_etims_submissions
       SET status = $3,
           response_payload = $4::jsonb,
           provider_reference = COALESCE($5, provider_reference),
           qr_code = COALESCE($6, qr_code),
           last_error = $7,
           next_attempt_at = CASE WHEN $8::int IS NULL THEN next_attempt_at ELSE NOW() + ($8::int * INTERVAL '1 second') END,
           submitted_at = CASE WHEN $3 IN ('accepted','rejected') THEN NOW() ELSE submitted_at END,
           accepted_at = CASE WHEN $3 = 'accepted' THEN NOW() ELSE accepted_at END,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $9
       RETURNING id, invoice_id, status, provider_reference`,
      [submission.id, submission.company_id, status, JSON.stringify(response || {}),
        providerReference || null, qrCode || null, errorMessage || null,
        retryDelaySeconds ?? null, submission.attempt_count],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    const invoiceStatus = status === "accepted"
      ? "accepted"
      : status === "rejected"
        ? "rejected"
        : status === "failed"
          ? "failed"
          : "pending";
    await client.query(
      `UPDATE erp_customer_invoices
       SET etims_status = $3, etims_ref = COALESCE($4, etims_ref),
           etims_cu_invoice_no = COALESCE($5, etims_cu_invoice_no),
           etims_receipt_signature = COALESCE($6, etims_receipt_signature),
           etims_internal_data = COALESCE($7, etims_internal_data),
           etims_cu_id = COALESCE($8, etims_cu_id),
           etims_receipt_counter = COALESCE($9, etims_receipt_counter),
           etims_cu_timestamp = CASE WHEN $10::text ~ '^\\d{14}$'
             THEN (to_timestamp($10, 'YYYYMMDDHH24MISS') AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Nairobi'
             ELSE etims_cu_timestamp END,
           etims_verification_data = COALESCE($11, etims_verification_data),
           etims_response_payload = CASE WHEN $12::jsonb IS NULL THEN etims_response_payload ELSE $12::jsonb END,
           etims_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [submission.invoice_id, submission.company_id, invoiceStatus, providerReference || null,
        response?.provider_reference || null, response?.receipt_signature || null,
        response?.internal_data || null, response?.cu_id || null,
        response?.receipt_counter == null ? null : String(response.receipt_counter),
        response?.cu_timestamp || null, response?.qr_code || null,
        response ? JSON.stringify(redactIntegrationPayload(response)) : null],
    );
    await client.query(
      `INSERT INTO erp_integration_logs
       (company_id, provider, action, request_payload, response_payload, status, correlation_id, outcome)
       VALUES ($1,'etims','submit_invoice',$2::jsonb,$3::jsonb,$4,$5,$4)`,
      [submission.company_id,
        JSON.stringify({ invoice_id: submission.invoice_id, idempotency_key: submission.idempotency_key }),
        JSON.stringify(redactIntegrationPayload(response || (errorMessage ? { error: errorMessage } : {}))),
        status, submission.correlation_id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimEtimsSubmissions(limit, { companyId = null, invoiceId = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH due AS (
         SELECT id
         FROM erp_etims_submissions
        WHERE ((status IN ('pending','retry') AND next_attempt_at <= NOW())
          OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'))
        AND ($2::uuid IS NULL OR company_id = $2)
        AND ($3::uuid IS NULL OR invoice_id = $3)
         ORDER BY next_attempt_at, queued_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE erp_etims_submissions submission
       SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
       FROM due
       WHERE submission.id = due.id
       RETURNING submission.*`,
      [limit, companyId, invoiceId],
    );
    for (const submission of claimed.rows) {
      await client.query(
        `UPDATE erp_customer_invoices SET etims_status = 'processing', etims_updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [submission.invoice_id, submission.company_id],
      );
    }
    await client.query("COMMIT");
    return claimed.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runEtimsOutboxBatch({ adapter, limit = 20, maxAttempts = 8, companyId = null, invoiceId = null } = {}) {
  if (!adapter || typeof adapter.submitInvoice !== "function") {
    return { configured: false, processed: 0, accepted: 0, rejected: 0, retrying: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const attemptsLimit = Math.max(1, Number(maxAttempts) || 8);
  const submissions = await claimEtimsSubmissions(batchSize, { companyId, invoiceId });
  const summary = { configured: true, processed: submissions.length, accepted: 0, rejected: 0, retrying: 0, failed: 0 };

  for (const submission of submissions) {
    try {
      const response = await adapter.submitInvoice({
        payload: submission.payload,
        idempotencyKey: submission.idempotency_key,
      });
      if (response?.accepted === true) {
        const providerReference = String(response.provider_reference || response.reference || "").trim();
        if (!providerReference) throw new Error("Provider reported acceptance without a KRA reference");
        const saved = await updateEtimsAttempt({
          submission,
          status: "accepted",
          response,
          providerReference,
          qrCode: response.qr_code,
        });
        if (saved) summary.accepted += 1;
      } else if (response?.retryable === true) {
        const terminal = submission.attempt_count >= attemptsLimit;
        const retryDelaySeconds = terminal
          ? null
          : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400);
        const saved = await updateEtimsAttempt({
          submission,
          status: terminal ? "failed" : "retry",
          response,
          errorMessage: response.message || "Provider requested retry",
          retryDelaySeconds,
        });
        if (saved) summary[terminal ? "failed" : "retrying"] += 1;
      } else {
        const saved = await updateEtimsAttempt({
          submission,
          status: "rejected",
          response,
          errorMessage: response?.message || "Provider rejected invoice",
        });
        if (saved) summary.rejected += 1;
      }
    } catch (error) {
      const terminal = submission.attempt_count >= attemptsLimit;
      const retryDelaySeconds = terminal
        ? null
        : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400);
      const saved = await updateEtimsAttempt({
        submission,
        status: terminal ? "failed" : "retry",
        errorMessage: String(error.message || "eTIMS provider request failed").slice(0, 2000),
        retryDelaySeconds,
      });
      if (saved) summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

module.exports = {
  logIntegration,
  logIntegrationInTransaction,
  redactIntegrationPayload,
  enqueueEtimsInvoiceInTransaction,
  queueEtimsInvoice,
  getEtimsSubmission,
  runEtimsOutboxBatch,
};
