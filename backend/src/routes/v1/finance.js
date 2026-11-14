const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission, getClientIp } = require("../../middleware/erpAuth");
const { logAudit } = require("../../services/auditService");
const gl = require("../../services/glPostingService");
const { ACCOUNT_CODES } = require("../../services/accountCodes");
const cashBankAccountService = require("../../services/cashBankAccountService");
const bankReconciliation = require("../../services/bankReconciliationService");
const budgetForecast = require("../../services/budgetForecastService");
const financeClose = require("../../services/financeCloseService");
const fiscalYears = require("../../services/fiscalYearService");
const { parsePagination } = require("../../lib/queryHelper");

const router = express.Router();
router.use(authenticateErp);

router.get("/bank-accounts", requirePermission("finance.view"), async (req, res) => {
  try {
    return res.json(await cashBankAccountService.listBankAccounts(req.user.company_id));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/bank-accounts", requirePermission("finance.create"), async (req, res) => {
  try {
    const account = await cashBankAccountService.createBankAccount({
      companyId: req.user.company_id,
      userId: req.user.id,
      accountCode: req.body?.account_code,
      accountName: req.body?.account_name,
      currencyCode: req.body?.currency_code,
      isActive: req.body?.is_active,
      isPostable: req.body?.is_postable,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_chart_of_accounts",
      entityId: account.id,
      action: "create",
      newValues: { ...account, company_id: req.user.company_id },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(account);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/cash-book", requirePermission("finance.view"), async (req, res) => {
  try {
    const result = await bankReconciliation.listCashBook(req.user.company_id, {
      accountId: req.query.account_id || null,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      limit: req.query.limit || 1000,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/budget-forecast", requirePermission("finance.view"), async (req, res) => {
  try {
    const result = await budgetForecast.getBudgetForecastSnapshot(req.user.company_id, {
      periodStart: req.query.period_start || "2026-01-01",
      periodEnd: req.query.period_end || "2026-12-31",
      limit: req.query.limit || 4,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
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
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_bank_reconciliations",
      entityId: reconciliation.id,
      action: "import",
      newValues: { ...reconciliation, line_count: req.body.lines.length },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json(reconciliation);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post(
  "/fiscal-periods/:id/reopen",
  requirePermission("finance.approve"),
  async (req, res) => {
    try {
      const period = await financeClose.reopenFiscalPeriod({
        companyId: req.user.company_id,
        periodId: req.params.id,
        userId: req.user.id,
        reason: req.body?.reason,
      });
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: "erp_fiscal_periods",
        entityId: req.params.id,
        action: "reopen",
        newValues: { reason: req.body.reason, period },
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(period);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

router.get(
  "/bank-reconciliations/:id/candidates",
  requirePermission("finance.view"),
  async (req, res) => {
    return res.json(await bankReconciliation.listCandidates(req.user.company_id, req.params.id));
  },
);

router.get("/bank-reconciliations/:id", requirePermission("finance.view"), async (req, res) => {
  const reconciliation = await bankReconciliation.getReconciliation(
    req.user.company_id,
    req.params.id,
  );
  if (!reconciliation) return res.status(404).json({ error: "Bank reconciliation not found" });
  return res.json(reconciliation);
});

router.post(
  "/bank-reconciliations/:id/lines/:lineId/match",
  requirePermission("finance.create"),
  async (req, res) => {
    try {
      const result = await bankReconciliation.matchStatementLine({
        companyId: req.user.company_id,
        userId: req.user.id,
        reconciliationId: req.params.id,
        lineId: req.params.lineId,
        journalLineId: req.body?.journal_line_id,
      });
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: "erp_bank_reconciliation_lines",
        entityId: req.params.lineId,
        action: "match",
        newValues: result,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

router.post(
  "/bank-reconciliations/:id/complete",
  requirePermission("finance.approve"),
  async (req, res) => {
    try {
      const result = await bankReconciliation.completeReconciliation({
        companyId: req.user.company_id,
        userId: req.user.id,
        reconciliationId: req.params.id,
      });
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: "erp_bank_reconciliations",
        entityId: req.params.id,
        action: "reconcile",
        newValues: result,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

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

router.post("/fiscal-years", requirePermission("finance.create"), async (req, res) => {
  try {
    const year = await fiscalYears.createFiscalYear({
      companyId: req.user.company_id,
      userId: req.user.id,
      yearLabel: req.body?.year_label,
      startDate: req.body?.start_date,
      endDate: req.body?.end_date,
    });
    return res.status(201).json(year);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
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

router.get(
  "/fiscal-periods/:id/close-checklist",
  requirePermission("finance.view"),
  async (req, res) => {
    try {
      const checklist = await financeClose.getPeriodCloseChecklist(
        req.user.company_id,
        req.params.id,
      );
      if (!checklist) return res.status(404).json({ error: "Fiscal period not found" });
      return res.json(checklist);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  },
);

router.get("/phase-c-readiness", requirePermission("finance.view"), async (req, res) => {
  try {
    const readiness = await financeClose.getPhaseCReadinessSummary(
      req.user.company_id,
      String(req.query.period_id || "").trim(),
    );
    if (!readiness) return res.status(404).json({ error: "Fiscal period not found" });
    return res.json(readiness);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/fiscal-periods/:id/close", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await financeClose.closeFiscalPeriod({
      companyId: req.user.company_id,
      periodId: req.params.id,
      userId: req.user.id,
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    const status = error.code === "FINANCE_CLOSE_BLOCKED" ? 409 : 400;
    return res.status(status).json({
      error: error.message,
      checklist: error.checklist,
    });
  }
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

router.post("/journals/:id/reverse", requirePermission("finance.approve"), async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "A reversal reason is required" });
  const original = await pool.query(
    "SELECT * FROM erp_journals WHERE id=$1 AND company_id=$2 AND status='posted' AND is_deleted=FALSE",
    [req.params.id, req.user.company_id],
  );
  if (!original.rowCount)
    return res.status(409).json({ error: "Only a posted journal can be reversed" });
  const lines = await pool.query(
    "SELECT * FROM erp_journal_lines WHERE journal_id=$1 ORDER BY line_no",
    [req.params.id],
  );
  try {
    const reversal = await gl.createJournal({
      companyId: req.user.company_id,
      userId: req.user.id,
      entryDate: req.body?.entry_date || new Date().toISOString().slice(0, 10),
      journalType: "general",
      referenceNo: original.rows[0].journal_no,
      description: `Reversal ${original.rows[0].journal_no}: ${reason}`,
      currencyCode: original.rows[0].currency_code,
      exchangeRate: original.rows[0].exchange_rate,
      source: "reversal",
      reversalOfId: original.rows[0].id,
      lines: lines.rows.map((line) => ({
        account_id: line.account_id,
        description: `Reversal: ${line.description || ""}`,
        debit: Number(line.credit),
        credit: Number(line.debit),
      })),
    });
    await gl.postJournal({
      journalId: reversal.id,
      companyId: req.user.company_id,
      userId: req.user.id,
    });
    await pool.query(
      "UPDATE erp_journals SET status='reversed',reversed_by_id=$2,updated_at=NOW(),updated_by=$3 WHERE id=$1",
      [original.rows[0].id, reversal.id, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_journals",
      entityId: original.rows[0].id,
      action: "reverse",
      newValues: { reversal_journal_id: reversal.id, reason },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.status(201).json({ original_id: original.rows[0].id, reversal });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/fiscal-years/:id/close", requirePermission("finance.approve"), async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "A year-end close reason is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const yearResult = await client.query(
      "SELECT * FROM erp_fiscal_years WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE AND is_closed=FALSE FOR UPDATE",
      [req.params.id, req.user.company_id],
    );
    const year = yearResult.rows[0];
    if (!year) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Open fiscal year not found" });
    }
    const period = (
      await client.query(
        "SELECT * FROM erp_fiscal_periods WHERE fiscal_year_id=$1 AND company_id=$2 ORDER BY period_no DESC LIMIT 1 FOR UPDATE",
        [year.id, req.user.company_id],
      )
    ).rows[0];
    if (!period || period.status !== "open") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Final fiscal period must be open for year-end close" });
    }
    const drafts = await client.query(
      "SELECT COUNT(*)::int AS count FROM erp_journals WHERE company_id=$1 AND fiscal_period_id IN (SELECT id FROM erp_fiscal_periods WHERE fiscal_year_id=$2) AND status='draft' AND is_deleted=FALSE",
      [req.user.company_id, year.id],
    );
    if (drafts.rows[0].count) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Fiscal year contains draft journals" });
    }
    const balances = await client.query(
      `SELECT a.id,a.account_type,SUM(b.period_debit) AS period_debit,SUM(b.period_credit) AS period_credit
      FROM erp_gl_balances b JOIN erp_chart_of_accounts a ON a.id=b.account_id
      WHERE b.company_id=$1 AND b.fiscal_period_id IN (SELECT id FROM erp_fiscal_periods WHERE fiscal_year_id=$2)
        AND a.account_type IN ('income','expense') GROUP BY a.id,a.account_type`,
      [req.user.company_id, year.id],
    );
    const lines = balances.rows
      .map((row) => ({
        account_id: row.id,
        debit: Math.max(0, Number(row.period_credit) - Number(row.period_debit)),
        credit: Math.max(0, Number(row.period_debit) - Number(row.period_credit)),
      }))
      .filter((line) => line.debit || line.credit);
    if (!lines.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No current-year earnings to close" });
    }
    const net = lines.reduce((sum, line) => sum + line.debit - line.credit, 0);
    const retained = (
      await client.query(
        "SELECT id FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=$2 AND is_active=TRUE AND is_deleted=FALSE",
        [req.user.company_id, ACCOUNT_CODES.retainedEarnings],
      )
    ).rows[0];
    if (!retained) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Retained earnings account is missing" });
    }
    lines.push({
      account_id: retained.id,
      debit: Math.max(0, -net),
      credit: Math.max(0, net),
      description: "Year-end retained earnings",
    });
    const journal = await gl.createJournalInTransaction(client, {
      companyId: req.user.company_id,
      userId: req.user.id,
      entryDate: period.end_date,
      journalType: "general",
      description: `Year-end close ${year.year_label}: ${reason}`,
      source: "year_end",
      lines,
    });
    await gl.postJournalInTransaction(client, {
      journalId: journal.id,
      companyId: req.user.company_id,
      userId: req.user.id,
    });
    await client.query(
      "UPDATE erp_fiscal_periods SET status='locked',updated_at=NOW() WHERE fiscal_year_id=$1 AND company_id=$2",
      [year.id, req.user.company_id],
    );
    await client.query(
      "UPDATE erp_fiscal_years SET is_closed=TRUE,updated_at=NOW(),updated_by=$2 WHERE id=$1",
      [year.id, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: "erp_fiscal_years",
      entityId: year.id,
      action: "year_end_close",
      newValues: { reason, journal_id: journal.id },
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
      client,
    });
    await client.query("COMMIT");
    return res.status(201).json({ year_id: year.id, journal });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get("/reports/trial-balance", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const rows = await gl.getTrialBalance(req.user.company_id, periodId);
  const totals = rows.reduce(
    (acc, r) => ({
      debit: acc.debit + Number(r.closing_debit),
      credit: acc.credit + Number(r.closing_credit),
    }),
    { debit: 0, credit: 0 },
  );
  return res.json({ lines: rows, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.01 });
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
  const currentEarnings = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN a.account_type = 'income' THEN b.period_credit - b.period_debit
                              WHEN a.account_type = 'expense' THEN b.period_debit - b.period_credit ELSE 0 END),0) AS amount
     FROM erp_gl_balances b JOIN erp_chart_of_accounts a ON a.id = b.account_id
     JOIN erp_fiscal_periods fp ON fp.id = b.fiscal_period_id
     WHERE b.company_id = $1 AND fp.fiscal_year_id = (SELECT fiscal_year_id FROM erp_fiscal_periods WHERE id = $2)
       AND fp.start_date <= (SELECT start_date FROM erp_fiscal_periods WHERE id = $2)`,
    [req.user.company_id, periodId],
  );
  const profit = Number(currentEarnings.rows[0].amount || 0);
  const lines = [
    ...result.rows,
    {
      account_type: "equity",
      account_code: "CURRENT-EARNINGS",
      account_name: "Current year earnings",
      balance: -profit,
    },
  ];
  const assets = lines
    .filter((row) => row.account_type === "asset")
    .reduce((sum, row) => sum + Number(row.balance), 0);
  const liabilitiesEquity = -lines
    .filter((row) => row.account_type !== "asset")
    .reduce((sum, row) => sum + Number(row.balance), 0);
  return res.json({
    lines,
    assets,
    liabilities_equity: liabilitiesEquity,
    balanced: Math.abs(assets - liabilitiesEquity) < 0.01,
  });
});

router.get("/reports/profit-loss", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const result = await pool.query(
    `SELECT a.account_type, a.account_code, a.account_name,
            CASE WHEN a.account_type = 'income' THEN b.period_credit - b.period_debit
                 ELSE b.period_debit - b.period_credit END AS amount
     FROM erp_gl_balances b
     JOIN erp_chart_of_accounts a ON a.id = b.account_id
     WHERE b.company_id = $1 AND b.fiscal_period_id = $2
       AND a.account_type IN ('income', 'expense')
     ORDER BY a.account_code`,
    [req.user.company_id, periodId],
  );
  const totals = gl.calculateProfitLoss(
    result.rows.map((row) => ({
      account_type: row.account_type,
      debit: row.account_type === "expense" ? row.amount : 0,
      credit: row.account_type === "income" ? row.amount : 0,
    })),
  );
  return res.json({ lines: result.rows, ...totals });
});

router.get("/reports/cash-flow", requirePermission("finance.view"), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: "fiscal_period_id required" });
  const period = await pool.query(
    `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date
     FROM erp_fiscal_periods WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
    [periodId, req.user.company_id],
  );
  if (!period.rowCount) return res.status(404).json({ error: "Fiscal period not found" });
  const [movement, opening, closing] = await Promise.all([
    pool.query(
      `WITH cash_journals AS (
         SELECT DISTINCT journal.id
         FROM erp_journals journal
         JOIN erp_journal_lines line ON line.journal_id=journal.id AND line.company_id=journal.company_id
         JOIN erp_chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
         WHERE journal.company_id=$1 AND journal.fiscal_period_id=$2
           AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
           AND account.account_code LIKE '11%'
       )
       SELECT account.cash_flow_activity,
              COALESCE(SUM(line.credit-line.debit),0)::numeric AS amount
       FROM cash_journals cash
       JOIN erp_journal_lines line ON line.journal_id=cash.id AND line.company_id=$1
       JOIN erp_chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
       WHERE account.account_code NOT LIKE '11%' AND account.cash_flow_activity <> 'exclude'
       GROUP BY account.cash_flow_activity`,
      [req.user.company_id, periodId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(line.debit-line.credit),0)::numeric AS amount
       FROM erp_journal_lines line
       JOIN erp_journals journal ON journal.id=line.journal_id AND journal.company_id=line.company_id
       JOIN erp_chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
       WHERE journal.company_id=$1 AND journal.entry_date < $2::date
         AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
         AND account.account_code LIKE '11%'`,
      [req.user.company_id, period.rows[0].start_date],
    ),
    pool.query(
      `SELECT COALESCE(SUM(line.debit-line.credit),0)::numeric AS amount
       FROM erp_journal_lines line
       JOIN erp_journals journal ON journal.id=line.journal_id AND journal.company_id=line.company_id
       JOIN erp_chart_of_accounts account ON account.id=line.account_id AND account.company_id=line.company_id
       WHERE journal.company_id=$1 AND journal.entry_date <= $2::date
         AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
         AND account.account_code LIKE '11%'`,
      [req.user.company_id, period.rows[0].end_date],
    ),
  ]);
  const activityAmounts = new Map(movement.rows.map((row) => [row.cash_flow_activity, Number(row.amount)]));
  const operating = activityAmounts.get("operating") || 0;
  const investing = activityAmounts.get("investing") || 0;
  const financing = activityAmounts.get("financing") || 0;
  const netMovement = operating + investing + financing;
  const openingCash = Number(opening.rows[0].amount || 0);
  const closingCash = Number(closing.rows[0].amount || 0);
  return res.json({
    period_id: periodId,
    period_name: period.rows[0].name,
    start_date: period.rows[0].start_date,
    end_date: period.rows[0].end_date,
    operating,
    investing,
    financing,
    net_movement: netMovement,
    opening_cash: openingCash,
    closing_cash: closingCash,
    reconciliation_variance: Math.round((openingCash + netMovement - closingCash) * 100) / 100,
    lines: [
      { activity: "operating", amount: operating },
      { activity: "investing", amount: investing },
      { activity: "financing", amount: financing },
    ],
  });
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
