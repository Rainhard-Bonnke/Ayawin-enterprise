const pool = require('../db');
const sales = require('./salesService');
const { resolveUnitPrice } = require('../lib/salesPricing');
const liveEvents = require('./liveEventsService');

const WALKIN_CODE = 'POS-WALKIN';
const WALKIN_TAX_ID = 'P051999999Z';

async function resolveWalkInCustomer(companyId, userId) {
  const existing = await pool.query(
    `SELECT id FROM erp_customers
     WHERE company_id = $1 AND customer_code = $2 AND is_deleted = FALSE
     LIMIT 1`,
    [companyId, WALKIN_CODE],
  );
  if (existing.rowCount) return existing.rows[0].id;

  const result = await pool.query(
    `INSERT INTO erp_customers (
       company_id, customer_code, name, tax_id, customer_type, credit_limit, is_active, created_by
     ) VALUES ($1, $2, 'Walk-in Customer', $3, 'Retail', 0, TRUE, $4)
     RETURNING id`,
    [companyId, WALKIN_CODE, WALKIN_TAX_ID, userId],
  );
  return result.rows[0].id;
}

/** All active items with on-hand qty for a warehouse (includes zero stock). */
async function getPosCatalog(companyId, { warehouseId, customerId, q = '' } = {}) {
  if (!warehouseId) throw new Error('warehouse_id is required');

  const params = [companyId, warehouseId];
  let search = '';
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    search = ` AND (i.item_code ILIKE ${p} OR i.name ILIKE ${p} OR COALESCE(i.barcode, '') ILIKE ${p})`;
  }

  const items = await pool.query(
    `SELECT i.id AS item_id, i.item_code, i.name AS item_name, i.barcode,
            i.standard_cost, i.reorder_point, i.is_active,
            COALESCE(s.quantity, 0)::numeric AS quantity,
            COALESCE(s.avg_unit_cost, i.standard_cost, 0)::numeric AS avg_unit_cost
     FROM erp_items i
     LEFT JOIN erp_stock_on_hand s
       ON s.item_id = i.id AND s.warehouse_id = $2 AND s.company_id = i.company_id AND s.is_deleted = FALSE
     WHERE i.company_id = $1 AND i.is_deleted = FALSE AND i.is_active = TRUE ${search}
     ORDER BY i.name, i.item_code`,
    params,
  );

  let custId = customerId;
  if (!custId) {
    const walk = await pool.query(
      `SELECT id FROM erp_customers WHERE company_id = $1 AND customer_code = $2 AND is_deleted = FALSE LIMIT 1`,
      [companyId, WALKIN_CODE],
    );
    custId = walk.rows[0]?.id;
    if (!custId) {
      const any = await pool.query(
        `SELECT id FROM erp_customers WHERE company_id = $1 AND is_deleted = FALSE AND is_active = TRUE ORDER BY name LIMIT 1`,
        [companyId],
      );
      custId = any.rows[0]?.id;
    }
  }
  const priced = [];
  for (const row of items.rows) {
    if (!custId) {
      priced.push({
        ...row,
        quantity: Number(row.quantity),
        unit_price: Number(row.standard_cost || 0),
        price_tier: 'retail',
      });
      continue;
    }
    let unitPrice = Number(row.standard_cost || 0);
    let priceTier = 'retail';
    try {
      const p = await resolveUnitPrice(pool, companyId, custId, row.item_id);
      unitPrice = Number(p.unit_price || unitPrice);
      priceTier = p.price_tier || priceTier;
    } catch {
      /* use standard_cost fallback */
    }
    priced.push({
      ...row,
      quantity: Number(row.quantity),
      unit_price: unitPrice,
      price_tier: priceTier,
    });
  }
  return { customer_id: custId || null, items: priced };
}

/**
 * One-shot POS sale: SO → confirm → deliver (stock issue) → invoice → cash payment.
 */
async function completePosSale({
  companyId,
  userId,
  warehouseId,
  customerId,
  lines,
  paymentMethod = 'cash',
  referenceNo,
  notes,
}) {
  if (!warehouseId) throw new Error('warehouse_id is required');
  if (!lines?.length) throw new Error('At least one line item is required');

  const custId = customerId || await resolveWalkInCustomer(companyId, userId);

  const normalizedLines = [];
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!qty || qty <= 0) throw new Error('Line quantity must be greater than zero');
    let unitPrice = Number(line.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      const p = await resolveUnitPrice(pool, companyId, custId, line.item_id);
      unitPrice = Number(p.unit_price);
    }
    if (unitPrice <= 0) throw new Error('Unit price must be greater than zero');
    normalizedLines.push({
      item_id: line.item_id,
      quantity: qty,
      unit_price: unitPrice,
      discount_percent: Number(line.discount_percent || 0),
    });
  }

  const atp = await sales.checkAtp(companyId, warehouseId, normalizedLines);
  if (!atp.ok) {
    const err = new Error('Insufficient stock for one or more items');
    err.code = 'INSUFFICIENT_STOCK';
    err.details = atp.shortages;
    throw err;
  }

  const so = await sales.createSalesOrder({
    companyId,
    userId,
    customerId: custId,
    warehouseId,
    lines: normalizedLines,
    notes: notes || 'Point of sale',
    salesRepId: userId,
  });

  await sales.confirmSalesOrder({ companyId, userId, orderId: so.id });

  const soLines = await pool.query(
    `SELECT id, item_id, quantity FROM erp_sales_order_lines
     WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [so.id, companyId],
  );

  const deliveryLines = soLines.rows.map((l) => ({
    so_line_id: l.id,
    item_id: l.item_id,
    quantity: Number(l.quantity),
  }));

  await sales.createAndPostDelivery({
    companyId,
    userId,
    salesOrderId: so.id,
    warehouseId,
    lines: deliveryLines,
  });

  const invResult = await pool.query(
    `SELECT id, invoice_no, total_amount, status, amount_paid
     FROM erp_customer_invoices
     WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status <> 'cancelled'
     ORDER BY created_at DESC LIMIT 1`,
    [so.id, companyId],
  );
  const invoice = invResult.rows[0];
  if (!invoice) throw new Error('Invoice was not created for this POS sale');

  const outstanding = Number(invoice.total_amount || 0) - Number(invoice.amount_paid || 0);
  let payment = null;
  if (outstanding > 0.0001) {
    payment = await sales.recordCustomerPayment({
      companyId,
      userId,
      invoiceId: invoice.id,
      amount: outstanding,
      referenceNo: referenceNo || `POS-${so.order_no}`,
      notes: notes || 'POS cash sale',
      paymentMethod,
    });
  }

  liveEvents.publish(companyId, 'pos.sale_completed', {
    order_id: so.id,
    order_no: so.order_no,
    invoice_id: invoice.id,
    invoice_no: invoice.invoice_no,
  });
  liveEvents.publish(companyId, 'inventory.updated', { reason: 'pos_sale', order_id: so.id });

  return {
    ok: true,
    sales_order_id: so.id,
    order_no: so.order_no,
    invoice_id: invoice.id,
    invoice_no: invoice.invoice_no,
    total_amount: Number(invoice.total_amount || 0),
    payment_id: payment?.payment_id || null,
    receipt_no: payment?.receipt_no || null,
  };
}

module.exports = {
  resolveWalkInCustomer,
  getPosCatalog,
  completePosSale,
};
