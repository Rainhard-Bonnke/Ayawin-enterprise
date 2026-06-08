#!/usr/bin/env node
/**
 * Static UI/UX checklist audit (responsive patterns, usability, PDF routes).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const routesDir = path.join(root, 'src', 'routes');
const backendDir = path.join(root, 'backend', 'src');

let failed = 0;
let warned = 0;

function pass(msg, detail = '') {
  console.log(`PASS  ${msg}${detail ? ` — ${detail}` : ''}`);
}
function fail(msg, detail = '') {
  console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ''}`);
  failed += 1;
}
function warn(msg, detail = '') {
  console.log(`WARN  ${msg}${detail ? ` — ${detail}` : ''}`);
  warned += 1;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function listRouteFiles() {
  return fs.readdirSync(routesDir).filter((f) => f.startsWith('_app.') && f.endsWith('.tsx'));
}

const LIST_PAGES = [
  { file: '_app.sales.tsx', name: 'Sales' },
  { file: '_app.invoices.tsx', name: 'Invoices' },
  { file: '_app.inventory.tsx', name: 'Inventory' },
  { file: '_app.procurement.tsx', name: 'Procurement' },
  { file: '_app.delivery.tsx', name: 'Delivery' },
  { file: '_app.customers.tsx', name: 'Customers' },
  { file: '_app.hr.tsx', name: 'HR' },
  { file: '_app.accounting.tsx', name: 'Accounting' },
  { file: '_app.accounts-payable.tsx', name: 'AP' },
  { file: '_app.reports.tsx', name: 'Reports' },
  { file: '_app.master-data.tsx', name: 'Master data' },
  { file: '_app.users.tsx', name: 'Users' },
  { file: '_app.audit-logs.tsx', name: 'Audit logs' },
];

console.log('\n=== UI/UX audit ===\n');

const appTsx = read(path.join(routesDir, '_app.tsx'));
if (/setOpenMobile|isMobile|Menu/.test(appTsx)) {
  pass('Mobile navigation', 'hamburger + sidebar sheet');
} else {
  fail('Mobile navigation', 'missing menu toggle');
}

const tableUi = read(path.join(root, 'src', 'components', 'ui', 'table.tsx'));
if (/overflow-auto/.test(tableUi)) {
  pass('Tables scroll horizontally on small screens', 'Table wrapper overflow-auto');
} else {
  fail('Table mobile scroll');
}

const styles = read(path.join(root, 'src', 'styles.css'));
if (/overflow-x:\s*clip|overflow-x-hidden/.test(styles) || /min-w-0/.test(appTsx)) {
  pass('Layout overflow guard', 'clip/min-w-0 on shell');
} else {
  warn('Layout overflow guard', 'add overflow-x-clip on main');
}

const inputUi = read(path.join(root, 'src', 'components', 'ui', 'input.tsx'));
if (/h-11|text-base/.test(inputUi)) {
  pass('Form inputs mobile-friendly', 'min 44px touch height');
} else {
  warn('Form input sizing');
}

if (fs.existsSync(path.join(root, 'src', 'lib', 'humanizeError.ts'))) {
  pass('Human-readable API errors', 'humanizeError.ts');
} else {
  fail('humanizeError.ts missing');
}

const rootTsx = read(path.join(routesDir, '__root.tsx'));
if (/Toaster|sonner/.test(rootTsx)) {
  pass('Global toast notifications');
} else {
  fail('Toaster not configured');
}

for (const page of LIST_PAGES) {
  const p = path.join(routesDir, page.file);
  if (!fs.existsSync(p)) {
    warn(`List page missing: ${page.name}`);
    continue;
  }
  const src = read(p);
  if (/SearchBar/.test(src)) {
    pass(`Search on ${page.name}`);
  } else {
    fail(`Search on ${page.name}`);
  }
  if (/toast\.(success|error|message)/.test(src)) {
    pass(`Toast feedback on ${page.name}`);
  } else {
    warn(`Toast usage on ${page.name}`);
  }
  if (/No .+ yet|ListEmptyState|text-center text-sm text-muted-foreground/.test(src)) {
    pass(`Empty state on ${page.name}`);
  } else {
    warn(`Empty state on ${page.name}`);
  }
}

const sales = read(path.join(routesDir, '_app.sales.tsx'));
if (/AlertDialog.*[Cc]ancel|ConfirmActionDialog/.test(sales)) {
  pass('Destructive confirm on sales (cancel order)');
} else {
  fail('Sales cancel confirmation');
}

const master = read(path.join(routesDir, '_app.master-data.tsx'));
if (/ConfirmActionDialog|AlertDialog/.test(master)) {
  pass('Destructive confirm on master data');
} else {
  warn('Master data delete confirmation');
}

if (fs.existsSync(path.join(root, 'src', 'components', 'DetailNav.tsx'))) {
  pass('Detail navigation component', 'DetailNav breadcrumbs/back');
} else {
  warn('DetailNav component missing');
}

const pdfRoutes = [
  ['sales.js', '/invoices/:invoiceNo/pdf'],
  ['logistics.js', '/deliveries/pdf'],
  ['payroll.js', '/payslips/:payslipId/pdf'],
  ['reports.js', "format === 'pdf'"],
];
for (const [file, needle] of pdfRoutes) {
  const fp = path.join(backendDir, 'routes', 'v1', file);
  if (fs.existsSync(fp) && read(fp).includes(needle)) {
    pass(`PDF route: ${file}`);
  } else {
    fail(`PDF route: ${file}`);
  }
}

const invoicePdf = path.join(backendDir, 'services', 'invoicePdfService.js');
const deliveryPdf = path.join(backendDir, 'services', 'deliveryPdfService.js');
const payslipPdf = path.join(backendDir, 'services', 'payslipPdfService.js');
const reportPdf = path.join(backendDir, 'services', 'reportExportService.js');

if (read(invoicePdf).includes("size: 'A4'")) pass('Invoice PDF A4');
else fail('Invoice PDF size');

if (read(deliveryPdf).includes("size: 'A4'")) pass('Delivery note PDF A4');
else fail('Delivery note PDF size');

if (read(payslipPdf).includes('Deductions') && read(payslipPdf).includes('NET PAY')) {
  pass('Payslip PDF deductions layout');
} else {
  fail('Payslip PDF layout');
}

if (read(reportPdf).includes('bufferPages')) {
  pass('Report PDF multi-page buffer');
} else {
  warn('Report PDF paging');
}
if (read(reportPdf).includes('switchToPage') || read(reportPdf).includes('Page ')) {
  pass('Report PDF page numbers');
} else {
  warn('Report PDF page numbers', 'enhance reportExportService');
}

console.log('\n=== Summary ===');
if (failed) console.log(`FAIL  ${failed} check(s), ${warned} warning(s)`);
else if (warned) console.log(`PASS  with ${warned} warning(s)`);
else console.log('PASS  All UI/UX static checks passed');

process.exit(failed ? 1 : 0);
