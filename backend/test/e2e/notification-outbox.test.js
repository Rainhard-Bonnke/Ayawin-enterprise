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
