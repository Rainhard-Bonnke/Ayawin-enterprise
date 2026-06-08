const express = require('express');

const pool = require('../../db');

const { authenticateErp, requirePermission, requireAnyPermission } = require('../../middleware/erpAuth');

const canManageStock = requireAnyPermission(
  'procurement.create',
  'master_data.create',
  'master_data.edit',
  'sales.create',
);

const inventory = require('../../services/inventoryService');

const adjustments = require('../../services/inventoryAdjustmentService');

const { REASON_CODES } = require('../../lib/inventoryReasonCodes');



const router = express.Router();

router.use(authenticateErp);



router.get('/stock', requirePermission('procurement.view'), async (req, res) => {

  const rows = await inventory.getStockOnHand(req.user.company_id, {

    warehouseId: req.query.warehouse_id,

    itemId: req.query.item_id,

    q: req.query.q,

  });

  return res.json(rows);

});

router.get('/catalog', requireAnyPermission('procurement.view', 'sales.view'), async (req, res) => {
  const warehouseId = typeof req.query.warehouse_id === 'string' ? req.query.warehouse_id : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!warehouseId) return res.status(400).json({ error: 'warehouse_id is required' });
  try {
    const pos = require('../../services/posService');
    const catalog = await pos.getPosCatalog(req.user.company_id, { warehouseId, q });
    return res.json(catalog);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/lookup', requirePermission('procurement.view'), async (req, res) => {

  try {

    const rows = await inventory.lookupByBarcode(req.user.company_id, req.query.barcode || req.query.q);

    return res.json(rows);

  } catch (err) {

    return res.status(404).json({ error: err.message });

  }

});



router.get('/valuation', requirePermission('procurement.view'), async (req, res) => {

  const data = await inventory.getStockValuation(req.user.company_id, {

    warehouseId: req.query.warehouse_id,

  });

  return res.json(data);

});



router.get('/reorder-alerts', requirePermission('procurement.view'), async (req, res) => {

  const rows = await inventory.getReorderAlerts(req.user.company_id);

  return res.json(rows);

});



router.get('/adjustment-reason-codes', requirePermission('procurement.view'), (_req, res) => {

  return res.json(REASON_CODES);

});



router.get('/batches', requirePermission('procurement.view'), async (req, res) => {

  const { warehouse_id, item_id } = req.query;

  if (!warehouse_id || !item_id) {

    return res.status(400).json({ error: 'warehouse_id and item_id required' });

  }

  const rows = await inventory.getBatchBalances(pool, req.user.company_id, warehouse_id, item_id);

  return res.json(rows);

});



router.get('/fefo-pick', requirePermission('procurement.view'), async (req, res) => {

  const { warehouse_id, item_id, quantity } = req.query;

  if (!warehouse_id || !item_id || !quantity) {

    return res.status(400).json({ error: 'warehouse_id, item_id, quantity required' });

  }

  try {

    const plan = await inventory.getFefoPickPlan(

      req.user.company_id,

      warehouse_id,

      item_id,

      Number(quantity),

    );

    return res.json(plan);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



router.get('/movements', requirePermission('procurement.view'), async (req, res) => {

  const rows = await inventory.getMovementHistory(req.user.company_id, {

    limit: req.query.limit,

    itemId: req.query.item_id,

    warehouseId: req.query.warehouse_id,

  });

  return res.json(rows);

});



router.post('/stock-in', canManageStock, async (req, res) => {

  const { warehouse_id, item_id, quantity, unit_cost, notes, batch_no, expiry_date } = req.body || {};

  if (!warehouse_id || !item_id || !quantity || Number(quantity) <= 0) {

    return res.status(400).json({ error: 'warehouse_id, item_id, and positive quantity required' });

  }

  if (unit_cost != null && Number(unit_cost) < 0) {

    return res.status(400).json({ error: 'unit_cost cannot be negative' });

  }



  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const ref = await client.query('SELECT gen_random_uuid() AS id');

    const referenceId = ref.rows[0].id;



    await inventory.recordReceipt(client, {

      companyId: req.user.company_id,

      warehouseId: warehouse_id,

      itemId: item_id,

      quantity: Number(quantity),

      unitCost: Number(unit_cost) || 0,

      referenceType: notes ? 'adjustment' : 'receipt',

      referenceId,

      batchNo: batch_no,

      expiryDate: expiry_date,

      userId: req.user.id,

    });



    await client.query('COMMIT');

    inventory.publishInventoryUpdate(req.user.company_id, {

      type: 'stock_in',

      warehouse_id,

      item_id,

      quantity: Number(quantity),

    });

    return res.status(201).json({ ok: true, reference_id: referenceId });

  } catch (err) {

    await client.query('ROLLBACK');

    return res.status(400).json({ error: err.message });

  } finally {

    client.release();

  }

});



router.post('/transfers', canManageStock, async (req, res) => {

  const { from_warehouse_id, to_warehouse_id, lines, notes } = req.body || {};

  if (!from_warehouse_id || !to_warehouse_id || !lines?.length) {

    return res.status(400).json({ error: 'from_warehouse_id, to_warehouse_id, lines required' });

  }

  if (String(from_warehouse_id) === String(to_warehouse_id)) {

    return res.status(400).json({ error: 'from_warehouse_id and to_warehouse_id must be different' });

  }

  if (!Array.isArray(lines) || lines.some((line) => !line?.item_id || Number(line.quantity) <= 0)) {

    return res.status(400).json({ error: 'each transfer line requires item_id and positive quantity' });

  }



  const client = await pool.connect();

  try {

    await client.query('BEGIN');

    const countR = await client.query('SELECT COUNT(*)::int AS n FROM erp_stock_transfers WHERE company_id = $1', [req.user.company_id]);

    const transferNo = `ST-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, '0')}`;



    const tr = await client.query(

      `INSERT INTO erp_stock_transfers (company_id, transfer_no, from_warehouse_id, to_warehouse_id, status, notes, created_by)

       VALUES ($1,$2,$3,$4,'draft',$5,$6) RETURNING *`,

      [req.user.company_id, transferNo, from_warehouse_id, to_warehouse_id, notes, req.user.id],

    );

    const transfer = tr.rows[0];



    let lineNo = 1;

    for (const line of lines) {

      await client.query(

        `INSERT INTO erp_stock_transfer_lines (company_id, transfer_id, line_no, item_id, quantity, created_by)

         VALUES ($1,$2,$3,$4,$5,$6)`,

        [req.user.company_id, transfer.id, lineNo++, line.item_id, line.quantity, req.user.id],

      );



      const cost = await inventory.recordIssue(client, {

        companyId: req.user.company_id,

        warehouseId: from_warehouse_id,

        itemId: line.item_id,

        quantity: line.quantity,

        referenceType: 'stock_transfer',

        referenceId: transfer.id,

        userId: req.user.id,

        useFefo: true,

      });



      await inventory.recordReceipt(client, {

        companyId: req.user.company_id,

        warehouseId: to_warehouse_id,

        itemId: line.item_id,

        quantity: line.quantity,

        unitCost: cost,

        referenceType: 'stock_transfer',

        referenceId: transfer.id,

        userId: req.user.id,

        batchNo: line.batch_no,

        expiryDate: line.expiry_date,

      });

    }



    await client.query(

      `UPDATE erp_stock_transfers SET status = 'posted', posted_at = NOW(), updated_at = NOW() WHERE id = $1`,

      [transfer.id],

    );

    await client.query('COMMIT');

    inventory.publishInventoryUpdate(req.user.company_id, {

      type: 'transfer',

      transfer_no: transferNo,

      from_warehouse_id,

      to_warehouse_id,

    });

    return res.status(201).json({ ok: true, transfer_no: transferNo, id: transfer.id });

  } catch (err) {

    await client.query('ROLLBACK');

    return res.status(400).json({ error: err.message });

  } finally {

    client.release();

  }

});



router.get('/adjustments', requirePermission('procurement.view'), async (req, res) => {

  const result = await pool.query(

    `SELECT a.*, w.name AS warehouse_name

     FROM erp_stock_adjustments a

     JOIN erp_warehouses w ON w.id = a.warehouse_id

     WHERE a.company_id = $1

     ORDER BY a.created_at DESC LIMIT 100`,

    [req.user.company_id],

  );

  return res.json(result.rows);

});



router.post('/adjustments', canManageStock, async (req, res) => {

  try {

    const adj = await adjustments.createStockAdjustment({

      companyId: req.user.company_id,

      userId: req.user.id,

      warehouseId: req.body.warehouse_id,

      reason: req.body.reason,

      reasonCode: req.body.reason_code,

      lines: req.body.lines,

    });

    return res.status(201).json(adj);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



router.post('/adjustments/:id/post', requirePermission('procurement.approve'), async (req, res) => {

  try {

    const result = await adjustments.postStockAdjustment({

      companyId: req.user.company_id,

      userId: req.user.id,

      adjustmentId: req.params.id,

      approverId: req.body.approver_id || req.user.id,

    });

    return res.json(result);

  } catch (err) {

    return res.status(400).json({ error: err.message });

  }

});



module.exports = router;


