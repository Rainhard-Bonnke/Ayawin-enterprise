const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const outbox = require("../../src/services/notificationOutboxService");

test("E2E notification outbox: unconfigured stays queued; provider success is idempotent and redacts body", async () => {
  const ctx = await getTestContext();
  const suffix = Date.now();
  const idempotencyKey = `e2e-email-${suffix}`;
  let notificationId;

  try {
    const queued = await outbox.enqueueNotification({
      companyId: ctx.companyId,
      userId: ctx.userId,
      channel: "email",
      destination: `ops-${suffix}@example.test`,
      subject: `Invoice notice ${suffix}`,
      body: "Sensitive invoice delivery message",
      idempotencyKey,
    });
    notificationId = queued.id;
    assert.equal(queued.status, "pending");

    const noAdapter = await outbox.runNotificationOutboxBatch({
      companyId: ctx.companyId,
      notificationId,
    });
    assert.equal(noAdapter.configured, false);
    assert.equal(noAdapter.processed, 0);

    const delivered = await outbox.runNotificationOutboxBatch({
      companyId: ctx.companyId,
      notificationId,
      adapter: {
        async sendEmail({ to, subject, body, idempotencyKey: providerKey }) {
          assert.equal(to, `ops-${suffix}@example.test`);
          assert.equal(subject, `Invoice notice ${suffix}`);
          assert.equal(body, "Sensitive invoice delivery message");
          assert.equal(providerKey, idempotencyKey);
          return { accepted: true, message_id: `provider-${suffix}` };
        },
      },
    });
    assert.equal(delivered.sent, 1);

    const status = await outbox.getNotification({ companyId: ctx.companyId, notificationId });
    assert.equal(status.status, "sent");
    assert.equal(status.provider_message_id, `provider-${suffix}`);

    const redacted = await pool.query(
      "SELECT message_body FROM erp_notification_outbox WHERE id = $1 AND company_id = $2",
      [notificationId, ctx.companyId],
    );
    assert.equal(redacted.rows[0].message_body, "");

    const duplicate = await outbox.enqueueNotification({
      companyId: ctx.companyId,
      userId: ctx.userId,
      channel: "email",
      destination: `ops-${suffix}@example.test`,
      subject: `Invoice notice ${suffix}`,
      body: "Sensitive invoice delivery message",
      idempotencyKey,
    });
    assert.equal(duplicate.id, notificationId);
    assert.equal(duplicate.status, "sent");
    assert.equal(duplicate.delivered, true);

    await assert.rejects(
      () => outbox.enqueueNotification({
        companyId: ctx.companyId,
        userId: ctx.userId,
        channel: "email",
        destination: `ops-${suffix}@example.test`,
        subject: `Invoice notice ${suffix}`,
        body: "Changed content must not reuse a request key",
        idempotencyKey,
      }),
      /already used for a different notification/,
    );
  } finally {
    if (notificationId) {
      await pool.query("DELETE FROM erp_notification_outbox WHERE id = $1 AND company_id = $2", [notificationId, ctx.companyId]);
    }
  }
});

test("E2E notification templates honor opt-outs and per-recipient rate limits", async () => {
  const ctx = await getTestContext();
  const suffix = Date.now();
  const destination = `finance-${suffix}@example.test`;
  const previousLimit = process.env.NOTIFICATION_EMAIL_RECIPIENT_LIMIT_PER_HOUR;
  process.env.NOTIFICATION_EMAIL_RECIPIENT_LIMIT_PER_HOUR = "1";
  let firstId;
  try {
    await outbox.saveNotificationTemplate({
      companyId: ctx.companyId, userId: ctx.userId, code: "invoice_issued", channel: "email",
      subject: "Invoice {{invoice_no}} issued", body: "Hello {{customer}}, amount {{amount}}",
    });
    const queued = await outbox.enqueueTemplatedNotification({
      companyId: ctx.companyId, userId: ctx.userId, code: "invoice_issued", destination,
      variables: { invoice_no: `INV-${suffix}`, customer: "Customer", amount: 25 },
      idempotencyKey: `e2e-template-${suffix}`,
    });
    firstId = queued.id;
    const stored = await pool.query(
      "SELECT subject,message_body,template_code FROM erp_notification_outbox WHERE id=$1 AND company_id=$2",
      [firstId, ctx.companyId],
    );
    assert.equal(stored.rows[0].subject, `Invoice INV-${suffix} issued`);
    assert.equal(stored.rows[0].message_body, "Hello Customer, amount 25");
    assert.equal(stored.rows[0].template_code, "invoice_issued");

    await assert.rejects(() => outbox.enqueueNotification({
      companyId: ctx.companyId, userId: ctx.userId, channel: "email", destination,
      subject: "Second", body: "Should hit rate limit", idempotencyKey: `e2e-rate-${suffix}`,
    }), /rate limit exceeded/);

    await outbox.addNotificationOptOut({ companyId: ctx.companyId, userId: ctx.userId,
      channel: "email", destination, reason: "Customer request" });
    const removed = await outbox.removeNotificationOptOut({ companyId: ctx.companyId, channel: "email", destination });
    assert.equal(removed.removed, true);
    await outbox.addNotificationOptOut({ companyId: ctx.companyId, userId: ctx.userId,
      channel: "email", destination, reason: "Customer request" });
    await assert.rejects(() => outbox.enqueueNotification({
      companyId: ctx.companyId, userId: ctx.userId, channel: "email", destination,
      subject: "Opt-out", body: "Should not queue", idempotencyKey: `e2e-optout-${suffix}`,
    }), /opted out/);
  } finally {
    if (previousLimit === undefined) delete process.env.NOTIFICATION_EMAIL_RECIPIENT_LIMIT_PER_HOUR;
    else process.env.NOTIFICATION_EMAIL_RECIPIENT_LIMIT_PER_HOUR = previousLimit;
    await pool.query("DELETE FROM erp_notification_opt_outs WHERE company_id=$1 AND destination=$2", [ctx.companyId, destination]);
    await pool.query("DELETE FROM erp_notification_templates WHERE company_id=$1 AND template_code='invoice_issued' AND channel='email'", [ctx.companyId]);
    await pool.query("DELETE FROM erp_notification_outbox WHERE company_id=$1 AND destination=$2", [ctx.companyId, destination]);
  }
});
