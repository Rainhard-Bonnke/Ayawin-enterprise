const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const procurement = require("../../services/procurementService");
const accountsPayable = require("../../services/accountsPayableService");
const supplierReturnCredits = require("../../services/supplierReturnCreditService");
const { parsePagination } = require("../../lib/queryHelper");

const router = express.Router();
router.use(authenticateErp);

router.get("/supplier-return-credits/setup", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await supplierReturnCredits.getSetup(req.user.company_id));
});

router.get("/supplier-return-credits", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await supplierReturnCredits.list(req.user.company_id));
});

router.post("/supplier-return-credits", requirePermission("procurement.create"), async (req, res) => {
  try {
    const credit = await supplierReturnCredits.create({
      companyId: req.user.company_id, user: req.user,
      dispositionId: req.body?.disposition_id, creditNoteNo: req.body?.credit_note_no,
      sourceBillLineId: req.body?.source_bill_line_id, creditDate: req.body?.credit_date,
      receivedDate: req.body?.received_date, referenceNo: req.body?.reference_no,
      returnedQuantity: req.body?.returned_quantity, inventoryClaimAmount: req.body?.inventory_claim_amount,
      vatAmount: req.body?.vat_amount, allocations: req.body?.allocations,
      refundAmount: req.body?.refund_amount, refundBankAccountId: req.body?.refund_bank_account_id,
      refundReferenceNo: req.body?.refund_reference_no, unappliedAmount: req.body?.unapplied_amount,
      unappliedAccountId: req.body?.unapplied_account_id,
      courtDisputeDeterminedOn: req.body?.court_dispute_determined_on, courtCaseReference: req.body?.court_case_reference,
    });
    return res.status(201).json(credit);
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to prepare supplier credit note" }); }
});

router.post("/supplier-return-credits/:id/post", requirePermission("procurement.approve"), async (req, res) => {
  try {
    return res.json(await supplierReturnCredits.post({ companyId: req.user.company_id, id: req.params.id, user: req.user }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to post supplier credit note" }); }
});

router.post("/supplier-return-credits/:id/cancel", requirePermission("procurement.create"), async (req, res) => {
  try {
    return res.json(await supplierReturnCredits.cancel({ companyId: req.user.company_id, id: req.params.id, user: req.user }));
  } catch (error) { return res.status(400).json({ error: error.message || "Unable to cancel supplier credit note" }); }
});

router.get("/supplier-bills", requirePermission("procurement.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT b.*, v.vendor_code, v.name AS vendor_name,
            gr.grn_number, po.po_number,
            GREATEST(b.total_amount - b.amount_paid, 0) AS balance_due,
            CASE WHEN b.status IN ('posted','partial','overdue') AND b.due_date < CURRENT_DATE
                 THEN CURRENT_DATE - b.due_date ELSE 0 END AS days_overdue,
            CASE WHEN b.status IN ('posted','partial','overdue') AND b.due_date < CURRENT_DATE THEN 'overdue'
                 ELSE b.status END AS display_status
     FROM erp_supplier_bills b JOIN erp_vendors v ON v.id = b.vendor_id
     LEFT JOIN erp_goods_receipts gr ON gr.id = b.goods_receipt_id AND gr.company_id = b.company_id
     LEFT JOIN erp_purchase_orders po ON po.id = b.purchase_order_id AND po.company_id = b.company_id
     WHERE b.company_id = $1 AND b.is_deleted = FALSE
     ORDER BY b.due_date, b.bill_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/supplier-bills/:id", requirePermission("procurement.view"), async (req, res) => {
  const bill = await pool.query(
    `SELECT b.*, v.vendor_code, v.name AS vendor_name, v.tax_id AS supplier_pin,
            GREATEST(b.total_amount - b.amount_paid, 0) AS balance_due
     FROM erp_supplier_bills b JOIN erp_vendors v ON v.id = b.vendor_id
     WHERE b.id = $1 AND b.company_id = $2 AND b.is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  if (!bill.rowCount) return res.status(404).json({ error: "Supplier bill not found" });
  const lines = await pool.query(
    `SELECT l.*, a.account_code, a.account_name FROM erp_supplier_bill_lines l
     JOIN erp_chart_of_accounts a ON a.id = l.account_id
     WHERE l.bill_id = $1 AND l.company_id = $2 ORDER BY l.line_no`,
    [req.params.id, req.user.company_id],
  );
  return res.json({ ...bill.rows[0], lines: lines.rows });
});

router.post("/supplier-bills", requirePermission("procurement.create"), async (req, res) => {
  try {
    const bill = await accountsPayable.createBill({
      companyId: req.user.company_id,
      userId: req.user.id,
      vendorId: req.body.vendor_id,
      supplierInvoiceNo: req.body.supplier_invoice_no,
      billDate: req.body.bill_date,
      dueDate: req.body.due_date,
      lines: req.body.lines,
      notes: req.body.notes,
      purchaseOrderId: req.body.purchase_order_id,
      goodsReceiptId: req.body.goods_receipt_id,
    });
    return res.status(201).json(bill);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post(
  "/supplier-bills/:id/post",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const result = await accountsPayable.postBill({
        companyId: req.user.company_id,
        userId: req.user.id,
        billId: req.params.id,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

router.get("/supplier-payments", requirePermission("procurement.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, v.name AS vendor_name, j.journal_no
     FROM erp_supplier_payments p JOIN erp_vendors v ON v.id = p.vendor_id
     LEFT JOIN erp_journals j ON j.id = p.journal_id
     WHERE p.company_id = $1 AND p.is_deleted = FALSE ORDER BY p.payment_date DESC, p.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/supplier-payments", requirePermission("procurement.create"), async (req, res) => {
  try {
    const payment = await accountsPayable.createPayment({
      companyId: req.user.company_id,
      userId: req.user.id,
      vendorId: req.body.vendor_id,
      paymentDate: req.body.payment_date,
      paymentMethod: req.body.payment_method,
      referenceNo: req.body.reference_no,
      bankAccountId: req.body.bank_account_id,
      notes: req.body.notes,
      allocations: req.body.allocations,
    });
    return res.status(201).json(payment);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post(
  "/supplier-payments/:id/post",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const result = await accountsPayable.postPayment({
        companyId: req.user.company_id,
        userId: req.user.id,
        paymentId: req.params.id,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

router.get("/requisitions", requirePermission("procurement.view"), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const [countR, dataR] = await Promise.all([
    pool.query(
      "SELECT COUNT(*)::int AS total FROM erp_purchase_requisitions WHERE company_id = $1 AND is_deleted = FALSE",
      [req.user.company_id],
    ),
    pool.query(
      `SELECT * FROM erp_purchase_requisitions WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.company_id, limit, offset],
    ),
  ]);
  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });
});

router.get("/purchase-orders", requirePermission("procurement.view"), async (req, res) => {
  const status = req.query.status;
  const params = [req.user.company_id];
  let filter = "";
  if (status) {
    params.push(status);
    filter = `AND po.status = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT po.*, v.name AS vendor_name, w.name AS warehouse_name
     FROM erp_purchase_orders po
     JOIN erp_vendors v ON v.id = po.vendor_id
     LEFT JOIN erp_warehouses w ON w.id = po.warehouse_id
     WHERE po.company_id = $1 AND po.is_deleted = FALSE ${filter}
     ORDER BY po.order_date DESC`,
    params,
  );
  return res.json(result.rows);
});

router.get("/purchase-orders/:id", requirePermission("procurement.view"), async (req, res) => {
  const po = await pool.query(
    `SELECT po.*, v.name AS vendor_name FROM erp_purchase_orders po
     JOIN erp_vendors v ON v.id = po.vendor_id
     WHERE po.id = $1 AND po.company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  if (!po.rowCount) return res.status(404).json({ error: "Not found" });
  const lines = await pool.query(
    `SELECT pol.*, i.item_code, i.name AS item_name
     FROM erp_purchase_order_lines pol JOIN erp_items i ON i.id = pol.item_id
     WHERE pol.purchase_order_id = $1 ORDER BY pol.line_no`,
    [req.params.id],
  );
  return res.json({ ...po.rows[0], lines: lines.rows });
});

router.post("/purchase-orders", requirePermission("procurement.create"), async (req, res) => {
  try {
    const po = await procurement.createPurchaseOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      vendorId: req.body.vendor_id,
      warehouseId: req.body.warehouse_id,
      requisitionId: req.body.requisition_id,
      lines: req.body.lines,
      expectedDate: req.body.expected_date,
      notes: req.body.notes,
    });
    return res.status(201).json(po);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post(
  "/purchase-orders/:id/approve",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const po = await procurement.approvePurchaseOrder({
        companyId: req.user.company_id,
        userId: req.user.id,
        poId: req.params.id,
      });
      return res.json(po);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  },
);

router.get("/goods-receipts", requirePermission("procurement.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT g.*, po.po_number, po.vendor_id, v.name AS vendor_name FROM erp_goods_receipts g
     JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
     JOIN erp_vendors v ON v.id = po.vendor_id
     WHERE g.company_id = $1 AND g.is_deleted = FALSE ORDER BY g.received_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/goods-receipts/:id", requirePermission("procurement.view"), async (req, res) => {
  const receipt = await pool.query(
    `SELECT gr.*, po.po_number, po.vendor_id, v.name AS vendor_name
     FROM erp_goods_receipts gr
     JOIN erp_purchase_orders po ON po.id = gr.purchase_order_id
     JOIN erp_vendors v ON v.id = po.vendor_id
     WHERE gr.id = $1 AND gr.company_id = $2 AND gr.is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  if (!receipt.rowCount) return res.status(404).json({ error: "Goods receipt not found" });
  const lines = await pool.query(
    `SELECT gl.id AS goods_receipt_line_id, gl.item_id, gl.quantity,
            gl.unit_cost AS unit_price, i.item_code, i.name AS item_name,
            GREATEST(gl.quantity - COALESCE(SUM(CASE WHEN b.status <> 'cancelled' AND b.is_deleted = FALSE THEN bl.quantity ELSE 0 END), 0), 0) AS unbilled_quantity
     FROM erp_goods_receipt_lines gl
     JOIN erp_items i ON i.id = gl.item_id AND i.company_id = gl.company_id
     LEFT JOIN erp_supplier_bill_lines bl ON bl.goods_receipt_line_id = gl.id AND bl.company_id = gl.company_id
     LEFT JOIN erp_supplier_bills b ON b.id = bl.bill_id AND b.company_id = gl.company_id
     WHERE gl.goods_receipt_id = $1 AND gl.company_id = $2 AND gl.is_deleted = FALSE
     GROUP BY gl.id, i.id ORDER BY gl.line_no`,
    [req.params.id, req.user.company_id],
  );
  return res.json({ ...receipt.rows[0], lines: lines.rows });
});

router.post("/goods-receipts", requirePermission("procurement.create"), async (req, res) => {
  try {
    const result = await procurement.createAndPostGrn({
      companyId: req.user.company_id,
      userId: req.user.id,
      purchaseOrderId: req.body.purchase_order_id,
      warehouseId: req.body.warehouse_id,
      lines: req.body.lines,
      receivedDate: req.body.received_date,
      notes: req.body.notes,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post(
  "/goods-receipts/:id/post",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const result = await procurement.postGoodsReceipt({
        companyId: req.user.company_id,
        userId: req.user.id,
        grnId: req.params.id,
        postGl: req.body?.post_gl !== false,
      });
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  },
);

module.exports = router;
