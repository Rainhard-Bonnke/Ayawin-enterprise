const fs = require("node:fs");
const path = require("node:path");

const rows = [
  ["A1", "Legacy API removal", "Complete", "Legacy API and demo markers are guarded by a source scan."],
  ["A2", "TanStack Query data layer", "In progress", "Shared list/document/action hooks and URL-backed filters exist; remaining data mutations still need migration."],
  ["A3", "Forms and validation", "In progress", "Common Kenyan schemas and RHF/Zod validation now cover login and customer create/edit; most route forms still need migration."],
  ["A4", "Frontend structure and permissions", "In progress", "Permission-code route checks, Can/usePermission, reusable DataTable, FormDialog, AttachmentPanel, and MoneyText exist; route splitting and the remaining shared components still need migration."],
  ["A5", "Session security", "Complete", "Refresh token is cookie-backed, access token is in memory, CSRF checks are enabled, and stale refresh cannot overwrite login."],
  ["A6", "Deployment foundation", "In progress", "Render, environment and CI foundations are updated; Render validation and staging deployment remain unverified."],
  ["A7", "Tests and CI", "In progress", "Frontend tests and four Playwright journeys pass; form coverage, CI execution and deployment verification remain."],
];

const outputPath = path.resolve(__dirname, "../docs/MODULE-MATRIX.md");
const content = [
  "# Phase A module matrix",
  "",
  "Generated from the Phase A scope in the implementation pack. Update the task rows in `scripts/generate-module-matrix.cjs`, then regenerate this file after each Phase A task change.",
  "",
  "| Task | Module | Status | Current evidence / remaining work |",
  "|---|---|---|---|",
  ...rows.map(([task, module, status, details]) => `| ${task} | ${module} | ${status} | ${details} |`),
  "",
].join("\n");

if (process.argv.includes("--check")) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== content) {
    console.error("docs/MODULE-MATRIX.md is stale. Run node scripts/generate-module-matrix.cjs.");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, content);
}
