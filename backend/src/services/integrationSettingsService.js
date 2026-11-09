const crypto = require("crypto");
const net = require("net");
const ipaddr = require("ipaddr.js");
const pool = require("../db");
const { decryptIntegrationSecret, encryptIntegrationSecret } = require("../lib/integrationSecrets");

const PROVIDERS = new Set(["etims", "mpesa"]);
const MODES = new Set(["disabled", "mock", "sandbox"]);
const ENVIRONMENTS = new Set(["sandbox", "production"]);
const DEFAULT_POLICY = { etims: { submit_on_post: "required" }, mpesa: { b2c_enabled: false } };

function normalizeSettingInput({ provider, providerMode, environment, publicConfig, secrets, policy }) {
  if (!PROVIDERS.has(provider)) throw new Error("Unsupported integration provider");
  if (!MODES.has(providerMode)) throw new Error("Provider mode must be disabled, mock, or sandbox");
  if (!ENVIRONMENTS.has(environment)) throw new Error("Environment must be sandbox or production");
  if (publicConfig !== undefined && (!publicConfig || typeof publicConfig !== "object" || Array.isArray(publicConfig))) {
    throw new Error("Public provider configuration must be an object");
  }
  if (secrets !== undefined && (!secrets || typeof secrets !== "object" || Array.isArray(secrets))) {
    throw new Error("Provider secrets must be an object");
  }
  if (policy !== undefined && (!policy || typeof policy !== "object" || Array.isArray(policy))) {
    throw new Error("Integration policy must be an object");
  }
  return {
    provider,
    providerMode,
    environment,
    publicConfig: publicConfig || {},
    secrets: secrets || null,
    policy: { ...DEFAULT_POLICY[provider], ...(policy || {}) },
  };
}

function redactPublicConfig(value) {
  const safe = { ...(value || {}) };
  for (const key of Object.keys(safe)) {
    if (/secret|pass(key|word)|credential|token|key$/i.test(key)) delete safe[key];
  }
  return safe;
}

async function getIntegrationSettings({ companyId, provider, branchId = null, includeSecrets = false }) {
  if (!PROVIDERS.has(provider)) throw new Error("Unsupported integration provider");
  const result = await pool.query(
    `SELECT id, company_id, branch_id, provider, provider_mode, environment,
            public_config, policy, secret_payload_encrypted, updated_at
     FROM erp_integration_settings
     WHERE company_id = $1 AND provider = $2
       AND (($3::uuid IS NULL AND branch_id IS NULL) OR branch_id = $3)
     LIMIT 1`,
    [companyId, provider, branchId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const settings = {
    id: row.id,
    company_id: row.company_id,
    branch_id: row.branch_id,
    provider: row.provider,
    provider_mode: row.provider_mode,
    environment: row.environment,
    public_config: redactPublicConfig(row.public_config),
    policy: row.policy,
    has_secrets: Boolean(row.secret_payload_encrypted),
    updated_at: row.updated_at,
  };
  if (includeSecrets && row.secret_payload_encrypted) {
    settings.secrets = JSON.parse(decryptIntegrationSecret(row.secret_payload_encrypted));
  }
  return settings;
}

async function saveIntegrationSettings({ companyId, userId, branchId = null, ...input }) {
  const setting = normalizeSettingInput(input);
  if (branchId) {
    const branch = await pool.query(
      "SELECT id FROM erp_branches WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE",
      [branchId, companyId],
    );
    if (!branch.rowCount) throw new Error("Branch does not belong to this company");
  }
  const previous = await pool.query(
    `SELECT secret_payload_encrypted FROM erp_integration_settings
     WHERE company_id = $1 AND provider = $2
       AND (($3::uuid IS NULL AND branch_id IS NULL) OR branch_id = $3)`,
    [companyId, setting.provider, branchId],
  );
  const encryptedSecrets = setting.secrets
    ? encryptIntegrationSecret(JSON.stringify(setting.secrets))
    : previous.rows[0]?.secret_payload_encrypted || null;
  const conflictClause = branchId
    ? "ON CONFLICT (company_id, branch_id, provider) WHERE branch_id IS NOT NULL"
    : "ON CONFLICT (company_id, provider) WHERE branch_id IS NULL";
  const result = await pool.query(
    `INSERT INTO erp_integration_settings (
       company_id, branch_id, provider, provider_mode, environment,
       public_config, secret_payload_encrypted, policy, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9)
     ${conflictClause}
       DO UPDATE SET provider_mode = EXCLUDED.provider_mode,
         environment = EXCLUDED.environment, public_config = EXCLUDED.public_config,
         secret_payload_encrypted = EXCLUDED.secret_payload_encrypted,
         policy = EXCLUDED.policy, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING id, company_id, branch_id, provider, provider_mode, environment,
       public_config, policy, (secret_payload_encrypted IS NOT NULL) AS has_secrets, updated_at`,
    [companyId, branchId, setting.provider, setting.providerMode, setting.environment,
      JSON.stringify(setting.publicConfig), encryptedSecrets, JSON.stringify(setting.policy), userId],
  );
  return { ...result.rows[0], public_config: redactPublicConfig(result.rows[0].public_config) };
}

async function getProviderRuntimeConfig({ companyId, provider, branchId = null }) {
  const settings = await getIntegrationSettings({ companyId, provider, branchId, includeSecrets: true })
    || (branchId ? await getIntegrationSettings({ companyId, provider, branchId: null, includeSecrets: true }) : null);
  if (!settings) return { provider_mode: "disabled", environment: "sandbox", public_config: {}, secrets: {}, policy: DEFAULT_POLICY[provider] };
  return {
    provider_mode: settings.provider_mode,
    environment: settings.environment,
    public_config: settings.public_config,
    secrets: settings.secrets || {},
    policy: settings.policy,
  };
}

async function rotateMpesaCallbackToken({ companyId, userId, branchId = null }) {
  const config = await getProviderRuntimeConfig({ companyId, provider: "mpesa", branchId });
  const callbackBaseUrl = String(config.public_config.callbackBaseUrl || "").trim().replace(/\/+$/, "");
  if (!callbackBaseUrl) throw new Error("Configure the public callback base URL before creating a callback token");
  let parsedUrl;
  try { parsedUrl = new URL(callbackBaseUrl); }
  catch { throw new Error("Callback base URL must be a valid HTTP(S) URL"); }
  const hostname = parsedUrl.hostname.toLowerCase();
  const isLiteralIp = net.isIP(hostname) !== 0;
  const ipRange = isLiteralIp ? ipaddr.parse(hostname).range() : null;
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname.endsWith(".test") || !hostname.includes(".")
    || (ipRange && ["private", "loopback", "linkLocal", "uniqueLocal", "unspecified", "reserved"].includes(ipRange))
    || (config.environment === "production" && parsedUrl.protocol !== "https:")
  ) {
    throw new Error("Production M-Pesa callbacks require a public HTTPS hostname");
  }
  if (!new Set(["https:", "http:"]).has(parsedUrl.protocol)) throw new Error("Callback base URL must use HTTP or HTTPS");
  const callbackToken = crypto.randomBytes(32).toString("base64url");
  const callbackUrl = `${callbackBaseUrl}/api/v1/callbacks/mpesa/${companyId}/${callbackToken}`;
  await saveIntegrationSettings({
    companyId,
    userId,
    branchId,
    provider: "mpesa",
    providerMode: config.provider_mode,
    environment: config.environment,
    publicConfig: config.public_config,
    secrets: { ...config.secrets, callbackToken },
    policy: config.policy,
  });
  return { callback_url: callbackUrl, token: callbackToken };
}

module.exports = {
  getIntegrationSettings,
  getProviderRuntimeConfig,
  normalizeSettingInput,
  rotateMpesaCallbackToken,
  saveIntegrationSettings,
};
