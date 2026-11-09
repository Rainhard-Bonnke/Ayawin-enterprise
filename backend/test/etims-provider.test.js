const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DisabledEtimsProvider,
  ETIMS_BASE_URLS,
  MockEtimsProvider,
  SandboxEtimsProvider,
} = require("../src/services/etimsProvider");
const { redactIntegrationPayload } = require("../src/services/integrationService");

const sandboxConfig = {
  environment: "sandbox",
  public_config: { bhfId: "00" },
  secrets: { tin: "A123456789Z", deviceSerial: "device-001", communicationKey: "provider-key" },
};

test("disabled eTIMS provider never fabricates fiscal data", async () => {
  const provider = new DisabledEtimsProvider();
  const response = await provider.submitInvoice({ payload: {}, idempotencyKey: "disabled-test" });
  assert.equal(response.accepted, false);
});

test("mock eTIMS provider returns deterministic fiscal fixture fields", async () => {
  const provider = new MockEtimsProvider({
    fixture: { submission: { accepted: true, provider_reference: "MOCK-42", receipt_signature: "sig", internal_data: "data", cu_id: "cu", receipt_counter: "1", qr_code: "qr" } },
  });
  const response = await provider.submitInvoice({ payload: {}, idempotencyKey: "mock-test" });
  assert.equal(response.accepted, true);
  assert.equal(response.provider_reference, "MOCK-42");
  assert.equal(response.receipt_signature, "sig");
});

test("sandbox device initialization uses the documented OSCU endpoint and request fields", async () => {
  let captured;
  const provider = new SandboxEtimsProvider({
    config: sandboxConfig,
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ resultCd: "000", resultMsg: "OK", data: { info: { sdcId: "CU-1", cmcKey: "new-key", dvcId: "DEV-1" } } }) };
    },
  });
  const initialized = await provider.initialize();
  assert.equal(captured.url, `${ETIMS_BASE_URLS.sandbox}/selectInitOsdcInfo`);
  assert.deepEqual(captured.body, { tin: "A123456789Z", bhfId: "00", dvcSrlNo: "device-001" });
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.communication_key, "new-key");
  assert.equal(initialized.sdc_id, "CU-1");
});

test("sandbox test connection uses the documented code-list endpoint", async () => {
  let captured;
  const provider = new SandboxEtimsProvider({
    config: sandboxConfig,
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ resultCd: "000", resultMsg: "OK", data: {} }) };
    },
  });
  const result = await provider.testConnection();
  assert.equal(captured.url, `${ETIMS_BASE_URLS.sandbox}/selectCodeList`);
  assert.equal(captured.body.cmcKey, "provider-key");
  assert.equal(result.connected, true);
});

test("sandbox invoice acceptance stores only fiscal data returned by KRA", async () => {
  const provider = new SandboxEtimsProvider({
    config: { ...sandboxConfig, public_config: { ...sandboxConfig.public_config, sdcId: "CU-1" } },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        resultCd: "000",
        resultMsg: "OK",
        data: { curRcptNo: "12", intrlData: "INTERNAL", rcptSign: "SIGNATURE", sdcDateTime: "20261107123456" },
      }),
    }),
  });
  const result = await provider.submitInvoice({ payload: { salesDt: "20261107" } });
  assert.equal(result.provider_reference, "CU-1/12");
  assert.equal(result.qr_code, "07112026#123456#CU-1#12#INTERNAL#SIGNATURE");
  assert.equal(result.receipt_signature, "SIGNATURE");
});

test("integration log redaction masks secrets and full phone numbers", () => {
  const safe = redactIntegrationPayload({
    cmcKey: "private-key",
    phone: "254712345678",
    nested: { consumerSecret: "another-secret", safe: "value" },
  });
  assert.equal(safe.cmcKey, "[REDACTED]");
  assert.equal(safe.phone, "254*****5678");
  assert.equal(safe.nested.consumerSecret, "[REDACTED]");
  assert.equal(safe.nested.safe, "value");
});
