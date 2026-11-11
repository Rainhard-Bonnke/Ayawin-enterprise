const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DisabledEtimsProvider,
  ETIMS_BASE_URLS,
  MockEtimsProvider,
  SandboxEtimsProvider,
} = require("../src/services/etimsProvider");
const { redactIntegrationPayload } = require("../src/services/integrationService");
const { inspectEtimsRetry } = require("../src/services/integrationService");
const codeListFixture = require("./fixtures/etims/code-list-response.json");
const itemClassFixture = require("./fixtures/etims/item-class-response.json");
const salesSuccessFixture = require("./fixtures/etims/sales-success-response.json");

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

test("eTIMS retry requires status reconciliation and never resends an ambiguous invoice", async () => {
  assert.equal((await inspectEtimsRetry({}, {})).action, "block");
  assert.equal((await inspectEtimsRetry({ lookupInvoiceStatus: async () => ({ status: "not_found" }) }, {})).action, "submit");
  assert.equal((await inspectEtimsRetry({ lookupInvoiceStatus: async () => ({ status: "accepted" }) }, {})).action, "accepted");
  assert.equal((await inspectEtimsRetry({ lookupInvoiceStatus: async () => ({ status: "pending" }) }, {})).action, "defer");
  assert.equal((await inspectEtimsRetry({ lookupInvoiceStatus: async () => ({ status: "unknown" }) }, {})).action, "block");
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

test("sandbox code-list and item-class lookups use documented OSCU endpoints and fields", async () => {
  const calls = [];
  const provider = new SandboxEtimsProvider({
    config: sandboxConfig,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => calls.length === 1 ? codeListFixture : itemClassFixture };
    },
  });
  await provider.selectCodeList({ lastReqDt: "20261107000000" });
  await provider.selectItemClassList({ lastReqDt: "20261107000000" });
  assert.equal(calls[0].url, `${ETIMS_BASE_URLS.sandbox}/selectCodeList`);
  assert.deepEqual(calls[0].body, { tin: "A123456789Z", bhfId: "00", cmcKey: "provider-key", lastReqDt: "20261107000000" });
  assert.equal(calls[1].url, `${ETIMS_BASE_URLS.sandbox}/selectItemClsList`);
  assert.deepEqual(calls[1].body, calls[0].body);
});

test("sandbox item registration uses the OSCU saveItem operation", async () => {
  let captured;
  const provider = new SandboxEtimsProvider({
    config: sandboxConfig,
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ resultCd: "000", resultMsg: "It is succeeded", data: null }) };
    },
  });
  const payload = { tin: "A123456789Z", bhfId: "00", cmcKey: "provider-key", itemCd: "KE1NTXU0000001", itemClsCd: "5059690800" };
  const result = await provider.saveItem({ payload });
  assert.equal(captured.url, `${ETIMS_BASE_URLS.sandbox}/saveItem`);
  assert.deepEqual(captured.body, payload);
  assert.equal(result.accepted, true);
});

test("sandbox purchase and stock operations use OSCU v2.0 catalogue endpoints", async () => {
  const calls = [];
  const provider = new SandboxEtimsProvider({
    config: sandboxConfig,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ resultCd: "000", resultMsg: "It is succeeded", data: {} }) };
    },
  });
  const purchase = { spplrTin: "P123456789A", invcNo: 1, orgInvcNo: 0, rcptTyCd: "P" };
  const stockMaster = { itemCd: "KE1NTXU0000001", rsdQty: 4 };
  const stockMovement = { sarNo: 1, orgSarNo: 1, sarTyCd: "11", itemList: [] };
  await provider.selectPurchaseSalesList({ lastReqDt: "20261107000000" });
  await provider.savePurchase({ payload: purchase });
  await provider.saveStockMaster({ payload: stockMaster });
  await provider.saveStockItems({ payload: stockMovement });
  assert.equal(calls[0].url, `${ETIMS_BASE_URLS.sandbox}/selectTrnsPurchaseSalesList`);
  assert.equal(calls[1].url, `${ETIMS_BASE_URLS.sandbox}/insertTrnsPurchase`);
  assert.equal(calls[1].body.spplrTin, purchase.spplrTin);
  assert.equal(calls[2].url, `${ETIMS_BASE_URLS.sandbox}/saveStockMaster`);
  assert.equal(calls[3].url, `${ETIMS_BASE_URLS.sandbox}/insertStockIO`);
});

test("sandbox submissions add credentials at the HTTP boundary and preserve sale versus credit receipt fields", async () => {
  const calls = [];
  const provider = new SandboxEtimsProvider({
    config: { ...sandboxConfig, public_config: { ...sandboxConfig.public_config, sdcId: "CU-1" } },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => salesSuccessFixture };
    },
  });
  const sale = await provider.submitInvoice({ payload: { trdInvcNo: "INV-1", invcNo: 10, rcptTyCd: "S", tin: "ATTACKER", cmcKey: "ATTACKER" } });
  const credit = await provider.submitCreditNote({ payload: {
    trdInvcNo: "CN-1", invcNo: 11, orgInvcNo: 10, rcptTyCd: "R", rfdRsnCd: "06", rfdDt: "20261107123456",
  } });
  assert.equal(calls[0].url, `${ETIMS_BASE_URLS.sandbox}/saveTrnsSalesOsdc`);
  assert.equal(calls[0].body.tin, "A123456789Z");
  assert.equal(calls[0].body.cmcKey, "provider-key");
  assert.equal(calls[0].body.rcptTyCd, "S");
  assert.equal(calls[1].body.rcptTyCd, "R");
  assert.equal(calls[1].body.orgInvcNo, 10);
  assert.equal(sale.accepted, true);
  assert.equal(credit.accepted, true);
});

test("sandbox provider rejects invoice-as-credit-note payloads", async () => {
  const provider = new SandboxEtimsProvider({ config: sandboxConfig, fetchImpl: async () => { throw new Error("must not call network"); } });
  await assert.rejects(() => provider.submitCreditNote({ payload: { rcptTyCd: "S" } }), /receipt type R/);
});

test("sandbox invoice acceptance stores only fiscal data returned by KRA", async () => {
  const provider = new SandboxEtimsProvider({
    config: { ...sandboxConfig, public_config: { ...sandboxConfig.public_config, sdcId: "CU-1" } },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ...salesSuccessFixture,
      }),
    }),
  });
  const result = await provider.submitInvoice({ payload: { salesDt: "20261107", rcptTyCd: "S" } });
  assert.equal(result.provider_reference, "CU-1/12");
  assert.equal(result.qr_code, "09112026#083045#CU-1#12#NON_SECRET_FIXTURE_INTERNAL_DATA#NON_SECRET_FIXTURE_RECEIPT_SIGNATURE");
  assert.equal(result.receipt_signature, "NON_SECRET_FIXTURE_RECEIPT_SIGNATURE");
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
