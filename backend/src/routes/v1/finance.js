const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission, getClientIp } = require("../../middleware/erpAuth");
const { logAudit } = require("../../services/auditService");
const gl = require("../../services/glPostingService");
const bankReconciliation = require("../../services/bankReconciliationService");
const { parsePagination } = require("../../lib/queryHelper");

const router = express.Router();
router.use(authenticateErp);

router.get("/bank-accounts", requirePermission("finance.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT id, account_code, account_name, currency_code
     FROM erp_chart_of_accounts
     WHERE company_id = $1 AND account_type = 'asset' AND account_code LIKE '11%'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE
     ORDER BY account_code`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/bank-reconciliations", requirePermission("finance.view"), async (req, res) => {
  return res.json(await bankReconciliation.listReconciliations(req.user.company_id));
});

router.post("/bank-reconciliations", requirePermission("finance.create"), async (req, res) => {
  try {
    const reconciliation = await bankReconciliation.createReconciliation({
      companyId: req.user.company_id,
      userId: req.user.id,
      bankAccountId: req.body?.bank_account_id,
      statementReference: req.body?.statement_reference,
      statementStart: req.body?.statement_start,
      statementEnd: req.body?.statement_end,
      openingBalance: req.body?.opening_balance,
      closingBalance: req.body?.closing_balance,
      lines: req.body?.lines,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id,
      entityType: "erp_bank_reconciliations", entityId: reconciliation.id,
      action: "import", newValues: { ...reconciliation, line_count: req.body.lines.length },
      ipAddress: getClientIp(req), userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(reconciliation);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/bank-reconciliations/:id/candidates", requirePermission("finance.view"), async (req, res) => {
  return res.json(await bankReconciliation.listCandidates(req.user.company_id, req.params.id));
});

router.get("/bank-reconciliations/:id", requirePermission("finance.view"), async (req, res) => {
  const reconciliation = await bankReconciliation.getReconciliation(req.user.company_id, req.params.id);
  if (!reconciliation) return res.status(404).json({ error: "Bank reconciliation not found" });
  return res.json(reconciliation);
});

router.post("/bank-reconciliations/:id/lines/:lineId/match", requirePermission("finance.create"), async (req, res) => {
  try {
    const result = await bankReconciliation.matchStatementLine({
      companyId: req.user.company_id, userId: req.user.id,
      reconciliationId: req.params.id, lineId: req.params.lineId,
      journalLineId: req.body?.journal_line_id,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id,
      entityType: "erp_bank_reconciliation_lines", entityId: req.params.lineId,
      action: "match", newValues: result,
      ipAddress: getClientIp(req), userAgent: req.headers["user-agent"],
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/bank-reconciliations/:id/complete", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await bankReconciliation.completeReconciliation({
      companyId: req.user.company_id, userId: req.user.id, reconciliationId: req.params.id,
    });
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id,
      entityType: "erp_bank_reconciliations", entityId: req.params.id,
      action: "reconcile", newValues: result,
      ipAddress: getClientIp(req), userAgent: req.headers["user-agent"],
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/fiscal-years", requirePermission("finance.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT fy.*, COUNT(fp.id)::int AS period_count
     FROM erp_fiscal_years fy
     LEFT JOIN erp_fiscal_periods fp ON fp.fiscal_year_id = fy.id AND fp.is_deleted = FALSE
     WHERE fy.company_id = $1 AND fy.is_deleted = FALSE
     GROUP BY fy.id ORDER BY fy.start_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/fiscal-periods", requirePermission("finance.view"), async (req, res) => {
  const yearId = req.query.fiscal_year_id;
  const params = [req.user.company_id];
  let filter = "";
  if (yearId) {
    filter = "AND fp.fiscal_year_id = $2";
    params.push(yearId);
  }
  const result = await pool.query(
    `SELECT fp.* FROM erp_fiscal_periods fp
     WHERE fp.company_id = $1 AND fp.is_deleted = FALSE ${filter}
     ORDER BY fp.period_no`,
    params,
  );
  return res.json(result.rows);
});

router.post("/fiscal-periods/:id/close", requirePermission("finance.approve"), async (req, res) => {
  const result = await pool.query(
    `UPDATE erp_fiscal_periods
     SET status = 'closed', closed_at = NOW(), closed_by = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'open'
     RETURNING *`,
    [req.params.id, req.user.company_id, req.user.id],
  );
  if (!result.rowCount) return res.status(400).json({ error: "Period not found or not open" });
  await logAudit({
    companyId: req.user.company_id,
    userId: req.user.id,
    entityType: "erp_fiscal_periods",
    entityId: req.params.id,
    action: "close",
    newValues: result.rows[0],
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
  return res.json(result.rows[0]);
});

router.get("/journals", requirePermission("finance.view"), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const params = [req.user.company_id];
  let filter = "";
  if (status) {
    params.push(status);
    filter = `AND j.status = $${params.length}`;
  }
  params.push(limit, offset);
  const [countR, dataR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM erp_journals j
       WHERE j.company_id = $1 AND j.is_deleted = FALSE ${filter}`,
      status ? [req.user.company_id, status] : [req.user.company_id],
    ),
    pool.query(
      `SELECT j.*, fp.name AS period_name
       FROM erp_journals j
       LEFT JOIN erp_fiscal_periods fp ON fp.id = j.fiscal_period_id
       WHERE j.company_id = $1 AND j.is_deleted = FALSE ${filter}
       ORDER BY j.entry_date DESC, j.journal_no DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
  ]);
  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });
});

router.get("/journals/:id", requirePermission("finance.view"), async (req, res) => {
  const journal = await pool.query(
    `SELECT * FROM erp_journals WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  if (!journal.rowCount) return res.status(404).json({ error: "Not found" });
  const lines = await pool.query(
    `SELECT jl.*, a.account_code, a.account_name
     FROM erp_journal_lines jl
     JOIN erp_chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.journal_id = $1 ORDER BY jl.line_no`,
    [req.params.id],
  );
  return res.json({ ...journal.rows[0], lines: lines.rows });
});

router.post("/journals", requirePermission("finance.create"), async (req, res) => {
  try {
    const journal = await gl.createJournal({
      companyId: req.user.company_id,
      userId: req.user.id,
      entryDate: req.body?.entry_date,
      journalType: req.body?.journal_type,
      referenceNo: req.body?.reference_no,
      description: req.body?.description,
      lines: req.body?.lines,
      branchId: req.body?.branch_id || req.user.default_branch_id,
      currencyCode: req.body?.currency_code,
      exchangeRate: req.body?.exchange_rate,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_journals",
      entityId: journal.id,
      action: "create",
      newValues: journal,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(journal);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post("/journals/:id/post", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await gl.postJournal({
      journalId: req.params.id,
      companyId: req.user.company_id,
      userId: req.user.id,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_journals",
      entityId: req.params.id,
      action: "post",
      newValues: result,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get("/reports/trial-balance", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const rows = await gl.getTrialBalance(req.user.company_id, periodId);
  const totals = rows.reduce(
    (acc, r) => ({
      period_debit: acc.period_debit + Number(r.period_debit),
      period_credit: acc.period_credit + Number(r.period_credit),
    }),
    { period_debit: 0, period_credit: 0 },
  );
  return res.json({ lines: rows, totals });
});

router.get("/reports/balance-sheet", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const result = await pool.query(
    `SELECT a.account_type, a.account_code, a.account_name,
            b.closing_debit - b.closing_credit AS balance
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2
       AND a.account_type IN ('asset', 'liability', 'equity')
     ORDER BY a.account_code`,
    [req.user.company_id, periodId],
  );
  return res.json(result.rows);
});

router.get("/reports/profit-loss", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const result = await pool.query(
    `SELECT a.account_type, a.account_code, a.account_name,
            b.period_credit - b.period_debit AS amount
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2
       AND a.account_type IN ('income', 'expense')
     ORDER BY a.account_code`,
    [req.user.company_id, periodId],
  );
  const income = result.rows
    .filter((r) => r.account_type === "income")
    .reduce((s, r) => s + Number(r.amount), 0);
  const expense = result.rows
    .filter((r) => r.account_type === "expense")
    .reduce((s, r) => s + Number(r.amount), 0);
  return res.json({ lines: result.rows, net_profit: income - expense });
});

router.get("/dimensions", requirePermission("finance.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_dimensions
     WHERE company_id = $1 AND is_deleted = FALSE ORDER BY dimension_type, code`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

module.exports = router;
