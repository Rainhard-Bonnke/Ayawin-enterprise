const pool = require('../db');
const sales = require('./salesService');
const liveEvents = require('./liveEventsService');

function publishDeliveryUpdate(companyId, delivery, extra = {}) {
  liveEvents.publish(companyId, 'delivery.updated', {
    delivery_id: delivery.id,
    delivery_no: delivery.delivery_no,
    logistics_status: delivery.logistics_status,
    status: delivery.status,
    ...extra,
  });
}

const NAIROBI_ZONES = [
  { code: 'nairobi_cbd', label: 'Nairobi — CBD', keywords: ['cbd', 'town', 'central', 'kicc'] },
  { code: 'nairobi_westlands', label: 'Nairobi — Westlands', keywords: ['westlands', 'parklands', 'lavington', 'kilimani'] },
  { code: 'nairobi_industrial', label: 'Nairobi — Industrial Area', keywords: ['industrial', 'enterprise rd', 'mombasa rd'] },
  { code: 'nairobi_eastlands', label: 'Nairobi — Eastlands', keywords: ['eastlands', 'buruburu', 'donholm', 'umoja', 'kayole'] },
  { code: 'nairobi_karen', label: 'Nairobi — Karen / Langata', keywords: ['karen', 'langata', 'ngong rd'] },
];

const UPCOUNTRY_CITIES = [
  'mombasa', 'kisumu', 'nakuru', 'eldoret', 'thika', 'nyeri', 'machakos', 'meru', 'kisii', 'kericho',
];

function resolveDeliveryZone(customer) {
  const city = String(customer.city || '').toLowerCase();
  const addr = `${customer.address_line1 || ''} ${customer.address_line2 || ''}`.toLowerCase();
  const stored = customer.delivery_zone;
  if (stored) {
    const match = NAIROBI_ZONES.find((z) => z.code === stored);
    if (match) return { code: match.code, label: match.label, group: 'nairobi' };
    if (stored === 'upcountry') return { code: 'upcountry', label: 'Upcountry', group: 'upcountry' };
  }

  const text = `${city} ${addr}`;
  const isNairobi = text.includes('nairobi') || city === 'nrb';
  if (!isNairobi) {
    for (const up of UPCOUNTRY_CITIES) {
      if (city.includes(up) || addr.includes(up)) {
        return { code: 'upcountry', label: `Upcountry — ${up.charAt(0).toUpperCase()}${up.slice(1)}`, group: 'upcountry' };
      }
    }
    if (city && city !== 'nairobi') {
      return { code: 'upcountry', label: 'Upcountry', group: 'upcountry' };
    }
  }

  for (const z of NAIROBI_ZONES) {
    if (z.keywords.some((k) => text.includes(k))) {
      return { code: z.code, label: z.label, group: 'nairobi' };
    }
  }
  if (isNairobi) return { code: 'nairobi_other', label: 'Nairobi — Other', group: 'nairobi' };
  return { code: 'upcountry', label: 'Upcountry', group: 'upcountry' };
}

async function getCustomerForOrder(companyId, salesOrderId) {
  const r = await pool.query(
    `SELECT c.* FROM erp_customers c
     JOIN erp_sales_orders so ON so.customer_id = c.id
     WHERE so.id = $1 AND so.company_id = $2`,
    [salesOrderId, companyId],
  );
  return r.rows[0];
}

async function resolveZoneForOrder(companyId, salesOrderId) {
  const customer = await getCustomerForOrder(companyId, salesOrderId);
  if (!customer) return { code: 'upcountry', label: 'Upcountry', group: 'upcountry' };
  return resolveDeliveryZone(customer);
}

async function nextTaskNo(client, companyId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM erp_delivery_redelivery_tasks WHERE company_id = $1`,
    [companyId],
  );
  return `RD-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
}

async function getDelivery(companyId, deliveryId) {
  const r = await pool.query(
    `SELECT d.*, so.order_no, so.status AS order_status, c.name AS customer_name
     FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     JOIN erp_customers c ON c.id = so.customer_id
     WHERE d.id = $1 AND d.company_id = $2 AND d.is_deleted = FALSE`,
    [deliveryId, companyId],
  );
  return r.rows[0] || null;
}

async function listDeliveries(companyId, { driverId, logisticsStatus } = {}) {
  const params = [companyId];
  let filter = '';
  if (driverId) {
    params.push(driverId);
    filter += ` AND d.driver_id = $${params.length}`;
  }
  if (logisticsStatus) {
    params.push(logisticsStatus);
    filter += ` AND d.logistics_status = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT d.*, so.order_no, so.status AS sales_order_status, c.name AS customer_name,
            w.name AS warehouse_name,
            e.first_name || ' ' || e.last_name AS driver_name,
            v.plate_no AS vehicle_plate
     FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     JOIN erp_customers c ON c.id = so.customer_id
     LEFT JOIN erp_warehouses w ON w.id = d.warehouse_id
     LEFT JOIN erp_employees e ON e.id = d.driver_id
     LEFT JOIN erp_vehicles v ON v.id = d.vehicle_id
     WHERE d.company_id = $1 AND d.is_deleted = FALSE ${filter}
     ORDER BY d.delivery_date DESC, d.delivery_no DESC`,
    params,
  );
  return result.rows;
}

async function assignDriver({ companyId, userId, deliveryId, driverId, vehicleId }) {
  const dn = await getDelivery(companyId, deliveryId);
  if (!dn) throw new Error('Delivery not found');
  if (dn.logistics_status === 'delivered' || dn.logistics_status === 'failed') {
    throw new Error('Cannot assign driver to a completed or failed delivery');
  }
  if (driverId) {
    const emp = await pool.query(
      `SELECT id FROM erp_employees WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
      [driverId, companyId],
    );
    if (!emp.rowCount) throw new Error('Driver not found');
  }
  const result = await pool.query(
    `UPDATE erp_delivery_notes
     SET driver_id = $3, vehicle_id = COALESCE($4, vehicle_id),
         updated_at = NOW(), updated_by = $5
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [deliveryId, companyId, driverId || null, vehicleId || null, userId],
  );
  const row = result.rows[0];
  publishDeliveryUpdate(companyId, row, { driver_id: driverId });
  return row;
}

async function getDriverActiveDeliveries(companyId, driverId) {
  const rows = await listDeliveries(companyId, { driverId });
  return rows.filter((d) => ['scheduled', 'in_transit'].includes(d.logistics_status));
}

async function updateLogisticsStatus({ companyId, userId, deliveryId, status, failureReason }) {
  const dn = await getDelivery(companyId, deliveryId);
  if (!dn) throw new Error('Delivery not found');

  const allowed = {
    scheduled: ['in_transit', 'failed'],
    in_transit: ['delivered', 'failed'],
    delivered: [],
    failed: [],
  };
  if (!allowed[dn.logistics_status]?.includes(status)) {
    throw new Error(`Cannot transition logistics status from ${dn.logistics_status} to ${status}`);
  }

  if (status === 'delivered') {
    if (dn.status === 'draft') {
      await sales.postDeliveryNote({ companyId, userId, deliveryId });
    }
    await pool.query(
      `UPDATE erp_delivery_notes SET logistics_status = 'delivered', updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2`,
      [deliveryId, companyId, userId],
    );
    const updated = await getDelivery(companyId, deliveryId);
    publishDeliveryUpdate(companyId, updated);
    return { delivery: updated, sales_order_status: updated.order_status };
  }

  if (status === 'failed') {
    return recordFailedDelivery({ companyId, userId, deliveryId, reason: failureReason });
  }

  await pool.query(
    `UPDATE erp_delivery_notes SET logistics_status = $3, updated_at = NOW(), updated_by = $4
     WHERE id = $1 AND company_id = $2`,
    [deliveryId, companyId, status, userId],
  );
  const updated = await getDelivery(companyId, deliveryId);
  publishDeliveryUpdate(companyId, updated);
  return { delivery: updated, sales_order_status: updated.order_status };
}

async function recordFailedDelivery({ companyId, userId, deliveryId, reason }) {
  const dn = await getDelivery(companyId, deliveryId);
  if (!dn) throw new Error('Delivery not found');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (dn.status === 'draft') {
      await client.query(
        `UPDATE erp_delivery_notes SET status = 'cancelled', logistics_status = 'failed',
         failure_reason = $3, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
        [deliveryId, companyId, reason || null, userId],
      );
    } else {
      await client.query(
        `UPDATE erp_delivery_notes SET logistics_status = 'failed', failure_reason = $3,
         updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
        [deliveryId, companyId, reason || null, userId],
      );
    }

    const taskNo = await nextTaskNo(client, companyId);
    const task = await client.query(
      `INSERT INTO erp_delivery_redelivery_tasks (
         company_id, sales_order_id, failed_delivery_id, task_no, status, failure_reason, created_by
       ) VALUES ($1,$2,$3,$4,'open',$5,$6) RETURNING *`,
      [companyId, dn.sales_order_id, deliveryId, taskNo, reason || null, userId],
    );
    await client.query('COMMIT');
    const refreshed = await getDelivery(companyId, deliveryId);
    publishDeliveryUpdate(companyId, refreshed, { failed: true });
    return { delivery: refreshed, redelivery_task: task.rows[0], sales_order_status: refreshed.order_status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function scheduleRedelivery({ companyId, userId, taskId, driverId, vehicleId, deliveryDate }) {
  const taskR = await pool.query(
    `SELECT * FROM erp_delivery_redelivery_tasks WHERE id = $1 AND company_id = $2 AND status = 'open'`,
    [taskId, companyId],
  );
  const task = taskR.rows[0];
  if (!task) throw new Error('Re-delivery task not found or not open');

  const lines = await pool.query(
    `SELECT sol.id AS so_line_id, sol.item_id,
            sol.quantity - sol.qty_delivered AS quantity
     FROM erp_sales_order_lines sol
     WHERE sol.sales_order_id = $1 AND sol.quantity > sol.qty_delivered`,
    [task.sales_order_id],
  );
  if (!lines.rowCount) throw new Error('No remaining quantities to re-deliver');

  const so = await pool.query(`SELECT warehouse_id FROM erp_sales_orders WHERE id = $1`, [task.sales_order_id]);
  const zone = await resolveZoneForOrder(companyId, task.sales_order_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seq = await client.query(`SELECT COUNT(*)::int AS n FROM erp_delivery_notes WHERE company_id = $1`, [companyId]);
    const deliveryNo = `DN-${new Date().getFullYear()}-${String(Number(seq.rows[0].n) + 1).padStart(4, '0')}`;
    const dnR = await client.query(
      `INSERT INTO erp_delivery_notes (
         company_id, sales_order_id, warehouse_id, delivery_no, delivery_date, status,
         driver_id, vehicle_id, delivery_zone, logistics_status, parent_delivery_id, created_by
       ) VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'draft',$6,$7,$8,'scheduled',$9,$10) RETURNING *`,
      [
        companyId, task.sales_order_id, so.rows[0].warehouse_id, deliveryNo, deliveryDate,
        driverId || null, vehicleId || null, zone.code, task.failed_delivery_id, userId,
      ],
    );
    const dn = dnR.rows[0];
    let lineNo = 1;
    for (const line of lines.rows) {
      if (Number(line.quantity) <= 0) continue;
      await client.query(
        `INSERT INTO erp_delivery_note_lines (
           company_id, delivery_note_id, so_line_id, line_no, item_id, quantity, unit_cost, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
        [companyId, dn.id, line.so_line_id, lineNo++, line.item_id, line.quantity, userId],
      );
    }
    await client.query(
      `UPDATE erp_delivery_redelivery_tasks
       SET status = 'scheduled', scheduled_date = COALESCE($3, CURRENT_DATE),
           driver_id = $4, new_delivery_id = $5, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [taskId, companyId, deliveryDate, driverId || null, dn.id],
    );
    await client.query('COMMIT');
    publishDeliveryUpdate(companyId, dn, { redelivery: true });
    return { delivery: dn, task_id: taskId, zone };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordMileage({
  companyId, userId, vehicleId, deliveryId, driverId, tripDate,
  odometerStart, odometerEnd, distanceKm, routeZone, notes,
}) {
  if (!vehicleId) throw new Error('vehicle_id required');
  const start = Number(odometerStart);
  const end = Number(odometerEnd);
  let km = Number(distanceKm);
  if (!km && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    km = end - start;
  }
  if (!km || km <= 0) throw new Error('distance_km or valid odometer readings required');

  const result = await pool.query(
    `INSERT INTO erp_vehicle_mileage_logs (
       company_id, vehicle_id, delivery_id, driver_id, trip_date,
       odometer_start, odometer_end, distance_km, route_zone, notes, created_by
     ) VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      companyId, vehicleId, deliveryId || null, driverId || null, tripDate,
      odometerStart ?? null, odometerEnd ?? null, km, routeZone || null, notes || null, userId,
    ],
  );
  return result.rows[0];
}

async function optimizeRoutes(companyId, { deliveryDate, driverId } = {}) {
  const params = [companyId];
  let filter = `AND d.logistics_status IN ('scheduled','in_transit')`;
  if (deliveryDate) {
    params.push(deliveryDate);
    filter += ` AND d.delivery_date = $${params.length}`;
  }
  if (driverId) {
    params.push(driverId);
    filter += ` AND d.driver_id = $${params.length}`;
  }

  const rows = await pool.query(
    `SELECT d.id, d.delivery_no, d.delivery_zone, d.logistics_status, d.delivery_date,
            so.order_no, c.name AS customer_name, c.city, c.address_line1
     FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     JOIN erp_customers c ON c.id = so.customer_id
     WHERE d.company_id = $1 AND d.is_deleted = FALSE ${filter}
     ORDER BY d.delivery_zone, c.name`,
    params,
  );

  const groups = {};
  for (const row of rows.rows) {
    const zoneInfo = row.delivery_zone
      ? (NAIROBI_ZONES.find((z) => z.code === row.delivery_zone) || { code: row.delivery_zone, label: row.delivery_zone })
      : resolveDeliveryZone(row);
    const groupKey = zoneInfo.group || (zoneInfo.code?.startsWith('nairobi') ? 'nairobi' : 'upcountry');
    const label = zoneInfo.label || zoneInfo.code || 'Unassigned';
    if (!groups[groupKey]) groups[groupKey] = { group: groupKey, zones: {} };
    if (!groups[groupKey].zones[label]) {
      groups[groupKey].zones[label] = { zone: zoneInfo.code, label, deliveries: [] };
    }
    groups[groupKey].zones[label].deliveries.push(row);
  }

  const ordered = [];
  for (const gk of ['nairobi', 'upcountry']) {
    if (!groups[gk]) continue;
    const zoneList = Object.values(groups[gk].zones).sort((a, b) => a.label.localeCompare(b.label));
    ordered.push({ group: gk, label: gk === 'nairobi' ? 'Nairobi' : 'Upcountry', zones: zoneList });
  }
  return { routes: ordered, total_stops: rows.rowCount };
}

async function applyZoneToDelivery(companyId, deliveryId) {
  const dn = await getDelivery(companyId, deliveryId);
  if (!dn) return null;
  const zone = await resolveZoneForOrder(companyId, dn.sales_order_id);
  await pool.query(
    `UPDATE erp_delivery_notes SET delivery_zone = $3 WHERE id = $1 AND company_id = $2`,
    [deliveryId, companyId, zone.code],
  );
  await pool.query(
    `UPDATE erp_customers c SET delivery_zone = $3
     FROM erp_sales_orders so
     WHERE so.customer_id = c.id AND so.id = $2 AND c.company_id = $1`,
    [companyId, dn.sales_order_id, zone.code],
  );
  return zone;
}

async function enrichAfterCreate(companyId, deliveryId, { driverId, vehicleId } = {}) {
  const zone = await applyZoneToDelivery(companyId, deliveryId);
  if (driverId || vehicleId) {
    await pool.query(
      `UPDATE erp_delivery_notes SET driver_id = COALESCE($3, driver_id), vehicle_id = COALESCE($4, vehicle_id)
       WHERE id = $1 AND company_id = $2`,
      [deliveryId, companyId, driverId || null, vehicleId || null],
    );
  }
  return zone;
}

async function markDeliveredAfterPost(companyId, deliveryId, userId) {
  await pool.query(
    `UPDATE erp_delivery_notes SET logistics_status = 'delivered', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2`,
    [deliveryId, companyId, userId],
  );
}

module.exports = {
  NAIROBI_ZONES,
  resolveDeliveryZone,
  resolveZoneForOrder,
  listDeliveries,
  getDelivery,
  assignDriver,
  getDriverActiveDeliveries,
  updateLogisticsStatus,
  recordFailedDelivery,
  scheduleRedelivery,
  recordMileage,
  optimizeRoutes,
  enrichAfterCreate,
  markDeliveredAfterPost,
};
