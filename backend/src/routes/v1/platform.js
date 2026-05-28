const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const { emitEvent, EVENTS } = require('../../services/webhookService');
const { processImport } = require('../../services/importService');
const integration = require('../../services/integrationService');

const router = express.Router();
router.use(authenticateErp);

router.get('/webhooks/events', (req, res) => res.json(EVENTS));

router.get('/webhooks', requirePermission('foundation.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, url, events, is_active, created_at FROM erp_webhook_subscriptions WHERE company_id = $1 AND is_deleted = FALSE',
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/webhooks', requirePermission('foundation.edit'), async (req, res) => {
  const { name, url, secret, events } = req.body || {};
  if (!name || !url || !events?.length) return res.status(400).json({ error: 'name, url, events required' });
  const result = await pool.query(
    `INSERT INTO erp_webhook_subscriptions (company_id, name, url, secret, events, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, url, events, is_active`,
    [req.user.company_id, name, url, secret, events, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.post('/webhooks/test', requirePermission('foundation.edit'), async (req, res) => {
  const result = await emitEvent({
    companyId: req.user.company_id,
    eventType: req.body?.event || 'invoice.posted',
    payload: req.body?.payload || { test: true },
  });
  return res.json(result);
});

router.post('/import', requirePermission('master_data.create'), async (req, res) => {
  const { entity_type, rows, file_name } = req.body || {};
  if (!entity_type || !Array.isArray(rows)) return res.status(400).json({ error: 'entity_type and rows required' });
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

router.get('/import/:id', requirePermission('master_data.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_import_jobs WHERE id = $1 AND company_id = $2',
    [req.params.id, req.user.company_id],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Not found' });
  return res.json(result.rows[0]);
});

router.post('/integrations/etims/submit', requirePermission('sales.create'), async (req, res) => {
  const result = await integration.submitEtimsInvoice({
    companyId: req.user.company_id,
    invoice: req.body,
  });
  return res.json(result);
});

router.post('/integrations/mpesa/stk-push', requirePermission('sales.create'), async (req, res) => {
  const { phone, amount, reference } = req.body || {};
  if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
  const result = await integration.initiateMpesaPayment({
    companyId: req.user.company_id,
    phone,
    amount,
    reference,
  });
  return res.json(result);
});

router.post('/notifications/send', requirePermission('foundation.edit'), async (req, res) => {
  const { channel, to, subject, body } = req.body || {};
  if (!to || !body) return res.status(400).json({ error: 'to and body required' });
  const result = await integration.sendNotification({
    companyId: req.user.company_id,
    channel: channel || 'email',
    to,
    subject,
    body,
  });
  return res.json(result);
});

router.get('/jobs', requirePermission('foundation.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_background_jobs WHERE company_id = $1 OR company_id IS NULL
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/jobs', requirePermission('foundation.edit'), async (req, res) => {
  const { job_type, payload, scheduled_at } = req.body || {};
  if (!job_type) return res.status(400).json({ error: 'job_type required' });
  const result = await pool.query(
    `INSERT INTO erp_background_jobs (company_id, job_type, payload, scheduled_at, created_by)
     VALUES ($1,$2,$3,COALESCE($4,NOW()),$5) RETURNING *`,
    [req.user.company_id, job_type, payload || {}, scheduled_at, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
