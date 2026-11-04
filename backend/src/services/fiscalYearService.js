const pool = require("../db");
const { logAudit } = require("./auditService");
const gl = require("./glPostingService");

function buildPeriods(startDate, endDate) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startDate) || !datePattern.test(endDate)) throw new Error("Fiscal year dates must use YYYY-MM-DD");
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start.getUTCDate() !== 1) {
    throw new Error("Fiscal year must start on the first day of a month");
  }
  const periods = [];
  for (let periodNo = 1; periodNo <= 12; periodNo += 1) {
    const periodStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + periodNo - 1, 1));
    const nextStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + periodNo, 1));
    const periodEnd = new Date(nextStart.valueOf() - 86400000);
    periods.push({
      period_no: periodNo,
      start_date: periodStart.toISOString().slice(0, 10),
      end_date: periodEnd.toISOString().slice(0, 10),
      name: new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(periodStart),
    });
  }
  if (periods[11].end_date !== end.toISOString().slice(0, 10)) {
    throw new Error("Fiscal year must cover twelve complete calendar months");
  }
  return periods;
}

async function createFiscalYear({ companyId, userId, yearLabel, startDate, endDate }) {
  if (!yearLabel?.trim()) throw new Error("year_label is required");
  const periods = buildPeriods(startDate, endDate);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [companyId,"fiscal-year-create"]);
    const overlap = await client.query(
      `SELECT id FROM erp_fiscal_years WHERE company_id=$1 AND is_deleted=FALSE
       AND start_date <= $3 AND end_date >= $2 FOR UPDATE`, [companyId,startDate,endDate]);
    if (overlap.rowCount) throw new Error("Fiscal year dates overlap an existing fiscal year");
    const inserted = await client.query(
      `INSERT INTO erp_fiscal_years(company_id,year_label,start_date,end_date,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$5) RETURNING *`, [companyId,yearLabel.trim(),startDate,endDate,userId]);
    const year = inserted.rows[0];
    for (const period of periods) {
      await client.query(
        `INSERT INTO erp_fiscal_periods(company_id,fiscal_year_id,period_no,name,start_date,end_date,status,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,'open',$7,$7)`,
        [companyId,year.id,period.period_no,period.name,period.start_date,period.end_date,userId]);
    }
    await gl.rebuildGlBalances(client, companyId, userId);
    await logAudit({ companyId,userId,entityType:"erp_fiscal_years",entityId:year.id,
      action:"create",newValues:{...year,period_count:periods.length},client });
    await client.query("COMMIT");
    return { ...year, periods };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = { buildPeriods, createFiscalYear };
