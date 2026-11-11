const crypto = require("crypto");
const pool = require("../db");
const { normalizeKenyanSmsDestination } = require("./notificationProvider");
const integrationSettings = require("./integrationSettingsService");

const TEMPLATE_CODES = new Set(["invoice_issued", "payment_received", "overdue_reminder", "payslip_available"]);

function renderNotificationTemplate(template, variables) {
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    throw new Error("Template variables must be an object");
  }
  const render = (source) => String(source || "").replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => {
    const value = key.split(".").reduce((current, part) => current?.[part], variables);
    if (value === undefined || value === null) throw new Error(`Missing notification template value: ${key}`);
    return String(value);
  });
  const rendered = { subject: render(template.subject_template), body: render(template.message_template) };
  if (/{{\s*[a-zA-Z0-9_.-]+\s*}}/.test(rendered.subject) || /{{\s*[a-zA-Z0-9_.-]+\s*}}/.test(rendered.body)) {
    throw new Error("Notification template contains an unresolved variable");
  }
  return rendered;
}

function normalizeDeliveryCallback(payload) {
  const event = Array.isArray(payload) ? payload[0] : payload;
  const messageId = String(event?.message_id || event?.sg_message_id || event?.messageId || "").trim();
  const rawStatus = String(event?.status || event?.event || "").trim().toLowerCase();
  const status = ["delivered", "delivery"].includes(rawStatus) ? "delivered"
    : ["bounce", "bounced"].includes(rawStatus) ? "bounced"
      : ["failed", "dropped", "undeliverable"].includes(rawStatus) ? "failed" : null;
  if (!messageId || !status) throw new Error("Notification delivery callback requires a message ID and supported status");
  return { messageId, status };
}

function safeTokenEqual(expected, actual) {
  if (!expected || !actual) return false;
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function recordNotificationDelivery({ companyId, provider, token, payload }) {
  if (!new Set(["email", "sms"]).has(provider)) throw new Error("Unsupported notification delivery provider");
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider });
  if (!safeTokenEqual(config.secrets.deliveryCallbackToken, token)) {
    const error = new Error("Invalid notification delivery callback token");
    error.statusCode = 401;
    throw error;
  }
  const event = normalizeDeliveryCallback(payload);
  const result = await pool.query(
    `UPDATE erp_notification_outbox
     SET delivery_status=$4,
         provider_response=COALESCE(provider_response,'{}'::jsonb) || jsonb_build_object(
           'delivery_status',$4,'delivery_event_at',NOW())
     WHERE company_id=$1 AND channel=$2 AND provider_message_id=$3
     RETURNING id,status,delivery_status`,
    [companyId, provider === "email" ? "email" : "sms", event.messageId, event.status],
  );
  if (!result.rowCount) {
    const error = new Error("Notification provider message was not found");
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
}

function normalizeNotification({ channel, destination, subject, body, idempotencyKey }) {
  const normalizedChannel = String(channel || "email").toLowerCase();
  const rawRecipient = String(destination || "").trim();
  const recipient = normalizedChannel === "sms" ? normalizeKenyanSmsDestination(rawRecipient) : rawRecipient.toLowerCase();
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

async function enqueueNotification({ companyId, userId, channel, destination, subject, body, idempotencyKey, templateCode = null }) {
  const notification = normalizeNotification({ channel, destination, subject, body, idempotencyKey });
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({
    channel: notification.channel,
    destination: notification.destination,
    subject: notification.subject,
    body: notification.body,
  })).digest("hex");
  const client = await pool.connect();
  let row;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [companyId, `${notification.channel}:${notification.destination}`]);
    const previous = await client.query(
      `SELECT id,channel,status,created_at,payload_hash FROM erp_notification_outbox
       WHERE company_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [companyId, notification.idempotencyKey],
    );
    if (previous.rowCount) {
      row = previous.rows[0];
      if (row.payload_hash !== payloadHash) throw new Error("Idempotency key was already used for a different notification");
    } else {
      const optedOut = await client.query(
        `SELECT 1 FROM erp_notification_opt_outs
         WHERE company_id=$1 AND channel=$2 AND LOWER(destination)=LOWER($3)`,
        [companyId, notification.channel, notification.destination],
      );
      if (optedOut.rowCount) throw new Error("This recipient has opted out of this notification channel");
      const limit = Math.max(1, Number(notification.channel === "sms"
        ? process.env.NOTIFICATION_SMS_RECIPIENT_LIMIT_PER_HOUR
        : process.env.NOTIFICATION_EMAIL_RECIPIENT_LIMIT_PER_HOUR) || (notification.channel === "sms" ? 5 : 30));
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM erp_notification_outbox
         WHERE company_id=$1 AND channel=$2 AND LOWER(destination)=LOWER($3)
           AND created_at >= NOW() - INTERVAL '1 hour' AND status <> 'failed'`,
        [companyId, notification.channel, notification.destination],
      );
      if (Number(recent.rows[0].count) >= limit) throw new Error("Recipient notification rate limit exceeded");
      const inserted = await client.query(
        `INSERT INTO erp_notification_outbox (
           company_id, channel, destination, subject, message_body, payload_hash, idempotency_key, created_by, template_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,channel,status,created_at,payload_hash`,
        [companyId, notification.channel, notification.destination, notification.subject,
          notification.body, payloadHash, notification.idempotencyKey, userId, templateCode],
      );
      row = inserted.rows[0];
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
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

async function saveNotificationTemplate({ companyId, userId, code, channel, subject, body }) {
  const templateCode = String(code || "").trim();
  const normalizedChannel = String(channel || "").toLowerCase();
  if (!TEMPLATE_CODES.has(templateCode) || !["email", "sms"].includes(normalizedChannel)) {
    throw new Error("Choose a supported notification template code and channel");
  }
  const subjectTemplate = normalizedChannel === "email" ? String(subject || "").trim().slice(0, 300) : null;
  const messageTemplate = String(body || "").trim();
  if (!messageTemplate || messageTemplate.length > 10000 || (normalizedChannel === "email" && !subjectTemplate)) {
    throw new Error("Enter a message and an email subject when using email");
  }
  const result = await pool.query(
    `INSERT INTO erp_notification_templates (company_id,template_code,channel,subject_template,message_template,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (company_id,template_code,channel) DO UPDATE
       SET subject_template=EXCLUDED.subject_template,message_template=EXCLUDED.message_template,
           is_active=TRUE,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     RETURNING id,template_code,channel,subject_template,message_template,is_active,updated_at`,
    [companyId, templateCode, normalizedChannel, subjectTemplate, messageTemplate, userId],
  );
  return result.rows[0];
}

async function listNotificationTemplates({ companyId }) {
  const result = await pool.query(
    `SELECT id,template_code,channel,subject_template,message_template,is_active,updated_at
     FROM erp_notification_templates WHERE company_id=$1 ORDER BY template_code,channel`,
    [companyId],
  );
  return result.rows;
}

async function enqueueTemplatedNotification({ companyId, userId, code, destination, variables, idempotencyKey }) {
  const result = await pool.query(
    `SELECT template_code,channel,subject_template,message_template
     FROM erp_notification_templates WHERE company_id=$1 AND template_code=$2 AND is_active=TRUE`,
    [companyId, code],
  );
  const template = result.rows[0];
  if (!template) throw new Error("Active company notification template not found");
  const rendered = renderNotificationTemplate(template, variables);
  return enqueueNotification({ companyId, userId, channel: template.channel, destination,
    subject: rendered.subject, body: rendered.body, idempotencyKey, templateCode: template.template_code });
}

async function addNotificationOptOut({ companyId, userId, channel, destination, reason = null }) {
  const normalizedChannel = String(channel || "").toLowerCase();
  if (!new Set(["email", "sms"]).has(normalizedChannel)) throw new Error("Channel must be email or sms");
  const recipient = normalizedChannel === "sms" ? normalizeKenyanSmsDestination(destination) : String(destination || "").trim().toLowerCase();
  if (normalizedChannel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("Enter a valid email address");
  const result = await pool.query(
    `INSERT INTO erp_notification_opt_outs (company_id,channel,destination,reason,created_by)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id,channel,destination) DO NOTHING
     RETURNING id,channel,destination,created_at`,
    [companyId, normalizedChannel, recipient, String(reason || "").trim().slice(0, 500) || null, userId],
  );
  return result.rows[0] || { channel: normalizedChannel, destination: recipient, already_opted_out: true };
}

async function removeNotificationOptOut({ companyId, channel, destination }) {
  const normalizedChannel = String(channel || "").toLowerCase();
  const recipient = normalizedChannel === "sms" ? normalizeKenyanSmsDestination(destination) : String(destination || "").trim().toLowerCase();
  const result = await pool.query(
    `DELETE FROM erp_notification_opt_outs WHERE company_id=$1 AND channel=$2 AND LOWER(destination)=LOWER($3)
     RETURNING id`,
    [companyId, normalizedChannel, recipient],
  );
  return { removed: Boolean(result.rowCount) };
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
        companyId: notification.company_id,
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
    `SELECT id, channel, destination, subject, status, delivery_status, provider_message_id,
            attempt_count, next_attempt_at, last_error, created_at, sent_at
     FROM erp_notification_outbox WHERE id = $1 AND company_id = $2`,
    [notificationId, companyId],
  );
  return result.rows[0] || null;
}

module.exports = {
  addNotificationOptOut,
  enqueueNotification,
  enqueueTemplatedNotification,
  getNotification,
  listNotificationTemplates,
  normalizeNotification,
  normalizeDeliveryCallback,
  recordNotificationDelivery,
  renderNotificationTemplate,
  removeNotificationOptOut,
  runNotificationOutboxBatch,
  saveNotificationTemplate,
};
