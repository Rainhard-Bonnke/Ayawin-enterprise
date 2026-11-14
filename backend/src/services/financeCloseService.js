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
      label: "Payroll runs not posted in period",
      count: Number(counts.unfinalized_payroll_runs || 0),
    },
    {
      code: "unmatched_bank_items",
      label: "Unmatched bank statement lines in period",
      count: Number(counts.unmatched_bank_items || 0),
    },
    {
      code: "vat_return_not_locked",
      label: "VAT working paper not locked for period",
      count: Number(counts.vat_return_not_locked || 0),
    },
    {
      code: "wht_not_remitted",
      label: "Withholding tax not remitted for the period",
      count: Number(counts.wht_not_remitted || 0),
    },
    {
      code: "depreciation_run_pending",
      label: "Depreciation run not posted for the period",
      count: Number(counts.depreciation_run_pending || 0),
    },
    {
      code: "fx_revaluation_pending",
      label: "FX revaluation or reversal entries pending",
      count: Number(counts.fx_revaluation_pending || 0),
    },
    {
      code: "inventory_variances",
      label: "Open inventory variances or reconciliation gaps",
      count: Number(counts.inventory_variances || 0),
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

function buildPhaseCReadinessSummary({
  checklist,
  foreignCurrencyWorkflow = {},
  fxPolicyGovernance = false,
} = {}) {
  const checks = [];
  const blockers = [];

  const closeReady = checklist ? checklist.ready_to_close === true : true;
  checks.push({
    code: "finance_close_controls",
    label: "Finance close controls",
    status: closeReady ? "pass" : "fail",
    message: closeReady
      ? "The fiscal period is clear of open close blockers."
      : "The fiscal period still has blocker events that must be cleared before close.",
  });
  if (!closeReady) {
    blockers.push({
      code: "finance_close_controls",
      label: "Finance close controls",
      message: "The period close checklist is still blocked by unresolved reconciliation or VAT controls.",
    });
  }

  const fxReady = foreignCurrencyWorkflow.posting === true
    && foreignCurrencyWorkflow.settlement === true
    && foreignCurrencyWorkflow.revaluation === true
    && foreignCurrencyWorkflow.reversal === true;
  checks.push({
    code: "foreign_currency_accounting",
    label: "Foreign-currency accounting workflow",
    status: fxReady ? "pass" : "fail",
    message: fxReady
      ? "Foreign-currency posting, settlement, revaluation, and reversal controls are implemented."
      : "Foreign-currency posting, realized settlement, revaluation, and reversal are not all implemented.",
  });
  if (!fxReady) {
    blockers.push({
      code: "foreign_currency_accounting",
      label: "Foreign-currency accounting workflow",
      message: "The complete FX accounting contract must be implemented and verified before Phase C can be marked ready.",
    });
  }

  checks.push({
    code: "fx_policy_governance",
    label: "FX policy governance",
    status: fxPolicyGovernance ? "pass" : "fail",
    message: fxPolicyGovernance
      ? "FX policies require independent approval and approved rates are bound to policy direction and source."
      : "FX policy approval and policy-bound exchange-rate controls are incomplete.",
  });
  if (!fxPolicyGovernance) {
    blockers.push({
      code: "fx_policy_governance",
      label: "FX policy governance",
      message: "An independently approved FX policy and matching approved rate source are required before foreign-currency accounting can be enabled.",
    });
  }

  const vatReady = checklist
    ? !checklist.blockers || !checklist.blockers.some((item) => item.code === "vat_return_not_locked")
    : true;
  checks.push({
    code: "vat_locking",
    label: "VAT period locking",
    status: vatReady ? "pass" : "fail",
    message: vatReady
      ? "VAT periods are locked when required."
      : "A VAT return must be locked before the period can be treated as complete.",
  });
  if (!vatReady) {
    blockers.push({
      code: "vat_locking",
      label: "VAT period locking",
      message: "The VAT return for the period is still unlocked and must be approved or closed before period close is considered complete.",
    });
  }

  const ready = blockers.length === 0;
  return {
    phase: "C",
    status: ready ? "ready" : "blocked",
    ready,
    checks,
    blockers,
    summary: ready
      ? "Phase C finance and compliance guardrails are in a ready state."
      : "Phase C has unresolved finance or compliance blockers.",
  };
}

async function getPhaseCReadinessSummary(companyId, periodId) {
  if (!periodId) throw new Error("A fiscal period id is required for Phase C readiness");
  const checklist = await getPeriodCloseChecklist(companyId, periodId);
  if (!checklist) return null;
  const policies = await pool.query(
    `SELECT COUNT(*)::int AS approved_policy_count
     FROM erp_fx_accounting_policies
     WHERE company_id = $1 AND status = 'approved' AND is_deleted = FALSE`,
    [companyId],
  );
  const summary = buildPhaseCReadinessSummary({
    checklist,
    fxPolicyGovernance: Number(policies.rows[0]?.approved_policy_count || 0) > 0,
  });
  return {
    ...summary,
    period_checklist: checklist,
    approved_fx_policy_count: Number(policies.rows[0]?.approved_policy_count || 0),
  };
}

async function getPeriodCloseChecklist(companyId, periodId, database = pool) {
  const result = await database.query(
    `SELECT fp.id, fp.name, fp.start_date, fp.end_date, fp.status
     FROM erp_fiscal_periods fp
     WHERE fp.id = $1 AND fp.company_id = $2 AND fp.is_deleted = FALSE`,
    [periodId, companyId],
  );
  const period = result.rows[0];
  if (!period) return null;

  const counts = await database.query(
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
       (SELECT COUNT(*) FROM erp_bank_reconciliation_lines l
        JOIN erp_bank_reconciliations r ON r.id = l.reconciliation_id AND r.company_id = l.company_id
        WHERE l.company_id = $1 AND r.statement_end BETWEEN $2 AND $3 AND l.journal_line_id IS NULL) AS unmatched_bank_items,
       (SELECT COUNT(*) FROM erp_payroll_runs pr
        WHERE pr.company_id = $1 AND pr.payroll_month BETWEEN $2 AND $3
          AND pr.status <> 'posted') AS unfinalized_payroll_runs,
       (SELECT COUNT(*) FROM erp_withholding_obligations obligation
        WHERE obligation.company_id = $1 AND obligation.due_date <= $3
          AND obligation.status = 'outstanding') AS wht_not_remitted,
       (SELECT COUNT(*) FROM erp_fx_accounting_policies policy
        WHERE policy.company_id=$1 AND policy.status='approved' AND policy.is_deleted=FALSE
          AND EXISTS (
            SELECT 1 FROM unnest(policy.monetary_account_ids) AS scoped(account_id)
            JOIN erp_journal_lines line ON line.account_id=scoped.account_id
              AND line.company_id=policy.company_id AND line.currency_code=policy.currency_code
            JOIN erp_journals journal ON journal.id=line.journal_id AND journal.company_id=line.company_id
              AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
            WHERE journal.entry_date <= $3
            GROUP BY scoped.account_id
            HAVING SUM(line.transaction_debit - line.transaction_credit) <> 0
          )
          AND NOT EXISTS (
            SELECT 1 FROM erp_fx_revaluation_runs run
            WHERE run.company_id=$1 AND run.fiscal_period_id=$4
              AND run.currency_code=policy.currency_code
          )) AS fx_revaluation_pending,
       (SELECT COUNT(*) FROM erp_fixed_assets a
        WHERE a.company_id = $1 AND a.acquisition_date <= $3
          AND a.status = 'active' AND a.is_deleted = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM erp_fixed_asset_depreciation_runs dr
            WHERE dr.company_id = $1 AND dr.period_start = $2 AND dr.period_end = $3
              AND dr.status = 'posted' AND dr.is_deleted = FALSE
          )) AS depreciation_run_pending,
       (SELECT COUNT(*) FROM erp_stocktake_sessions s
        WHERE s.company_id = $1 AND s.snapshot_at::date BETWEEN $2 AND $3
          AND s.status IN ('counting', 'submitted', 'recount_required')) AS inventory_variances,
       (SELECT CASE WHEN EXISTS (
           SELECT 1 FROM erp_customer_invoices i WHERE i.company_id = $1 AND i.invoice_date BETWEEN $2 AND $3
             AND i.status IN ('posted','paid','partial','overdue') AND i.tax_amount > 0 AND i.is_deleted = FALSE
           UNION ALL
           SELECT 1 FROM erp_customer_credit_notes n WHERE n.company_id = $1 AND n.credit_date BETWEEN $2 AND $3
             AND n.status = 'posted' AND n.tax_amount > 0
           UNION ALL
           SELECT 1 FROM erp_supplier_bills b WHERE b.company_id = $1 AND b.bill_date BETWEEN $2 AND $3
             AND b.status IN ('posted','partial','paid','overdue') AND b.tax_amount > 0 AND b.is_deleted = FALSE
           UNION ALL
           SELECT 1 FROM erp_supplier_return_credit_notes c WHERE c.company_id = $1 AND c.received_date BETWEEN $2 AND $3
             AND c.status = 'posted' AND c.vat_amount > 0 AND c.is_deleted = FALSE
         ) AND NOT EXISTS (
           SELECT 1 FROM erp_vat_returns vr WHERE vr.company_id = $1 AND vr.period_id = $4 AND vr.status = 'locked'
         ) THEN 1 ELSE 0 END) AS vat_return_not_locked,
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
         (SELECT COUNT(*) FROM erp_bank_reconciliation_lines l
          JOIN erp_bank_reconciliations r ON r.id = l.reconciliation_id AND r.company_id = l.company_id
          WHERE l.company_id = $1 AND r.statement_end BETWEEN $2 AND $3 AND l.journal_line_id IS NULL) AS unmatched_bank_items,
         (SELECT COUNT(*) FROM erp_payroll_runs pr
          WHERE pr.company_id = $1 AND pr.payroll_month BETWEEN $2 AND $3
            AND pr.status <> 'posted') AS unfinalized_payroll_runs,
         (SELECT COUNT(*) FROM erp_withholding_obligations obligation
          WHERE obligation.company_id = $1 AND obligation.due_date <= $3
            AND obligation.status = 'outstanding') AS wht_not_remitted,
         (SELECT COUNT(*) FROM erp_fx_accounting_policies policy
          WHERE policy.company_id=$1 AND policy.status='approved' AND policy.is_deleted=FALSE
            AND EXISTS (
              SELECT 1 FROM unnest(policy.monetary_account_ids) AS scoped(account_id)
              JOIN erp_journal_lines line ON line.account_id=scoped.account_id
                AND line.company_id=policy.company_id AND line.currency_code=policy.currency_code
              JOIN erp_journals journal ON journal.id=line.journal_id AND journal.company_id=line.company_id
                AND journal.status IN ('posted','reversed') AND journal.is_deleted=FALSE
              WHERE journal.entry_date <= $3
              GROUP BY scoped.account_id
              HAVING SUM(line.transaction_debit - line.transaction_credit) <> 0
            )
            AND NOT EXISTS (
              SELECT 1 FROM erp_fx_revaluation_runs run
              WHERE run.company_id=$1 AND run.fiscal_period_id=$4
                AND run.currency_code=policy.currency_code
            )) AS fx_revaluation_pending,
         (SELECT COUNT(*) FROM erp_fixed_assets a
          WHERE a.company_id = $1 AND a.acquisition_date <= $3
            AND a.status = 'active' AND a.is_deleted = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM erp_fixed_asset_depreciation_runs dr
              WHERE dr.company_id = $1 AND dr.period_start = $2 AND dr.period_end = $3
                AND dr.status = 'posted' AND dr.is_deleted = FALSE
            )) AS depreciation_run_pending,
         (SELECT COUNT(*) FROM erp_stocktake_sessions s
          WHERE s.company_id = $1 AND s.snapshot_at::date BETWEEN $2 AND $3
            AND s.status IN ('counting', 'submitted', 'recount_required')) AS inventory_variances,
         (SELECT CASE WHEN EXISTS (
             SELECT 1 FROM erp_customer_invoices i WHERE i.company_id = $1 AND i.invoice_date BETWEEN $2 AND $3
               AND i.status IN ('posted','paid','partial','overdue') AND i.tax_amount > 0 AND i.is_deleted = FALSE
             UNION ALL
             SELECT 1 FROM erp_customer_credit_notes n WHERE n.company_id = $1 AND n.credit_date BETWEEN $2 AND $3
               AND n.status = 'posted' AND n.tax_amount > 0
             UNION ALL
             SELECT 1 FROM erp_supplier_bills b WHERE b.company_id = $1 AND b.bill_date BETWEEN $2 AND $3
               AND b.status IN ('posted','partial','paid','overdue') AND b.tax_amount > 0 AND b.is_deleted = FALSE
             UNION ALL
             SELECT 1 FROM erp_supplier_return_credit_notes c WHERE c.company_id = $1 AND c.received_date BETWEEN $2 AND $3
               AND c.status = 'posted' AND c.vat_amount > 0 AND c.is_deleted = FALSE
           ) AND NOT EXISTS (
             SELECT 1 FROM erp_vat_returns vr WHERE vr.company_id = $1 AND vr.period_id = $4 AND vr.status = 'locked'
           ) THEN 1 ELSE 0 END) AS vat_return_not_locked,
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

module.exports = {
  buildChecklist,
  buildPhaseCReadinessSummary,
  getPhaseCReadinessSummary,
  getPeriodCloseChecklist,
  closeFiscalPeriod,
  reopenFiscalPeriod,
};
