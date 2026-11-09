const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission, requireAnyPermission } = require("../../middleware/erpAuth");
const { emitEvent, EVENTS, validateWebhookUrl } = require("../../services/webhookService");
const { processImport } = require("../../services/importService");
const integration = require("../../services/integrationService");
const integrationSettings = require("../../services/integrationSettingsService");
const etimsIntegration = require("../../services/etimsIntegrationService");
const mpesa = require("../../services/mpesaService");
const notificationOutbox = require("../../services/notificationOutboxService");

const router = express.Router();
router.post("/integrations/mpesa/callback", async (req, res) => {
  try {
    const result = await mpesa.receiveMpesaCallback({
      token: req.get("x-mpesa-callback-token"),
      payload: req.body,
    });
    return res.status(200).json({ ResultCode: 0, ResultDesc: "Callback received", request_id: result.request_id });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({ ResultCode: 1, ResultDesc: error.message });
  }
});

router.use(authenticateErp);

router.get("/webhooks/events", (req, res) => res.json(EVENTS));

router.get("/integrations/:provider/settings", requirePermission("foundation.view"), async (req, res) => {
  try {
    const settings = await integrationSettings.getIntegrationSettings({
      companyId: req.user.company_id,
      provider: req.params.provider,
      branchId: req.query.branch_id || null,
    });
    return res.json(settings || {
      provider: req.params.provider,
      provider_mode: "disabled",
      environment: "sandbox",
      public_config: {},
      policy: req.params.provider === "etims" ? { submit_on_post: "required" } : { b2c_enabled: false },
      has_secrets: false,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.put("/integrations/:provider/settings", requirePermission("foundation.edit"), async (req, res) => {
  try {
    const body = req.body || {};
    const settings = await integrationSettings.saveIntegrationSettings({
      companyId: req.user.company_id,
      userId: req.user.id,
      branchId: body.branch_id || null,
      provider: req.params.provider,
      providerMode: body.provider_mode,
      environment: body.environment,
      publicConfig: body.public_config,
      secrets: body.secrets,
      policy: body.policy,
    });
    return res.json(settings);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/integrations/mpesa/rotate-callback-token", requirePermission("foundation.edit"), async (req, res) => {
  try {
    const result = await integrationSettings.rotateMpesaCallbackToken({
      companyId: req.user.company_id,
      userId: req.user.id,
      branchId: req.body?.branch_id || null,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/integrations/etims/initialize", requirePermission("foundation.edit"), async (req, res) => {
  try {
    const result = await etimsIntegration.initializeEtimsDevice({
      companyId: req.user.company_id,
      userId: req.user.id,
      branchId: req.body?.branch_id || null,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/integrations/etims/test-connection", requirePermission("foundation.view"), async (req, res) => {
  try {
    return res.json(await etimsIntegration.testEtimsConnection({
      companyId: req.user.company_id,
      branchId: req.body?.branch_id || null,
    }));
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
});

router.get("/webhooks", requirePermission("foundation.view"), async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, url, events, is_active, created_at FROM erp_webhook_subscriptions WHERE company_id = $1 AND is_deleted = FALSE",
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/webhooks", requirePermission("foundation.edit"), async (req, res) => {
  const { name, url, secret, events } = req.body || {};
  if (!name || !url || !events?.length)
    return res.status(400).json({ error: "name, url, events required" });
  try { await validateWebhookUrl(url); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const result = await pool.query(
    `INSERT INTO erp_webhook_subscriptions (company_id, name, url, secret, events, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, url, events, is_active`,
    [req.user.company_id, name, url, secret, events, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/webhooks/test", requirePermission("foundation.edit"), async (req, res) => {
  const result = await emitEvent({
    companyId: req.user.company_id,
    eventType: req.body?.event || "invoice.posted",
    payload: req.body?.payload || { test: true },
  });
  return res.json(result);
});

router.post("/import", requirePermission("master_data.create"), async (req, res) => {
  const { entity_type, rows, file_name } = req.body || {};
  if (!entity_type || !Array.isArray(rows))
    return res.status(400).json({ error: "entity_type and rows required" });
  try {
    const result = await processImport({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: entity_type,
      rows,
      fileName: file_name,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/import/:id", requirePermission("master_data.view"), async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM erp_import_jobs WHERE id = $1 AND company_id = $2",
    [req.params.id, req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Not found" });
  return res.json(result.rows[0]);
});

router.post("/integrations/etims/invoices/:invoiceId/submit", requirePermission("sales.create"), async (req, res) => {
  try {
    const result = await integration.queueEtimsInvoice({
      companyId: req.user.company_id,
      userId: req.user.id,
      invoiceId: req.params.invoiceId,
    });
    return res.status(result.queued ? 202 : 200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/integrations/etims/invoices/:invoiceId", requirePermission("sales.view"), async (req, res) => {
  const submission = await integration.getEtimsSubmission({
    companyId: req.user.company_id,
    invoiceId: req.params.invoiceId,
  });
  if (!submission) return res.status(404).json({ error: "eTIMS submission not found for this invoice" });
  return res.json(submission);
});

router.post("/integrations/mpesa/invoices/:invoiceId/stk-push", requirePermission("sales.create"), async (req, res) => {
  try {
    const result = await mpesa.createStkRequest({
      companyId: req.user.company_id,
      userId: req.user.id,
      invoiceId: req.params.invoiceId,
      phone: req.body?.phone,
      amount: req.body?.amount,
      idempotencyKey: req.get("idempotency-key") || req.body?.idempotency_key,
    });
    return res.status(result.status === "pending" ? 202 : 200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/integrations/mpesa/requests/:id", requirePermission("sales.view"), async (req, res) => {
  const request = await mpesa.getMpesaPaymentRequest({
    companyId: req.user.company_id,
    requestId: req.params.id,
  });
  if (!request) return res.status(404).json({ error: "M-Pesa payment request not found" });
  return res.json(request);
});

router.post("/notifications/send", requireAnyPermission("foundation.edit", "sales.create"), async (req, res) => {
  try {
    const result = await notificationOutbox.enqueueNotification({
      companyId: req.user.company_id,
      userId: req.user.id,
      channel: req.body?.channel || "email",
      destination: req.body?.to,
      subject: req.body?.subject,
      body: req.body?.body,
      idempotencyKey: req.get("idempotency-key") || req.body?.idempotency_key,
    });
    return res.status(result.queued ? 202 : 200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/notifications/:id", requireAnyPermission("foundation.view", "sales.view"), async (req, res) => {
  const notification = await notificationOutbox.getNotification({
    companyId: req.user.company_id,
    notificationId: req.params.id,
  });
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  return res.json(notification);
});

router.get("/jobs", requirePermission("foundation.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_background_jobs WHERE company_id = $1 OR company_id IS NULL
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/jobs", requirePermission("foundation.edit"), async (req, res) => {
  const { job_type, payload, scheduled_at } = req.body || {};
  if (!job_type) return res.status(400).json({ error: "job_type required" });
  const result = await pool.query(
    `INSERT INTO erp_background_jobs (company_id, job_type, payload, scheduled_at, created_by)
     VALUES ($1,$2,$3,COALESCE($4,NOW()),$5) RETURNING *`,
    [req.user.company_id, job_type, payload || {}, scheduled_at, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
