const pool = require("../db");
const { logAudit } = require("./auditService");

function validDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function validatePeriod(start, end, label = "period") {
  if (!validDate(start) || !validDate(end) || end < start) {
    throw new Error(`Provide a valid ${label} start and end date`);
  }
}

async function validateSalesRep(client, companyId, salesRepId) {
  const result = await client.query(
    `SELECT id FROM erp_users
     WHERE id = $1 AND company_id = $2 AND status = 'active' AND is_deleted = FALSE`,
    [salesRepId, companyId],
  );
  if (!result.rowCount) throw new Error("Sales representative must be an active user in this company");
}

async function saveSalesTarget({ companyId, userId, salesRepId, periodStart, periodEnd, targetAmount }) {
  validatePeriod(periodStart, periodEnd, "target period");
  const amount = Number(targetAmount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Target amount must be a non-negative number");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateSalesRep(client, companyId, salesRepId);
    const saved = await client.query(
      `INSERT INTO erp_sales_targets (
         company_id, sales_rep_id, period_start, period_end, target_amount, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (company_id, sales_rep_id, period_start, period_end)
       DO UPDATE SET target_amount = EXCLUDED.target_amount, is_deleted = FALSE,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [companyId, salesRepId, periodStart, periodEnd, amount, userId],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_sales_targets",
      entityId: saved.rows[0].id,
      action: "sales_target_saved",
      newValues: { sales_rep_id: salesRepId, period_start: periodStart, period_end: periodEnd, target_amount: amount },
    });
    await client.query("COMMIT");
    return saved.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createCommissionPlan({ companyId, userId, code, name, ratePercent, effectiveFrom, effectiveTo = null }) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const normalizedName = String(name || "").trim();
  const rate = Number(ratePercent);
  if (!normalizedCode || !normalizedName || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new Error("Provide a plan code, name, and commission rate from 0 to 100 percent");
  }
  validatePeriod(effectiveFrom, effectiveTo || "9999-12-31", "commission plan effective");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [companyId, "sales-commission-plans"]);
    const overlap = await client.query(
      `SELECT id FROM erp_sales_commission_plans
       WHERE company_id = $1 AND is_deleted = FALSE
         AND effective_from <= COALESCE($3::date, DATE '9999-12-31')
         AND COALESCE(effective_to, DATE '9999-12-31') >= $2::date
         AND NOT (code = $4 AND effective_from = $2::date)
       LIMIT 1 FOR UPDATE`,
      [companyId, effectiveFrom, effectiveTo, normalizedCode],
    );
    if (overlap.rowCount) throw new Error("Commission plan effective dates cannot overlap another active plan");
    const created = await client.query(
      `INSERT INTO erp_sales_commission_plans (
         company_id, code, name, rate_percent, effective_from, effective_to, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (company_id, code, effective_from)
       DO UPDATE SET name = EXCLUDED.name, rate_percent = EXCLUDED.rate_percent,
         effective_to = EXCLUDED.effective_to, is_deleted = FALSE,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [companyId, normalizedCode, normalizedName, rate, effectiveFrom, effectiveTo, userId],
    );
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_sales_commission_plans",
      entityId: created.rows[0].id,
      action: "sales_commission_plan_created",
      newValues: { code: normalizedCode, rate_percent: rate, effective_from: effectiveFrom, effective_to: effectiveTo },
    });
    await client.query("COMMIT");
    return created.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getSalesPerformance({ companyId, periodStart, periodEnd, salesRepId = null }) {
  validatePeriod(periodStart, periodEnd, "report period");
  const result = await pool.query(
    `WITH targets AS (
       SELECT target.id, target.sales_rep_id, target.period_start, target.period_end, target.target_amount,
              rep.full_name AS sales_rep_name
       FROM erp_sales_targets target
       JOIN erp_users rep ON rep.id = target.sales_rep_id AND rep.company_id = target.company_id
       WHERE target.company_id = $1 AND target.is_deleted = FALSE
         AND target.period_start >= $2::date AND target.period_end <= $3::date
         AND ($4::uuid IS NULL OR target.sales_rep_id = $4::uuid)
     ), events AS (
       SELECT COALESCE(invoice.sales_rep_id, sales_order.sales_rep_id, invoice.created_by) AS sales_rep_id,
              invoice.invoice_date AS event_date, invoice.invoice_date AS rate_date,
              invoice.subtotal AS net_amount, 'invoice'::text AS event_type
       FROM erp_customer_invoices invoice
       LEFT JOIN erp_sales_orders sales_order
         ON sales_order.id = invoice.sales_order_id AND sales_order.company_id = invoice.company_id
       WHERE invoice.company_id = $1 AND invoice.is_deleted = FALSE
         AND invoice.status IN ('posted','partial','paid','overdue','credited')
         AND invoice.invoice_date BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT COALESCE(invoice.sales_rep_id, sales_order.sales_rep_id, invoice.created_by) AS sales_rep_id,
              credit.credit_date AS event_date, invoice.invoice_date AS rate_date,
              -credit.subtotal AS net_amount, 'credit_note'::text AS event_type
       FROM erp_customer_credit_notes credit
       JOIN erp_customer_invoices invoice
         ON invoice.id = credit.invoice_id AND invoice.company_id = credit.company_id
       LEFT JOIN erp_sales_orders sales_order
         ON sales_order.id = invoice.sales_order_id AND sales_order.company_id = invoice.company_id
       WHERE credit.company_id = $1 AND credit.status = 'posted'
         AND invoice.is_deleted = FALSE AND credit.credit_date BETWEEN $2::date AND $3::date
     ), rated_events AS (
       SELECT event.sales_rep_id, event.event_date, event.net_amount, event.event_type,
              COALESCE(plan.rate_percent, 0) AS rate_percent
       FROM events event
       LEFT JOIN LATERAL (
         SELECT rate_percent FROM erp_sales_commission_plans plan
         WHERE plan.company_id = $1 AND plan.is_deleted = FALSE
           AND plan.effective_from <= event.rate_date
           AND (plan.effective_to IS NULL OR plan.effective_to >= event.rate_date)
         ORDER BY plan.effective_from DESC LIMIT 1
       ) plan ON TRUE
     )
     SELECT target.id AS target_id, target.sales_rep_id, target.sales_rep_name,
            target.period_start, target.period_end, target.target_amount,
            COALESCE(SUM(event.net_amount), 0)::numeric(18,2) AS net_sales,
            CASE WHEN target.target_amount > 0
              THEN ROUND(COALESCE(SUM(event.net_amount), 0) / target.target_amount * 100, 2)
              ELSE 0 END AS attainment_percent,
            COALESCE(SUM(event.net_amount * event.rate_percent / 100), 0)::numeric(18,2) AS commission_amount,
            COUNT(*) FILTER (WHERE event.event_type = 'invoice')::int AS invoice_count,
            COUNT(*) FILTER (WHERE event.event_type = 'credit_note')::int AS credit_note_count
     FROM targets target
     LEFT JOIN rated_events event
       ON event.sales_rep_id = target.sales_rep_id
      AND event.event_date BETWEEN target.period_start AND target.period_end
     GROUP BY target.id, target.sales_rep_id, target.sales_rep_name,
              target.period_start, target.period_end, target.target_amount
     ORDER BY target.period_start, target.sales_rep_name`,
    [companyId, periodStart, periodEnd, salesRepId],
  );
  return result.rows.map((row) => ({
    ...row,
    target_amount: Number(row.target_amount),
    net_sales: Number(row.net_sales),
    attainment_percent: Number(row.attainment_percent),
    commission_amount: Number(row.commission_amount),
    invoice_count: Number(row.invoice_count),
    credit_note_count: Number(row.credit_note_count),
  }));
}

module.exports = { saveSalesTarget, createCommissionPlan, getSalesPerformance };