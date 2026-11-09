const test = require("node:test");
const assert = require("node:assert/strict");
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
