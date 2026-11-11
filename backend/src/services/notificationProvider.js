const integrationSettings = require("./integrationSettingsService");

function normalizeKenyanSmsDestination(value) {
  const digits = String(value || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  if (!/^254[17]\d{8}$/.test(normalized)) throw new Error("SMS recipient must be a valid Kenyan mobile number");
  return `+${normalized}`;
}

class SendGridNotificationAdapter {
  constructor({ config, fetchImpl = globalThis.fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    if (typeof fetchImpl !== "function") throw new Error("Fetch is required for the SendGrid adapter");
  }

  async sendEmail({ to, subject, body, idempotencyKey, attachments = [] }) {
    const apiKey = this.config.secrets.apiKey;
    const fromEmail = this.config.public_config.fromEmail;
    if (!apiKey || !fromEmail) throw new Error("Configure the SendGrid API key and verified sender email");
    const response = await this.fetchImpl("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: fromEmail, name: this.config.public_config.fromName || undefined },
        subject,
        content: [{ type: "text/plain", value: body }],
        ...(attachments.length ? { attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          type: attachment.mimeType,
          content: attachment.content,
          disposition: "attachment",
        })) } : {}),
      }),
    });
    const providerResponse = await response.json().catch(() => ({}));
    if (response.status !== 202) {
      return { accepted: false, retryable: response.status >= 500 || response.status === 429,
        message: String(providerResponse.errors?.[0]?.message || `SendGrid returned HTTP ${response.status}`) };
    }
    return { accepted: true, message_id: response.headers?.get?.("x-message-id") || null,
      provider_response: { status: response.status } };
  }
}

class AfricasTalkingNotificationAdapter {
  constructor({ config, fetchImpl = globalThis.fetch }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    if (typeof fetchImpl !== "function") throw new Error("Fetch is required for the Africa's Talking adapter");
  }

  async sendSms({ to, body, idempotencyKey }) {
    const username = this.config.secrets.username;
    const apiKey = this.config.secrets.apiKey;
    if (!username || !apiKey) throw new Error("Configure the Africa's Talking username and API key");
    const form = new URLSearchParams({ username, to: normalizeKenyanSmsDestination(to), message: body });
    if (this.config.public_config.senderId) form.set("from", this.config.public_config.senderId);
    const response = await this.fetchImpl("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: {
        apiKey,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idempotencyKey,
      },
      body: form.toString(),
    });
    const providerResponse = await response.json().catch(() => ({}));
    const recipients = providerResponse.SMSMessageData?.Recipients || [];
    const accepted = response.ok && recipients.length > 0
      && recipients.every((recipient) => ["100", "101", "102"].includes(String(recipient.statusCode)));
    return accepted
      ? { accepted: true, message_id: recipients.map((recipient) => recipient.messageId).filter(Boolean).join(",") || null,
        provider_response: { status: response.status, recipients: recipients.length } }
      : { accepted: false, retryable: response.status >= 500 || response.status === 429,
        message: String(providerResponse.SMSMessageData?.Message || `Africa's Talking returned HTTP ${response.status}`) };
  }
}

function createSettingsNotificationAdapter({ fetchImpl } = {}) {
  return {
    async sendEmail(input) {
      const config = await integrationSettings.getProviderRuntimeConfig({ companyId: input.companyId, provider: "email" });
      if (config.provider_mode !== "production") throw new Error("Company SendGrid integration is not enabled");
      return new SendGridNotificationAdapter({ config, fetchImpl }).sendEmail(input);
    },
    async sendSms(input) {
      const config = await integrationSettings.getProviderRuntimeConfig({ companyId: input.companyId, provider: "sms" });
      if (config.provider_mode !== "production") throw new Error("Company Africa's Talking integration is not enabled");
      return new AfricasTalkingNotificationAdapter({ config, fetchImpl }).sendSms(input);
    },
  };
}

module.exports = {
  AfricasTalkingNotificationAdapter,
  SendGridNotificationAdapter,
  createSettingsNotificationAdapter,
  normalizeKenyanSmsDestination,
};