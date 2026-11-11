const test = require("node:test");
const assert = require("node:assert/strict");
const { matchesCallbackSourceIp, SAFARICOM_CALLBACK_SOURCE_IPS } = require("../src/services/mpesaService");
const {
  DisabledMpesaProvider,
  MPESA_BASE_URLS,
  MockMpesaProvider,
  SandboxMpesaProvider,
  buildMpesaCallbackUrl,
} = require("../src/services/mpesaProvider");

const config = {
  environment: "sandbox",
  public_config: {
    shortcode: "174379",
    partyB: "174379",
    transactionType: "CustomerPayBillOnline",
    callbackBaseUrl: "https://example.com",
  },
  secrets: {
    consumerKey: "consumer-key",
    consumerSecret: "consumer-secret",
    passkey: "stk-passkey",
    callbackToken: "callback-token",
  },
};

test("disabled M-Pesa provider refuses payment initiation", async () => {
  await assert.rejects(() => new DisabledMpesaProvider().initiateStkPush({}), /disabled/);
});

test("M-Pesa callback URLs preserve company and token when generating kind-specific callbacks", () => {
  assert.equal(
    buildMpesaCallbackUrl({ baseUrl: "https://example.com", companyId: "company-123", token: "token-456", kind: "stk" }),
    "https://example.com/api/v1/callbacks/mpesa/company-123/token-456/stk",
  );
  assert.equal(
    buildMpesaCallbackUrl({ baseUrl: "https://example.com", companyId: "company-123", token: "token-456", kind: "c2b/confirmation" }),
    "https://example.com/api/v1/callbacks/mpesa/company-123/token-456/c2b/confirmation",
  );
});

test("M-Pesa callback source allowlist is disabled by default and enforces configured CIDRs", () => {
  assert.equal(SAFARICOM_CALLBACK_SOURCE_IPS.length, 12);
  assert.ok(SAFARICOM_CALLBACK_SOURCE_IPS.includes("196.201.214.200"));
  assert.equal(matchesCallbackSourceIp("203.0.113.8"), true);
  assert.equal(matchesCallbackSourceIp("203.0.113.8", ["203.0.113.0/24"]), true);
  assert.equal(matchesCallbackSourceIp("203.0.114.8", ["203.0.113.0/24"]), false);
  assert.equal(matchesCallbackSourceIp("203.0.113.8", ["not-a-cidr"]), false);
});

test("mock M-Pesa provider is deterministic and confirms fixture callbacks", async () => {
  const provider = new MockMpesaProvider();
  const initiated = await provider.initiateStkPush({ idempotencyKey: "req-1" });
  assert.equal(initiated.checkout_request_id, "MOCK-CHECKOUT-req-1");
  const verified = await provider.verifyPayment({ callbackPayload: {
    Body: { stkCallback: {
      ResultCode: 0,
      CallbackMetadata: { Item: [
        { Name: "Amount", Value: 50 },
        { Name: "MpesaReceiptNumber", Value: "MOCK123" },
        { Name: "TransactionDate", Value: "20261107123456" },
        { Name: "PhoneNumber", Value: 254712345678 },
      ] },
    } },
  } });
  assert.equal(verified.confirmed, true);
  assert.equal(verified.receipt_number, "MOCK123");
});

test("Daraja sandbox OAuth and STK payload use official endpoints and fields", async () => {
  const calls = [];
  const provider = new SandboxMpesaProvider({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("/oauth/")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 3599 }) };
      return { ok: true, json: async () => ({ ResponseCode: "0", MerchantRequestID: "merchant-1", CheckoutRequestID: "checkout-1" }) };
    },
  });
  const result = await provider.initiateStkPush({
    phone: "254712345678",
    amount: 125,
    accountReference: "INV-001",
    idempotencyKey: "request-1",
  });
  assert.equal(result.checkout_request_id, "checkout-1");
  assert.equal(calls[0].url, `${MPESA_BASE_URLS.sandbox}/oauth/v1/generate?grant_type=client_credentials`);
  assert.equal(calls[1].url, `${MPESA_BASE_URLS.sandbox}/mpesa/stkpush/v1/processrequest`);
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.BusinessShortCode, "174379");
  assert.equal(payload.TransactionType, "CustomerPayBillOnline");
  assert.equal(payload.PartyA, "254712345678");
  assert.equal(payload.AccountReference, "INV-001");
  assert.equal(calls[1].options.headers.authorization, "Bearer token");
});

test("Daraja sandbox STK amount rejects fractional KES instead of rounding", async () => {
  const provider = new SandboxMpesaProvider({ config, fetchImpl: async () => { throw new Error("must not call network"); } });
  await assert.rejects(
    () => provider.initiateStkPush({ phone: "254712345678", amount: 12.5, accountReference: "INV-1" }),
    /whole KES shilling/,
  );
});

test("Daraja transaction-status acknowledgment waits for the asynchronous final callback", async () => {
  const calls = [];
  const statusConfig = {
    ...config,
    companyId: "company-1",
    public_config: { ...config.public_config, callbackBaseUrl: "https://example.com" },
    secrets: { ...config.secrets, initiatorName: "api-initiator", securityCredential: "encrypted-credential" },
  };
  const provider = new SandboxMpesaProvider({
    config: statusConfig,
    fetchImpl: async (url, options) => {
      if (url.includes("/oauth/")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 3599 }) };
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ResponseCode: "0", ResponseDescription: "Accept the service request successfully.",
        OriginatorConversationID: "status-originator-1", ConversationID: "status-conversation-1" }) };
    },
  });
  const result = await provider.verifyPayment({
    checkoutRequestId: "checkout-1",
    idempotencyKey: "stk-request-1",
    callbackPayload: { Body: { stkCallback: { CallbackMetadata: { Item: [
      { Name: "Amount", Value: 50 }, { Name: "MpesaReceiptNumber", Value: "MPESA123" },
      { Name: "PhoneNumber", Value: 254712345678 }, { Name: "TransactionDate", Value: "20261109123456" },
    ] } } } },
  });
  assert.equal(result.confirmed, undefined);
  assert.equal(result.awaiting_status_callback, true);
  assert.equal(result.status_query_originator_id, "status-originator-1");
  assert.equal(calls[0].url, `${MPESA_BASE_URLS.sandbox}/mpesa/transactionstatus/v1/query`);
  assert.equal(calls[0].body.TransactionID, "MPESA123");
  assert.equal(calls[0].body.CommandID, "TransactionStatusQuery");
  assert.match(calls[0].body.ResultURL, /company-1\/callback-token\/stk\/status-result/);
});

test("Daraja B2C rejects fractional amounts and derives a stable bounded provider request ID", async () => {
  const calls = [];
  const b2cConfig = {
    ...config,
    public_config: { ...config.public_config, b2cShortcode: "600000" },
    secrets: { ...config.secrets, initiatorName: "initiator", securityCredential: "credential" },
  };
  const provider = new SandboxMpesaProvider({
    config: b2cConfig,
    fetchImpl: async (url, options) => {
      if (url.includes("/oauth/")) return { ok: true, json: async () => ({ access_token: "token", expires_in: 3599 }) };
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ResponseCode: "0", ConversationID: "conversation-1", OriginatorConversationID: calls[0].body.OriginatorConversationID }) };
    },
  });
  await assert.rejects(() => provider.sendB2c({ amount: 10.5, idempotencyKey: "refund-1", callbackUrl: "https://example.test/result", timeoutUrl: "https://example.test/timeout" }), /whole KES/);
  await provider.sendB2c({ phone: "0712345678", amount: 10, idempotencyKey: "a-long-stable-refund-key-that-must-not-be-truncated", callbackUrl: "https://example.test/result", timeoutUrl: "https://example.test/timeout" });
  assert.equal(calls[0].body.Amount, 10);
  assert.equal(calls[0].body.PartyB, "254712345678");
  assert.equal(calls[0].body.OriginatorConversationID.length, 20);
});
