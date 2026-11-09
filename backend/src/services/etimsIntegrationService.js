const integrationSettings = require("./integrationSettingsService");
const { getEtimsProvider } = require("./etimsProvider");

function assertSandboxConfiguration(config) {
  if (!config.secrets.tin || !config.secrets.deviceSerial || !config.public_config.bhfId) {
    throw new Error("Configure the taxpayer PIN, device serial, and branch ID before initializing eTIMS");
  }
  if (config.environment !== "sandbox") {
    throw new Error("Device initialization must be completed in the sandbox before production use");
  }
}

async function initializeEtimsDevice({ companyId, userId, branchId = null, fetchImpl }) {
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "etims", branchId });
  if (config.provider_mode === "disabled") throw new Error("eTIMS integration is disabled");
  assertSandboxConfiguration(config);
  const provider = await getEtimsProvider({ companyId, branchId, fetchImpl });
  const result = await provider.initialize();
  if (!result.initialized || !result.communication_key) {
    throw new Error("KRA did not return an eTIMS communication key; device initialization is incomplete");
  }
  await integrationSettings.saveIntegrationSettings({
    companyId,
    userId,
    branchId,
    provider: "etims",
    providerMode: config.provider_mode,
    environment: config.environment,
    publicConfig: { ...config.public_config, ...(result.sdc_id ? { sdcId: result.sdc_id } : {}), ...(result.device_id ? { deviceId: result.device_id } : {}) },
    secrets: { ...config.secrets, communicationKey: result.communication_key },
    policy: config.policy,
  });
  return { initialized: true, sdc_id: result.sdc_id || null, device_id: result.device_id || null };
}

async function testEtimsConnection({ companyId, branchId = null, fetchImpl }) {
  const config = await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "etims", branchId });
  if (config.provider_mode === "disabled") return { configured: false, connected: false, message: "eTIMS integration is disabled" };
  const provider = await getEtimsProvider({ companyId, branchId, fetchImpl });
  const result = await provider.testConnection();
  return {
    configured: result.configured !== false,
    connected: result.connected === true,
    environment: config.environment,
    message: result.message || (result.connected ? "eTIMS connection succeeded" : "eTIMS connection is not initialized"),
  };
}

module.exports = { initializeEtimsDevice, testEtimsConnection };
