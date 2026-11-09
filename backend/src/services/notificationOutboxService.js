const crypto = require("crypto");
const pool = require("../db");

function normalizeNotification({ channel, destination, subject, body, idempotencyKey }) {
  const normalizedChannel = String(channel || "email").toLowerCase();
  const recipient = String(destination || "").trim();
  const title = String(subject || "").trim().slice(0, 300);
  const message = String(body || "").trim();
  const key = String(idempotencyKey || "").trim();
  if (!["email", "sms"].includes(normalizedChannel)) throw new Error("Notification channel must be email or sms");
  if (!recipient || recipient.length > 320) throw new Error("Enter a valid notification destination");
  if (normalizedChannel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    throw new Error("Enter a valid email address");
  }
  if (normalizedChannel === "sms" && !/^\+[1-9]\d{7,14}$/.test(recipient)) {
    throw new Error("SMS destination must be an international E.164 phone number");
  }
  if (!message || message.length > 10000) throw new Error("Message body must contain 1 to 10,000 characters");
  if (normalizedChannel === "email" && !title) throw new Error("Email subject is required");
  if (!key || key.length > 128) throw new Error("An idempotency key of at most 128 characters is required");
  return { channel: normalizedChannel, destination: recipient, subject: title, body: message, idempotencyKey: key };
}

async function enqueueNotification({ companyId, userId, channel, destination, subject, body, idempotencyKey }) {
  const notification = normalizeNotification({ channel, destination, subject, body, idempotencyKey });
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({
    channel: notification.channel,
    destination: notification.destination,
    subject: notification.subject,
    body: notification.body,
  })).digest("hex");
  const result = await pool.query(
    `INSERT INTO erp_notification_outbox (
       company_id, channel, destination, subject, message_body, payload_hash, idempotency_key, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (company_id, idempotency_key) DO NOTHING
     RETURNING id, channel, status, created_at, payload_hash`,
    [companyId, notification.channel, notification.destination, notification.subject,
      notification.body, payloadHash, notification.idempotencyKey, userId],
  );
  const row = result.rows[0] || (await pool.query(
    `SELECT id, channel, status, created_at, payload_hash
     FROM erp_notification_outbox WHERE company_id = $1 AND idempotency_key = $2`,
    [companyId, notification.idempotencyKey],
  )).rows[0];
  if (!row || row.payload_hash !== payloadHash) {
    throw new Error("Idempotency key was already used for a different notification");
  }
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    queued: ["pending", "retry"].includes(row.status),
    delivered: row.status === "sent",
    configured: Boolean(process.env.NOTIFICATION_ADAPTER_MODULE),
    message: row.status === "sent"
      ? "Notification was delivered by the configured provider."
      : "Notification is queued; it is not delivered until a provider confirms success.",
  };
}

async function claimNotifications({ limit, channel = null, companyId = null, notificationId = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH due AS (
         SELECT id
         FROM erp_notification_outbox
         WHERE ((status IN ('pending','retry') AND next_attempt_at <= NOW())
             OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'))
           AND ($2::text IS NULL OR channel = $2)
           AND ($3::uuid IS NULL OR company_id = $3)
           AND ($4::uuid IS NULL OR id = $4)
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE erp_notification_outbox notification
       SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
       FROM due WHERE notification.id = due.id
       RETURNING notification.*`,
      [limit, channel, companyId, notificationId],
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

async function finishNotification(notification, { status, response = {}, error = null, retryDelaySeconds = null }) {
  const result = await pool.query(
    `UPDATE erp_notification_outbox
     SET status = $3,
         provider_message_id = COALESCE($4, provider_message_id),
         provider_response = $5::jsonb,
         message_body = CASE WHEN $3 = 'sent' THEN '' ELSE message_body END,
         last_error = $6,
         next_attempt_at = CASE WHEN $7::int IS NULL THEN next_attempt_at ELSE NOW() + ($7::int * INTERVAL '1 second') END,
         sent_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE sent_at END,
         updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $8
     RETURNING id`,
    [notification.id, notification.company_id, status, response?.message_id || null,
      JSON.stringify(response || {}), error ? String(error).slice(0, 2000) : null,
      retryDelaySeconds, notification.attempt_count],
  );
  return Boolean(result.rowCount);
}

async function runNotificationOutboxBatch({ adapter, limit = 20, maxAttempts = 6, channel = null, companyId = null, notificationId = null } = {}) {
  if (!adapter || (typeof adapter.sendEmail !== "function" && typeof adapter.sendSms !== "function")) {
    return { configured: false, processed: 0, sent: 0, retrying: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const attemptsLimit = Math.max(1, Number(maxAttempts) || 6);
  const notifications = await claimNotifications({ limit: batchSize, channel, companyId, notificationId });
  const summary = { configured: true, processed: notifications.length, sent: 0, retrying: 0, failed: 0 };

  for (const notification of notifications) {
    try {
      const send = notification.channel === "email" ? adapter.sendEmail : adapter.sendSms;
      if (typeof send !== "function") throw new Error(`No ${notification.channel} provider adapter is configured`);
      const response = await send({
        to: notification.destination,
        subject: notification.subject,
        body: notification.message_body,
        idempotencyKey: notification.idempotency_key,
      });
      if (response?.accepted !== true) {
        if (response?.retryable === true && notification.attempt_count < attemptsLimit) {
          const delay = Math.min(30 * (2 ** (notification.attempt_count - 1)), 3600);
          if (await finishNotification(notification, {
            status: "retry", response, error: response.message || "Provider requested retry", retryDelaySeconds: delay,
          })) summary.retrying += 1;
        } else if (await finishNotification(notification, {
          status: "failed", response, error: response?.message || "Provider did not confirm delivery",
        })) summary.failed += 1;
        continue;
      }
      if (await finishNotification(notification, { status: "sent", response })) summary.sent += 1;
    } catch (error) {
      const terminal = notification.attempt_count >= attemptsLimit;
      const delay = terminal ? null : Math.min(30 * (2 ** (notification.attempt_count - 1)), 3600);
      if (await finishNotification(notification, {
        status: terminal ? "failed" : "retry", error: error.message, retryDelaySeconds: delay,
      })) summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

async function getNotification({ companyId, notificationId }) {
  const result = await pool.query(
    `SELECT id, channel, destination, subject, status, provider_message_id,
            attempt_count, next_attempt_at, last_error, created_at, sent_at
     FROM erp_notification_outbox WHERE id = $1 AND company_id = $2`,
    [notificationId, companyId],
  );
  return result.rows[0] || null;
}

module.exports = { enqueueNotification, runNotificationOutboxBatch, getNotification };
