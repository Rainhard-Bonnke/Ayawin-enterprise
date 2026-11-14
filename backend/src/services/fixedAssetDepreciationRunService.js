const pool = require("../db");
const { createJournalInTransaction, postJournalInTransaction } = require("./glPostingService");
const { logAudit } = require("./auditService");

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeDepreciationRunInput({ periodStart, periodEnd, assets = [] } = {}) {
  if (!isCalendarDate(periodStart) || !isCalendarDate(periodEnd) || periodEnd < periodStart) {
    throw new Error("Choose a valid depreciation period");
  }

  const list = Array.isArray(assets) ? assets : [];
  for (const asset of list) {
    const cost = Number(asset?.acquisition_cost ?? 0);
    const residual = Number(asset?.residual_value ?? 0);
    const life = Number(asset?.useful_life_months ?? 0);
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`Asset ${asset?.asset_code || "unknown"} has a non-negative acquisition cost requirement`);
    }
    if (!Number.isFinite(residual) || residual < 0) {
      throw new Error(`Asset ${asset?.asset_code || "unknown"} has a valid residual value requirement`);
    }
    if (residual > cost) {
      throw new Error(`Asset ${asset?.asset_code || "unknown"} residual value cannot exceed acquisition cost`);
    }
    if (!Number.isInteger(life) || life < 1) {
      throw new Error(`Asset ${asset?.asset_code || "unknown"} must have a useful life of at least 1 month`);
    }
  }

  return {
    period_start: periodStart,
    period_end: periodEnd,
    assets: list,
  };
}

function toCalendarDate(value, fallback) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || fallback).slice(0, 10);
}

function countDepreciationMonths(periodStart, periodEnd, acquisitionDate) {
  const firstMonth = new Date(`${periodStart.slice(0, 7)}-01T00:00:00Z`);
  const lastMonth = new Date(`${periodEnd.slice(0, 7)}-01T00:00:00Z`);
  const acquiredMonth = new Date(`${toCalendarDate(acquisitionDate, periodStart).slice(0, 7)}-01T00:00:00Z`);
  const start = acquiredMonth > firstMonth ? acquiredMonth : firstMonth;
  if (start > lastMonth) return 0;
  return (lastMonth.getUTCFullYear() - start.getUTCFullYear()) * 12
    + lastMonth.getUTCMonth() - start.getUTCMonth() + 1;
}

function countElapsedMonths(periodEnd, acquisitionDate) {
  const acquiredMonth = new Date(`${toCalendarDate(acquisitionDate, periodEnd).slice(0, 7)}-01T00:00:00Z`);
  const endMonth = new Date(`${periodEnd.slice(0, 7)}-01T00:00:00Z`);
  if (acquiredMonth > endMonth) return 0;
  return (endMonth.getUTCFullYear() - acquiredMonth.getUTCFullYear()) * 12
    + endMonth.getUTCMonth() - acquiredMonth.getUTCMonth() + 1;
}

function buildDepreciationRun({ periodStart, periodEnd, assets = [] } = {}) {
  const normalized = normalizeDepreciationRunInput({ periodStart, periodEnd, assets });
  const activeAssets = (normalized.assets || []).filter(
    (asset) => String(asset?.status || "").trim().toLowerCase() === "active"
      && toCalendarDate(asset?.acquisition_date, normalized.period_start) <= normalized.period_end,
  );

  const lines = activeAssets.map((asset) => {
    const cost = Number(asset.acquisition_cost || 0);
    const residual = Number(asset.residual_value || 0);
    const usefulLife = Math.max(1, Number(asset.useful_life_months || 1));
    const depreciableMinor = Math.max(0, Math.round((cost - residual) * 100));
    const monthlyMinor = Math.round(depreciableMinor / usefulLife);
    const monthlyDepreciation = depreciableMinor / 100 / usefulLife;
    const accumulatedMinor = Math.max(0, Math.round(Number(asset.accumulated_depreciation || 0) * 100));
    const monthsInPeriod = countDepreciationMonths(
      normalized.period_start,
      normalized.period_end,
      asset.acquisition_date,
    );
    const elapsedMonths = countElapsedMonths(normalized.period_end, asset.acquisition_date);
    const remainingBasisMinor = Math.max(0, depreciableMinor - accumulatedMinor);
    const periodChargeMinor = monthlyMinor * monthsInPeriod;
    const depreciationMinor = Math.min(
      remainingBasisMinor,
      elapsedMonths >= usefulLife ? remainingBasisMinor : periodChargeMinor,
    );
    const depreciationAmount = depreciationMinor / 100;
    if (depreciationAmount <= 0) return null;

    return {
      id: String(asset.id || asset.asset_code || `${asset.name || "asset"}-${asset.category || "general"}`),
      asset_code: String(asset.asset_code || ""),
      name: String(asset.name || ""),
      category: String(asset.category || "General"),
      status: "active",
      acquisition_cost: cost,
      residual_value: residual,
      useful_life_months: usefulLife,
      months_in_period: monthsInPeriod,
      accumulated_depreciation: accumulatedMinor / 100,
      monthly_depreciation: monthlyDepreciation,
      depreciation_amount: depreciationAmount,
    };
  }).filter(Boolean);

  const totalMinor = lines.reduce((sum, line) => sum + Math.round(Number(line.depreciation_amount || 0) * 100), 0);

  return {
    period_start: normalized.period_start,
    period_end: normalized.period_end,
    line_count: lines.length,
    total_depreciation: totalMinor / 100,
    lines,
  };
}

async function postFixedAssetDepreciationRun({ companyId, userId, periodStart, periodEnd, client: suppliedClient = null } = {}) {
  normalizeDepreciationRunInput({ periodStart, periodEnd, assets: [] });
  const client = suppliedClient || await pool.connect();
  const ownsTransaction = !suppliedClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const periodResult = await client.query(
      `SELECT id, name, start_date, end_date, status
       FROM erp_fiscal_periods
       WHERE company_id = $1 AND start_date = $2 AND end_date = $3 AND is_deleted = FALSE
       FOR UPDATE`,
      [companyId, periodStart, periodEnd],
    );
    const period = periodResult.rows[0];
    if (!period || period.status !== "open") {
      throw new Error("Depreciation run dates must match an open fiscal period");
    }

    const assetsResult = await client.query(
      `SELECT id, asset_code, name, category, acquisition_date, acquisition_cost,
              residual_value, useful_life_months, status
       FROM erp_fixed_assets
       WHERE company_id = $1 AND is_deleted = FALSE AND status = 'active'
         AND acquisition_date <= $2
       ORDER BY acquisition_date, asset_code
       FOR UPDATE`,
      [companyId, periodEnd],
    );
    const accumulatedResult = await client.query(
      `SELECT line.asset_id, SUM(line.depreciation_amount)::numeric AS accumulated_depreciation
       FROM erp_fixed_asset_depreciation_run_lines line
       JOIN erp_fixed_asset_depreciation_runs run ON run.id = line.run_id
       WHERE run.company_id = $1 AND run.status = 'posted' AND run.is_deleted = FALSE
         AND run.period_end < $2
       GROUP BY line.asset_id`,
      [companyId, periodStart],
    );
    const accumulatedByAsset = new Map(
      accumulatedResult.rows.map((row) => [String(row.asset_id), Number(row.accumulated_depreciation || 0)]),
    );
    const summary = buildDepreciationRun({
      periodStart,
      periodEnd,
      assets: assetsResult.rows.map((asset) => ({
        ...asset,
        accumulated_depreciation: accumulatedByAsset.get(String(asset.id)) || 0,
      })),
    });

    const runResult = await client.query(
      `INSERT INTO erp_fixed_asset_depreciation_runs (
         company_id, period_start, period_end, status, total_depreciation, notes, created_by, updated_by
       ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $6)
       RETURNING *`,
      [companyId, periodStart, periodEnd, summary.total_depreciation,
        `Depreciation run for ${period.name}`, userId],
    );
    const run = runResult.rows[0];

    for (const line of summary.lines) {
      await client.query(
        `INSERT INTO erp_fixed_asset_depreciation_run_lines (
           company_id, run_id, asset_id, asset_code, depreciation_amount,
           accumulated_before, months_in_period
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, run.id, line.id, line.asset_code, line.depreciation_amount,
          line.accumulated_depreciation, line.months_in_period],
      );
    }

    let journalId = null;
    if (summary.total_depreciation > 0) {
      const accountsResult = await client.query(
        `SELECT id, account_code, account_type
         FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code IN ('6200', '1590')
           AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId],
      );
      const expenseAccount = accountsResult.rows.find((account) => account.account_code === "6200");
      const accumulatedAccount = accountsResult.rows.find((account) => account.account_code === "1590");
      if (expenseAccount?.account_type !== "expense" || accumulatedAccount?.account_type !== "asset") {
        throw new Error("Configure postable accounts 6200 (depreciation expense) and 1590 (accumulated depreciation)");
      }

      const journal = await createJournalInTransaction(client, {
        companyId,
        userId,
        entryDate: periodEnd,
        journalType: "depreciation",
        referenceNo: run.id,
        description: `Fixed-asset depreciation for ${period.name}`,
        source: "fixed_asset_depreciation_run",
        lines: [
          {
            account_id: expenseAccount.id,
            debit: summary.total_depreciation,
            credit: 0,
            description: "Depreciation expense",
          },
          {
            account_id: accumulatedAccount.id,
            debit: 0,
            credit: summary.total_depreciation,
            description: "Accumulated depreciation",
          },
        ],
      });
      await postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;
    }

    const postedResult = await client.query(
      `UPDATE erp_fixed_asset_depreciation_runs
       SET status = 'posted', journal_id = $2, posted_at = NOW(), updated_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $4
       RETURNING *`,
      [run.id, journalId, userId, companyId],
    );
    await logAudit({
      companyId,
      userId,
      entityType: "erp_fixed_asset_depreciation_runs",
      entityId: run.id,
      action: "post",
      newValues: { run: postedResult.rows[0], journal_id: journalId, summary },
      client,
    });
    if (ownsTransaction) await client.query("COMMIT");
    return { run: postedResult.rows[0], summary };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

module.exports = {
  normalizeDepreciationRunInput,
  buildDepreciationRun,
  postFixedAssetDepreciationRun,
};
