const integrationSettings = require("./integrationSettingsService");

const ETIMS_BASE_URLS = Object.freeze({
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
});

class EtimsProvider {
  async initialize() { throw new Error("EtimsProvider.initialize must be implemented"); }
  async testConnection() { throw new Error("EtimsProvider.testConnection must be implemented"); }
  async submitInvoice() { throw new Error("EtimsProvider.submitInvoice must be implemented"); }
  async submitCreditNote() { throw new Error("EtimsProvider.submitCreditNote must be implemented"); }
}

class DisabledEtimsProvider extends EtimsProvider {
  async initialize() { return { configured: false, message: "eTIMS integration is disabled" }; }
  async testConnection() { return { configured: false, connected: false, message: "eTIMS integration is disabled" }; }
  async submitInvoice() { return { accepted: false, retryable: false, message: "eTIMS integration is disabled" }; }
  async submitCreditNote() { return { accepted: false, retryable: false, message: "eTIMS integration is disabled" }; }
}

class MockEtimsProvider extends EtimsProvider {
  constructor({ fixture = {} } = {}) {
    super();
    this.fixture = fixture;
  }

  async initialize() {
    return this.fixture.initialization || { configured: true, initialized: true, communication_key: "mock-communication-key" };
  }

  async testConnection() {
    return this.fixture.connection || { configured: true, connected: true, provider: "mock" };
  }

  async submitInvoice({ idempotencyKey }) {
    if (this.fixture.error) throw new Error(this.fixture.error);
    return this.fixture.submission || {
      accepted: true,
      provider_reference: `MOCK-${String(idempotencyKey).slice(-16)}`,
      receipt_signature: "MOCK-RECEIPT-SIGNATURE",
      internal_data: "MOCK-INTERNAL-DATA",
      cu_id: "MOCK-CU",
      receipt_counter: "1/1",
      qr_code: "MOCK-VERIFICATION-DATA",
    };
  }

  async submitCreditNote({ idempotencyKey }) {
    return this.submitInvoice({ idempotencyKey });
  }
}

class SandboxEtimsProvider extends EtimsProvider {
  constructor({ config, fetchImpl = globalThis.fetch, timeoutMs = 15000, onCall = async () => {} }) {
    super();
    if (typeof fetchImpl !== "function") throw new Error("Node.js fetch is required for the eTIMS sandbox provider");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.onCall = onCall;
    this.baseUrl = ETIMS_BASE_URLS[config.environment];
    if (!this.baseUrl) throw new Error("Unsupported eTIMS environment");
  }

  async post(path, body, action) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let responsePayload = null;
    let status = "error";
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      responsePayload = await response.json().catch(() => ({}));
      status = response.ok && responsePayload.resultCd === "000" ? "success" : "error";
      if (!response.ok) throw new Error(`KRA eTIMS returned HTTP ${response.status}`);
      if (responsePayload.resultCd !== "000") {
        throw new Error(String(responsePayload.resultMsg || "KRA eTIMS rejected the request"));
      }
      return responsePayload;
    } catch (error) {
      responsePayload = responsePayload || { error: String(error.message || "eTIMS request failed") };
      throw error;
    } finally {
      clearTimeout(timeout);
      await this.onCall({
        action,
        request: body,
        response: responsePayload,
        status,
        durationMs: Date.now() - started,
      });
    }
  }

  async initialize() {
    const { secrets, public_config: publicConfig } = this.config;
    const response = await this.post("/selectInitOsdcInfo", {
      tin: secrets.tin,
      bhfId: publicConfig.bhfId,
      dvcSrlNo: secrets.deviceSerial,
    }, "initialize_device");
    const info = response.data?.info || {};
    return {
      initialized: true,
      response,
      communication_key: info.cmcKey || null,
      sdc_id: info.sdcId || null,
      device_id: info.dvcId || null,
    };
  }

  async testConnection() {
    const { secrets, public_config: publicConfig } = this.config;
    if (!secrets.tin || !secrets.communicationKey || !publicConfig.bhfId) {
      return { configured: false, connected: false, message: "Initialize the eTIMS device before testing the connection" };
    }
    await this.post("/selectCodeList", {
      tin: secrets.tin,
      bhfId: publicConfig.bhfId,
      cmcKey: secrets.communicationKey,
      lastReqDt: "20000101000000",
    }, "test_connection");
    return { configured: true, connected: true, environment: this.config.environment };
  }

  async submitInvoice({ payload }) {
    if (!payload || typeof payload !== "object") throw new Error("A mapped official eTIMS sales request is required");
    const response = await this.post("/saveTrnsSalesOsdc", payload, "submit_invoice");
    const data = response.data || {};
    const sdcId = String(this.config.public_config.sdcId || "").trim();
    const receiptCounter = String(data.curRcptNo || "").trim();
    const cuInvoiceNo = sdcId && receiptCounter ? `${sdcId}/${receiptCounter}` : "";
    const signature = String(data.rcptSign || "").trim();
    const internalData = String(data.intrlData || "").trim();
    const cuId = sdcId;
    const cuDateTime = String(data.sdcDateTime || "").trim();
    if (!cuInvoiceNo || !signature || !internalData || !cuId || !/^\d{14}$/.test(cuDateTime)) {
      return {
        accepted: false,
        retryable: false,
        message: "KRA response omitted required control-unit fiscal fields",
        response,
      };
    }
    const qrDate = `${cuDateTime.slice(6, 8)}${cuDateTime.slice(4, 6)}${cuDateTime.slice(0, 4)}`;
    const verificationData = `${qrDate}#${cuDateTime.slice(8, 14)}#${cuId}#${receiptCounter}#${internalData}#${signature}`;
    return {
      accepted: true,
      provider_reference: cuInvoiceNo,
      receipt_signature: signature,
      internal_data: internalData,
      cu_id: cuId,
      receipt_counter: receiptCounter,
      cu_timestamp: cuDateTime,
      qr_code: verificationData,
      response,
    };
  }

  async submitCreditNote({ payload }) {
    return this.submitInvoice({ payload });
  }
}

async function getEtimsProvider({ companyId, branchId = null, fetchImpl, onCall }) {
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "etims", branchId });
  if (config.provider_mode === "disabled") return new DisabledEtimsProvider();
  if (config.provider_mode === "mock") {
    if (config.environment !== "sandbox") throw new Error("Mock eTIMS provider is permitted only in sandbox environment");
    return new MockEtimsProvider();
  }
  if (config.provider_mode === "sandbox") {
    const logCall = onCall || (async ({ action, request, response, status, durationMs }) => {
      const { logIntegration } = require("./integrationService");
      await logIntegration({
        companyId,
        provider: "etims",
        action,
        request,
        response,
        status,
        durationMs,
        correlationId: require("crypto").randomUUID(),
        outcome: status,
      });
    });
    return new SandboxEtimsProvider({ config, fetchImpl, onCall: logCall });
  }
  return new DisabledEtimsProvider();
}

module.exports = {
  DisabledEtimsProvider,
  EtimsProvider,
  ETIMS_BASE_URLS,
  MockEtimsProvider,
  SandboxEtimsProvider,
  getEtimsProvider,
};
