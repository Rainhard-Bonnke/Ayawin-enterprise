const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const procurement = require("../../services/procurementService");
const procurementExpansion = require("../../services/procurementExpansionService");
const accountsPayable = require("../../services/accountsPayableService");
const supplierReturnCredits = require("../../services/supplierReturnCreditService");
const { parsePagination } = require("../../lib/queryHelper");

const router = express.Router();
router.use(authenticateErp);

router.get(
  "/supplier-return-credits/setup",
  requirePermission("procurement.view"),
  async (req, res) => {
    return res.json(await supplierReturnCredits.getSetup(req.user.company_id));
  },
);

router.get("/supplier-return-credits", requirePermission("procurement.view"), async (req, res) => {
  return res.json(await supplierReturnCredits.list(req.user.company_id));
});

router.post(
  "/supplier-return-credits",
  requirePermission("procurement.create"),
  async (req, res) => {
    try {
      const credit = await supplierReturnCredits.create({
        companyId: req.user.company_id,
        user: req.user,
        dispositionId: req.body?.disposition_id,
        creditNoteNo: req.body?.credit_note_no,
        sourceBillLineId: req.body?.source_bill_line_id,
        creditDate: req.body?.credit_date,
        receivedDate: req.body?.received_date,
        referenceNo: req.body?.reference_no,
        returnedQuantity: req.body?.returned_quantity,
        inventoryClaimAmount: req.body?.inventory_claim_amount,
        vatAmount: req.body?.vat_amount,
        allocations: req.body?.allocations,
        refundAmount: req.body?.refund_amount,
        refundBankAccountId: req.body?.refund_bank_account_id,
        refundReferenceNo: req.body?.refund_reference_no,
        unappliedAmount: req.body?.unapplied_amount,
        unappliedAccountId: req.body?.unapplied_account_id,
        courtDisputeDeterminedOn: req.body?.court_dispute_determined_on,
        courtCaseReference: req.body?.court_case_reference,
      });
      return res.status(201).json(credit);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to prepare supplier credit note" });
    }
  },
);

router.post(
  "/supplier-return-credits/:id/post",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      return res.json(
        await supplierReturnCredits.post({
          companyId: req.user.company_id,
          id: req.params.id,
          user: req.user,
        }),
      );
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to post supplier credit note" });
    }
  },
);

router.post(
  "/supplier-return-credits/:id/cancel",
  requirePermission("procurement.create"),
  async (req, res) => {
    try {
      return res.json(
        await supplierReturnCredits.cancel({
          companyId: req.user.company_id,
          id: req.params.id,
          user: req.user,
        }),
      );
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to cancel supplier credit note" });
    }
  },
);

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

router.get("/supplier-bills/tax-review", requirePermission("tax.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT b.id, b.bill_no, b.supplier_invoice_no, b.bill_date, b.status,
            b.evidence_status, b.etims_invoice_no, b.etims_receipt_signature,
            v.vendor_code, v.name AS vendor_name,
            COUNT(l.id)::int AS line_count,
            COALESCE(SUM(l.claimable_vat), 0) AS claimable_vat,
            COALESCE(SUM(l.non_claimable_vat), 0) AS non_claimable_vat
     FROM erp_supplier_bills b
     JOIN erp_vendors v ON v.id = b.vendor_id AND v.company_id = b.company_id
     LEFT JOIN erp_supplier_bill_lines l ON l.bill_id = b.id AND l.company_id = b.company_id
     WHERE b.company_id = $1 AND b.is_deleted = FALSE
       AND b.evidence_status IN ('unverified', 'rejected')
     GROUP BY b.id, v.id
     ORDER BY b.bill_date, b.bill_no`,
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
      etimsInvoiceNo: req.body.etims_invoice_no,
      etimsReceiptSignature: req.body.etims_receipt_signature,
      permissions: req.user.permissions || [],
    });
    return res.status(201).json(bill);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post(
  "/supplier-bills/:id/verify-evidence",
  requirePermission("tax.approve"),
  async (req, res) => {
    try {
      const result = await accountsPayable.verifySupplierBillEvidence({
        companyId: req.user.company_id,
        userId: req.user.id,
        billId: req.params.id,
        etimsInvoiceNo: req.body?.etims_invoice_no,
        etimsReceiptSignature: req.body?.etims_receipt_signature,
        verificationNote: req.body?.verification_note,
      });
      return res.json(result);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to verify supplier invoice evidence" });
    }
  },
);

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

router.get("/purchase-requisitions", requirePermission("procurement.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, COUNT(l.id)::int AS line_count
     FROM erp_purchase_requisitions r
     LEFT JOIN erp_purchase_requisition_lines l ON l.requisition_id = r.id AND l.company_id = r.company_id
     WHERE r.company_id = $1 AND r.is_deleted = FALSE
     GROUP BY r.id ORDER BY r.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get(
  "/purchase-requisitions/:id",
  requirePermission("procurement.view"),
  async (req, res) => {
    const requisition = await pool.query(
      `SELECT r.* FROM erp_purchase_requisitions r WHERE r.id = $1 AND r.company_id = $2 AND r.is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!requisition.rowCount)
      return res.status(404).json({ error: "Purchase requisition not found" });
    const lines = await pool.query(
      `SELECT l.*, i.item_code, i.name AS item_name
     FROM erp_purchase_requisition_lines l
     JOIN erp_items i ON i.id = l.item_id AND i.company_id = l.company_id
     WHERE l.requisition_id = $1 AND l.company_id = $2 AND l.is_deleted = FALSE ORDER BY l.line_no`,
      [req.params.id, req.user.company_id],
    );
    return res.json({ ...requisition.rows[0], lines: lines.rows });
  },
);

router.post("/purchase-requisitions", requirePermission("procurement.create"), async (req, res) => {
  try {
    const requisition = await procurement.createPurchaseRequisition({
      companyId: req.user.company_id,
      userId: req.user.id,
      branchId: req.body.branch_id,
      vendorId: req.body.vendor_id,
      requiredDate: req.body.required_date,
      notes: req.body.notes,
      lines: req.body.lines,
    });
    return res.status(201).json(requisition);
  } catch (error) {
    return res
      .status(400)
      .json({ error: error.message || "Unable to create purchase requisition" });
  }
});

router.post(
  "/purchase-requisitions/:id/approve",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const requisition = await procurement.approvePurchaseRequisition({
        companyId: req.user.company_id,
        userId: req.user.id,
        requisitionId: req.params.id,
      });
      return res.json(requisition);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to approve purchase requisition" });
    }
  },
);

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
    `SELECT pol.*, i.item_code, i.name AS item_name, i.lot_tracking_enabled, i.expiry_tracking_enabled
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

router.get("/suppliers", requirePermission("procurement.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT v.*, COALESCE(b.reason, '') AS blacklist_reason,
              COALESCE((SELECT COUNT(*) FROM erp_supplier_documents d WHERE d.company_id = v.company_id AND d.supplier_id = v.id), 0) AS document_count,
              COALESCE((SELECT MAX(total_score) FROM erp_supplier_scorecards s WHERE s.company_id = v.company_id AND s.supplier_id = v.id), 0) AS latest_score
       FROM erp_vendors v
       LEFT JOIN erp_supplier_blacklist b ON b.company_id = v.company_id AND b.supplier_id = v.id AND b.is_active = TRUE
       WHERE v.company_id = $1 AND v.is_deleted = FALSE
       ORDER BY v.name ASC`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list suppliers" });
  }
});

router.post("/suppliers", requirePermission("procurement.create"), async (req, res) => {
  try {
    const taxId = req.body.tax_id || null;
    if (taxId && !/^[AP][0-9]{9}[A-Z]$/.test(taxId)) {
      throw new Error("Supplier tax ID must match the KRA PIN format");
    }
    const vendor = await pool.query(
      `INSERT INTO erp_vendors (company_id, payment_terms_id, currency_code, vendor_code, name, tax_id, contact_name, email, phone, address_line1, city, country_code, bank_name, bank_account_no, bank_branch, credit_limit, is_active, created_by)
       VALUES ($1, $2, COALESCE($3, 'KES'), $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12,'KE'), $13, $14, $15, COALESCE($16,0), TRUE, $17)
       RETURNING *`,
      [
        req.user.company_id,
        req.body.payment_terms_id || null,
        req.body.currency_code || null,
        req.body.vendor_code || `V-${Date.now()}`,
        req.body.name,
        taxId,
        req.body.contact_name || null,
        req.body.email || null,
        req.body.phone || null,
        req.body.address_line1 || null,
        req.body.city || null,
        req.body.country_code || "KE",
        req.body.bank_name || null,
        req.body.bank_account_no || null,
        req.body.bank_branch || null,
        req.body.credit_limit || 0,
        req.user.id,
      ],
    );
    return res.status(201).json(vendor.rows[0]);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create supplier" });
  }
});

router.post(
  "/suppliers/:id/documents",
  requirePermission("procurement.create"),
  async (req, res) => {
    try {
      const doc = await procurementExpansion.createSupplierDocument({
        companyId: req.user.company_id,
        supplierId: req.params.id,
        documentType: req.body.document_type,
        documentName: req.body.document_name,
        fileUrl: req.body.file_url,
        expiryDate: req.body.expiry_date,
        status: req.body.status || "active",
        userId: req.user.id,
      });
      return res.status(201).json(doc);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to store supplier document" });
    }
  },
);

router.post(
  "/suppliers/:id/scorecards",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const scorecard = await procurementExpansion.upsertSupplierScorecard({
        companyId: req.user.company_id,
        supplierId: req.params.id,
        periodStart: req.body.period_start,
        periodEnd: req.body.period_end,
        scorecard: req.body,
        reviewedBy: req.user.id,
      });
      return res.status(201).json(scorecard);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to save supplier scorecard" });
    }
  },
);

router.post(
  "/suppliers/:id/blacklist",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const blocked = await procurementExpansion.blacklistSupplier({
        companyId: req.user.company_id,
        supplierId: req.params.id,
        reason: req.body.reason || "Blacklisted by procurement",
        userId: req.user.id,
      });
      return res.status(201).json(blocked);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to blacklist supplier" });
    }
  },
);

router.get("/procurement-policies", requirePermission("procurement.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_procurement_policies WHERE company_id = $1 AND status = 'active' ORDER BY created_at DESC`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list procurement policies" });
  }
});

router.post("/procurement-policies", requirePermission("procurement.approve"), async (req, res) => {
  try {
    const policy = await procurementExpansion.createProcurementPolicy({
      companyId: req.user.company_id,
      policyName: req.body.policy_name || "default",
      policy: req.body,
    });
    return res.status(201).json(policy);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create procurement policy" });
  }
});

router.get("/tenders", requirePermission("procurement.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_tenders WHERE company_id = $1 ORDER BY created_at DESC`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list tenders" });
  }
});

router.post("/tenders", requirePermission("procurement.create"), async (req, res) => {
  try {
    const tender = await procurementExpansion.createTender({
      companyId: req.user.company_id,
      tenderNo: req.body.tender_no || `TND-${Date.now()}`,
      title: req.body.title,
      tenderType: req.body.tender_type || "open",
      submissionDeadline: req.body.submission_deadline,
      notes: req.body.notes,
      userId: req.user.id,
    });
    return res.status(201).json(tender);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create tender" });
  }
});

router.post("/tenders/:id/bidders", requirePermission("procurement.create"), async (req, res) => {
  try {
    const bidder = await procurementExpansion.addTenderBidder({
      companyId: req.user.company_id,
      tenderId: req.params.id,
      vendorId: req.body.vendor_id,
    });
    return res.status(201).json(bidder);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to register bidder" });
  }
});

router.post(
  "/tenders/:id/evaluations",
  requirePermission("procurement.approve"),
  async (req, res) => {
    try {
      const evaluation = await procurementExpansion.evaluateTender({
        companyId: req.user.company_id,
        tenderId: req.params.id,
        vendorId: req.body.vendor_id,
        evaluatorName: req.body.evaluator_name || "Committee Member",
        score: req.body.score,
        comments: req.body.comments,
      });
      return res.status(201).json(evaluation);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to record tender evaluation" });
    }
  },
);

router.get("/contracts", requirePermission("procurement.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_contracts WHERE company_id = $1 ORDER BY created_at DESC`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list contracts" });
  }
});

router.post("/contracts", requirePermission("procurement.create"), async (req, res) => {
  try {
    const contract = await procurementExpansion.createContract({
      companyId: req.user.company_id,
      supplierId: req.body.supplier_id,
      contractNo: req.body.contract_no || `CT-${Date.now()}`,
      contractType: req.body.contract_type || "supplier",
      valueAmount: req.body.value_amount,
      startDate: req.body.start_date,
      endDate: req.body.end_date,
      ownerUserId: req.body.owner_user_id || null,
      renewalTerms: req.body.renewal_terms,
      serviceLevels: req.body.service_levels,
      userId: req.user.id,
    });
    return res.status(201).json(contract);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to create contract" });
  }
});

router.post(
  "/contracts/:id/call-offs",
  requirePermission("procurement.create"),
  async (req, res) => {
    try {
      const calloff = await procurementExpansion.recordContractCallOff({
        companyId: req.user.company_id,
        contractId: req.params.id,
        purchaseOrderId: req.body.purchase_order_id,
        calloffAmount: req.body.calloff_amount || 0,
      });
      return res.status(201).json(calloff);
    } catch (error) {
      return res.status(400).json({ error: error.message || "Unable to record contract call-off" });
    }
  },
);

router.post("/cost-allocations", requirePermission("procurement.create"), async (req, res) => {
  try {
    const allocation = await procurementExpansion.allocateCost({
      companyId: req.user.company_id,
      allocationType: req.body.allocation_type,
      sourceId: req.body.source_id,
      details: req.body,
      userId: req.user.id,
    });
    return res.status(201).json(allocation);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to allocate costs" });
  }
});

module.exports = router;
