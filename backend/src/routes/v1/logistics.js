const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');
const delivery = require('../../services/deliveryService');
const { renderDeliveryPdfBuffer } = require('../../services/deliveryPdfService');

const router = express.Router();
router.use(authenticateErp);

router.get('/drivers', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.department, e.job_title
     FROM erp_employees e
     WHERE e.company_id = $1 AND e.is_active = TRUE AND e.is_deleted = FALSE
       AND (
         LOWER(COALESCE(e.department, '')) LIKE '%logistics%'
         OR LOWER(COALESCE(e.job_title, '')) LIKE '%driver%'
         OR EXISTS (
           SELECT 1 FROM erp_users u
           JOIN erp_roles r ON r.id = u.role_id AND r.company_id = e.company_id
           WHERE e.user_id = u.id AND LOWER(r.name) = 'driver'
         )
       )
     ORDER BY e.first_name, e.last_name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/vehicles', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_vehicles WHERE company_id = $1 AND is_deleted = FALSE AND is_active = TRUE ORDER BY plate_no`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/deliveries', requirePermission('sales.view'), async (req, res) => {
  const rows = await delivery.listDeliveries(req.user.company_id, {
    driverId: req.query.driver_id,
    logisticsStatus: req.query.logistics_status,
  });
  return res.json(rows);
});

router.get('/deliveries/pdf/:deliveryNo', requirePermission('sales.view'), async (req, res) => {
  try {
    const buffer = await renderDeliveryPdfBuffer({
      companyId: req.user.company_id,
      deliveryNo: req.params.deliveryNo,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="delivery-${req.params.deliveryNo}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

router.get('/deliveries/:id', requirePermission('sales.view'), async (req, res) => {
  const row = await delivery.getDelivery(req.user.company_id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  return res.json(row);
});

router.patch('/deliveries/:id/assign', requirePermission('sales.edit'), async (req, res) => {
  try {
    const row = await delivery.assignDriver({
      companyId: req.user.company_id,
      userId: req.user.id,
      deliveryId: req.params.id,
      driverId: req.body?.driver_id,
      vehicleId: req.body?.vehicle_id,
    });
    return res.json(row);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.patch('/deliveries/:id/status', requirePermission('sales.edit'), async (req, res) => {
  const status = req.body?.logistics_status;
  if (!status) return res.status(400).json({ error: 'logistics_status required' });
  try {
    const result = await delivery.updateLogisticsStatus({
      companyId: req.user.company_id,
      userId: req.user.id,
      deliveryId: req.params.id,
      status,
      failureReason: req.body?.failure_reason,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/deliveries/:id/fail', requirePermission('sales.edit'), async (req, res) => {
  try {
    const result = await delivery.recordFailedDelivery({
      companyId: req.user.company_id,
      userId: req.user.id,
      deliveryId: req.params.id,
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/drivers/:driverId/active', requirePermission('sales.view'), async (req, res) => {
  const rows = await delivery.getDriverActiveDeliveries(req.user.company_id, req.params.driverId);
  return res.json(rows);
});

router.get('/routes/optimize', requirePermission('sales.view'), async (req, res) => {
  const plan = await delivery.optimizeRoutes(req.user.company_id, {
    deliveryDate: req.query.delivery_date,
    driverId: req.query.driver_id,
  });
  return res.json(plan);
});

router.post('/mileage', requirePermission('sales.create'), async (req, res) => {
  try {
    const row = await delivery.recordMileage({
      companyId: req.user.company_id,
      userId: req.user.id,
      vehicleId: req.body?.vehicle_id,
      deliveryId: req.body?.delivery_id,
      driverId: req.body?.driver_id,
      tripDate: req.body?.trip_date,
      odometerStart: req.body?.odometer_start,
      odometerEnd: req.body?.odometer_end,
      distanceKm: req.body?.distance_km,
      routeZone: req.body?.route_zone,
      notes: req.body?.notes,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_vehicle_mileage_logs',
      entityId: row.id,
      action: 'create',
      newValues: row,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(row);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/redelivery-tasks', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, so.order_no, d.delivery_no AS failed_delivery_no
     FROM erp_delivery_redelivery_tasks t
     JOIN erp_sales_orders so ON so.id = t.sales_order_id
     JOIN erp_delivery_notes d ON d.id = t.failed_delivery_id
     WHERE t.company_id = $1 AND t.is_deleted = FALSE AND t.status = 'open'
     ORDER BY t.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/redelivery-tasks/:id/schedule', requirePermission('sales.create'), async (req, res) => {
  try {
    const result = await delivery.scheduleRedelivery({
      companyId: req.user.company_id,
      userId: req.user.id,
      taskId: req.params.id,
      driverId: req.body?.driver_id,
      vehicleId: req.body?.vehicle_id,
      deliveryDate: req.body?.delivery_date,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
