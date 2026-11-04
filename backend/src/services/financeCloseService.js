const pool = require("../db");
const { logAudit } = require("./auditService");

function buildChecklist(period, counts) {
  const checks = [
    {
      code: "unposted_journals",
      label: "Draft journals in period",
      count: Number(counts.unposted_journals || 0),
    },
    {
      code: "draft_customer_invoices",
      label: "Draft customer invoices in period",
      count: Number(counts.draft_customer_invoices || 0),
    },
    {
      code: "unposted_supplier_bills",
      label: "Unposted supplier bills in period",
      count: Number(counts.unposted_supplier_bills || 0),
    },
    {
      code: "unposted_supplier_payments",
      label: "Unposted supplier payments in period",
      count: Number(counts.unposted_supplier_payments || 0),
    },
    {
      code: "open_bank_reconciliations",
      label: "Unreconciled bank statements ending in period",
      count: Number(counts.open_bank_reconciliations || 0),
    },
    {
      code: "unfinalized_payroll_runs",
      label: "Unfinalized payroll runs in period",
      count: Number(counts.unfinalized_payroll_runs || 0),
    },
    {
      code: "trial_balance_difference",
      label: "Trial balance difference",
      count: Number(counts.trial_balance_difference || 0),
      amount: Number(counts.trial_balance_difference || 0),
    },
  ].map((check) => ({
    ...check,
    blocked: check.code === "trial_balance_difference"
      ? check.count > 0.01
      : check.count > 0,
  }));

  return {
    period_id: period.id,
    period_name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    status: period.status,
    ready_to_close: period.status === "open" && checks.every((check) => !check.blocked),
    blockers: checks.filter((check) => check.blocked),
    checks,
  };
}

async function getPeriodCloseChecklist(companyId, periodId) {
  const result = await pool.query(
    `SELECT fp.id, fp.name, fp.start_date, fp.end_date, fp.status
     FROM erp_fiscal_periods fp
     WHERE fp.id = $1 AND fp.company_id = $2 AND fp.is_deleted = FALSE`,
    [periodId, companyId],
  );
  const period = result.rows[0];
  if (!period) return null;

  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM erp_journals j
        WHERE j.company_id = $1 AND j.entry_date BETWEEN $2 AND $3
          AND j.status = 'draft' AND j.is_deleted = FALSE) AS unposted_journals,
       (SELECT COUNT(*) FROM erp_customer_invoices i
        WHERE i.company_id = $1 AND i.invoice_date BETWEEN $2 AND $3
          AND i.status = 'draft' AND i.is_deleted = FALSE) AS draft_customer_invoices,
       (SELECT COUNT(*) FROM erp_supplier_bills b
        WHERE b.company_id = $1 AND b.bill_date BETWEEN $2 AND $3
          AND b.status IN ('draft','approved','posting') AND b.is_deleted = FALSE) AS unposted_supplier_bills,
       (SELECT COUNT(*) FROM erp_supplier_payments p
        WHERE p.company_id = $1 AND p.payment_date BETWEEN $2 AND $3
          AND p.status IN ('draft','posting') AND p.is_deleted = FALSE) AS unposted_supplier_payments,
       (SELECT COUNT(*) FROM erp_bank_reconciliations r
        WHERE r.company_id = $1 AND r.statement_end BETWEEN $2 AND $3
          AND r.status = 'draft') AS open_bank_reconciliations,
       (SELECT COUNT(*) FROM erp_payroll_runs pr
        WHERE pr.company_id = $1 AND pr.payroll_month BETWEEN $2 AND $3
          AND pr.status IN ('draft','calculated','approved','posting')) AS unfinalized_payroll_runs,
       ABS(COALESCE((
         SELECT SUM(g.opening_debit + g.period_debit - g.opening_credit - g.period_credit)
         FROM erp_gl_balances g
         WHERE g.company_id = $1 AND g.fiscal_period_id = $4 AND g.is_deleted = FALSE
       ), 0)) AS trial_balance_difference`,
    [companyId, period.start_date, period.end_date, period.id],
  );
  return buildChecklist(period, counts.rows[0]);
}

async function closeFiscalPeriod({ companyId, periodId, userId, reason }) {
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to close a fiscal period");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodResult = await client.query(
      `SELECT fp.id, fp.name, fp.start_date, fp.end_date, fp.status
       FROM erp_fiscal_periods fp
       WHERE fp.id = $1 AND fp.company_id = $2 AND fp.is_deleted = FALSE
       FOR UPDATE`,
      [periodId, companyId],
    );
    const period = periodResult.rows[0];
    if (!period || period.status !== "open") {
      throw new Error("Period not found or not open");
    }

    const counts = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM erp_journals j
          WHERE j.company_id = $1 AND j.entry_date BETWEEN $2 AND $3
            AND j.status = 'draft' AND j.is_deleted = FALSE) AS unposted_journals,
         (SELECT COUNT(*) FROM erp_customer_invoices i
          WHERE i.company_id = $1 AND i.invoice_date BETWEEN $2 AND $3
            AND i.status = 'draft' AND i.is_deleted = FALSE) AS draft_customer_invoices,
         (SELECT COUNT(*) FROM erp_supplier_bills b
          WHERE b.company_id = $1 AND b.bill_date BETWEEN $2 AND $3
            AND b.status IN ('draft','approved','posting') AND b.is_deleted = FALSE) AS unposted_supplier_bills,
         (SELECT COUNT(*) FROM erp_supplier_payments p
          WHERE p.company_id = $1 AND p.payment_date BETWEEN $2 AND $3
            AND p.status IN ('draft','posting') AND p.is_deleted = FALSE) AS unposted_supplier_payments,
         (SELECT COUNT(*) FROM erp_bank_reconciliations r
          WHERE r.company_id = $1 AND r.statement_end BETWEEN $2 AND $3
            AND r.status = 'draft') AS open_bank_reconciliations,
         (SELECT COUNT(*) FROM erp_payroll_runs pr
          WHERE pr.company_id = $1 AND pr.payroll_month BETWEEN $2 AND $3
            AND pr.status IN ('draft','calculated','approved','posting')) AS unfinalized_payroll_runs,
         ABS(COALESCE((
           SELECT SUM(g.opening_debit + g.period_debit - g.opening_credit - g.period_credit)
           FROM erp_gl_balances g
           WHERE g.company_id = $1 AND g.fiscal_period_id = $4 AND g.is_deleted = FALSE
         ), 0)) AS trial_balance_difference`,
      [companyId, period.start_date, period.end_date, period.id],
    );
    const checklist = buildChecklist(period, counts.rows[0]);
    if (!checklist.ready_to_close) {
      const summary = checklist.blockers
        .map((blocker) => `${blocker.label}: ${blocker.count}`)
        .join("; ");
      const error = new Error(`Period cannot be closed until finance exceptions are resolved: ${summary}`);
      error.code = "FINANCE_CLOSE_BLOCKED";
      error.checklist = checklist;
      throw error;
    }

    const closed = await client.query(
      `UPDATE erp_fiscal_periods
       SET status = 'closed', closed_at = NOW(), closed_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'open'
       RETURNING *`,
      [periodId, companyId, userId],
    );
    await logAudit({ companyId, userId, entityType: "erp_fiscal_periods", entityId: periodId,
      action: "close", newValues: { reason: String(reason).trim(), period: closed.rows[0] }, client });
    await client.query("COMMIT");
    return { period: closed.rows[0], checklist };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reopenFiscalPeriod({ companyId, periodId, userId, reason }) {
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to reopen a fiscal period");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE erp_fiscal_periods SET status='open',closed_at=NULL,closed_by=NULL,updated_at=NOW()
       WHERE id=$1 AND company_id=$2 AND status='closed' RETURNING *`, [periodId,companyId]);
    if (!result.rowCount) throw new Error("Period not found or not closed");
    await logAudit({ companyId,userId,entityType:"erp_fiscal_periods",entityId:periodId,
      action:"reopen",newValues:{reason:String(reason).trim(),period:result.rows[0]},client });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = { getPeriodCloseChecklist, closeFiscalPeriod, reopenFiscalPeriod };
