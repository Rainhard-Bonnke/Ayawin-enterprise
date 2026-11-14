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
const etimsItems = require("../../services/etimsItemService");
const mpesaStatements = require("../../services/mpesaStatementService");
const mpesaB2c = require("../../services/mpesaB2cService");
const { getOpsStatus } = require("../../services/opsStatusService");
const {
  DEFAULT_WORKFLOWS,
  listApprovalRequests,
  createApprovalRequest,
  getApprovalRequest,
  applyApprovalActionById,
} = require("../../services/approvalWorkflowService");
const {
  createDocumentAttachment,
  listDocumentAttachments,
  getDocumentAttachment,
  ALLOWED_MIME_TYPES,
} = require("../../services/documentAttachmentService");
const { createOrgNode, listOrgHierarchy, buildOrgTree, validateHierarchy } = require("../../services/orgHierarchyService");
const { createBranchDimension, summarizeBranchBalances, consolidateBranchBalances, createBranchJournalEntry } = require("../../services/branchDimensionService");
const { createReminder, listReminders, getDueReminders } = require("../../services/notificationReminderService");
const { importOpeningBalance } = require("../../services/openingBalanceImportService");
const { applyRlsScope, canAccessRecord } = require("../../services/rowLevelSecurityService");

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
      environment: req.query.environment || "sandbox",
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

router.post("/integrations/:provider/production-certification", requirePermission("integrations.production_certify"), async (req, res) => {
  try {
    const certification = await integrationSettings.certifyProductionIntegration({
      companyId: req.user.company_id,
      userId: req.user.id,
      provider: req.params.provider,
      checklist: req.body?.checklist,
    });
    return res.status(201).json(certification);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/integrations/notifications/:provider/rotate-delivery-token", requirePermission("foundation.edit"), async (req, res) => {
  try {
    return res.status(201).json(await integrationSettings.rotateNotificationDeliveryToken({
      companyId: req.user.company_id,
      userId: req.user.id,
      provider: req.params.provider,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to rotate notification delivery token" });
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

router.post("/integrations/etims/reference-data/refresh", requirePermission("foundation.edit"), async (req, res) => {
  try {
    return res.json(await etimsItems.refreshEtimsReferenceData({
      companyId: req.user.company_id,
      branchId: req.body?.branch_id || null,
      lastReqDt: req.body?.last_req_dt || null,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to refresh KRA eTIMS reference data" });
  }
});

router.get("/integrations/etims/reference-data/status", requirePermission("foundation.view"), async (req, res) => {
  try {
    return res.json({ lists: await etimsItems.listEtimsReferenceSyncStatus({ companyId: req.user.company_id }) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load eTIMS reference status" });
  }
});

router.post("/integrations/etims/items/register", requirePermission("master_data.edit"), async (req, res) => {
  try {
    const result = await etimsItems.enqueueEtimsItemRegistrations({
      companyId: req.user.company_id,
      userId: req.user.id,
      itemIds: Array.isArray(req.body?.item_ids) ? req.body.item_ids : null,
      dryRun: req.body?.dry_run === true,
    });
    return res.status(req.body?.dry_run ? 200 : 202).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to prepare eTIMS item registration" });
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

router.get("/approvals/workflows", requirePermission("foundation.view"), (_req, res) => {
  return res.json(Object.values(DEFAULT_WORKFLOWS));
});

router.get("/approvals/requests", requirePermission("foundation.view"), (req, res) => {
  return res.json(listApprovalRequests({ companyId: req.user.company_id }));
});

router.post("/approvals/requests", requirePermission("foundation.edit"), (req, res) => {
  const { documentType, documentId, amount, requestedBy } = req.body || {};
  if (!documentType || !documentId) {
    return res.status(400).json({ error: "documentType and documentId are required" });
  }

  try {
    const request = createApprovalRequest({
      companyId: req.user.company_id,
      documentType,
      documentId,
      requestedBy: requestedBy || req.user.id,
      amount: Number(amount || 0),
    });
    return res.status(201).json(request);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/approvals/requests/:id", requirePermission("foundation.view"), (req, res) => {
  const request = getApprovalRequest(req.params.id, { companyId: req.user.company_id });
  if (!request) return res.status(404).json({ error: "Approval request not found" });
  return res.json(request);
});

router.get("/documents/:documentType/:documentId/attachments", requirePermission("foundation.view"), (req, res) => {
  try {
    return res.json(listDocumentAttachments({
      companyId: req.user.company_id,
      documentType: req.params.documentType,
      documentId: req.params.documentId,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/documents/:documentType/:documentId/attachments", requirePermission("foundation.edit"), (req, res) => {
  const { fileName, contentType, byteSize, sha256, metadata, blob } = req.body || {};
  if (!fileName || !contentType || !blob) {
    return res.status(400).json({ error: "fileName, contentType, and blob are required" });
  }
  if (!ALLOWED_MIME_TYPES.has(String(contentType))) {
    return res.status(400).json({ error: "Attachment content type is not allowed" });
  }

  try {
    const attachment = createDocumentAttachment({
      companyId: req.user.company_id,
      documentType: req.params.documentType,
      documentId: req.params.documentId,
      fileName,
      contentType,
      byteSize: Number(byteSize ?? 0),
      sha256,
      uploadedBy: req.user.id,
      metadata: metadata || {},
      blob,
    });
    return res.status(201).json(attachment);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/documents/:documentType/:documentId/attachments/:attachmentId", requirePermission("foundation.view"), (req, res) => {
  const attachment = getDocumentAttachment({
    companyId: req.user.company_id,
    documentType: req.params.documentType,
    documentId: req.params.documentId,
    attachmentId: req.params.attachmentId,
  });
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });
  return res.json(attachment);
});

router.post("/approvals/requests/:id/actions", requirePermission("foundation.edit"), (req, res) => {
  const { action, comment } = req.body || {};
  if (!action) {
    return res.status(400).json({ error: "action is required" });
  }

  try {
    const request = applyApprovalActionById(req.params.id, action, {
      id: req.user.id,
      role: req.user.role,
      position: req.user.position,
      email: req.user.email,
    }, { comment, companyId: req.user.company_id });
    return res.json(request);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/org-hierarchy", requirePermission("foundation.view"), (req, res) => {
  return res.json({
    companyId: req.user.company_id,
    tree: buildOrgTree(req.user.company_id),
    validation: validateHierarchy(req.user.company_id),
  });
});

router.post("/org-hierarchy", requirePermission("foundation.edit"), (req, res) => {
  try {
    const node = createOrgNode({
      companyId: req.user.company_id,
      name: req.body?.name,
      type: req.body?.type,
      parentId: req.body?.parent_id || null,
      branchId: req.body?.branch_id || null,
      metadata: req.body?.metadata || {},
    });
    return res.status(201).json(node);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/branch-dimensions", requirePermission("foundation.view"), (_req, res) => {
  return res.json(Array.from(new Map()).size === 0 ? [] : []);
});

router.post("/branch-dimensions", requirePermission("foundation.edit"), (req, res) => {
  try {
    const branch = createBranchDimension({
      companyId: req.user.company_id,
      branchId: req.body?.branch_id,
      branchName: req.body?.branch_name,
      currency: req.body?.currency || "KES",
      allowedAccounts: req.body?.allowed_accounts || [],
    });
    return res.status(201).json(branch);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/branch-dimensions/consolidate", requirePermission("finance.view"), (req, res) => {
  try {
    const result = consolidateBranchBalances(Array.isArray(req.body?.entries) ? req.body.entries : []);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/reminders", requirePermission("foundation.view"), (req, res) => {
  return res.json(listReminders({ companyId: req.user.company_id, status: req.query?.status || null }));
});

router.post("/reminders", requirePermission("foundation.edit"), (req, res) => {
  try {
    const reminder = createReminder({
      companyId: req.user.company_id,
      entityType: req.body?.entity_type,
      entityId: req.body?.entity_id,
      recipient: req.body?.recipient,
      dueAt: req.body?.due_at,
      subject: req.body?.subject,
      message: req.body?.message,
      channel: req.body?.channel || "email",
    });
    return res.status(201).json(reminder);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/reminders/due", requirePermission("foundation.view"), (req, res) => {
  return res.json(getDueReminders({ companyId: req.user.company_id, now: req.query?.now || new Date().toISOString() }));
});

router.post("/opening-balances/import", requirePermission("finance.edit"), (req, res) => {
  try {
    const result = importOpeningBalance({ companyId: req.user.company_id, rows: req.body?.rows || [] });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/rls/access-check", requirePermission("foundation.view"), (req, res) => {
  try {
    const record = req.body?.record || {};
    const scope = req.body?.scope || { companyId: req.user.company_id, branchId: req.body?.branch_id || null, allowedBranches: req.body?.allowed_branches || [], role: req.body?.role || req.user.role };
    return res.json({
      allowed: canAccessRecord(record, scope),
      filtered: applyRlsScope(Array.isArray(req.body?.records) ? req.body.records : [record], scope),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
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

router.post("/integrations/etims/invoices/:invoiceId/submit", requirePermission("sales.invoice.post"), async (req, res) => {
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

router.get("/integrations/etims/exceptions", requirePermission("foundation.view"), async (req, res) => {
  try {
    const submissions = await integration.getEtimsExceptions({
      companyId: req.user.company_id,
      limit: req.query.limit,
    });
    return res.json({ submissions });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load eTIMS exceptions" });
  }
});

router.get("/integrations/exceptions", requirePermission("reports.view"), async (req,res)=>{
  try{
    return res.json({exceptions:await integration.getEtimsExceptions({companyId:req.user.company_id,limit:req.query.limit})});
  }catch(error){return res.status(400).json({error:error.message||"Unable to load integration exceptions"});}
});

router.post("/integrations/etims/events/:id/retry", requirePermission("integrations.retry"), async (req, res) => {
  try {
    return res.json(await integration.retryEtimsEvent({
      companyId: req.user.company_id,
      userId: req.user.id,
      eventId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to retry eTIMS event" });
  }
});

router.post("/integrations/etims/invoices/:id/retry", requirePermission("integrations.retry"), async (req,res)=>{
  try{return res.json(await integration.retryEtimsInvoice({companyId:req.user.company_id,invoiceId:req.params.id,userId:req.user.id}));}
  catch(error){return res.status(400).json({error:error.message||"Unable to retry eTIMS invoice"});}
});

router.get("/integrations/etims/invoices/:invoiceId", requirePermission("sales.view"), async (req, res) => {
  const submission = await integration.getEtimsSubmission({
    companyId: req.user.company_id,
    invoiceId: req.params.invoiceId,
  });
  if (!submission) return res.status(404).json({ error: "eTIMS submission not found for this invoice" });
  return res.json(submission);
});

router.post("/integrations/mpesa/invoices/:invoiceId/stk-push", requirePermission("sales.receipt.create"), async (req, res) => {
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

router.get("/integrations/mpesa/unallocated-payments", requirePermission("sales.view"), async (req, res) => {
  try {
    return res.json({ transactions: await mpesa.getUnallocatedMpesaTransactions({
      companyId: req.user.company_id,
      limit: req.query.limit,
    }) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load unallocated M-Pesa payments" });
  }
});

router.post("/integrations/mpesa/unallocated-payments/:id/allocate", requirePermission("sales.receipt.create"), async (req, res) => {
  try {
    return res.json(await mpesa.allocateMpesaTransaction({
      companyId: req.user.company_id,
      userId: req.user.id,
      transactionId: req.params.id,
      customerId: req.body?.customer_id || null,
      invoiceId: req.body?.invoice_id || null,
      allocations: req.body?.allocations || [],
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to allocate M-Pesa payment" });
  }
});

router.post("/integrations/mpesa/unallocated-payments/:id/reject", requirePermission("sales.receipt.approve"), async (req, res) => {
  try {
    return res.json(await mpesa.rejectMpesaTransaction({
      companyId: req.user.company_id,
      userId: req.user.id,
      transactionId: req.params.id,
      reason: req.body?.reason,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to reject M-Pesa payment" });
  }
});

router.post("/integrations/mpesa/statements/import", requirePermission("sales.receipt.approve"),
  express.text({ type: ["text/csv", "application/csv"], limit: "10mb" }), async (req, res) => {
    try {
      const csvText = typeof req.body === "string" ? req.body : req.body?.csv;
      const result = await mpesaStatements.importMpesaStatement({
        companyId: req.user.company_id,
        userId: req.user.id,
        statementReference: req.body?.statement_reference || req.get("x-statement-reference"),
        csvText,
        fileName: req.body?.file_name || null,
      });
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to import M-Pesa statement" });
    }
  });

router.get("/integrations/mpesa/statements/:id/variance", requirePermission("sales.view"), async (req, res) => {
  try {
    const report = await mpesaStatements.getMpesaStatementVariance({ companyId: req.user.company_id, importId: req.params.id });
    if (!report) return res.status(404).json({ error: "M-Pesa statement import not found" });
    return res.json(report);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load M-Pesa statement variance" });
  }
});

router.post("/integrations/mpesa/refunds/prepare", requirePermission("sales.credit_note.create"), async (req, res) => {
  try {
    const result = await mpesaB2c.prepareB2cRefund({
      companyId: req.user.company_id,
      userId: req.user.id,
      creditNoteId: req.body?.credit_note_id,
      phone: req.body?.phone,
      idempotencyKey: req.get("idempotency-key") || req.body?.idempotency_key,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to prepare M-Pesa refund" });
  }
});

router.get("/integrations/mpesa/refunds", requirePermission("sales.view"), async (req, res) => {
  try {
    return res.json({ refunds: await mpesaB2c.listB2cRefundRequests({ companyId: req.user.company_id, limit: req.query.limit }) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load M-Pesa refund requests" });
  }
});

router.post("/integrations/mpesa/refunds/:id/approve", requirePermission("sales.credit_note.approve"), async (req, res) => {
  try {
    return res.json(await mpesaB2c.approveAndReleaseB2cRefund({
      companyId: req.user.company_id,
      userId: req.user.id,
      requestId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to approve M-Pesa refund" });
  }
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

router.get("/notifications/templates", requirePermission("foundation.view"), async (req, res) => {
  try {
    return res.json({ templates: await notificationOutbox.listNotificationTemplates({ companyId: req.user.company_id }) });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to load notification templates" });
  }
});

router.put("/notifications/templates/:code", requirePermission("foundation.edit"), async (req, res) => {
  try {
    const template = await notificationOutbox.saveNotificationTemplate({
      companyId: req.user.company_id,
      userId: req.user.id,
      code: req.params.code,
      channel: req.body?.channel,
      subject: req.body?.subject,
      body: req.body?.body,
    });
    return res.json(template);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to save notification template" });
  }
});

router.post("/notifications/send-template", requireAnyPermission("foundation.edit", "sales.create"), async (req, res) => {
  try {
    const result = await notificationOutbox.enqueueTemplatedNotification({
      companyId: req.user.company_id,
      userId: req.user.id,
      code: req.body?.template_code,
      destination: req.body?.to,
      variables: req.body?.variables || {},
      idempotencyKey: req.get("idempotency-key") || req.body?.idempotency_key,
    });
    return res.status(result.queued ? 202 : 200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to queue notification" });
  }
});

router.post("/notifications/opt-outs", requirePermission("foundation.edit"), async (req, res) => {
  try {
    return res.status(201).json(await notificationOutbox.addNotificationOptOut({
      companyId: req.user.company_id,
      userId: req.user.id,
      channel: req.body?.channel,
      destination: req.body?.destination,
      reason: req.body?.reason,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to add notification opt-out" });
  }
});

router.delete("/notifications/opt-outs", requirePermission("foundation.edit"), async (req, res) => {
  try {
    return res.json(await notificationOutbox.removeNotificationOptOut({
      companyId: req.user.company_id,
      channel: req.body?.channel,
      destination: req.body?.destination,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to remove notification opt-out" });
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

router.get("/status", requirePermission("foundation.view"), async (req, res) => {
  try {
    return res.json(await getOpsStatus({ companyId: req.user.company_id }));
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unable to load platform health status" });
  }
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
