const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { ensureCompanyContext } = require('../../middleware/ensureCompanyContext');
const { logAudit } = require('../../services/auditService');
const sales = require('../../services/salesService');
const discountPolicy = require('../../lib/discountPolicy');
const { resolveUnitPrice } = require('../../lib/salesPricing');
const { parsePagination, parseSort } = require('../../lib/queryHelper');
const {
  buildInvoiceVerificationHash,
  buildPaymentReceiptHash,
} = require('../../services/documentVerificationService');
const { emailInvoicePdf } = require('../../services/invoiceEmailService');
const { renderInvoicePdfBuffer } = require('../../services/invoicePdfService');
const { renderPaymentReceiptPdfBuffer } = require('../../services/paymentReceiptPdfService');

const router = express.Router();
router.use(authenticateErp);
router.use(ensureCompanyContext);

router.get('/discount-cap', requirePermission('sales.view'), (req, res) => {
  return res.json({ max_discount_percent: discountPolicy.maxDiscountPercent(req.user) });
});

router.post('/preview-totals', requirePermission('sales.view'), async (req, res) => {
  const { customer_id, lines } = req.body || {};
  if (!customer_id || !Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: 'customer_id and lines required' });
  }
  try {
    const priced = await sales.previewOrderTotals({
      companyId: req.user.company_id,
      customerId: customer_id,
      lines,
    });
    return res.json(priced);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/pricing', requirePermission('sales.view'), async (req, res) => {
  const { customer_id, item_id } = req.query;
  if (!customer_id || !item_id) {
    return res.status(400).json({ error: 'customer_id and item_id required' });
  }
  try {
    const result = await resolveUnitPrice(pool, req.user.company_id, customer_id, item_id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/atp-check', requirePermission('sales.view'), async (req, res) => {
  const { warehouse_id, lines } = req.body || {};
  if (!warehouse_id || !lines?.length) return res.status(400).json({ error: 'warehouse_id and lines required' });
  const result = await sales.checkAtp(req.user.company_id, warehouse_id, lines);
  return res.json(result);
});

router.post('/credit-check', requirePermission('sales.view'), async (req, res) => {
  const { customer_id, order_total } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  const { getCreditLimitMode } = require('../../lib/creditLimitPolicy');
  const result = await sales.checkCreditLimit(req.user.company_id, customer_id, order_total || 0);
  return res.json({ ...result, mode: getCreditLimitMode() });
});

router.get('/orders', requirePermission('sales.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const { page, limit, offset } = parsePagination(req.query);
  const { sort, order } = parseSort(
    req.query,
    ['order_date', 'order_no', 'total_amount', 'status', 'created_at'],
    'order_date',
  );

  try {
    let countSql = `SELECT COUNT(*)::int AS total FROM erp_sales_orders so
      JOIN erp_customers c ON c.id = so.customer_id
      WHERE so.company_id = $1 AND so.is_deleted = FALSE`;
    let listSql = `SELECT so.*, c.name AS customer_name, w.name AS warehouse_name,
            COALESCE(rep.full_name, rep.email, 'Unassigned') AS sales_rep_name,
            COALESCE(lc.line_count, 0)::int AS line_count
     FROM erp_sales_orders so
     JOIN erp_customers c ON c.id = so.customer_id
     LEFT JOIN erp_warehouses w ON w.id = so.warehouse_id
     LEFT JOIN erp_users rep ON rep.id = COALESCE(so.sales_rep_id, so.created_by)
     LEFT JOIN (
       SELECT sales_order_id, COUNT(*)::int AS line_count
       FROM erp_sales_order_lines WHERE is_deleted = FALSE GROUP BY sales_order_id
     ) lc ON lc.sales_order_id = so.id
     WHERE so.company_id = $1 AND so.is_deleted = FALSE`;
    const params = [req.user.company_id];

    if (q) {
      params.push(`%${q}%`);
      const clause = ` AND (so.order_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
      countSql += clause;
      listSql += clause;
    }
    if (status) {
      params.push(status);
      const clause = ` AND so.status = $${params.length}`;
      countSql += clause;
      listSql += clause;
    }

    const countParams = [...params];
    params.push(limit, offset);
    listSql += ` ORDER BY so.${sort} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const [countResult, result] = await Promise.all([
      pool.query(countSql, countParams),
      pool.query(listSql, params),
    ]);

    return res.json({
      data: result.rows,
      pagination: { page, limit, total: countResult.rows[0].total },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.get('/orders/:id', requirePermission('sales.view'), async (req, res) => {
  const so = await pool.query(
    `SELECT so.*, c.name AS customer_name FROM erp_sales_orders so
     JOIN erp_customers c ON c.id = so.customer_id
     WHERE so.id = $1 AND so.company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  if (!so.rowCount) return res.status(404).json({ error: 'Not found' });
  const lines = await pool.query(
    `SELECT sol.*, i.item_code, i.name AS item_name FROM erp_sales_order_lines sol
     JOIN erp_items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1 ORDER BY sol.line_no`,
    [req.params.id],
  );
  return res.json({ ...so.rows[0], lines: lines.rows });
});

router.post('/orders', requirePermission('sales.create'), async (req, res) => {
  if (!req.body?.customer_id || !req.body?.warehouse_id || !Array.isArray(req.body?.lines) || !req.body.lines.length) {
    return res.status(400).json({ error: 'customer_id, warehouse_id, and at least one line are required' });
  }
  if (req.body.lines.some((line) => !line?.item_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)) {
    return res.status(400).json({ error: 'each line requires item_id, positive quantity, and non-negative unit_price' });
  }
  try {
    const order = await sales.createSalesOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      actor: req.user,
      customerId: req.body.customer_id,
      warehouseId: req.body.warehouse_id,
      quotationId: req.body.quotation_id,
      lines: req.body.lines,
      orderDate: req.body.order_date,
      notes: req.body.notes,
      salesRepId: req.body.sales_rep_id,
    });
    return res.status(201).json(order);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/orders/:id/confirm', requirePermission('sales.approve'), async (req, res) => {
  try {
    const result = await sales.confirmSalesOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      orderId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/deliveries', requirePermission('sales.create'), async (req, res) => {
  try {
    const result = await sales.createAndPostDelivery({
      companyId: req.user.company_id,
      userId: req.user.id,
      salesOrderId: req.body.sales_order_id,
      warehouseId: req.body.warehouse_id,
      lines: req.body.lines,
      deliveryDate: req.body.delivery_date,
      driverId: req.body.driver_id,
      vehicleId: req.body.vehicle_id,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/deliveries', requirePermission('sales.view'), async (req, res) => {
  const deliverySvc = require('../../services/deliveryService');
  const rows = await deliverySvc.listDeliveries(req.user.company_id);
  return res.json(rows);
});

router.patch('/deliveries/:id/pod', requirePermission('sales.edit'), async (req, res) => {
  const { pod_signature, pod_photo_data } = req.body || {};
  if (!pod_signature && !pod_photo_data) {
    return res.status(400).json({ error: 'pod_signature or pod_photo_data required' });
  }
  const { validateAndScanPodPhoto } = require('../../lib/uploadValidation');
  const photoCheck = await validateAndScanPodPhoto(pod_photo_data);
  if (!photoCheck.ok) {
    return res.status(400).json({ error: photoCheck.error });
  }
  try {
    const result = await pool.query(
      `UPDATE erp_delivery_notes
       SET pod_signature = COALESCE($3, pod_signature),
           pod_photo_url = COALESCE($4, pod_photo_url),
           pod_uploaded_at = NOW(),
           updated_at = NOW(),
           updated_by = $5
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       RETURNING *`,
      [req.params.id, req.user.company_id, pod_signature || null, photoCheck.value || null, req.user.id],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Delivery not found' });
    const liveEvents = require('../../services/liveEventsService');
    const row = result.rows[0];
    liveEvents.publish(req.user.company_id, 'delivery.updated', {
      delivery_id: row.id,
      delivery_no: row.delivery_no,
      logistics_status: row.logistics_status,
      pod_uploaded: true,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_delivery_notes',
      entityId: req.params.id,
      action: 'pod_upload',
      newValues: { pod_signature, has_photo: Boolean(pod_photo_data) },
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to save proof of delivery' });
  }
});

router.post('/invoices', requirePermission('sales.create'), async (req, res) => {
  if (!req.body?.customer_id || !Array.isArray(req.body?.lines) || !req.body.lines.length) {
    return res.status(400).json({ error: 'customer_id and at least one line are required' });
  }
  if (req.body.lines.some((line) => !line?.item_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0)) {
    return res.status(400).json({ error: 'each line requires item_id, positive quantity, and non-negative unit_price' });
  }
  try {
    const result = await sales.createCustomerInvoice({
      companyId: req.user.company_id,
      userId: req.user.id,
      customerId: req.body.customer_id,
      salesOrderId: req.body.sales_order_id,
      deliveryNoteId: req.body.delivery_note_id,
      lines: req.body.lines,
      invoiceDate: req.body.invoice_date,
      dueDate: req.body.due_date,
      invoiceType: req.body.invoice_type,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/invoices', requirePermission('sales.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : '';
  const { page, limit, offset } = parsePagination(req.query);
  const { sort, order } = parseSort(
    req.query,
    ['invoice_date', 'invoice_no', 'total_amount', 'status', 'due_date', 'created_at'],
    'invoice_date',
  );

  try {
    let countSql = `SELECT COUNT(*)::int AS total FROM erp_customer_invoices inv
      JOIN erp_customers c ON c.id = inv.customer_id
      WHERE inv.company_id = $1 AND inv.is_deleted = FALSE`;
    let listSql = `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.is_deleted = FALSE`;
    const params = [req.user.company_id];

    if (q) {
      params.push(`%${q}%`);
      const clause = ` AND (inv.invoice_no ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
      countSql += clause;
      listSql += clause;
    }
    if (status) {
      params.push(status);
      const clause = ` AND inv.status = $${params.length}`;
      countSql += clause;
      listSql += clause;
    }

    const countParams = [...params];
    params.push(limit, offset);
    listSql += ` ORDER BY inv.${sort} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const [countResult, result] = await Promise.all([
      pool.query(countSql, countParams),
      pool.query(listSql, params),
    ]);

    return res.json({
      data: result.rows,
      pagination: { page, limit, total: countResult.rows[0].total },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.post('/invoices/:id/pay', requirePermission('sales.create'), async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amount must be greater than zero' });
  }
  try {
    const result = await sales.recordCustomerPayment({
      companyId: req.user.company_id,
      userId: req.user.id,
      invoiceId: req.params.id,
      paymentDate: req.body?.payment_date,
      amount,
      referenceNo: req.body?.reference_no,
      notes: req.body?.notes,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/invoices/:id/etims', requirePermission('sales.create'), async (req, res) => {
  try {
    const result = await sales.submitInvoiceToEtims({
      companyId: req.user.company_id,
      invoiceId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/invoices/:invoiceNo/email', requirePermission('sales.create'), async (req, res) => {
  try {
    const result = await emailInvoicePdf({
      companyId: req.user.company_id,
      invoiceNo: String(req.params.invoiceNo || '').trim(),
      toEmail: req.body?.to_email,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/invoices/:invoiceNo/pdf', requirePermission('sales.view'), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || '').trim();
  try {
    const buffer = await renderInvoicePdfBuffer({
      companyId: req.user.company_id,
      invoiceNo,
      receipt: false,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

router.get('/invoices/:invoiceNo/receipt-pdf', requirePermission('sales.view'), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || '').trim();
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [req.user.company_id, invoiceNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = result.rows[0];
  if (String(invoice.status).toLowerCase() !== 'paid') {
    return res.status(400).json({ error: 'Receipt PDF is available only for paid invoices' });
  }
  const buffer = await renderInvoicePdfBuffer({
    companyId: req.user.company_id,
    invoiceNo,
    receipt: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${invoiceNo}.pdf"`);
  return res.send(buffer);
});

router.get('/invoices/:invoiceNo/verify', requirePermission('sales.view'), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || '').trim();
  const provided = String(req.query?.hash || '').trim();
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [req.user.company_id, invoiceNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Invoice not found' });
  const invoice = result.rows[0];
  const expected = buildInvoiceVerificationHash(invoice);
  return res.json({
    invoice_no: invoice.invoice_no,
    status: invoice.status,
    verification_hash: expected,
    valid: provided ? provided === expected : undefined,
  });
});

router.get('/receipts/:receiptNo/pdf', requirePermission('sales.view'), async (req, res) => {
  const receiptNo = String(req.params.receiptNo || '').trim();
  try {
    const buffer = await renderPaymentReceiptPdfBuffer({
      companyId: req.user.company_id,
      receiptNo,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payment-receipt-${receiptNo}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(err.message === 'Payment receipt not found' ? 404 : 500).json({ error: err.message });
  }
});

router.get('/receipts/:receiptNo/verify', requirePermission('sales.view'), async (req, res) => {
  const receiptNo = String(req.params.receiptNo || '').trim();
  const provided = String(req.query?.hash || '').trim();
  const result = await pool.query(
    `SELECT r.*, c.name AS customer_name
     FROM erp_customer_receipts r
     JOIN erp_customers c ON c.id = r.customer_id
     WHERE r.company_id = $1 AND r.receipt_no = $2 AND r.is_deleted = FALSE`,
    [req.user.company_id, receiptNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Payment receipt not found' });
  const receipt = result.rows[0];
  const expected = buildPaymentReceiptHash(receipt);
  return res.json({
    receipt_no: receipt.receipt_no,
    customer_name: receipt.customer_name,
    amount: receipt.amount,
    receipt_date: receipt.receipt_date,
    verification_hash: expected,
    valid: provided ? provided === expected : undefined,
  });
});

router.get('/analytics/summary', requirePermission('sales.view'), async (req, res) => {
  const companyId = req.user.company_id;
  const today = new Date().toISOString().slice(0, 10);
  const { parseDashboardRange, fillMonthlyRevenueGaps } = require('../../lib/chartMonths');
  const range = parseDashboardRange(req.query);
  const { from, to } = range;

  const [
    orders,
    invoices,
    pipeline,
    todaysSales,
    monthlyRev,
    topProducts,
    byCategory,
    recentOrders,
  ] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0) AS total
       FROM erp_sales_orders WHERE company_id = $1 AND is_deleted = FALSE GROUP BY status`,
      [companyId],
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0) AS total
       FROM erp_customer_invoices WHERE company_id = $1 AND is_deleted = FALSE GROUP BY status`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount * probability / 100),0) AS forecast FROM erp_opportunities
       WHERE company_id = $1 AND is_deleted = FALSE AND stage NOT IN ('won','lost')`,
      [companyId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date = $2
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE`,
      [companyId, today],
    ),
    pool.query(
      `SELECT to_char(date_trunc('month', invoice_date), 'Mon YY') AS month,
              date_trunc('month', invoice_date) AS sort_key,
              COALESCE(SUM(total_amount),0) AS revenue
       FROM erp_customer_invoices
       WHERE company_id = $1 AND invoice_date BETWEEN $2 AND $3
         AND status IN ('posted','partial','paid','overdue') AND is_deleted = FALSE
       GROUP BY 1, 2 ORDER BY sort_key`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT i.name AS item_name, SUM(il.quantity)::float AS units
       FROM erp_customer_invoice_lines il
       JOIN erp_items i ON i.id = il.item_id
       JOIN erp_customer_invoices inv ON inv.id = il.invoice_id
       WHERE inv.company_id = $1 AND inv.invoice_date BETWEEN $2 AND $3
         AND inv.is_deleted = FALSE AND il.is_deleted = FALSE
       GROUP BY i.name ORDER BY units DESC LIMIT 5`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT COALESCE(ic.name, 'Uncategorized') AS category,
              COALESCE(SUM(il.line_total),0)::float AS value
       FROM erp_customer_invoice_lines il
       JOIN erp_items i ON i.id = il.item_id
       LEFT JOIN erp_item_categories ic ON ic.id = i.category_id
       JOIN erp_customer_invoices inv ON inv.id = il.invoice_id
       WHERE inv.company_id = $1 AND inv.invoice_date BETWEEN $2 AND $3
         AND inv.is_deleted = FALSE AND il.is_deleted = FALSE
       GROUP BY ic.name ORDER BY value DESC LIMIT 6`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT so.order_no, so.order_date, c.name AS customer_name,
              so.total_amount, so.status
       FROM erp_sales_orders so
       JOIN erp_customers c ON c.id = so.customer_id
       WHERE so.company_id = $1 AND so.is_deleted = FALSE
       ORDER BY so.order_date DESC, so.created_at DESC LIMIT 8`,
      [companyId],
    ),
  ]);

  return res.json({
    orders_by_status: orders.rows,
    invoices_by_status: invoices.rows,
    pipeline_forecast: pipeline.rows[0]?.forecast || 0,
    todays_sales: Number(todaysSales.rows[0]?.total || 0),
    monthly_revenue: fillMonthlyRevenueGaps(
      monthlyRev.rows.map((r) => ({
        month: r.month,
        sort_key: r.sort_key,
        revenue: Number(r.revenue || 0),
      })),
      from,
      to,
    ),
    range,
    top_products: topProducts.rows.map((r) => ({
      name: r.item_name,
      units: Number(r.units || 0),
    })),
    sales_by_category: byCategory.rows.map((r) => ({
      name: r.category,
      value: Number(r.value || 0),
    })),
    recent_orders: recentOrders.rows.map((r) => ({
      id: r.order_no,
      date: String(r.order_date || '').slice(0, 10),
      customer: r.customer_name,
      rep: '—',
      total: Number(r.total_amount || 0),
      status: r.status,
    })),
  });
});

const quotationService = require('../../services/quotationService');
const { syncOverdueInvoices } = require('../../services/overdueService');

router.get('/quotations', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT q.*, c.name AS customer_name FROM erp_quotations q
     JOIN erp_customers c ON c.id = q.customer_id
     WHERE q.company_id = $1 AND q.is_deleted = FALSE ORDER BY q.quote_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/quotations', requirePermission('sales.create'), async (req, res) => {
  const customerId = req.body?.customer_id ?? req.body?.customerId;
  if (!customerId) {
    return res.status(400).json({ error: 'customer_id is required' });
  }
  if (!Array.isArray(req.body.lines) || !req.body.lines.length) {
    return res.status(400).json({ error: 'lines are required' });
  }
  try {
    const quote = await quotationService.createQuotation({
      companyId: req.user.company_id,
      userId: req.user.id,
      actor: req.user,
      customerId,
      lines: req.body.lines,
      validUntil: req.body.valid_until ?? req.body.validUntil,
      opportunityId: req.body.opportunity_id ?? req.body.opportunityId,
    });
    return res.status(201).json(quote);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/quotations/:id/convert', requirePermission('sales.create'), async (req, res) => {
  const warehouseId = req.body?.warehouse_id;
  if (!warehouseId) {
    return res.status(400).json({ error: 'warehouse_id is required' });
  }
  try {
    const order = await quotationService.convertQuotationToOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      quotationId: req.params.id,
      warehouseId,
    });
    return res.status(201).json(order);
  } catch (err) {
    return res.status(400).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }
});

router.post('/orders/:id/cancel', requirePermission('sales.approve'), async (req, res) => {
  try {
    const result = await sales.cancelSalesOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      orderId: req.params.id,
      reason: req.body.reason,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/credit-notes', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT cn.*, c.name AS customer_name FROM erp_credit_notes cn
     JOIN erp_customers c ON c.id = cn.customer_id
     WHERE cn.company_id = $1 AND cn.is_deleted = FALSE
     ORDER BY cn.credit_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/credit-notes', requirePermission('sales.create'), async (req, res) => {
  try {
    const wh = req.body.warehouse_id;
    const cn = await sales.createAndPostCreditNote({
      companyId: req.user.company_id,
      userId: req.user.id,
      customerId: req.body.customer_id,
      invoiceId: req.body.invoice_id,
      reason: req.body.reason,
      lines: (req.body.lines || []).map((line) => ({
        ...line,
        warehouse_id: line.warehouse_id || wh,
      })),
    });
    return res.status(201).json(cn);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/maintenance/sync-overdue', requirePermission('finance.edit'), async (req, res) => {
  const result = await syncOverdueInvoices(req.user.company_id);
  return res.json(result);
});

module.exports = router;
