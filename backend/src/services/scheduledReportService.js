const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { CronExpressionParser } = require("cron-parser");
const pool = require("../db");
const reporting = require("./reportingService");
const userService = require("./userService");
const { createSettingsNotificationAdapter } = require("./notificationProvider");

const REPORT_TIME_ZONE = process.env.REPORT_SCHEDULE_TIMEZONE || "Africa/Nairobi";

function getNextScheduledRunAt(expression, currentDate = new Date(), timeZone = REPORT_TIME_ZONE) {
  try {
    return CronExpressionParser.parse(expression, { currentDate, tz: timeZone }).next().toDate();
  } catch {
    throw new Error("Enter a valid five-field cron expression");
  }
}

function createPdfBuffer({ reportName, rows }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 40, compress: true });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.fontSize(16).text(reportName, { continued: false });
    document.moveDown(0.5).fontSize(9).text(`Generated ${new Date().toISOString()}`);
    document.moveDown();
    if (!rows.length) document.text("No rows");
    for (const row of rows) {
      const line = Object.entries(row).map(([key, value]) => `${key}: ${value == null ? "" : String(value)}`).join(" | ");
      document.fontSize(8).text(line, { width: 515 });
      document.moveDown(0.25);
    }
    document.end();
  });
}

async function buildScheduledReportBuffer({ format, reportName, rows }) {
  if (!Array.isArray(rows)) throw new Error("Scheduled report rows must be an array");
  if (format === "csv") return Buffer.from(reporting.rowsToCsv(rows), "utf8");
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Report");
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (headers.length) {
      worksheet.addRow(headers);
      rows.forEach((row) => worksheet.addRow(headers.map((header) => row[header] ?? null)));
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  if (format === "pdf") return createPdfBuffer({ reportName, rows });
  throw new Error("Scheduled report format must be csv, xlsx, or pdf");
}

function getExportDirectory() {
  return path.resolve(process.env.REPORT_EXPORT_DIR || path.join(__dirname, "../../data/report-exports"));
}

async function claimDueSchedules(limit) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT schedule.*, report.code AS report_code, report.name AS report_name,
              report.query_config, schedule.next_run_at AS scheduled_for
       FROM erp_report_schedules schedule
       JOIN erp_saved_reports report ON report.id = schedule.saved_report_id
         AND report.company_id = schedule.company_id AND report.is_active = TRUE AND report.is_deleted = FALSE
       WHERE schedule.is_active = TRUE AND schedule.is_deleted = FALSE
         AND (schedule.next_run_at IS NULL OR schedule.next_run_at <= NOW())
         AND (schedule.lease_until IS NULL OR schedule.lease_until < NOW())
       ORDER BY schedule.next_run_at NULLS FIRST, schedule.created_at
       FOR UPDATE OF schedule SKIP LOCKED LIMIT $1`,
      [limit],
    );
    const claimed = [];
    for (const schedule of due.rows) {
      const scheduledFor = schedule.scheduled_for || new Date();
      const run = await client.query(
        `INSERT INTO erp_report_schedule_runs (company_id, schedule_id, saved_report_id, scheduled_for, status, recipients)
         VALUES ($1,$2,$3,$4,'processing',$5)
         ON CONFLICT (schedule_id, scheduled_for) DO NOTHING RETURNING id`,
        [schedule.company_id, schedule.id, schedule.saved_report_id, scheduledFor, schedule.recipients],
      );
      if (!run.rowCount) continue;
      await client.query(
        `UPDATE erp_report_schedules SET lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [schedule.id, schedule.company_id],
      );
      claimed.push({ ...schedule, scheduled_for: scheduledFor, run_id: run.rows[0].id });
    }
    await client.query("COMMIT");
    return claimed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function finishRun(schedule, { status, filename = null, storagePath = null, fileSize = null, error = null }) {
  const nextRunAt = getNextScheduledRunAt(schedule.cron_expression);
  await pool.query(
    `UPDATE erp_report_schedule_runs
     SET status = $3, filename = $4, storage_path = $5, file_size_bytes = $6,
         error_message = $7, completed_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'processing'`,
    [schedule.run_id, schedule.company_id, status, filename, storagePath, fileSize,
      error ? String(error).slice(0, 2000) : null],
  );
  await pool.query(
    `UPDATE erp_report_schedules SET last_run_at = NOW(), next_run_at = $3,
       lease_until = NULL, updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [schedule.id, schedule.company_id, nextRunAt],
  );
}

async function runOneSchedule(schedule, adapter) {
  let storagePath = null;
  try {
    const owner = schedule.created_by ? await userService.findUserById(schedule.created_by) : null;
    if (!owner || owner.company_id !== schedule.company_id
      || !owner.permissions.includes("reports.view") || !owner.permissions.includes("reports.export")) {
      throw new Error("Schedule owner no longer has report view and export permissions");
    }
    const reportKey = schedule.query_config?.report || schedule.report_code;
    const reportResult = await reporting.runStandardReport(
      schedule.company_id, reportKey, schedule.query_config?.filters || {},
    );
    const buffer = await buildScheduledReportBuffer({
      format: schedule.format,
      reportName: schedule.report_name,
      rows: reportResult.rows || [],
    });
    const extension = schedule.format === "xlsx" ? "xlsx" : schedule.format;
    const filename = `${schedule.report_code}-${new Date(schedule.scheduled_for).toISOString().replace(/[:.]/g, "-")}.${extension}`;
    const exportDirectory = getExportDirectory();
    await fs.mkdir(exportDirectory, { recursive: true });
    storagePath = path.join(exportDirectory, `${schedule.run_id}.${extension}`);
    await fs.writeFile(storagePath, buffer, { flag: "wx" });

    for (const recipient of schedule.recipients) {
      const delivery = await adapter.sendEmail({
        companyId: schedule.company_id,
        to: recipient,
        subject: `${schedule.report_name} report`,
        body: `The scheduled ${schedule.report_name} report is attached.`,
        idempotencyKey: `report:${schedule.run_id}:${recipient}`,
        attachments: [{
          filename,
          mimeType: schedule.format === "pdf" ? "application/pdf"
            : schedule.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
          content: buffer.toString("base64"),
        }],
      });
      if (delivery?.accepted !== true) throw new Error(delivery?.message || `Report email to ${recipient} was not accepted`);
    }
    await finishRun(schedule, { status: "sent", filename, storagePath, fileSize: buffer.length });
    return "sent";
  } catch (error) {
    if (storagePath) await fs.rm(storagePath, { force: true }).catch(() => {});
    await finishRun(schedule, { status: "failed", error: error.message });
    return "failed";
  }
}

async function expireOldReportRuns() {
  const retentionDays = Math.max(1, Number(process.env.REPORT_EXPORT_RETENTION_DAYS) || 90);
  const oldRuns = await pool.query(
    `SELECT id, storage_path FROM erp_report_schedule_runs
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [retentionDays],
  );
  const exportDirectory = `${getExportDirectory()}${path.sep}`;
  for (const run of oldRuns.rows) {
    if (run.storage_path && path.resolve(run.storage_path).startsWith(exportDirectory)) {
      await fs.rm(run.storage_path, { force: true }).catch(() => {});
    }
  }
  if (oldRuns.rowCount) {
    await pool.query(
      `DELETE FROM erp_report_schedule_runs WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [retentionDays],
    );
  }
  return oldRuns.rowCount;
}

async function runScheduledReportsBatch({ limit = 10, adapter = createSettingsNotificationAdapter() } = {}) {
  await expireOldReportRuns();
  const schedules = await claimDueSchedules(Math.max(1, Math.min(50, Number(limit) || 10)));
  const summary = { processed: schedules.length, sent: 0, failed: 0 };
  for (const schedule of schedules) {
    summary[await runOneSchedule(schedule, adapter)] += 1;
  }
  return summary;
}

module.exports = { buildScheduledReportBuffer, expireOldReportRuns, getNextScheduledRunAt, runScheduledReportsBatch };