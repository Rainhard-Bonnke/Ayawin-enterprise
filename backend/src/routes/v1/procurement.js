const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const procurement = require('../../services/procurementService');
const { parsePagination } = require('../../lib/queryHelper');

const router = express.Router();
router.use(authenticateErp);

router.get('/requisitions', requirePermission('procurement.view'), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const [countR, dataR] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM erp_purchase_requisitions WHERE company_id = $1 AND is_deleted = FALSE', [req.user.company_id]),
    pool.query(
      `SELECT * FROM erp_purchase_requisitions WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.company_id, limit, offset],
    ),
  ]);
  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });
});

router.get('/purchase-orders', requirePermission('procurement.view'), async (req, res) => {
  const status = req.query.status;
  const params = [req.user.company_id];
  let filter = '';
  if (status) { params.push(status); filter = `AND po.status = $${params.length}`; }
  const result = await pool.query(
    `SELECT po.*, v.name AS vendor_name, w.name AS warehouse_name
     FROM erp_purchase_orders po
     JOIN erp_vendors v ON v.id = po.vendor_id
     LEFT JOIN erp_warehouses w ON w.id = po.warehouse_id
     WHERE po.company_id = $1 AND po.is_deleted = FALSE ${filter}
     ORDER BY po.order_date DESC`,
    params,
  );
  return res.json(result.rows);
});

router.get('/purchase-orders/:id', requirePermission('procurement.view'), async (req, res) => {
  const po = await pool.query(
    `SELECT po.*, v.name AS vendor_name FROM erp_purchase_orders po
     JOIN erp_vendors v ON v.id = po.vendor_id
     WHERE po.id = $1 AND po.company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  if (!po.rowCount) return res.status(404).json({ error: 'Not found' });
  const lines = await pool.query(
    `SELECT pol.*, i.item_code, i.name AS item_name
     FROM erp_purchase_order_lines pol JOIN erp_items i ON i.id = pol.item_id
     WHERE pol.purchase_order_id = $1 ORDER BY pol.line_no`,
    [req.params.id],
  );
  return res.json({ ...po.rows[0], lines: lines.rows });
});

router.post('/purchase-orders', requirePermission('procurement.create'), async (req, res) => {
  try {
    const po = await procurement.createPurchaseOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      vendorId: req.body.vendor_id,
      warehouseId: req.body.warehouse_id,
      requisitionId: req.body.requisition_id,
      lines: req.body.lines,
      expectedDate: req.body.expected_date,
      notes: req.body.notes,
    });
    return res.status(201).json(po);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/purchase-orders/:id/approve', requirePermission('procurement.approve'), async (req, res) => {
  try {
    const po = await procurement.approvePurchaseOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      poId: req.params.id,
    });
    return res.json(po);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/goods-receipts', requirePermission('procurement.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT g.*, po.po_number FROM erp_goods_receipts g
     JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
     WHERE g.company_id = $1 AND g.is_deleted = FALSE ORDER BY g.received_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/goods-receipts', requirePermission('procurement.create'), async (req, res) => {
  try {
    const result = await procurement.createAndPostGrn({
      companyId: req.user.company_id,
      userId: req.user.id,
      purchaseOrderId: req.body.purchase_order_id,
      warehouseId: req.body.warehouse_id,
      lines: req.body.lines,
      receivedDate: req.body.received_date,
      notes: req.body.notes,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/goods-receipts/:id/post', requirePermission('procurement.approve'), async (req, res) => {
  try {
    const result = await procurement.postGoodsReceipt({
      companyId: req.user.company_id,
      userId: req.user.id,
      grnId: req.params.id,
      postGl: req.body?.post_gl !== false,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
