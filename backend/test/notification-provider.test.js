const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AfricasTalkingNotificationAdapter,
  SendGridNotificationAdapter,
  normalizeKenyanSmsDestination,
} = require("../src/services/notificationProvider");
const { normalizeDeliveryCallback, normalizeNotification, renderNotificationTemplate } = require("../src/services/notificationOutboxService");

test("SendGrid adapter sends a company-configured message through the mocked API", async () => {
  let request;
  const adapter = new SendGridNotificationAdapter({
    config: { secrets: { apiKey: "sendgrid-secret" }, public_config: { fromEmail: "billing@example.test", fromName: "Ayawin" } },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 202, headers: { get: () => "mock-message-id" }, json: async () => ({}) };
    },
  });
  const result = await adapter.sendEmail({ to: "customer@example.test", subject: "Invoice", body: "Ready", idempotencyKey: "mail-1" });
  assert.equal(request.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(request.options.headers.authorization, "Bearer sendgrid-secret");
  assert.equal(JSON.parse(request.options.body).personalizations[0].to[0].email, "customer@example.test");
  assert.equal(result.accepted, true);
  assert.equal(result.message_id, "mock-message-id");
});

test("Africa's Talking adapter normalizes Kenyan numbers and accepts mocked provider receipts", async () => {
  let request;
  const adapter = new AfricasTalkingNotificationAdapter({
    config: { secrets: { username: "sandbox-user", apiKey: "sms-secret" }, public_config: { senderId: "AYAWIN" } },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201, json: async () => ({ SMSMessageData: { Recipients: [
        { statusCode: 101, messageId: "mock-sms-1" },
      ] } }) };
    },
  });
  const result = await adapter.sendSms({ to: "0712345678", body: "Payment received", idempotencyKey: "sms-1" });
  assert.equal(request.url, "https://api.africastalking.com/version1/messaging");
  assert.equal(new URLSearchParams(request.options.body).get("to"), "+254712345678");
  assert.equal(result.accepted, true);
  assert.equal(result.message_id, "mock-sms-1");
  assert.equal(normalizeKenyanSmsDestination("+254 712 345678"), "+254712345678");
  assert.throws(() => normalizeKenyanSmsDestination("07123"), /valid Kenyan mobile number/);
});

test("notification templates render required variables and SMS queue accepts Kenyan local numbers", () => {
  const rendered = renderNotificationTemplate({
    subject_template: "Invoice {{invoice.number}}",
    message_template: "Hello {{customer}}, amount due {{amount}}",
  }, { invoice: { number: "INV-1" }, customer: "Customer", amount: 25 });
  assert.deepEqual(rendered, { subject: "Invoice INV-1", body: "Hello Customer, amount due 25" });
  assert.throws(() => renderNotificationTemplate({ message_template: "Hello {{name}}" }, {}), /Missing notification template value/);
  assert.equal(normalizeNotification({ channel: "sms", destination: "0712345678", body: "Notice", idempotencyKey: "sms-local" }).destination,
    "+254712345678");
});

test("notification delivery callback normalization accepts supported delivery states only", () => {
  assert.deepEqual(normalizeDeliveryCallback({ sg_message_id: "m-1", event: "delivered" }), { messageId: "m-1", status: "delivered" });
  assert.deepEqual(normalizeDeliveryCallback({ message_id: "m-2", status: "bounce" }), { messageId: "m-2", status: "bounced" });
  assert.throws(() => normalizeDeliveryCallback({ message_id: "m-3", status: "queued" }), /supported status/);
});