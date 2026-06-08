const pool = require('../db');
const piiCrypto = require('../lib/piiCrypto');
const { recordReceipt } = require('./inventoryService');

const IMPORT_HANDLERS = {
  customers: async (client, companyId, userId, row) => {
    await client.query(
      `INSERT INTO erp_customers (company_id, customer_code, name, email, tax_id, credit_limit, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),$7)
       ON CONFLICT (company_id, customer_code) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()`,
      [
        companyId,
        row.customer_code,
        row.name,
        row.email,
        piiCrypto.isEnabled() && row.tax_id ? `***${String(row.tax_id).slice(-4)}` : row.tax_id,
        row.credit_limit,
        userId,
      ],
    );
    if (piiCrypto.isEnabled() && row.tax_id) {
      await client.query(
        `UPDATE erp_customers SET tax_id_enc = $1 WHERE company_id = $2 AND customer_code = $3`,
        [piiCrypto.encrypt(row.tax_id), companyId, row.customer_code],
      );
    }
  },
  vendors: async (client, companyId, userId, row) => {
    await client.query(
      `INSERT INTO erp_vendors (company_id, vendor_code, name, email, tax_id, credit_limit, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),$7)
       ON CONFLICT (company_id, vendor_code) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()`,
      [
        companyId,
        row.vendor_code,
        row.name,
        row.email,
        piiCrypto.isEnabled() && row.tax_id ? `***${String(row.tax_id).slice(-4)}` : row.tax_id,
        row.credit_limit,
        userId,
      ],
    );
    if (piiCrypto.isEnabled() && row.tax_id) {
      await client.query(
        `UPDATE erp_vendors SET tax_id_enc = $1 WHERE company_id = $2 AND vendor_code = $3`,
        [piiCrypto.encrypt(row.tax_id), companyId, row.vendor_code],
      );
    }
  },
  items: async (client, companyId, userId, row) => {
    await client.query(
      `INSERT INTO erp_items (company_id, item_code, name, standard_cost, created_by)
       VALUES ($1,$2,$3,COALESCE($4,0),$5)
       ON CONFLICT (company_id, item_code) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()`,
      [companyId, row.item_code, row.name, row.standard_cost, userId],
    );
  },
  opening_stock: async (client, companyId, userId, row) => {
    const whCode = row.warehouse_code || row.warehouse;
    const itemCode = row.item_code || row.sku;
    const qty = Number(row.quantity);
    const unitCost = Number(row.unit_cost ?? row.cost ?? 0);
    if (!whCode || !itemCode) throw new Error('warehouse_code and item_code are required');
    if (!qty || qty <= 0) throw new Error('quantity must be greater than zero');

    const wh = await client.query(
      `SELECT id FROM erp_warehouses WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE LIMIT 1`,
      [companyId, whCode],
    );
    if (!wh.rowCount) throw new Error(`Warehouse not found: ${whCode}`);

    const item = await client.query(
      `SELECT id FROM erp_items WHERE company_id = $1 AND item_code = $2 AND is_deleted = FALSE LIMIT 1`,
      [companyId, itemCode],
    );
    if (!item.rowCount) throw new Error(`Item not found: ${itemCode}`);

    await recordReceipt(client, {
      companyId,
      warehouseId: wh.rows[0].id,
      itemId: item.rows[0].id,
      quantity: qty,
      unitCost,
      referenceType: 'opening_stock',
      referenceId: null,
      userId,
    });
  },
  attendance: async (client, companyId, userId, row) => {
    const emp = await client.query(
      'SELECT id FROM erp_employees WHERE company_id = $1 AND employee_code = $2',
      [companyId, row.employee_code],
    );
    if (!emp.rowCount) throw new Error(`Employee not found: ${row.employee_code}`);
    await client.query(
      `INSERT INTO erp_attendance (company_id, employee_id, attendance_date, hours_worked, overtime_hours, status, source, created_by)
       VALUES ($1,$2,$3,COALESCE($4,8),COALESCE($5,0),COALESCE($6,'present'),'import',$7)
       ON CONFLICT (employee_id, attendance_date) DO UPDATE SET hours_worked = EXCLUDED.hours_worked, updated_at = NOW()`,
      [companyId, emp.rows[0].id, row.attendance_date, row.hours_worked, row.overtime_hours, row.status, userId],
    );
  },
};

async function processImport({ companyId, userId, entityType, rows, fileName }) {
  const handler = IMPORT_HANDLERS[entityType];
  if (!handler) throw new Error(`Unsupported entity type: ${entityType}`);

  const jobResult = await pool.query(
    `INSERT INTO erp_import_jobs (company_id, entity_type, file_name, status, total_rows, created_by)
     VALUES ($1,$2,$3,'processing',$4,$5) RETURNING *`,
    [companyId, entityType, fileName, rows.length, userId],
  );
  const job = jobResult.rows[0];

  const client = await pool.connect();
  const errors = [];
  let success = 0;

  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += 1) {
      try {
        await handler(client, companyId, userId, rows[i]);
        success += 1;
      } catch (err) {
        errors.push({ row: i + 1, error: err.message, data: rows[i] });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await pool.query(
    `UPDATE erp_import_jobs SET status = $2, success_rows = $3, error_rows = $4, errors = $5::jsonb, updated_at = NOW()
     WHERE id = $1`,
    [job.id, errors.length ? 'completed' : 'completed', success, errors.length, JSON.stringify(errors)],
  );

  return { job_id: job.id, total: rows.length, success, errors };
}

module.exports = { processImport, IMPORT_HANDLERS };
