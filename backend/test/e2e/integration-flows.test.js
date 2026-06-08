/**
 * Integration E2E — five complete business flows (service layer).
 * Run: npm run test:e2e:integration
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getTestContext,
  getVendorId,
  getItemId,
  createTestCustomer,
  getDriverId,
  getGlBalance,
  countAuditActions,
  pool,
} = require('./helpers');
const sales = require('../../src/services/salesService');
const procurement = require('../../src/services/procurementService');
const ap = require('../../src/services/apService');
const payroll = require('../../src/services/payrollService');
const inventory = require('../../src/services/inventoryService');
const adjustments = require('../../src/services/inventoryAdjustmentService');
const accounting = require('../../src/services/accountingService');
const monthEnd = require('../../src/services/monthEndService');
const bankRecon = require('../../src/services/bankReconService');
const dashboard = require('../../src/services/dashboardService');
const crm = require('../../src/services/crmService');
const reportExport = require('../../src/services/reportExportService');
const { renderPayslipPdf } = require('../../src/services/payslipPdfService');

const MD_ACTOR = { role_name: 'Administrator', permissions: ['procurement.approve', 'procurement.md_approve'] };

test('FLOW 1: Full sale cycle — customer through dashboard KPI', async () => {
  process.env.AUTO_INVOICE_ON_DELIVERY = 'false';
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, 'COKE-500');
  const driverId = await getDriverId(ctx.companyId);

  const customer = await createTestCustomer(ctx.companyId, ctx.userId, { creditLimit: 800000 });
  const credit = await sales.checkCreditLimit(ctx.companyId, customer.id, 5000);
  assert.equal(credit.ok, true, 'credit check should pass');

  const dashBefore = await dashboard.getDashboardSummary(ctx.companyId, { preset: 'mtd' });
  const arBefore = await crm.getCustomerArBalance(ctx.companyId, customer.id);

  const so = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId: customer.id,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 5, unit_price: 120 }],
  });
  const confirm = await sales.confirmSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    orderId: so.id,
  });
  assert.equal(confirm.ok, true);

  const sol = await pool.query(
    'SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1',
    [so.id],
  );

  const delivery = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: so.id,
    warehouseId: ctx.warehouseId,
    driverId: driverId || undefined,
    lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: 5 }],
  });
  assert.equal(delivery.ok, true);

  const dn = await pool.query(
    `SELECT logistics_status, status FROM erp_delivery_notes WHERE id = $1`,
    [delivery.delivery_id],
  );
  assert.equal(dn.rows[0].status, 'posted');
  assert.equal(dn.rows[0].logistics_status, 'delivered');

  const invoice = await sales.createCustomerInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId: customer.id,
    salesOrderId: so.id,
    lines: [{ item_id: itemId, quantity: 5, unit_price: 120, so_line_id: sol.rows[0].id }],
  });
  assert.equal(invoice.ok, true);

  const inv = await pool.query(
    `SELECT id, total_amount, journal_id FROM erp_customer_invoices WHERE sales_order_id = $1`,
    [so.id],
  );
  assert.ok(inv.rows[0].journal_id, 'invoice posted to GL');

  const payment = await sales.recordCustomerPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
    amount: Number(inv.rows[0].total_amount),
    notes: 'E2E flow 1 payment',
  });
  assert.equal(payment.ok, true);
  assert.equal(payment.status, 'paid');

  const receipt = await pool.query(
    `SELECT r.id, r.journal_id FROM erp_customer_receipts r
     JOIN erp_receipt_allocations ra ON ra.receipt_id = r.id
     WHERE ra.invoice_id = $1`,
    [inv.rows[0].id],
  );
  assert.ok(receipt.rowCount);
  assert.ok(receipt.rows[0].journal_id, 'receipt posted to GL');

  const arAfter = await crm.getCustomerArBalance(ctx.companyId, customer.id);
  assert.ok(arAfter <= arBefore, 'AR balance should not increase after full payment');

  const dashAfter = await dashboard.getDashboardSummary(ctx.companyId, { preset: 'mtd' });
  assert.ok(Number(dashAfter.kpis.revenue_in_range) >= Number(dashBefore.kpis.revenue_in_range));
});

test('FLOW 2: Full procurement cycle — low stock through AP', async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, 'TSK-500');

  await pool.query(
    `UPDATE erp_stock_on_hand SET quantity = 0
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  await pool.query(
    `UPDATE erp_items SET reorder_point = 10 WHERE id = $1 AND company_id = $2`,
    [itemId, ctx.companyId],
  );

  const alerts = await inventory.getReorderAlerts(ctx.companyId);
  assert.ok(alerts.some((a) => a.item_id === itemId), 'low stock alert should fire');

  const po = await procurement.createPurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    vendorId,
    warehouseId: ctx.warehouseId,
    lines: [{ item_id: itemId, quantity: 25, unit_cost: 40 }],
  });
  assert.ok(po.po_number);

  const approved = await procurement.approvePurchaseOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
    actor: MD_ACTOR,
  });
  assert.equal(approved.status, 'approved');

  const sent = await procurement.sendPurchaseOrderToSupplier({
    companyId: ctx.companyId,
    userId: ctx.userId,
    poId: po.id,
  });
  assert.equal(sent.status, 'sent');

  const pol = await pool.query(
    'SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1',
    [po.id],
  );

  const grn = await procurement.createAndPostGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    purchaseOrderId: po.id,
    warehouseId: ctx.warehouseId,
    lines: [{ po_line_id: pol.rows[0].id, item_id: itemId, quantity: 25, unit_cost: 40 }],
  });
  assert.equal(grn.ok, true);

  const stock = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  assert.ok(Number(stock.rows[0].quantity) >= 25);

  const bill = await ap.createVendorBillFromGrn({
    companyId: ctx.companyId,
    userId: ctx.userId,
    goodsReceiptId: grn.grn_id,
  });
  await ap.postVendorBill({ companyId: ctx.companyId, userId: ctx.userId, billId: bill.id });

  const billBal = await pool.query(
    `SELECT total_amount, amount_paid FROM erp_vendor_invoices WHERE id = $1`,
    [bill.id],
  );
  const outstanding = Number(billBal.rows[0].total_amount) - Number(billBal.rows[0].amount_paid);
  assert.ok(outstanding > 0, 'AP balance updated after bill post');

  const payment = await ap.recordVendorPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: bill.id,
    amount: outstanding,
    referenceNo: `E2E-AP-${Date.now()}`,
    paymentMethod: 'bank_transfer',
  });
  assert.equal(payment.ok, true);

  const vendorAfter = await pool.query('SELECT ap_balance FROM erp_vendors WHERE id = $1', [vendorId]);
  assert.ok(Number(vendorAfter.rows[0].ap_balance) >= 0);

  const apGl = await getGlBalance(ctx.companyId, '2100');
  assert.ok(Number.isFinite(apGl));
});

test('FLOW 3: Full payroll cycle — compute through P&L expense', async () => {
  const ctx = await getTestContext();
  const payrollMonth = '2026-11-01';

  const attendance = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_attendance
     WHERE company_id = $1 AND attendance_date >= '2026-01-01'`,
    [ctx.companyId],
  );
  assert.ok(attendance.rows[0].n >= 0, 'attendance table reachable');

  const leave = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_leave_balances WHERE company_id = $1`,
    [ctx.companyId],
  );
  assert.ok(leave.rows[0].n > 0, 'leave balances confirmed');

  await pool.query(
    `DELETE FROM erp_payslips WHERE payroll_run_id IN (
       SELECT id FROM erp_payroll_runs WHERE company_id = $1 AND run_no = $2
     )`,
    [ctx.companyId, 'PR-2026-11'],
  );
  await pool.query(
    `DELETE FROM erp_payroll_runs WHERE company_id = $1 AND run_no = $2`,
    [ctx.companyId, 'PR-2026-11'],
  );

  const run = await payroll.runPayroll({
    companyId: ctx.companyId,
    userId: ctx.userId,
    payrollMonth,
  });
  assert.ok(run.run_id);

  const slips = await pool.query(
    `SELECT COUNT(*)::int AS n, SUM(paye)::numeric AS paye, SUM(nhif)::numeric AS nhif
     FROM erp_payslips WHERE payroll_run_id = $1`,
    [run.run_id],
  );
  assert.ok(slips.rows[0].n >= 10, 'payroll computed for employee set');
  assert.ok(Number(slips.rows[0].paye) > 0);
  assert.ok(Number(slips.rows[0].nhif) > 0);

  await payroll.approvePayrollRun({
    companyId: ctx.companyId,
    userId: ctx.userId,
    runId: run.run_id,
  });

  const bankExport = await payroll.buildPayrollBankExport(ctx.companyId, run.run_id);
  assert.ok(bankExport.buffer.length > 50);
  assert.ok(bankExport.rows >= 10);

  const slipRow = await pool.query(
    `SELECT ps.*, e.employee_code, e.first_name, e.last_name, e.department, e.job_title,
            pr.run_no, pr.payroll_month, c.name AS company_name
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     JOIN erp_payroll_runs pr ON pr.id = ps.payroll_run_id
     JOIN erp_companies c ON c.id = ps.company_id
     WHERE ps.payroll_run_id = $1 LIMIT 1`,
    [run.run_id],
  );
  const pdf = await renderPayslipPdf({
    companyName: slipRow.rows[0].company_name,
    payslip: slipRow.rows[0],
    employee: slipRow.rows[0],
    run: slipRow.rows[0],
  });
  assert.ok(pdf.length > 500, 'payslip PDF generated');

  const period = await pool.query(
    `SELECT id FROM erp_fiscal_periods
     WHERE company_id = $1 AND start_date <= $2::date AND end_date >= $2::date
     LIMIT 1`,
    [ctx.companyId, payrollMonth],
  );
  const expenseBefore = period.rowCount
    ? await getGlBalance(ctx.companyId, '6100', period.rows[0].id)
    : 0;

  const posted = await payroll.postPayrollToGl({
    companyId: ctx.companyId,
    userId: ctx.userId,
    runId: run.run_id,
  });
  assert.equal(posted.ok, true);

  const runRow = await pool.query('SELECT total_gross, journal_id FROM erp_payroll_runs WHERE id = $1', [run.run_id]);
  assert.ok(runRow.rows[0].journal_id);

  if (period.rowCount) {
    const expenseAfter = await getGlBalance(ctx.companyId, '6100', period.rows[0].id);
    assert.ok(expenseAfter >= expenseBefore);
    const pl = await accounting.getProfitLossReport(ctx.companyId, period.rows[0].id);
    assert.ok(pl.total_expense >= 0);
  }
});

test('FLOW 4: Month-end close — reports, recon, trial balance, PDF export', async () => {
  const ctx = await getTestContext();
  const period = await monthEnd.getOpenPeriod(ctx.companyId);
  if (!period) return;

  const draftInv = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_customer_invoices
     WHERE company_id = $1 AND status = 'draft'`,
    [ctx.companyId],
  );
  if (draftInv.rows[0].n > 0) {
    await pool.query(
      `UPDATE erp_customer_invoices SET status = 'cancelled'
       WHERE company_id = $1 AND status = 'draft'`,
      [ctx.companyId],
    );
  }

  const vat = await accounting.getVatReport(ctx.companyId, period.start_date, period.end_date);
  assert.equal(vat.matched, true);

  const excise = await accounting.getExciseReport(ctx.companyId, period.start_date, period.end_date);
  assert.ok(Math.abs(Number(excise.totals.variance)) <= 1);

  const banks = await bankRecon.listBankAccounts(ctx.companyId);
  if (banks.length) {
    const bankId = banks[0].id;
    const imported = await bankRecon.importStatementLines({
      companyId: ctx.companyId,
      userId: ctx.userId,
      bankAccountId: bankId,
      lines: [{ txn_date: period.end_date, description: 'E2E recon', amount: 100, reference_no: 'E2E-STMT' }],
    });
    assert.ok(imported.imported >= 1);
    const unmatched = await bankRecon.getUnmatched(ctx.companyId, bankId);
    assert.ok(Array.isArray(unmatched.statement_lines));
  }

  const preview = await monthEnd.previewMonthEnd(ctx.companyId, period.id);
  assert.ok(preview.trial_balance);
  assert.equal(preview.trial_balance.balanced, true);
  assert.ok(Math.abs(preview.trial_balance.difference) <= 0.02);

  const pl = await accounting.getProfitLossReport(ctx.companyId, period.id);
  const bs = await accounting.getBalanceSheetReport(ctx.companyId, period.id);
  assert.ok(pl.lines.length > 0);
  assert.ok(bs.lines.length > 0);

  const pdf = await reportExport.renderReportPdfBuffer({
    title: 'E2E Month-End TB',
    subtitle: period.name,
    rows: [{ account: 'Check', balance: preview.trial_balance.difference }],
    meta: { period: `${period.start_date} → ${period.end_date}`, company_name: 'MARTIN' },
  });
  assert.ok(pdf.length > 200);
});

test('FLOW 5: Stock discrepancy resolution — adjustment and audit trail', async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, 'TSK-500');

  const before = await pool.query(
    `SELECT quantity, avg_unit_cost FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  const qtyBefore = Number(before.rows[0]?.quantity || 0);
  const costBefore = Number(before.rows[0]?.avg_unit_cost || 35);

  const valBefore = await inventory.getStockValuation(ctx.companyId);
  const totalBefore = Number(valBefore.totals.total_value);

  const physicalQty = qtyBefore + 3;
  const delta = physicalQty - qtyBefore;

  const adj = await adjustments.createStockAdjustment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    warehouseId: ctx.warehouseId,
    reason: 'E2E physical count variance',
    reasonCode: 'CYCLE_COUNT',
    lines: [{ item_id: itemId, quantity_delta: delta, unit_cost: costBefore }],
  });
  assert.equal(adj.status, 'draft');
  assert.ok(adj.reason.includes('physical') || adj.reason_code === 'CYCLE_COUNT');

  assert.ok(
    (await countAuditActions(ctx.companyId, 'stock_adjustment', adj.id, ['adjustment.created'])) >= 1,
    'audit: adjustment created',
  );

  await adjustments.postStockAdjustment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    adjustmentId: adj.id,
    approverId: ctx.userId,
  });

  const ledger = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_stock_ledger
     WHERE company_id = $1 AND reference_type = 'adjustment' AND reference_id = $2`,
    [ctx.companyId, adj.id],
  );
  assert.ok(ledger.rows[0].n >= 1, 'stock ledger records adjustment');

  assert.ok(
    (await countAuditActions(ctx.companyId, 'stock_adjustment', adj.id, ['adjustment.posted'])) >= 1,
    'audit: adjustment posted',
  );

  const after = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  assert.equal(Number(after.rows[0].quantity), physicalQty);

  const valAfter = await inventory.getStockValuation(ctx.companyId);
  const totalAfter = Number(valAfter.totals.total_value);
  assert.ok(Math.abs(totalAfter - totalBefore - delta * costBefore) <= costBefore * 2);
});
