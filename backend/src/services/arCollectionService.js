const pool = require("../db");
const { logAudit } = require("./auditService");

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

module.exports = { listActivities, createActivity, completeActivity };
