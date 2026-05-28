const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const inventory = require('../../services/inventoryService');

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

router.get('/reorder-alerts', requirePermission('procurement.view'), async (req, res) => {
  const rows = await inventory.getReorderAlerts(req.user.company_id);
  return res.json(rows);
});

router.get('/movements', requirePermission('procurement.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    `SELECT sl.*, i.item_code, i.name AS item_name, w.code AS warehouse_code
     FROM erp_stock_ledger sl
     JOIN erp_items i ON i.id = sl.item_id
     JOIN erp_warehouses w ON w.id = sl.warehouse_id
     WHERE sl.company_id = $1
     ORDER BY sl.movement_date DESC LIMIT $2`,
    [req.user.company_id, limit],
  );
  return res.json(result.rows);
});

router.post('/stock-in', requirePermission('procurement.create'), async (req, res) => {
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
    return res.status(201).json({ ok: true, reference_id: referenceId });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/transfers', requirePermission('procurement.create'), async (req, res) => {
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
      });
    }

    await client.query(
      `UPDATE erp_stock_transfers SET status = 'posted', posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [transfer.id],
    );
    await client.query('COMMIT');
    return res.status(201).json({ ok: true, transfer_no: transferNo, id: transfer.id });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
