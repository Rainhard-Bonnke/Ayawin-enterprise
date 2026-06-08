const pool = require('../db');
const sales = require('./salesService');
const taxEngine = require('../lib/taxEngine');
const discountPolicy = require('../lib/discountPolicy');
const { normalizeDateOnly, normalizeQuotationLines } = require('../lib/normalizeQuotation');

async function nextQuoteNo(client, companyId) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM erp_quotations WHERE company_id = $1`,
    [companyId],
  );
  return `QT-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
}

async function createQuotation({ companyId, userId, customerId, lines, validUntil, opportunityId, actor }) {
  if (!companyId) throw new Error('Company context is required');
  const customer_id = String(customerId || '').trim();
  if (!customer_id) throw new Error('customer_id is required');
  const normalizedLines = normalizeQuotationLines(lines);
  if (actor) discountPolicy.assertLineDiscounts(actor, normalizedLines);
  const valid_until = normalizeDateOnly(validUntil);
  const opportunity_id = opportunityId ? String(opportunityId).trim() : null;

  const itemIds = normalizedLines.map((l) => l.item_id);

  const cust = await pool.query(
    `SELECT id, is_active FROM erp_customers WHERE id = $1::uuid AND company_id = $2::uuid AND is_deleted = FALSE`,
    [customer_id, companyId],
  );
  if (!cust.rowCount) throw new Error('Customer not found');
  if (cust.rows[0].is_active === false) throw new Error('Customer is inactive');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const quoteNo = await nextQuoteNo(client, companyId);
    const itemMeta = await taxEngine.loadItemTaxMeta(client, companyId, itemIds);
    const priced = taxEngine.computeDocumentLines(normalizedLines, itemMeta);
    const { subtotal, taxAmount, total } = priced;

    const qResult = await client.query(
      `INSERT INTO erp_quotations (
         company_id, customer_id, opportunity_id, quote_no, valid_until,
         status, subtotal, tax_amount, total_amount, created_by
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::text,$5::date,'draft',$6::numeric,$7::numeric,$8::numeric,$9::uuid)
       RETURNING *`,
      [
        companyId,
        customer_id,
        opportunity_id,
        quoteNo,
        valid_until,
        subtotal,
        taxAmount,
        total,
        userId,
      ],
    );
    const quote = qResult.rows[0];

    let lineNo = 1;
    for (let i = 0; i < priced.lines.length; i++) {
      const pricedLine = priced.lines[i];
      const src = normalizedLines[i];
      await client.query(
        `INSERT INTO erp_quotation_lines (
           company_id, quotation_id, line_no, item_id, quantity, unit_price, discount_percent, line_total, created_by
         ) VALUES ($1::uuid,$2::uuid,$3::int,$4::uuid,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::uuid)`,
        [
          companyId, quote.id, lineNo++, pricedLine.item_id, pricedLine.quantity, pricedLine.unit_price,
          src.discount_percent || 0, pricedLine.lineSubtotal, userId,
        ],
      );
    }
    await client.query('COMMIT');
    return quote;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function convertQuotationToOrder({ companyId, userId, quotationId, warehouseId }) {
  const q = await pool.query(
    `SELECT * FROM erp_quotations WHERE id = $1 AND company_id = $2 AND status IN ('draft','sent','accepted')`,
    [quotationId, companyId],
  );
  if (!q.rowCount) throw new Error('Quotation not found or already converted');
  const quote = q.rows[0];

  const lines = await pool.query(
    `SELECT * FROM erp_quotation_lines WHERE quotation_id = $1 AND is_deleted = FALSE ORDER BY line_no`,
    [quotationId],
  );
  if (!lines.rowCount) throw new Error('Quotation has no lines');

  const order = await sales.createSalesOrder({
    companyId,
    userId,
    customerId: quote.customer_id,
    warehouseId,
    quotationId,
    lines: lines.rows.map((l) => ({
      item_id: l.item_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      discount_percent: l.discount_percent,
    })),
  });

  await pool.query(
    `UPDATE erp_quotations SET status = 'converted', updated_at = NOW(), updated_by = $3 WHERE id = $1`,
    [quotationId, companyId, userId],
  );

  return order;
}

module.exports = {
  createQuotation,
  convertQuotationToOrder,
};
