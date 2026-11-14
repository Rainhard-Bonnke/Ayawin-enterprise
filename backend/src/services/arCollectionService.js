const pool = require("../db");
const { logAudit } = require("./auditService");
const notifications = require("./notificationOutboxService");
const { normalizeKenyanSmsDestination } = require("./notificationProvider");

const activityTypes = new Set(["call", "email", "visit", "promise_to_pay", "dispute", "other"]);
const validDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));

async function listActivities(companyId, status = "open") {
  const params = [companyId];
  const statusFilter = ["open", "completed"].includes(status) ? ` AND a.status = $${params.push(status)}` : "";
  const result = await pool.query(
    `SELECT a.*, inv.invoice_no, inv.due_date, inv.total_amount, inv.amount_paid,
            c.name AS customer_name, creator.full_name AS created_by_name,
            completer.full_name AS completed_by_name,
            GREATEST(inv.total_amount - inv.amount_paid - inv.credited_amount, 0) AS current_outstanding
     FROM erp_ar_collection_activities a
     JOIN erp_customer_invoices inv ON inv.id = a.invoice_id AND inv.company_id = a.company_id
     JOIN erp_customers c ON c.id = a.customer_id AND c.company_id = a.company_id
     LEFT JOIN erp_users creator ON creator.id = a.created_by
     LEFT JOIN erp_users completer ON completer.id = a.completed_by
     WHERE a.company_id = $1${statusFilter}
     ORDER BY a.next_action_date NULLS LAST, a.created_at DESC LIMIT 500`, params,
  );
  return result.rows;
}

async function createActivity({ companyId, user, invoiceId, activityType, summary, nextActionDate, promisedDate, promisedAmount }) {
  const type = String(activityType || "");
  const note = String(summary || "").trim().slice(0, 2000);
  const nextDate = nextActionDate || null;
  const promiseDate = promisedDate || null;
  const promiseValue = promisedAmount === undefined || promisedAmount === null || promisedAmount === "" ? null : Number(promisedAmount);
  if (!invoiceId || !activityTypes.has(type) || !note) throw new Error("Select an activity type and enter a follow-up note");
  if (!validDate(nextDate) || !validDate(promiseDate)) throw new Error("Enter valid follow-up and promise dates");
  if (type === "promise_to_pay" && (!promiseDate || !Number.isFinite(promiseValue) || promiseValue <= 0)) {
    throw new Error("A payment promise needs a date and positive amount");
  }
  if (promiseValue !== null && (!Number.isFinite(promiseValue) || promiseValue <= 0)) throw new Error("Promised amount must be positive");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoiceResult = await client.query(
      `SELECT id, customer_id, total_amount, amount_paid, status FROM erp_customer_invoices
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`, [invoiceId, companyId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || !["posted", "partial", "overdue"].includes(invoice.status)) throw new Error("Select an open posted invoice");
    const outstanding = Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid) - Number(invoice.credited_amount));
    if (promiseValue !== null && promiseValue > outstanding + 0.005) throw new Error("Promised amount exceeds the current invoice balance");
    const created = await client.query(
      `INSERT INTO erp_ar_collection_activities
       (company_id, invoice_id, customer_id, activity_type, summary, next_action_date, promised_date, promised_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [companyId, invoice.id, invoice.customer_id, type, note, nextDate, promiseDate, promiseValue, user.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_ar_collection_activities", entityId: created.rows[0].id,
      action: "ar_collection_activity_created", newValues: { invoice_id: invoice.id, activity_type: type, next_action_date: nextDate, promised_date: promiseDate, promised_amount: promiseValue } });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function completeActivity({ companyId, user, activityId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activity = await client.query(
      `UPDATE erp_ar_collection_activities SET status = 'completed', completed_at = NOW(), completed_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'open' RETURNING *`, [activityId, companyId, user.id],
    );
    if (!activity.rowCount) throw new Error("Open collection follow-up not found");
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_ar_collection_activities", entityId: activityId,
      action: "ar_collection_activity_completed", oldValues: { status: "open" }, newValues: { status: "completed" } });
    await client.query("COMMIT");
    return activity.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function queueDunningReminders({ companyId, userId, asOfDate = new Date().toISOString().slice(0, 10) }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || ""))
      || Number.isNaN(Date.parse(`${asOfDate}T00:00:00.000Z`))
      || new Date(`${asOfDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== asOfDate) {
    throw new Error("Provide a valid dunning as-of date");
  }
  const overdue = await pool.query(
    `SELECT invoice.id, invoice.invoice_no, invoice.due_date, invoice.currency_code,
            GREATEST(invoice.total_amount - invoice.amount_paid - invoice.credited_amount, 0) AS outstanding,
            customer.name AS customer_name, customer.email, customer.phone
     FROM erp_customer_invoices invoice
     JOIN erp_customers customer ON customer.id = invoice.customer_id AND customer.company_id = invoice.company_id
     WHERE invoice.company_id = $1 AND invoice.is_deleted = FALSE
       AND invoice.status IN ('posted','partial','overdue')
       AND invoice.due_date < $2::date
       AND invoice.total_amount > invoice.amount_paid + invoice.credited_amount
     ORDER BY invoice.due_date, invoice.invoice_no LIMIT 500`,
    [companyId, asOfDate],
  );
  const reminders = [];
  for (const invoice of overdue.rows) {
    let channel;
    let destination;
    try {
      if (invoice.email) {
        channel = "email";
        destination = String(invoice.email).trim().toLowerCase();
      } else if (invoice.phone) {
        channel = "sms";
        destination = normalizeKenyanSmsDestination(invoice.phone);
      } else {
        reminders.push({ invoice_id: invoice.id, invoice_no: invoice.invoice_no, status: "skipped", reason: "no_customer_contact" });
        continue;
      }
      const outstanding = Number(invoice.outstanding).toFixed(2);
      const body = `Dear ${invoice.customer_name}, invoice ${invoice.invoice_no} is overdue. Outstanding balance: ${invoice.currency_code} ${outstanding}. Please arrange payment or contact our accounts team.`;
      const queued = await notifications.enqueueNotification({
        companyId,
        userId,
        channel,
        destination,
        subject: channel === "email" ? `Payment reminder: ${invoice.invoice_no}` : "",
        body,
        idempotencyKey: `dunning:${invoice.id}:${asOfDate}`,
      });
      reminders.push({
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        channel,
        status: queued.status,
        notification_id: queued.id,
        queued: queued.queued,
        delivered: queued.delivered,
      });
    } catch (error) {
      reminders.push({ invoice_id: invoice.id, invoice_no: invoice.invoice_no, status: "failed", reason: error.message });
    }
  }
  return {
    as_of: asOfDate,
    eligible_count: overdue.rowCount,
    queued_count: reminders.filter((reminder) => reminder.queued).length,
    skipped_count: reminders.filter((reminder) => reminder.status === "skipped").length,
    failed_count: reminders.filter((reminder) => reminder.status === "failed").length,
    reminders,
  };
}

module.exports = { listActivities, createActivity, completeActivity, queueDunningReminders };
