const crypto = require("crypto");
const integrationSettings = require("./integrationSettingsService");

const MPESA_BASE_URLS = Object.freeze({
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke",
});

function normalizePhone(value) {
  const digits = String(value || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  if (!/^254[17]\d{8}$/.test(normalized)) throw new Error("B2C recipient must be a valid Kenyan mobile number");
  return normalized;
}

class MpesaProvider {
  async initiateStkPush() { throw new Error("MpesaProvider.initiateStkPush must be implemented"); }
  async verifyPayment() { throw new Error("MpesaProvider.verifyPayment must be implemented"); }
  async queryTransactionStatus() { throw new Error("MpesaProvider.queryTransactionStatus must be implemented"); }
  async registerC2bUrls() { throw new Error("MpesaProvider.registerC2bUrls must be implemented"); }
  async sendB2c() { throw new Error("MpesaProvider.sendB2c must be implemented"); }
}

class DisabledMpesaProvider extends MpesaProvider {
  async initiateStkPush() { throw new Error("M-Pesa integration is disabled"); }
  async verifyPayment() { throw new Error("M-Pesa integration is disabled"); }
  async queryTransactionStatus() { return { accepted: false, message: "M-Pesa integration is disabled" }; }
  async registerC2bUrls() { throw new Error("M-Pesa integration is disabled"); }
  async sendB2c() { throw new Error("M-Pesa integration is disabled"); }
}

class MockMpesaProvider extends MpesaProvider {
  constructor({ fixture = {} } = {}) {
    super();
    this.fixture = fixture;
  }

  async initiateStkPush({ idempotencyKey }) {
    if (this.fixture.initiationError) throw new Error(this.fixture.initiationError);
    return this.fixture.initiation || {
      merchant_request_id: `MOCK-MERCHANT-${idempotencyKey}`,
      checkout_request_id: `MOCK-CHECKOUT-${idempotencyKey}`,
    };
  }

  async verifyPayment({ callbackPayload }) {
    if (this.fixture.verification) return this.fixture.verification;
    if (this.fixture.forged) return { confirmed: false, message: "Mock status query rejected callback" };
    const callback = callbackPayload?.Body?.stkCallback;
    if (!callback || Number(callback.ResultCode) !== 0) {
      return { confirmed: false, message: callback?.ResultDesc || "Mock payment was not successful" };
    }
    const items = callback.CallbackMetadata?.Item || [];
    const value = (name) => items.find((item) => item.Name === name)?.Value;
    return {
      confirmed: true,
      amount: Number(value("Amount")),
      receipt_number: String(value("MpesaReceiptNumber") || ""),
      transaction_date: String(value("TransactionDate") || ""),
      phone: String(value("PhoneNumber") || ""),
    };
  }

  async queryTransactionStatus({ idempotencyKey }) {
    return this.fixture.statusQuery || {
      accepted: true,
      originator_conversation_id: `MOCK-STATUS-${crypto.createHash("sha256").update(String(idempotencyKey)).digest("hex").slice(0,12)}`,
      conversation_id: `MOCK-CONVERSATION-${String(idempotencyKey).slice(-8)}`,
    };
  }

  async registerC2bUrls() { return this.fixture.registration || { accepted: true }; }
  async sendB2c({ idempotencyKey }) { return this.fixture.b2c || { accepted: true, originator_conversation_id: idempotencyKey }; }

  buildCallbackUrl(kind) { return `https://mock-mpesa.invalid/callback/${String(kind || "result")}`; }
}

function buildMpesaCallbackUrl({ baseUrl, companyId, token, kind = "stk" }) {
  const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBase) return "";
  const segments = [
    String(companyId || "").trim(),
    String(token || "").trim(),
    String(kind || "").trim().replace(/^\/+|\/+$/g, ""),
  ].filter(Boolean);
  return `${normalizedBase}/api/v1/callbacks/mpesa${segments.length ? `/${segments.join("/")}` : ""}`;
}

class SandboxMpesaProvider extends MpesaProvider {
  constructor({ config, fetchImpl = globalThis.fetch, timeoutMs = 15000, onCall = async () => {} }) {
    super();
    if (typeof fetchImpl !== "function") throw new Error("Node.js fetch is required for the Daraja provider");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onCall = onCall;
    this.baseUrl = MPESA_BASE_URLS[config.environment];
    if (!this.baseUrl) throw new Error("Unsupported M-Pesa environment");
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  async request({ method, path, body, action, authenticated = true }) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let responsePayload = null;
    let status = "error";
    try {
      const headers = { accept: "application/json", "content-type": "application/json" };
      if (authenticated) headers.authorization = `Bearer ${await this.getAccessToken()}`;
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(responsePayload.errorMessage || `Daraja returned HTTP ${response.status}`));
      status = "success";
      return responsePayload;
    } catch (error) {
      responsePayload = responsePayload || { error: String(error.message || "Daraja request failed") };
      throw error;
    } finally {
      clearTimeout(timeout);
      await this.onCall({ action, request: body || {}, response: responsePayload || {}, status, durationMs: Date.now() - started });
    }
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30000) return this.accessToken;
    const consumerKey = this.config.secrets.consumerKey;
    const consumerSecret = this.config.secrets.consumerSecret;
    if (!consumerKey || !consumerSecret) throw new Error("Daraja consumer credentials are not configured");
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let responsePayload = null;
    let status = "error";
    try {
      const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
      const response = await this.fetchImpl(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: "GET",
        headers: { authorization: `Basic ${auth}`, accept: "application/json" },
        signal: controller.signal,
      });
      responsePayload = await response.json().catch(() => ({}));
      if (!response.ok || !responsePayload.access_token) throw new Error("Daraja OAuth token request failed");
      status = "success";
      this.accessToken = responsePayload.access_token;
      this.tokenExpiresAt = Date.now() + Math.max(60, Number(responsePayload.expires_in) || 3599) * 1000;
      return this.accessToken;
    } finally {
      clearTimeout(timeout);
      await this.onCall({
        action: "oauth_token",
        request: { grant_type: "client_credentials" },
        response: responsePayload || {},
        status,
        durationMs: Date.now() - started,
      });
    }
  }

  stkPassword(timestamp) {
    const shortcode = String(this.config.public_config.shortcode || "");
    const passkey = String(this.config.secrets.passkey || "");
    if (!/^\d{5,7}$/.test(shortcode) || !passkey) throw new Error("Daraja shortcode and STK passkey are required");
    return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  }

  async initiateStkPush({ phone, amount, accountReference, idempotencyKey }) {
    const shortcode = String(this.config.public_config.shortcode || "");
    const transactionType = this.config.public_config.transactionType;
    if (!shortcode || !["CustomerPayBillOnline", "CustomerBuyGoodsOnline"].includes(transactionType)) {
      throw new Error("Configure the Daraja shortcode and PayBill/Till transaction type");
    }
    const normalizedAmount = Math.round(Number(amount));
    if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount < 1 || normalizedAmount !== Number(amount)) {
      throw new Error("Daraja STK amount must be a whole KES shilling amount");
    }
    const reference = String(accountReference || "");
    if (!reference || reference.length > 12) throw new Error("Daraja account reference must contain 1 to 12 characters");
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const callbackUrl = this.buildCallbackUrl("stk");
    const payload = {
      BusinessShortCode: shortcode,
      Password: this.stkPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: transactionType,
      Amount: normalizedAmount,
      PartyA: phone,
      PartyB: String(this.config.public_config.partyB || shortcode),
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: "ERP payment".slice(0, 13),
    };
    if (!payload.CallBackURL) throw new Error("A valid M-Pesa callback URL is required");
    const response = await this.request({ method: "POST", path: "/mpesa/stkpush/v1/processrequest", body: payload, action: "stk_push" });
    if (String(response.ResponseCode) !== "0" || !response.MerchantRequestID || !response.CheckoutRequestID) {
      throw new Error(String(response.ResponseDescription || "Daraja did not accept the STK request"));
    }
    return { merchant_request_id: response.MerchantRequestID, checkout_request_id: response.CheckoutRequestID, provider_response: response };
  }

  async verifyPayment({ checkoutRequestId, callbackPayload, idempotencyKey }) {
    const items = callbackPayload?.Body?.stkCallback?.CallbackMetadata?.Item || [];
    const value = (name) => items.find((item) => item.Name === name)?.Value;
    const receiptNumber = String(value("MpesaReceiptNumber") || "").trim();
    if (!receiptNumber) return { confirmed: false, message: "STK callback has no receipt ID for independent transaction-status verification" };
    const query = await this.queryTransactionStatus({
      transactionId: receiptNumber,
      idempotencyKey,
    });
    if (!query.accepted) return { confirmed: false, retryable: true, message: query.message || "Transaction status query was not accepted" };
    return {
      awaiting_status_callback: true,
      status_query_originator_id: query.originator_conversation_id,
      status_query_conversation_id: query.conversation_id,
      amount: Number(value("Amount")),
      receipt_number: receiptNumber,
      transaction_date: String(value("TransactionDate") || ""),
      phone: String(value("PhoneNumber") || ""),
      provider_response: query.provider_response || {},
    };
  }

  async queryTransactionStatus({ transactionId, idempotencyKey }) {
    const { initiatorName, securityCredential } = this.config.secrets;
    const shortcode = String(this.config.public_config.shortcode || "");
    if (!shortcode || !initiatorName || !securityCredential || !transactionId) {
      throw new Error("Configure the shortcode, Transaction Status API credentials, and receipt number");
    }
    const originatorId = crypto.createHash("sha256").update(String(idempotencyKey || `${transactionId}:${Date.now()}`)).digest("hex").slice(0,20);
    const resultUrl = this.buildCallbackUrl("stk/status-result");
    const timeoutUrl = this.buildCallbackUrl("stk/status-timeout");
    const response = await this.request({
      method: "POST",
      path: "/mpesa/transactionstatus/v1/query",
      body: {
        Initiator: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: "TransactionStatusQuery",
        TransactionID: transactionId,
        PartyA: shortcode,
        IdentifierType: "4",
        ResultURL: resultUrl,
        QueueTimeOutURL: timeoutUrl,
        Remarks: "Verify ERP STK payment",
        Occasion: originatorId,
      },
      action: "transaction_status_query",
    });
    if (String(response.ResponseCode) !== "0" || !response.OriginatorConversationID || !response.ConversationID) {
      return { accepted: false, message: String(response.ResponseDescription || "Daraja did not accept the status query"), provider_response: response };
    }
    return { accepted: true, originator_conversation_id: response.OriginatorConversationID,
      conversation_id: response.ConversationID, provider_response: response };
  }

  async registerC2bUrls() {
    const shortcode = String(this.config.public_config.shortcode || "");
    if (!shortcode) {
      throw new Error("Configure the M-Pesa shortcode before registering C2B URLs");
    }
    const response = await this.request({
      method: "POST",
      path: "/mpesa/c2b/v2/registerurl",
      body: {
        ShortCode: shortcode,
        ResponseType: this.config.public_config.validationUnavailableAction === "Cancelled" ? "Cancelled" : "Completed",
        ConfirmationURL: this.buildCallbackUrl("c2b/confirmation"),
        ValidationURL: this.buildCallbackUrl("c2b/validation"),
      },
      action: "register_c2b_urls",
    });
    return { accepted: String(response.ResponseCode) === "0", provider_response: response };
  }

  buildCallbackUrl(kind) {
    return buildMpesaCallbackUrl({
      baseUrl: this.config.public_config.callbackBaseUrl,
      companyId: this.config.companyId,
      token: this.config.secrets.callbackToken,
      kind,
    });
  }

  async sendB2c({ phone, amount, idempotencyKey, callbackUrl, timeoutUrl }) {
    const shortcode = String(this.config.public_config.b2cShortcode || "");
    const { initiatorName, securityCredential } = this.config.secrets;
    if (!shortcode || !initiatorName || !securityCredential || !callbackUrl || !timeoutUrl) {
      throw new Error("B2C credentials, shortcode, result URL, and timeout URL are required");
    }
    const normalizedAmount = Number(amount);
    if (!Number.isSafeInteger(normalizedAmount) || normalizedAmount < 1) {
      throw new Error("Daraja B2C amount must be a positive whole KES shilling amount");
    }
    const normalizedPhone = normalizePhone(phone);
    const originatorConversationId = crypto.createHash("sha256").update(String(idempotencyKey || "")).digest("hex").slice(0, 20);
    if (!idempotencyKey) throw new Error("A stable B2C idempotency key is required");
    const response = await this.request({
      method: "POST",
      path: "/mpesa/b2c/v3/paymentrequest",
      body: {
        OriginatorConversationID: originatorConversationId,
        InitiatorName: initiatorName,
        SecurityCredential: securityCredential,
        CommandID: "BusinessPayment",
        Amount: normalizedAmount,
        PartyA: shortcode,
        PartyB: normalizedPhone,
        Remarks: "Approved customer refund",
        QueueTimeOutURL: timeoutUrl,
        ResultURL: callbackUrl,
      },
      action: "b2c_payment",
    });
    if (String(response.ResponseCode) !== "0") throw new Error(String(response.ResponseDescription || "Daraja did not accept the B2C request"));
    return { accepted: true, conversation_id: response.ConversationID, originator_conversation_id: response.OriginatorConversationID, provider_response: response };
  }
}

async function getMpesaProvider({ companyId, branchId = null, fetchImpl, onCall }) {
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa", branchId });
  config.companyId = companyId;
  if (config.provider_mode === "disabled") return new DisabledMpesaProvider();
  if (config.provider_mode === "mock") {
    if (config.environment !== "sandbox") throw new Error("Mock M-Pesa provider is permitted only in sandbox environment");
    return new MockMpesaProvider();
  }
  if (["sandbox", "production"].includes(config.provider_mode)) {
    const logCall = onCall || (async ({ action, request, response, status, durationMs }) => {
      const { logIntegration } = require("./integrationService");
      await logIntegration({
        companyId,
        provider: "mpesa",
        action,
        request,
        response,
        status,
        durationMs,
        correlationId: crypto.randomUUID(),
        outcome: status,
      });
    });
    return new SandboxMpesaProvider({ config, fetchImpl, onCall: logCall });
  }
  return new DisabledMpesaProvider();
}

module.exports = {
  DisabledMpesaProvider,
  MPESA_BASE_URLS,
  MockMpesaProvider,
  MpesaProvider,
  SandboxMpesaProvider,
  buildMpesaCallbackUrl,
  getMpesaProvider,
};
