const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const collections = require("../../src/services/arCollectionService");

test("overdue receivable dunning queues one idempotent customer reminder", async () => {
  const context = await getTestContext();
  const runId = crypto.randomUUID().replace(/-/g, "");
  const customerId = await getCustomerId(context.companyId, `CDUN-${runId.slice(0, 8)}`);
  const email = `dunning-${runId}@example.test`;
  await pool.query(`UPDATE erp_customers SET email=$2 WHERE id=$1 AND company_id=$3`, [customerId, email, context.companyId]);
  const itemId = await getItemId(context.companyId, "TSK-500");
  const dates = (await pool.query(
    `SELECT CURRENT_DATE::text AS as_of,
            (CURRENT_DATE - 10)::text AS invoice_date,
            (CURRENT_DATE - 2)::text AS due_date`,
  )).rows[0];
  const invoice = await sales.createCustomerInvoice({
    companyId: context.companyId,
    userId: context.userId,
    customerId,
    invoiceDate: dates.invoice_date,
    dueDate: dates.due_date,
    lines: [{ item_id: itemId, quantity: 1, unit_price: 250 }],
    permissions: ["sales.price_override"],
  });
  assert.equal(invoice.ok, true);

  const first = await collections.queueDunningReminders({
    companyId: context.companyId,
    userId: context.userId,
    asOfDate: dates.as_of,
  });
  const reminder = first.reminders.find((entry) => entry.invoice_id === invoice.invoice_id);
  assert.ok(reminder);
  assert.equal(reminder.status, "pending");
  assert.equal(reminder.channel, "email");

  const second = await collections.queueDunningReminders({
    companyId: context.companyId,
    userId: context.userId,
    asOfDate: dates.as_of,
  });
  const repeated = second.reminders.find((entry) => entry.invoice_id === invoice.invoice_id);
  assert.equal(repeated.notification_id, reminder.notification_id);
  const count = await pool.query(
    `SELECT COUNT(*)::int AS count FROM erp_notification_outbox
     WHERE company_id=$1 AND idempotency_key=$2`,
    [context.companyId, `dunning:${invoice.invoice_id}:${dates.as_of}`],
  );
  assert.equal(count.rows[0].count, 1);
});