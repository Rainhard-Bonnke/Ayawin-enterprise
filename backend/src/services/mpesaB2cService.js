const pool = require("../db");
const { assertDifferentUser, logAudit } = require("./auditService");
const { normalizeKenyanPhone, validateCompanyCallbackToken } = require("./mpesaService");
const { getMpesaProvider } = require("./mpesaProvider");
const integrationSettings = require("./integrationSettingsService");

async function prepareB2cRefund({ companyId, userId, creditNoteId, phone, idempotencyKey }) {
  const key = String(idempotencyKey || "").trim();
  if (!key || key.length > 128) throw new Error("A stable B2C idempotency key is required");
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa" });
  if (config.policy?.b2c_enabled !== true) throw new Error("M-Pesa B2C refunds are disabled by company policy");
  const dailyLimit = Number(config.policy.b2c_daily_limit);
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) throw new Error("Configure a positive company B2C daily limit before enabling refunds");
  const recipientPhone = normalizeKenyanPhone(phone);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [companyId, `mpesa-b2c:${key}`]);
    const existing = await client.query(
      `SELECT * FROM erp_mpesa_b2c_refund_requests WHERE company_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [companyId, key],
    );
    if (existing.rowCount) {
      if (existing.rows[0].credit_note_id !== creditNoteId || existing.rows[0].recipient_phone !== recipientPhone) {
        throw new Error("B2C idempotency key was already used for a different refund");
      }
      await client.query("COMMIT");
      return { ...existing.rows[0], idempotent: true };
    }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('mpesa-b2c-daily-limit'))", [companyId]);
    const noteResult = await client.query(
      `SELECT note.id,note.customer_id,note.refund_amount,note.refund_journal_id,
              customer.phone,account.id AS refund_account_id
       FROM erp_customer_credit_notes note
       JOIN erp_customers customer ON customer.id=note.customer_id AND customer.company_id=note.company_id
       LEFT JOIN erp_chart_of_accounts account ON account.id=note.refund_bank_account_id AND account.company_id=note.company_id
       WHERE note.id=$1 AND note.company_id=$2 AND note.status='posted' FOR UPDATE OF note`,
      [creditNoteId, companyId],
    );
    const note = noteResult.rows[0];
    if (!note || !note.refund_journal_id || Number(note.refund_amount) <= 0) {
      throw new Error("B2C refund must link to a posted customer credit note with a cash refund journal");
    }
    if (note.refund_account_id !== config.policy.mpesa_clearing_account_id) {
      throw new Error("Credit-note refund account must be the configured M-Pesa clearing account");
    }
    if (!note.phone || normalizeKenyanPhone(note.phone) !== recipientPhone) {
      throw new Error("B2C recipient must match the customer's registered mobile number");
    }
    const amount = Number(note.refund_amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("M-Pesa B2C requires a positive whole-KES credit-note refund");
    const daily = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS amount FROM erp_mpesa_b2c_refund_requests
       WHERE company_id=$1 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'
         AND status IN ('prepared','processing','submitted','confirmed')`, [companyId],
    );
    if (Number(daily.rows[0].amount) + amount > dailyLimit) throw new Error("Company M-Pesa B2C daily limit would be exceeded");
    const inserted = await client.query(
      `INSERT INTO erp_mpesa_b2c_refund_requests
         (company_id,credit_note_id,customer_id,idempotency_key,recipient_phone,amount,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'prepared',$7) RETURNING *`,
      [companyId, creditNoteId, note.customer_id, key, recipientPhone, amount, userId],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_mpesa_b2c_refund_requests", entityId: inserted.rows[0].id,
      action: "mpesa_b2c_refund_prepared", newValues: { credit_note_id: creditNoteId, amount, recipient_phone: recipientPhone } });
    await client.query("COMMIT");
    return { ...inserted.rows[0], idempotent: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function approveAndReleaseB2cRefund({ companyId, userId, requestId, adapter = null }) {
  const client = await pool.connect();
  let request;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('mpesa-b2c-daily-limit'))", [companyId]);
    const result = await client.query(
      `SELECT request.*,customer.phone AS current_phone
       FROM erp_mpesa_b2c_refund_requests request
       JOIN erp_customers customer ON customer.id=request.customer_id AND customer.company_id=request.company_id
       WHERE request.id=$1 AND request.company_id=$2 AND request.status='prepared' FOR UPDATE OF request`,
      [requestId, companyId],
    );
    request = result.rows[0];
    if (!request) throw new Error("Prepared M-Pesa B2C refund not found");
    assertDifferentUser(request.created_by, userId);
    if (normalizeKenyanPhone(request.current_phone) !== request.recipient_phone) throw new Error("Customer mobile number changed; prepare the refund again");
    const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa" });
    if (config.policy?.b2c_enabled !== true) throw new Error("M-Pesa B2C refunds are disabled by company policy");
    const dailyLimit = Number(config.policy.b2c_daily_limit);
    const daily = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS amount FROM erp_mpesa_b2c_refund_requests
       WHERE company_id=$1 AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi'
            AND id<>$2 AND status IN ('prepared','processing','submitted','confirmed')`, [companyId, request.id],
    );
    if (!Number.isFinite(dailyLimit) || Number(daily.rows[0].amount) + Number(request.amount) > dailyLimit) {
      throw new Error("Company M-Pesa B2C daily limit would be exceeded");
    }
          const claimed = await client.query(
         `UPDATE erp_mpesa_b2c_refund_requests SET status='processing',approved_by=$3,approved_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND company_id=$2 AND status='prepared' RETURNING *`,
         [request.id, companyId, userId],
          );
          if (!claimed.rowCount) throw new Error("B2C refund is already being approved or has changed state");
          request = claimed.rows[0];
          await logAudit({ client, companyId, userId, entityType: "erp_mpesa_b2c_refund_requests", entityId: request.id,
            action: "mpesa_b2c_refund_approved", newValues: { credit_note_id: request.credit_note_id,
              amount: Number(request.amount), recipient_phone: request.recipient_phone } });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }

  const provider = adapter || await getMpesaProvider({ companyId });
  if (typeof provider.sendB2c !== "function" || typeof provider.buildCallbackUrl !== "function") {
    throw new Error("Configured M-Pesa provider does not support approved B2C refunds");
  }
  let result;
  try {
    result = await provider.sendB2c({
      phone: request.recipient_phone,
      amount: Number(request.amount),
      idempotencyKey: request.idempotency_key,
      callbackUrl: provider.buildCallbackUrl("b2c/result"),
      timeoutUrl: provider.buildCallbackUrl("b2c/timeout"),
    });
    if (result?.accepted !== true) throw new Error("Daraja did not accept the approved B2C refund request");
  } catch (error) {
    await pool.query(
      `UPDATE erp_mpesa_b2c_refund_requests SET status='failed',last_error=$3,completed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2 AND status='processing'`,
      [request.id, companyId, String(error.message || "B2C provider submission failed").slice(0, 2000)],
    );
    throw error;
  }
  const saved = await pool.query(
    `UPDATE erp_mpesa_b2c_refund_requests SET status='submitted',
       submitted_at=NOW(),originator_conversation_id=$3,conversation_id=$4,provider_response=$5::jsonb,updated_at=NOW()
     WHERE id=$1 AND company_id=$2 AND status='processing' RETURNING id,status,originator_conversation_id,conversation_id`,
    [request.id, companyId, result.originator_conversation_id, result.conversation_id, JSON.stringify(result.provider_response || result)],
  );
  if (!saved.rowCount) throw new Error("B2C refund changed state while the provider request was in flight");
  return saved.rows[0];
}

async function receiveB2cResult({ companyId, token, payload }) {
  if (!(await validateCompanyCallbackToken({ companyId, token }))) {
    const error = new Error("Invalid M-Pesa callback token"); error.statusCode = 401; throw error;
  }
  const result = payload?.Result || {};
  const originatorId = String(result.OriginatorConversationID || "").trim();
  const resultCode = Number(result.ResultCode);
  if (!originatorId || !Number.isInteger(resultCode)) throw new Error("Invalid M-Pesa B2C result callback schema");
  const transactionId = String(result.TransactionID || "").trim() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      `SELECT * FROM erp_mpesa_b2c_refund_requests
       WHERE company_id=$1 AND originator_conversation_id=$2 FOR UPDATE`, [companyId, originatorId],
    );
    const request = row.rows[0];
    if (!request) throw new Error("No B2C refund matches this Safaricom callback");
    if (request.status === "confirmed" || request.status === "failed") {
      await client.query("COMMIT");
      return { duplicate: true, status: request.status };
    }
    const status = resultCode === 0 && transactionId ? "confirmed" : "failed";
    await client.query(
      `UPDATE erp_mpesa_b2c_refund_requests SET status=$3,provider_transaction_id=$4,
         provider_response=$5::jsonb,last_error=$6,completed_at=NOW(),updated_at=NOW()
       WHERE id=$1 AND company_id=$2`,
      [request.id, companyId, status, transactionId, JSON.stringify(payload), status === "failed" ? String(result.ResultDesc || "B2C payment failed") : null],
    );
    await logAudit({ client, companyId, userId: request.approved_by || request.created_by,
      entityType: "erp_mpesa_b2c_refund_requests", entityId: request.id,
      action: status === "confirmed" ? "mpesa_b2c_refund_confirmed" : "mpesa_b2c_refund_failed",
      newValues: { status, provider_transaction_id: transactionId, result_code: resultCode } });
    await client.query("COMMIT");
    return { duplicate: false, status, transaction_id: transactionId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function listB2cRefundRequests({ companyId, limit = 100 }) {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const result = await pool.query(
    `SELECT request.id,request.credit_note_id,note.credit_note_no,customer.name AS customer_name,
            request.recipient_phone,request.amount,request.status,request.originator_conversation_id,
            request.conversation_id,request.provider_transaction_id,request.last_error,
            request.created_by,request.approved_by,request.approved_at,request.submitted_at,request.completed_at,
            request.created_at
     FROM erp_mpesa_b2c_refund_requests request
     JOIN erp_customer_credit_notes note ON note.id=request.credit_note_id AND note.company_id=request.company_id
     JOIN erp_customers customer ON customer.id=request.customer_id AND customer.company_id=request.company_id
     WHERE request.company_id=$1 ORDER BY request.created_at DESC LIMIT $2`,
    [companyId, boundedLimit],
  );
  return result.rows;
}

module.exports = { approveAndReleaseB2cRefund, listB2cRefundRequests, prepareB2cRefund, receiveB2cResult };
