const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const sales = require('../../services/salesService');
const { parsePagination } = require('../../lib/queryHelper');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { buildInvoiceVerificationHash } = require('../../services/documentVerificationService');

const router = express.Router();
router.use(authenticateErp);

router.post('/atp-check', requirePermission('sales.view'), async (req, res) => {
  const { warehouse_id, lines } = req.body || {};
  if (!warehouse_id || !lines?.length) return res.status(400).json({ error: 'warehouse_id and lines required' });
  const result = await sales.checkAtp(req.user.company_id, warehouse_id, lines);
  return res.json(result);
});

router.post('/credit-check', requirePermission('sales.view'), async (req, res) => {
  const { customer_id, order_total } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  const result = await sales.checkCreditLimit(req.user.company_id, customer_id, order_total || 0);
  return res.json(result);
});

router.get('/orders', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT so.*, c.name AS customer_name, w.name AS warehouse_name
     FROM erp_sales_orders so
     JOIN erp_customers c ON c.id = so.customer_id
     LEFT JOIN erp_warehouses w ON w.id = so.warehouse_id
     WHERE so.company_id = $1 AND so.is_deleted = FALSE
     ORDER BY so.order_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
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
      customerId: req.body.customer_id,
      warehouseId: req.body.warehouse_id,
      quotationId: req.body.quotation_id,
      lines: req.body.lines,
      orderDate: req.body.order_date,
      notes: req.body.notes,
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
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/deliveries', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT d.*, so.order_no FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     WHERE d.company_id = $1 AND d.is_deleted = FALSE ORDER BY d.delivery_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
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
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/invoices', requirePermission('sales.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.is_deleted = FALSE ORDER BY inv.invoice_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
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

async function renderInvoicePdfBuffer({ invoice, companyName = 'Ayawin Enterprise ERP', receipt = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    (async () => {
      const title = receipt ? 'PAYMENT RECEIPT' : 'TAX INVOICE';
      const verifyHash = buildInvoiceVerificationHash(invoice);
      const verifyBase = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const verifyUrl = `${verifyBase}/api/v1/sales/invoices/${encodeURIComponent(invoice.invoice_no)}/verify?hash=${verifyHash}`;
      const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 128 });

      doc.fontSize(18).font('Helvetica-Bold').text(companyName);
      doc.fontSize(10).font('Helvetica').text('Nairobi, Kenya');
      doc.moveDown(0.5);
      doc.fontSize(14).font('Helvetica-Bold').text(title, { align: 'right' });
      doc.fontSize(10).font('Helvetica').text(`${invoice.invoice_no}`, { align: 'right' });
      doc.text(`ETR/TIMS: ${invoice.etims_ref || '-'}`, { align: 'right' });
      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#dddddd').stroke();
      doc.moveDown();

      doc.fontSize(10).font('Helvetica-Bold').text('Bill To');
      doc.font('Helvetica').text(invoice.customer_name || '-');
      doc.text(`KRA PIN: ${invoice.customer_tax_id || '-'}`);
      doc.moveDown(0.5);
      doc.text(`Invoice date: ${String(invoice.invoice_date || '').slice(0, 10)}`);
      doc.text(`Due date: ${String(invoice.due_date || '').slice(0, 10)}`);
      if (receipt) doc.text(`Amount paid: KES ${Number(invoice.amount_paid || 0).toLocaleString()}`);
      doc.moveDown();

      doc.font('Helvetica-Bold').text('Subtotal', 40, doc.y, { continued: true }).text(`KES ${Number(invoice.subtotal || 0).toLocaleString()}`, { align: 'right' });
      doc.font('Helvetica').text('VAT', 40, doc.y, { continued: true }).text(`KES ${Number(invoice.tax_amount || 0).toLocaleString()}`, { align: 'right' });
      doc.font('Helvetica-Bold').text('Total', 40, doc.y, { continued: true }).text(`KES ${Number(invoice.total_amount || 0).toLocaleString()}`, { align: 'right' });
      doc.moveDown(1.5);

      doc.image(qrDataUrl, 40, doc.y, { width: 72, height: 72 });
      doc.fontSize(8).font('Helvetica').fillColor('#555555');
      doc.text(`Verification hash: ${verifyHash}`, 124, doc.y + 6);
      doc.text(`Verify URL: ${verifyUrl}`, 124, doc.y + 22, { width: 410 });
      doc.text('System generated document for audit and reconciliation.', 124, doc.y + 46);
      doc.end();
    })().catch(reject);
  });
}

router.get('/invoices/:invoiceNo/pdf', requirePermission('sales.view'), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || '').trim();
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [req.user.company_id, invoiceNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Invoice not found' });
  const buffer = await renderInvoicePdfBuffer({ invoice: result.rows[0] });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);
  return res.send(buffer);
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
  const buffer = await renderInvoicePdfBuffer({ invoice, receipt: true });
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

router.get('/analytics/summary', requirePermission('sales.view'), async (req, res) => {
  const [orders, invoices, pipeline] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0) AS total
       FROM erp_sales_orders WHERE company_id = $1 AND is_deleted = FALSE GROUP BY status`,
      [req.user.company_id],
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(total_amount),0) AS total
       FROM erp_customer_invoices WHERE company_id = $1 AND is_deleted = FALSE GROUP BY status`,
      [req.user.company_id],
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount * probability / 100),0) AS forecast FROM erp_opportunities
       WHERE company_id = $1 AND is_deleted = FALSE AND stage NOT IN ('won','lost')`,
      [req.user.company_id],
    ),
  ]);
  return res.json({
    orders_by_status: orders.rows,
    invoices_by_status: invoices.rows,
    pipeline_forecast: pipeline.rows[0]?.forecast || 0,
  });
});

module.exports = router;
