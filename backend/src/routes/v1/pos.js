const express = require('express');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { ensureCompanyContext } = require('../../middleware/ensureCompanyContext');
const { logAudit } = require('../../services/auditService');
const pos = require('../../services/posService');
const sales = require('../../services/salesService');

const router = express.Router();
router.use(authenticateErp);
router.use(ensureCompanyContext);

router.get('/catalog', requirePermission('sales.view'), async (req, res) => {
  const warehouseId = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : '';
  const customerId = typeof req.query.customer_id === 'string' ? req.query.customer_id : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!warehouseId) return res.status(400).json({ error: 'warehouse_id is required' });
  try {
    const catalog = await pos.getPosCatalog(req.user.company_id, {
      warehouseId,
      customerId,
      q,
    });
    return res.json(catalog);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/preview-totals', requirePermission('sales.view'), async (req, res) => {
  const { customer_id, lines } = req.body || {};
  if (!lines?.length) return res.status(400).json({ error: 'lines required' });
  try {
    let customerId = customer_id;
    if (!customerId) {
      customerId = await pos.resolveWalkInCustomer(req.user.company_id, req.user.id);
    }
    const priced = await sales.previewOrderTotals({
      companyId: req.user.company_id,
      customerId,
      lines,
    });
    return res.json(priced);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/sales', requirePermission('sales.create'), async (req, res) => {
  const {
    warehouse_id,
    customer_id,
    lines,
    payment_method,
    reference_no,
    notes,
  } = req.body || {};
  if (!warehouse_id || !lines?.length) {
    return res.status(400).json({ error: 'warehouse_id and lines are required' });
  }
  try {
    const result = await pos.completePosSale({
      companyId: req.user.company_id,
      userId: req.user.id,
      warehouseId: warehouse_id,
      customerId: customer_id,
      lines,
      paymentMethod: payment_method || 'cash',
      referenceNo: reference_no,
      notes,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'pos_sale',
      entityId: result.sales_order_id,
      action: 'create',
      newValues: result,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ error: err.message, code: err.code, details: err.details });
    }
    console.error(err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
