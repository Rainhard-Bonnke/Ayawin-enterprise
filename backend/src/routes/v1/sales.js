const express = require("express");
const fs = require("fs");
const path = require("path");
const pool = require("../../db");
const { authenticateErp, requirePermission, requireAnyPermission } = require("../../middleware/erpAuth");
const sales = require("../../services/salesService");
const arCollections = require("../../services/arCollectionService");
const customerCredits = require("../../services/customerCreditNoteService");
const customerReceipts = require("../../services/customerReceiptService");
const { parsePagination } = require("../../lib/queryHelper");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { buildInvoiceVerificationHash, isFinalEtimsInvoice } = require("../../services/documentVerificationService");

const router = express.Router();
const AYAWIN_PDF_LOGO = path.resolve(__dirname, "../../../../public/ayawin-wordmark.png");
router.use(authenticateErp);

async function requireSalesApprovalOrOwnPosOrder(req, res, next) {
  if (req.user?.permissions?.includes("sales.order.approve") || req.user?.role === "Admin") return next();
  if (req.user?.session_type === "pos" && req.user?.permissions?.includes("sales.create")) {
    const owned = await pool.query(
      "SELECT 1 FROM erp_sales_orders WHERE id=$1 AND company_id=$2 AND created_by=$3 AND is_deleted=FALSE",
      [req.params.id, req.user.company_id, req.user.id],
    );
    if (owned.rowCount) return next();
  }
  return res.status(403).json({ error: "Forbidden", required: ["sales.order.approve"] });
}

router.post("/atp-check", requirePermission("sales.view"), async (req, res) => {
  const { warehouse_id, lines } = req.body || {};
  if (!warehouse_id || !lines?.length)
    return res.status(400).json({ error: "warehouse_id and lines required" });
  const result = await sales.checkAtp(req.user.company_id, warehouse_id, lines);
  return res.json(result);
});

router.post("/tax-preview", requirePermission("sales.view"), async (req, res) => {
  try {
    const result = await sales.previewSaleTax(req.user.company_id, req.body?.lines, req.body?.tax_date);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/credit-check", requirePermission("sales.view"), async (req, res) => {
  const { customer_id, order_total } = req.body || {};
  if (!customer_id) return res.status(400).json({ error: "customer_id required" });
  const result = await sales.checkCreditLimit(req.user.company_id, customer_id, order_total || 0);
  return res.json(result);
});

router.get("/orders", requirePermission("sales.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const result = await pool.query(
    `SELECT so.*, c.name AS customer_name, w.name AS warehouse_name
     FROM erp_sales_orders so
     JOIN erp_customers c ON c.id = so.customer_id
     LEFT JOIN erp_warehouses w ON w.id = so.warehouse_id
     WHERE so.company_id = $1 AND so.is_deleted = FALSE
    ORDER BY so.order_date DESC
    LIMIT $2`,
    [req.user.company_id, limit],
  );
  return res.json(result.rows);
});

router.get("/orders/:id", requirePermission("sales.view"), async (req, res) => {
  const so = await pool.query(
    `SELECT so.*, c.name AS customer_name FROM erp_sales_orders so
     JOIN erp_customers c ON c.id = so.customer_id
     WHERE so.id = $1 AND so.company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  if (!so.rowCount) return res.status(404).json({ error: "Not found" });
  const lines = await pool.query(
    `SELECT sol.*, i.item_code, i.name AS item_name FROM erp_sales_order_lines sol
     JOIN erp_items i ON i.id = sol.item_id WHERE sol.sales_order_id = $1 ORDER BY sol.line_no`,
    [req.params.id],
  );
  return res.json({ ...so.rows[0], lines: lines.rows });
});

router.post("/orders", requirePermission("sales.order.create"), async (req, res) => {
  if (
    !req.body?.customer_id ||
    !req.body?.warehouse_id ||
    !req.body?.required_date ||
    !Array.isArray(req.body?.lines) ||
    !req.body.lines.length
  ) {
    return res
      .status(400)
      .json({ error: "customer_id, warehouse_id, required_date, and at least one line are required" });
  }
  if (
    req.body.lines.some(
      (line) => !line?.item_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0,
    )
  ) {
    return res.status(400).json({
      error: "each line requires item_id, positive quantity, and non-negative unit_price",
    });
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
      requiredDate: req.body.required_date,
      notes: req.body.notes,
      permissions: req.user.permissions,
    });
    return res.status(201).json(order);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/orders/:id/discount-approve", requirePermission("sales.discount_approve"), async (req, res) => {
  try {
    return res.json(await sales.approveSalesOrderDiscount({ companyId: req.user.company_id,
      userId: req.user.id, orderId: req.params.id, reason: req.body?.reason }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/orders/:id/credit-override", requirePermission("sales.credit_override"), async (req, res) => {
  try {
    return res.json(await sales.approveSalesOrderCreditOverride({ companyId: req.user.company_id,
      userId: req.user.id, orderId: req.params.id, reason: req.body?.reason }));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/orders/:id/confirm", requireSalesApprovalOrOwnPosOrder, async (req, res) => {
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

router.post("/orders/:id/cancel", requireSalesApprovalOrOwnPosOrder, async (req, res) => {
  try {
    const result = await sales.cancelSalesOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      orderId: req.params.id,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/deliveries", requirePermission("sales.delivery.post"), async (req, res) => {
  try {
    const result = await sales.createAndPostDelivery({
      companyId: req.user.company_id,
      userId: req.user.id,
      salesOrderId: req.body.sales_order_id,
      warehouseId: req.body.warehouse_id,
      lines: Array.isArray(req.body.lines) ? req.body.lines.map(({ so_line_id, item_id, quantity }) => ({
        so_line_id, item_id, quantity,
      })) : req.body.lines,
      deliveryDate: req.body.delivery_date,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/deliveries/:id/proof", requireAnyPermission("sales.create", "fleet.count"), async (req, res) => {
  try {
    const result = await sales.recordDeliveryProof({
      companyId: req.user.company_id,
      userId: req.user.id,
      user: req.user,
      deliveryId: req.params.id,
      routeCode: req.body.route_code,
      driverUserId: req.body.driver_user_id,
      vehicleWarehouseId: req.body.vehicle_warehouse_id,
      customerConfirmed: req.body.customer_confirmed,
      deliveredAt: req.body.delivered_at,
      proofNote: req.body.proof_note,
      signatureUrl: req.body.signature_url,
      lines: req.body.lines,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/routes/reconciliation", requireAnyPermission("sales.view", "fleet.view"), async (req, res) => {
  try {
    const routeCode = req.query.route_code || req.query.routeCode;
    if (!routeCode) return res.status(400).json({ error: "route_code is required" });
    const result = await sales.getRouteCollections({
      companyId: req.user.company_id,
      routeCode,
      fromDate: req.query.from_date || null,
      toDate: req.query.to_date || null,
      driverUserId: String(req.user.role_name || req.user.role || "").toLowerCase().includes("driver")
        ? req.user.id
        : null,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/routes/closures", requireAnyPermission("sales.view", "fleet.view"), async (req, res) => {
  try {
    const closures = await sales.listRouteClosures(req.user.company_id, {
      status: req.query.status || null,
      routeDate: req.query.route_date || null,
      user: req.user,
    });
    return res.json(closures);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/routes/closures", requireAnyPermission("sales.create", "fleet.count"), async (req, res) => {
  try {
    const closure = await sales.submitRouteClosure({
      companyId: req.user.company_id,
      user: req.user,
      routeCode: req.body?.route_code,
      routeDate: req.body?.route_date,
      driverUserId: req.body?.driver_user_id,
      declaredCollection: req.body?.declared_collection,
      note: req.body?.note,
    });
    return res.status(201).json(closure);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/routes/closures/:id/review", requireAnyPermission("sales.approve", "fleet.approve"), async (req, res) => {
  try {
    const closure = await sales.reviewRouteClosure({
      companyId: req.user.company_id,
      closureId: req.params.id,
      decision: req.body?.decision,
      note: req.body?.note,
      user: req.user,
    });
    return res.json(closure);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/deliveries", requirePermission("sales.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT d.*, so.order_no FROM erp_delivery_notes d
     JOIN erp_sales_orders so ON so.id = d.sales_order_id
     WHERE d.company_id = $1 AND d.is_deleted = FALSE ORDER BY d.delivery_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/invoices", requirePermission("sales.invoice.create"), async (req, res) => {
  if (!req.body?.customer_id || !Array.isArray(req.body?.lines) || !req.body.lines.length) {
    return res.status(400).json({ error: "customer_id and at least one line are required" });
  }
  if (
    req.body.lines.some(
      (line) => !line?.item_id || Number(line.quantity) <= 0 || Number(line.unit_price) < 0,
    )
  ) {
    return res.status(400).json({
      error: "each line requires item_id, positive quantity, and non-negative unit_price",
    });
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
      permissions: req.user.permissions,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/invoices", requirePermission("sales.view"), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
    WHERE inv.company_id = $1 AND inv.is_deleted = FALSE
    ORDER BY inv.invoice_date DESC
    LIMIT $2`,
    [req.user.company_id, limit],
  );
  return res.json(result.rows);
});

router.get("/customer-credit-notes/setup", requirePermission("sales.view"), async (req, res) => {
  try { return res.json(await customerCredits.getSetup(req.user.company_id)); }
  catch (error) { return res.status(400).json({ error: error.message || "Unable to load customer return setup" }); }
});

router.get("/invoices/:id/return-options", requirePermission("sales.view"), async (req, res) => {
  try { return res.json(await customerCredits.getReturnOptions(req.user.company_id, req.params.id)); }
  catch (error) { return res.status(400).json({ error: error.message || "Unable to load invoice return options" }); }
});

router.post("/customer-credit-notes", requirePermission("sales.credit_note.create"), async (req, res) => {
  try {
    const note = await customerCredits.createDraft({
      companyId: req.user.company_id, user: req.user, invoiceId: req.body?.invoice_id,
      creditDate: req.body?.credit_date, reason: req.body?.reason, lines: req.body?.lines,
      refundAmount: req.body?.refund_amount, refundBankAccountId: req.body?.refund_bank_account_id,
      refundReferenceNo: req.body?.refund_reference_no,
      courtDisputeDeterminedOn: req.body?.court_dispute_determined_on,
      courtCaseReference: req.body?.court_case_reference,
    });
    return res.status(201).json(note);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to prepare customer credit note" }); }
});

router.post("/customer-credit-notes/:id/post", requirePermission("sales.credit_note.approve"), async (req, res) => {
  try { return res.json(await customerCredits.postCreditNote({ companyId: req.user.company_id, noteId: req.params.id, user: req.user })); }
  catch (error) { return res.status(400).json({ error: error.message || "Unable to post customer credit note" }); }
});

router.post("/customer-credit-notes/:id/cancel", requirePermission("sales.create"), async (req, res) => {
  try { return res.json(await customerCredits.cancelDraft({ companyId: req.user.company_id, noteId: req.params.id, user: req.user })); }
  catch (error) { return res.status(400).json({ error: error.message || "Unable to cancel customer credit note" }); }
});

router.post("/invoices/:invoiceNo/post", requirePermission("sales.invoice.post"), async (req, res) => {
  const invoice = await pool.query(
    `SELECT id FROM erp_customer_invoices
     WHERE company_id = $1 AND invoice_no = $2 AND is_deleted = FALSE AND status = 'draft'`,
    [req.user.company_id, req.params.invoiceNo],
  );
  if (!invoice.rowCount) return res.status(404).json({ error: "Draft invoice not found" });
  try {
    return res.json(await sales.postCustomerInvoice({
      companyId: req.user.company_id, userId: req.user.id, invoiceId: invoice.rows[0].id,
    }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/invoices/:id/void", requirePermission("sales.invoice.post"), async (req, res) => {
  try {
    return res.json(await sales.voidCustomerInvoice({ companyId: req.user.company_id, userId: req.user.id,
      invoiceId: req.params.id, reason: req.body?.reason }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/customer-credit-notes/:id/void", requirePermission("sales.credit_note.approve"), async (req, res) => {
  try {
    return res.json(await customerCredits.voidDraft({ companyId: req.user.company_id, noteId: req.params.id,
      user: req.user, reason: req.body?.reason }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

// Invoice-level ageing is the operational collection list: it shows the open
// balance and days past due, rather than treating every invoice as unpaid.
router.get("/receivables/aging", requirePermission("sales.view"), async (req, res) => {
  const result = await pool.query(
    `WITH open_invoices AS (
       SELECT inv.id, inv.invoice_no, inv.customer_id, c.name AS customer_name,
         inv.invoice_date, inv.due_date, inv.currency_code, inv.status,
         inv.total_amount, inv.amount_paid, inv.credited_amount,
         GREATEST(inv.total_amount - inv.amount_paid - inv.credited_amount, 0) AS outstanding,
         GREATEST(CURRENT_DATE - COALESCE(inv.due_date, inv.invoice_date), 0)::int AS days_overdue
       FROM erp_customer_invoices inv
       JOIN erp_customers c ON c.id = inv.customer_id
       WHERE inv.company_id = $1 AND inv.is_deleted = FALSE
         AND inv.status IN ('posted','partial','overdue')
         AND inv.total_amount > inv.amount_paid + inv.credited_amount
     )
     SELECT *, CASE
       WHEN days_overdue = 0 THEN 'current'
       WHEN days_overdue <= 30 THEN '1-30 days'
       WHEN days_overdue <= 60 THEN '31-60 days'
       WHEN days_overdue <= 90 THEN '61-90 days'
       ELSE 'over 90 days' END AS ageing_bucket
     FROM open_invoices
     ORDER BY days_overdue DESC, due_date ASC, customer_name ASC
     LIMIT 2000`,
    [req.user.company_id],
  );
  const totals = result.rows.reduce((summary, invoice) => {
    const amount = Number(invoice.outstanding || 0);
    summary.outstanding += amount;
    summary[invoice.ageing_bucket === "current" ? "current" : invoice.ageing_bucket === "1-30 days" ? "days_1_30" : invoice.ageing_bucket === "31-60 days" ? "days_31_60" : invoice.ageing_bucket === "61-90 days" ? "days_61_90" : "days_over_90"] += amount;
    return summary;
  }, { outstanding: 0, current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0 });
  return res.json({ as_of: new Date().toISOString().slice(0, 10), totals, rows: result.rows });
});

router.get("/receivables/collection-activities", requirePermission("sales.view"), async (req, res) => {
  try {
    return res.json(await arCollections.listActivities(req.user.company_id, String(req.query.status || "open")));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to load collection follow-ups" }); }
});

router.post("/receivables/collection-activities", requirePermission("sales.create"), async (req, res) => {
  try {
    const activity = await arCollections.createActivity({
      companyId: req.user.company_id, user: req.user, invoiceId: req.body?.invoice_id,
      activityType: req.body?.activity_type, summary: req.body?.summary,
      nextActionDate: req.body?.next_action_date, promisedDate: req.body?.promised_date,
      promisedAmount: req.body?.promised_amount,
    });
    return res.status(201).json(activity);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to save collection follow-up" }); }
});

router.post("/receivables/collection-activities/:id/complete", requirePermission("sales.create"), async (req, res) => {
  try {
    return res.json(await arCollections.completeActivity({ companyId: req.user.company_id, user: req.user, activityId: req.params.id }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to complete collection follow-up" }); }
});

router.post("/invoices/:id/pay", requirePermission("sales.receipt.create"), async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "amount must be greater than zero" });
  }
  try {
    const result = await customerReceipts.createCustomerReceipt({
      companyId: req.user.company_id,
      userId: req.user.id,
      invoiceId: req.params.id,
      customerId: req.body?.customer_id,
      allocations: req.body?.allocations,
      paymentDate: req.body?.payment_date,
      amount,
      referenceNo: req.body?.reference_no,
      notes: req.body?.notes,
      paymentMethod: req.body?.payment_method || "bank_transfer",
      idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotency_key || null,
      tillSessionId: req.body?.till_session_id || null,
    });
    return res.status(result.status === "pending_approval" ? 202 : 201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/receipts/:id/approve", requirePermission("sales.receipt.approve"), async (req, res) => {
  try {
    return res.json(await customerReceipts.approveCustomerReceipt({ companyId: req.user.company_id,
      userId: req.user.id, receiptId: req.params.id }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/receipts/:id/allocate", requirePermission("sales.receipt.create"), async (req, res) => {
  try {
    return res.json(await customerReceipts.allocateCustomerReceipt({ companyId: req.user.company_id,
      userId: req.user.id, receiptId: req.params.id, allocations: req.body.allocations || [] }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/receipts/:id/clear-cheque", requirePermission("sales.receipt.approve"), async (req, res) => {
  try {
    return res.json(await customerReceipts.clearCheque({ companyId: req.user.company_id,
      userId: req.user.id, receiptId: req.params.id }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/pos/till-sessions/open", requirePermission("sales.receipt.create"), async (req, res) => {
  try {
    return res.status(201).json(await customerReceipts.openTillSession({ companyId: req.user.company_id,
      userId: req.user.id, openingFloat: req.body?.opening_float || 0 }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.post("/pos/till-sessions/:id/close", requirePermission("sales.receipt.create"), async (req, res) => {
  try {
    return res.json(await customerReceipts.closeTillSession({ companyId: req.user.company_id,
      userId: req.user.id, sessionId: req.params.id, countedCash: req.body?.counted_cash }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.get("/customers/:id/statement", requirePermission("sales.view"), async (req, res) => {
  try {
    return res.json(await customerReceipts.getCustomerStatement({ companyId: req.user.company_id,
      customerId: req.params.id, fromDate: req.query.from || null, toDate: req.query.to || null }));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

router.get("/customers/:id/statement.pdf", requirePermission("sales.view"), async (req, res) => {
  try {
    const statement = await customerReceipts.getCustomerStatement({ companyId: req.user.company_id,
      customerId: req.params.id, fromDate: req.query.from || null, toDate: req.query.to || null });
    const chunks = [];
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    doc.on("data", (chunk) => chunks.push(chunk));
    const completed = new Promise((resolve, reject) => { doc.on("end", resolve); doc.on("error", reject); });
    doc.fontSize(18).text("Customer Statement");
    doc.moveDown(0.5).fontSize(10).text(`${statement.customer.customer_code} · ${statement.customer.name}`);
    doc.text(`Period: ${statement.from} to ${statement.to}`);
    doc.text(`Opening balance: KES ${Number(statement.opening_balance).toFixed(2)}`);
    doc.moveDown().font("Helvetica-Bold").text("Date      Reference      Type      Debit      Credit      Balance");
    doc.font("Helvetica");
    for (const row of statement.transactions) {
      doc.text(`${String(row.event_date).slice(0,10)}   ${row.reference}   ${row.event_type}   ${Number(row.debit).toFixed(2)}   ${Number(row.credit).toFixed(2)}   ${Number(row.balance).toFixed(2)}`);
    }
    doc.moveDown().font("Helvetica-Bold").text(`Closing balance: KES ${Number(statement.closing_balance).toFixed(2)}`);
    doc.end();
    await completed;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=customer-statement-${req.params.id}.pdf`);
    return res.send(Buffer.concat(chunks));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

async function renderInvoicePdfBuffer({
  invoice,
  companyName = "Ayawin Enterprise ERP",
  receipt = false,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    (async () => {
      const title = receipt ? "PAYMENT RECEIPT" : "TAX INVOICE";
      const legacyVerifyHash = receipt ? buildInvoiceVerificationHash(invoice) : null;
      const verifyBase = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
      const verifyUrl = receipt
        ? `${verifyBase}/api/v1/sales/invoices/${encodeURIComponent(invoice.invoice_no)}/verify?hash=${legacyVerifyHash}`
        : null;
      const qrPayload = receipt ? verifyUrl : invoice.etims_verification_data;
      const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 128 });

      if (fs.existsSync(AYAWIN_PDF_LOGO)) {
        doc.image(AYAWIN_PDF_LOGO, 40, 34, { width: 190, height: 54, fit: [190, 54] });
        doc.y = 96;
      }
      doc.fontSize(18).font("Helvetica-Bold").text(companyName);
      doc.fontSize(10).font("Helvetica").text("Nairobi, Kenya");
      doc.moveDown(0.5);
      doc.fontSize(14).font("Helvetica-Bold").text(title, { align: "right" });
      doc.fontSize(10).font("Helvetica").text(`${invoice.invoice_no}`, { align: "right" });
      doc.text(`eTIMS CU invoice: ${invoice.etims_cu_invoice_no || invoice.etims_ref || "-"}`, { align: "right" });
      doc.moveDown();
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#dddddd").stroke();
      doc.moveDown();

      doc.fontSize(10).font("Helvetica-Bold").text("Bill To");
      doc.font("Helvetica").text(invoice.customer_name || "-");
      doc.text(`KRA PIN: ${invoice.customer_tax_id || "-"}`);
      doc.moveDown(0.5);
      doc.text(`Invoice date: ${String(invoice.invoice_date || "").slice(0, 10)}`);
      doc.text(`Due date: ${String(invoice.due_date || "").slice(0, 10)}`);
      if (receipt)
        doc.text(`Amount paid: KES ${Number(invoice.amount_paid || 0).toLocaleString()}`);
      doc.moveDown();

      if (invoice.lines?.length) {
        const drawLinesHeader = () => {
          const y = doc.y;
          doc.font("Helvetica-Bold").fontSize(8)
            .text("Item", 40, y, { width: 215 })
            .text("Qty", 260, y, { width: 45, align: "right" })
            .text("Unit price", 310, y, { width: 65, align: "right" })
            .text("Tax", 380, y, { width: 80, align: "right" })
            .text("Net", 465, y, { width: 90, align: "right" });
          doc.moveTo(40, y + 14).lineTo(555, y + 14).strokeColor("#aaaaaa").stroke();
          doc.y = y + 19;
        };
        drawLinesHeader();
        for (const line of invoice.lines) {
          if (doc.y > 700) { doc.addPage(); drawLinesHeader(); }
          const y = doc.y;
          const taxLabel = `${line.tax_code || "Tax"} ${Number(line.tax_rate || 0)}%`;
          doc.font("Helvetica").fontSize(8)
            .text(`${line.item_code || ""} ${line.item_name || "Item"}`.trim(), 40, y, { width: 215 })
            .text(Number(line.quantity || 0).toLocaleString(), 260, y, { width: 45, align: "right" })
            .text(Number(line.unit_price || 0).toLocaleString(), 310, y, { width: 65, align: "right" })
            .text(`${taxLabel} · ${Number(line.tax_amount || 0).toLocaleString()}`, 380, y, { width: 80, align: "right" })
            .text(Number(line.line_total || 0).toLocaleString(), 465, y, { width: 90, align: "right" });
          doc.y = y + 18;
        }
        doc.moveDown(0.5);
      }

      doc
        .font("Helvetica-Bold")
        .text("Subtotal", 40, doc.y, { continued: true })
        .text(`KES ${Number(invoice.subtotal || 0).toLocaleString()}`, { align: "right" });
      doc
        .font("Helvetica")
        .text("VAT", 40, doc.y, { continued: true })
        .text(`KES ${Number(invoice.tax_amount || 0).toLocaleString()}`, { align: "right" });
      doc
        .font("Helvetica-Bold")
        .text("Total", 40, doc.y, { continued: true })
        .text(`KES ${Number(invoice.total_amount || 0).toLocaleString()}`, { align: "right" });
      doc.moveDown(1.5);

      doc.image(qrDataUrl, 40, doc.y, { width: 72, height: 72 });
      doc.fontSize(8).font("Helvetica").fillColor("#555555");
      if (receipt) {
        doc.text(`Verification hash: ${legacyVerifyHash}`, 124, doc.y + 6);
        doc.text(`Verify URL: ${verifyUrl}`, 124, doc.y + 22, { width: 410 });
      } else {
        doc.text(`SCU ID: ${invoice.etims_cu_id}  Receipt: ${invoice.etims_receipt_counter || "-"}`, 124, doc.y + 6);
        doc.text(`SCU time: ${invoice.etims_cu_timestamp || "-"}`, 124, doc.y + 22, { width: 410 });
        doc.text(`Receipt signature: ${invoice.etims_receipt_signature}`, 124, doc.y + 38, { width: 410 });
        doc.text(`Internal data: ${invoice.etims_internal_data}`, 124, doc.y + 54, { width: 410 });
      }
      doc.end();
    })().catch(reject);
  });
}

router.get("/invoices/:invoiceNo/pdf", requirePermission("sales.view"), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || "").trim();
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [req.user.company_id, invoiceNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Invoice not found" });
  if (!isFinalEtimsInvoice(result.rows[0])) {
    return res.status(409).json({ error: "Invoice is pending KRA eTIMS acceptance and cannot be issued as a final tax invoice" });
  }
  const lines = await pool.query(
    `SELECT il.*, i.item_code, i.name AS item_name
     FROM erp_customer_invoice_lines il JOIN erp_items i ON i.id = il.item_id
     WHERE il.company_id = $1 AND il.invoice_id = $2 AND il.is_deleted = FALSE ORDER BY il.line_no`,
    [req.user.company_id, result.rows[0].id],
  );
  const buffer = await renderInvoicePdfBuffer({ invoice: { ...result.rows[0], lines: lines.rows } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoiceNo}.pdf"`);
  return res.send(buffer);
});

router.get(
  "/invoices/:invoiceNo/receipt-pdf",
  requirePermission("sales.view"),
  async (req, res) => {
    const invoiceNo = String(req.params.invoiceNo || "").trim();
    const result = await pool.query(
      `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
      [req.user.company_id, invoiceNo],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Invoice not found" });
    const invoice = result.rows[0];
    if (String(invoice.status).toLowerCase() !== "paid") {
      return res.status(400).json({ error: "Receipt PDF is available only for paid invoices" });
    }
    const lines = await pool.query(
      `SELECT il.*, i.item_code, i.name AS item_name
       FROM erp_customer_invoice_lines il JOIN erp_items i ON i.id = il.item_id
       WHERE il.company_id = $1 AND il.invoice_id = $2 AND il.is_deleted = FALSE ORDER BY il.line_no`,
      [req.user.company_id, invoice.id],
    );
    invoice.lines = lines.rows;
    const buffer = await renderInvoicePdfBuffer({ invoice, receipt: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${invoiceNo}.pdf"`);
    return res.send(buffer);
  },
);

router.get("/invoices/:invoiceNo/verify", requirePermission("sales.view"), async (req, res) => {
  const invoiceNo = String(req.params.invoiceNo || "").trim();
  const provided = String(req.query?.hash || "").trim();
  const result = await pool.query(
    `SELECT inv.*, c.name AS customer_name, c.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.invoice_no = $2 AND inv.is_deleted = FALSE`,
    [req.user.company_id, invoiceNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Invoice not found" });
  const invoice = result.rows[0];
  const expected = buildInvoiceVerificationHash(invoice);
  return res.json({
    invoice_no: invoice.invoice_no,
    status: invoice.status,
    verification_hash: expected,
    valid: provided ? provided === expected : undefined,
  });
});

router.get("/analytics/summary", requirePermission("sales.view"), async (req, res) => {
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
