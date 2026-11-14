const express = require("express");
const { authenticateErp, requirePermission, getClientIp } = require("../../middleware/erpAuth");
const pool = require("../../db");
const vatReturns = require("../../services/vatReturnService");
const { buildTaxManagementSummary } = require("../../services/taxManagementService");
const gl = require("../../services/glPostingService");
const { logAudit } = require("../../services/auditService");

const router = express.Router();
router.use(authenticateErp);

router.get("/summary", requirePermission("tax.view"), async (req, res) => {
  try {
    const latestReturn = await pool.query(
      `SELECT id, return_no, period_end, status, summary
       FROM erp_vat_returns
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY period_end DESC, created_at DESC
       LIMIT 1`,
      [req.user.company_id],
    );
    const [whtTotals, whtCategories] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE status='outstanding'),0) AS payable,
                COUNT(*) FILTER (WHERE status='outstanding')::int AS outstanding_count,
                COUNT(*) FILTER (WHERE status='remitted' AND certificate_no IS NULL)::int AS certificates_pending,
                MIN(due_date) FILTER (WHERE status='outstanding')::text AS next_due_date
         FROM erp_withholding_obligations WHERE company_id=$1`,
        [req.user.company_id],
      ),
      pool.query(
        `SELECT COUNT(*)::int AS approved_count FROM erp_withholding_categories
         WHERE company_id=$1 AND status='approved' AND is_deleted=FALSE`,
        [req.user.company_id],
      ),
    ]);
    const wht = whtTotals.rows[0];
    const whtOutstanding = Number(wht?.outstanding_count || 0);
    const withholdingCalendar = wht?.next_due_date
      ? [
          {
            name: "Withholding tax remittance",
            due_date: wht.next_due_date,
            status: "Pending remittance",
          },
        ]
      : [];
    const vatCalendar = latestReturn.rowCount
      ? [
          {
            name: `VAT return — ${new Date(`${latestReturn.rows[0].period_end}T00:00:00Z`).toLocaleString("en-KE", { month: "short", year: "numeric" })}`,
            due_date: new Date(`${latestReturn.rows[0].period_end}T00:00:00Z`)
              .toISOString()
              .slice(0, 10),
            status: latestReturn.rows[0].status === "locked" ? "Filed" : "Draft ready",
          },
        ]
      : [];

    const summary = buildTaxManagementSummary({
      latestVatReturn: latestReturn.rowCount ? latestReturn.rows[0] : null,
      withholdingTax: {
        payable: Number(wht?.payable || 0),
        certificatesPending: Number(wht?.certificates_pending || 0),
        remittanceStatus:
          whtOutstanding > 0
            ? "pending_remittance"
            : Number(whtCategories.rows[0]?.approved_count || 0) > 0
              ? "ready"
              : "not_configured",
        outstandingRemittances: whtOutstanding,
      },
      calendar: [...vatCalendar, ...withholdingCalendar],
    });

    return res.json(summary);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to build tax summary" });
  }
});

router.get("/returns", requirePermission("tax.view"), async (req, res) => {
  return res.json(await vatReturns.listVatReturns(req.user.company_id));
});

router.post("/returns/prepare", requirePermission("tax.prepare"), async (req, res) => {
  try {
    const result = await vatReturns.prepareVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodId: req.body?.period_id,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to prepare VAT working paper" });
  }
});

router.get("/returns/:id/export.csv", requirePermission("tax.export"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${vatReturn.return_no}.csv"`);
  return res.send(vatReturns.returnToCsv(vatReturn));
});

router.get("/returns/:id/export.xlsx", requirePermission("tax.export"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${vatReturn.return_no}.xlsx"`);
  return res.send(await vatReturns.returnToXlsx(vatReturn));
});

router.get("/returns/:id", requirePermission("tax.view"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  return res.json(vatReturn);
});

router.post("/returns/:id/approve", requirePermission("tax.approve"), async (req, res) => {
  try {
    const result = await vatReturns.approveVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      returnId: req.params.id,
      varianceExplanation: req.body?.variance_explanation,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to approve VAT working paper" });
  }
});

router.post("/returns/:id/lock", requirePermission("tax.approve"), async (req, res) => {
  try {
    return res.json(
      await vatReturns.lockVatReturn({
        companyId: req.user.company_id,
        userId: req.user.id,
        returnId: req.params.id,
      }),
    );
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to lock VAT return" });
  }
});

router.post("/returns/:id/reopen", requirePermission("tax.approve"), async (req, res) => {
  try {
    return res.json(
      await vatReturns.reopenVatReturn({
        companyId: req.user.company_id,
        userId: req.user.id,
        returnId: req.params.id,
        reason: req.body?.reason,
      }),
    );
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to reopen VAT return" });
  }
});

router.get("/withholding/categories", requirePermission("tax.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT category.id, category.code, category.name, category.residency, category.rate,
            category.taxable_basis, category.effective_from, category.effective_to,
            category.remittance_working_days, category.status, category.approved_by,
            category.approved_at, account.account_code AS liability_account_code
     FROM erp_withholding_categories category
     JOIN erp_chart_of_accounts account ON account.id=category.liability_account_id
       AND account.company_id=category.company_id
     WHERE category.company_id=$1 AND category.is_deleted=FALSE
     ORDER BY category.code, category.effective_from DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/withholding/categories", requirePermission("tax.edit"), async (req, res) => {
  const body = req.body || {};
  const code = String(body.code || "")
    .trim()
    .toUpperCase();
  const name = String(body.name || "").trim();
  const residency = String(body.residency || "").trim();
  const rate = Number(body.rate);
  const taxableBasis = String(body.taxable_basis || "").trim();
  const effectiveFrom = String(body.effective_from || "");
  const effectiveTo = body.effective_to ? String(body.effective_to) : null;
  const remittanceWorkingDays = Number(body.remittance_working_days);
  const liabilityAccountId = String(body.liability_account_id || "");
  const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (
    !/^[A-Z0-9_-]{2,40}$/.test(code) ||
    !name ||
    name.length > 180 ||
    !["resident", "non_resident"].includes(residency) ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 100 ||
    !["net_before_vat", "gross_including_vat"].includes(taxableBasis) ||
    !validDate(effectiveFrom) ||
    (effectiveTo && (!validDate(effectiveTo) || effectiveTo < effectiveFrom)) ||
    !Number.isInteger(remittanceWorkingDays) ||
    remittanceWorkingDays < 1 ||
    remittanceWorkingDays > 30 ||
    !liabilityAccountId
  ) {
    return res
      .status(400)
      .json({
        error:
          "Enter a valid withholding category, rate, residency, taxable basis, effective dates, due period, and liability account",
      });
  }
  try {
    const account = await pool.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE id=$1 AND company_id=$2 AND account_type='liability'
         AND is_postable=TRUE AND is_active=TRUE AND is_deleted=FALSE`,
      [liabilityAccountId, req.user.company_id],
    );
    if (!account.rowCount)
      throw new Error("Choose an active postable liability account in this company");
    const overlap = await pool.query(
      `SELECT 1 FROM erp_withholding_categories
       WHERE company_id=$1 AND code=$2 AND residency=$3 AND is_deleted=FALSE
         AND status <> 'disabled'
         AND daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]')
             && daterange($4::date, COALESCE($5::date, 'infinity'::date), '[]')`,
      [req.user.company_id, code, residency, effectiveFrom, effectiveTo],
    );
    if (overlap.rowCount)
      throw new Error("A category with overlapping effective dates already exists");
    const result = await pool.query(
      `INSERT INTO erp_withholding_categories (
         company_id, code, name, residency, rate, taxable_basis,
         effective_from, effective_to, remittance_working_days,
         liability_account_id, status, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
       RETURNING *`,
      [
        req.user.company_id,
        code,
        name,
        residency,
        rate,
        taxableBasis,
        effectiveFrom,
        effectiveTo,
        remittanceWorkingDays,
        liabilityAccountId,
        req.user.id,
      ],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_withholding_categories",
      entityId: result.rows[0].id,
      action: "create",
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res
      .status(400)
      .json({ error: error.message || "Unable to create withholding category" });
  }
});

router.post(
  "/withholding/categories/:id/approve",
  requirePermission("tax.approve"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE erp_withholding_categories
       SET status='approved', approved_by=$3, approved_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND company_id=$2 AND status='draft' AND is_deleted=FALSE
         AND created_by <> $3
       RETURNING *`,
        [req.params.id, req.user.company_id, req.user.id],
      );
      if (!result.rowCount)
        throw new Error("Category not found, already reviewed, or requires a different approver");
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: "erp_withholding_categories",
        entityId: req.params.id,
        action: "approve",
        newValues: result.rows[0],
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(result.rows[0]);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to approve withholding category" });
    }
  },
);

router.patch(
  "/withholding/vendors/:id/residency",
  requirePermission("tax.edit"),
  async (req, res) => {
    const residency = String(req.body?.tax_residency || "");
    const evidenceReference = String(req.body?.evidence_reference || "").trim();
    if (
      !["resident", "non_resident"].includes(residency) ||
      !evidenceReference ||
      evidenceReference.length > 180
    ) {
      return res
        .status(400)
        .json({ error: "Choose supplier residency and provide the supporting evidence reference" });
    }
    try {
      const result = await pool.query(
        `UPDATE erp_vendors SET tax_residency=$1, updated_by=$2, updated_at=NOW()
       WHERE id=$3 AND company_id=$4 AND is_active=TRUE AND is_deleted=FALSE
       RETURNING id, vendor_code, name, tax_residency`,
        [residency, req.user.id, req.params.id, req.user.company_id],
      );
      if (!result.rowCount) return res.status(404).json({ error: "Active supplier not found" });
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: "erp_vendors",
        entityId: req.params.id,
        action: "withholding_residency_update",
        newValues: { ...result.rows[0], evidence_reference: evidenceReference },
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(result.rows[0]);
    } catch (error) {
      return res
        .status(400)
        .json({ error: error.message || "Unable to update supplier tax residency" });
    }
  },
);

router.get("/withholding/obligations", requirePermission("tax.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT obligation.id, obligation.bill_id, obligation.payment_id, obligation.taxable_base,
            obligation.rate, obligation.amount, obligation.due_date, obligation.status,
            obligation.certificate_no, vendor.vendor_code, vendor.name AS vendor_name,
            category.code AS category_code, category.name AS category_name
     FROM erp_withholding_obligations obligation
     JOIN erp_vendors vendor ON vendor.id=obligation.vendor_id AND vendor.company_id=obligation.company_id
     JOIN erp_withholding_categories category ON category.id=obligation.category_id AND category.company_id=obligation.company_id
     WHERE obligation.company_id=$1
     ORDER BY obligation.due_date, vendor.name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/withholding/remittances", requirePermission("tax.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT remittance.id, remittance.remittance_no, remittance.remittance_date,
            remittance.payment_reference, remittance.total_amount, remittance.status,
            remittance.journal_id, COUNT(obligation.id)::int AS certificate_count
     FROM erp_withholding_remittances remittance
     LEFT JOIN erp_withholding_obligations obligation ON obligation.remittance_id=remittance.id
     WHERE remittance.company_id=$1
     GROUP BY remittance.id ORDER BY remittance.remittance_date DESC, remittance.created_at DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/withholding/remittances", requirePermission("tax.approve"), async (req, res) => {
  const obligationIds = Array.isArray(req.body?.obligation_ids)
    ? [...new Set(req.body.obligation_ids.map(String))]
    : [];
  const remittanceDate = String(req.body?.remittance_date || "");
  const paymentReference = String(req.body?.payment_reference || "").trim();
  const bankAccountId = String(req.body?.bank_account_id || "");
  if (
    !obligationIds.length ||
    !/^\d{4}-\d{2}-\d{2}$/.test(remittanceDate) ||
    !paymentReference ||
    paymentReference.length > 120 ||
    !bankAccountId
  ) {
    return res
      .status(400)
      .json({
        error:
          "Select outstanding obligations and provide a valid date, payment reference, and bank account",
      });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const obligations = await client.query(
      `SELECT obligation.*, category.liability_account_id, payment.created_by AS payment_approver
       FROM erp_withholding_obligations obligation
       JOIN erp_withholding_categories category ON category.id=obligation.category_id AND category.company_id=obligation.company_id
       JOIN erp_supplier_payments payment ON payment.id=obligation.payment_id AND payment.company_id=obligation.company_id
       WHERE obligation.company_id=$1 AND obligation.id=ANY($2::uuid[])
         AND obligation.status='outstanding'
       FOR UPDATE OF obligation`,
      [req.user.company_id, obligationIds],
    );
    if (obligations.rowCount !== obligationIds.length)
      throw new Error("Every selected withholding obligation must be outstanding in this company");
    if (
      obligations.rows.some(
        (item) => item.created_by === req.user.id || item.payment_approver === req.user.id,
      )
    ) {
      throw new Error("The payment preparer cannot approve the withholding remittance");
    }
    const bank = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE id=$1 AND company_id=$2
       AND account_type='asset' AND account_code LIKE '11%' AND is_postable=TRUE
       AND is_active=TRUE AND is_deleted=FALSE FOR UPDATE`,
      [bankAccountId, req.user.company_id],
    );
    if (!bank.rowCount) throw new Error("Choose an active postable cash or bank account");
    const total =
      Math.round(obligations.rows.reduce((sum, item) => sum + Number(item.amount), 0) * 100) / 100;
    const byAccount = new Map();
    for (const obligation of obligations.rows) {
      const accountId = String(obligation.liability_account_id);
      byAccount.set(accountId, (byAccount.get(accountId) || 0) + Number(obligation.amount));
    }
    const journal = await gl.createJournalInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      entryDate: remittanceDate,
      journalType: "payment",
      referenceNo: paymentReference,
      description: "Withholding tax remittance",
      source: "withholding_tax_remittance",
      lines: [
        ...[...byAccount.entries()].map(([accountId, amount]) => ({
          account_id: accountId,
          debit: Math.round(amount * 100) / 100,
          credit: 0,
          description: "Clear withholding tax payable",
        })),
        {
          account_id: bankAccountId,
          debit: 0,
          credit: total,
          description: `WHT remittance ${paymentReference}`,
        },
      ],
    });
    await gl.postJournalInTransaction(client, {
      journalId: journal.id,
      companyId: req.user.company_id,
      userId: req.user.id,
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [
      req.user.company_id,
      "wht-remittance-number",
    ]);
    const count = await client.query(
      "SELECT COUNT(*)::int AS count FROM erp_withholding_remittances WHERE company_id=$1",
      [req.user.company_id],
    );
    const remittanceNo = `WHT-${new Date().getFullYear()}-${String(Number(count.rows[0].count) + 1).padStart(5, "0")}`;
    const remittance = await client.query(
      `INSERT INTO erp_withholding_remittances (
         company_id, remittance_no, remittance_date, bank_account_id,
         payment_reference, journal_id, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.user.company_id,
        remittanceNo,
        remittanceDate,
        bankAccountId,
        paymentReference,
        journal.id,
        total,
        req.user.id,
      ],
    );
    for (const [index, obligation] of obligations.rows.entries()) {
      await client.query(
        `UPDATE erp_withholding_obligations
         SET status='remitted', remittance_id=$3, certificate_no=$4, remitted_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [
          obligation.id,
          req.user.company_id,
          remittance.rows[0].id,
          `${remittanceNo}-${String(index + 1).padStart(3, "0")}`,
        ],
      );
    }
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_withholding_remittances",
      entityId: remittance.rows[0].id,
      action: "post",
      newValues: { ...remittance.rows[0], obligation_ids: obligationIds },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      client,
    });
    await client.query("COMMIT");
    return res
      .status(201)
      .json({
        remittance: remittance.rows[0],
        journal_id: journal.id,
        certificate_count: obligations.rowCount,
      });
  } catch (error) {
    await client.query("ROLLBACK");
    return res
      .status(400)
      .json({ error: error.message || "Unable to post withholding remittance" });
  } finally {
    client.release();
  }
});

module.exports = router;
