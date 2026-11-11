const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScheduledReportBuffer, getNextScheduledRunAt } = require("../src/services/scheduledReportService");

test("scheduled report cron validation uses Nairobi timezone and rejects invalid expressions", () => {
  const current = new Date("2026-11-09T08:01:00.000Z");
  const next = getNextScheduledRunAt("0 8 * * *", current, "Africa/Nairobi");
  assert.equal(next.toISOString(), "2026-11-10T05:00:00.000Z");
  assert.throws(() => getNextScheduledRunAt("not cron", current), /five-field cron/);
});

test("scheduled report exports generate CSV, XLSX, and PDF buffers", async () => {
  const rows = [{ code: "A,1", amount: 12.5 }];
  const csv = await buildScheduledReportBuffer({ format: "csv", reportName: "Test", rows });
  const xlsx = await buildScheduledReportBuffer({ format: "xlsx", reportName: "Test", rows });
  const pdf = await buildScheduledReportBuffer({ format: "pdf", reportName: "Test", rows });
  assert.match(csv.toString(), /"A,1"/);
  assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
});