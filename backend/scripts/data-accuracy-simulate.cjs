#!/usr/bin/env node
/**
 * Seeds transactional volume for the data accuracy audit checklist.
 * Invoked via: node scripts/data-accuracy-audit.js --simulate
 */
require('dotenv').config();
const pool = require('../src/db');
const { ensureErpFoundation } = require('../src/erpBootstrap');
const sales = require('../src/services/salesService');
const procurement = require('../src/services/procurementService');
const adjustments = require('../src/services/inventoryAdjustmentService');
const payroll = require('../src/services/payrollService');

const TAG = 'ACC-DA';
/** Dedicated audit month (must fall in an open FY2026 fiscal period). */
const PAYROLL_MONTH = '2026-12-01';

async function getCtx() {
  await ensureErpFoundation();
  const company = await pool.query(`SELECT id FROM erp_companies WHERE code = 'MARTIN' LIMIT 1`);
  const user = await pool.query(`SELECT id FROM erp_users WHERE email = 'admin@martin.co.ke' LIMIT 1`);
  const warehouse = await pool.query(
    `SELECT id FROM erp_warehouses WHERE company_id = $1 AND code = 'WH-NRB' LIMIT 1`,
    [company.rows[0].id],
  );
  const customers = await pool.query(
    `SELECT id FROM erp_customers WHERE company_id = $1 AND is_deleted = FALSE LIMIT 5`,
    [company.rows[0].id],
  );
  const items = await pool.query(
    `SELECT id, item_code FROM erp_items WHERE company_id = $1 AND is_deleted = FALSE AND is_active = TRUE LIMIT 5`,
    [company.rows[0].id],
  );
  const vendor = await pool.query(
    `SELECT id FROM erp_vendors WHERE company_id = $1 LIMIT 1`,
    [company.rows[0].id],
  );
  return {
    companyId: company.rows[0].id,
    userId: user.rows[0].id,
    warehouseId: warehouse.rows[0].id,
    customerIds: customers.rows.map((r) => r.id),
    items: items.rows,
    vendorId: vendor.rows[0]?.id,
  };
}

async function runSalesMonthSim(ctx) {
  console.log(`\n[${TAG}] Financial month sim: 50 invoices, 20 payments, 5 credit notes`);
  const createdInvoices = [];

  for (let i = 0; i < 50; i += 1) {
    const customerId = ctx.customerIds[i % ctx.customerIds.length];
    const item = ctx.items[i % ctx.items.length];
    const inv = await sales.createCustomerInvoice({
      companyId: ctx.companyId,
      userId: ctx.userId,
      customerId,
      notes: `${TAG} invoice ${i + 1}`,
      lines: [{ item_id: item.id, quantity: 2 + (i % 5), unit_price: 50 + i }],
    });
    if (inv.ok && inv.invoice_id) createdInvoices.push({ id: inv.invoice_id });
  }

  const payTargets = createdInvoices.slice(0, 20);
  for (const inv of payTargets) {
    const row = await pool.query(
      `SELECT id, total_amount, amount_paid FROM erp_customer_invoices WHERE id = $1`,
      [inv.id],
    );
    const id = row.rows[0].id;
    const due = Number(row.rows[0].total_amount) - Number(row.rows[0].amount_paid);
    if (due > 0) {
      await sales.recordCustomerPayment({
        companyId: ctx.companyId,
        userId: ctx.userId,
        invoiceId: id,
        amount: due,
        notes: `${TAG} payment`,
      });
    }
  }

  const cnTargets = createdInvoices.slice(20, 25);
  for (const inv of cnTargets) {
    const row = await pool.query(
      `SELECT id, customer_id FROM erp_customer_invoices WHERE id = $1`,
      [inv.id],
    );
    const item = ctx.items[0];
    await sales.createAndPostCreditNote({
      companyId: ctx.companyId,
      userId: ctx.userId,
      customerId: row.rows[0].customer_id,
      invoiceId: row.rows[0].id,
      reason: `${TAG} audit credit`,
      lines: [{
        item_id: item.id,
        quantity: 1,
        unit_price: 50,
        warehouse_id: ctx.warehouseId,
        unit_cost: 40,
      }],
    });
  }
  console.log(`[${TAG}] Created ${createdInvoices.length} invoices`);
}

async function runInventorySim(ctx) {
  console.log(`\n[${TAG}] Inventory: 10 SO dispatch, 3 GRN, 2 adjustments`);
  const itemId = ctx.items[0]?.id;
  if (!itemId) return;

  for (let i = 0; i < 10; i += 1) {
    const customerId = ctx.customerIds[i % ctx.customerIds.length];
    const qty = 1 + (i % 3);
    const so = await sales.createSalesOrder({
      companyId: ctx.companyId,
      userId: ctx.userId,
      customerId,
      warehouseId: ctx.warehouseId,
      notes: `${TAG} SO`,
      lines: [{ item_id: itemId, quantity: qty, unit_price: 60 }],
    });
    await sales.confirmSalesOrder({
      companyId: ctx.companyId,
      userId: ctx.userId,
      orderId: so.id,
    });
    const sol = await pool.query(
      'SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1',
      [so.id],
    );
    await sales.createAndPostDelivery({
      companyId: ctx.companyId,
      userId: ctx.userId,
      salesOrderId: so.id,
      warehouseId: ctx.warehouseId,
      lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: qty }],
    });
  }

  if (ctx.vendorId) {
    for (let i = 0; i < 3; i += 1) {
      const po = await procurement.createPurchaseOrder({
        companyId: ctx.companyId,
        userId: ctx.userId,
        vendorId: ctx.vendorId,
        warehouseId: ctx.warehouseId,
        lines: [{ item_id: itemId, quantity: 10, unit_cost: 35 }],
      });
      await procurement.approvePurchaseOrder({
        companyId: ctx.companyId,
        userId: ctx.userId,
        poId: po.id,
      });
      const pol = await pool.query(
        'SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id = $1 LIMIT 1',
        [po.id],
      );
      await procurement.createAndPostGrn({
        companyId: ctx.companyId,
        userId: ctx.userId,
        purchaseOrderId: po.id,
        warehouseId: ctx.warehouseId,
        lines: [{ po_line_id: pol.rows[0].id, item_id: itemId, quantity: 10, unit_cost: 35 }],
      });
    }
  }

  for (let i = 0; i < 2; i += 1) {
    const adj = await adjustments.createStockAdjustment({
      companyId: ctx.companyId,
      userId: ctx.userId,
      warehouseId: ctx.warehouseId,
      reason: `${TAG} cycle count ${i + 1}`,
      lines: [{ item_id: itemId, quantity_delta: i === 0 ? 1 : -1, unit_cost: 35 }],
    });
    await adjustments.postStockAdjustment({
      companyId: ctx.companyId,
      userId: ctx.userId,
      adjustmentId: adj.id,
      approverId: ctx.userId,
    });
  }
}

async function runPayrollSim(ctx) {
  console.log(`\n[${TAG}] Payroll: run + post for active employees (${PAYROLL_MONTH})`);
  const existing = await pool.query(
    `SELECT id, status FROM erp_payroll_runs
     WHERE company_id = $1 AND run_no = $2`,
    [ctx.companyId, `PR-${PAYROLL_MONTH.slice(0, 7)}`],
  );
  if (existing.rowCount && existing.rows[0].status === 'posted') {
    console.log(`[${TAG}] Payroll ${PAYROLL_MONTH} already posted — skip`);
    return;
  }
  const result = await payroll.runPayroll({
    companyId: ctx.companyId,
    userId: ctx.userId,
    payrollMonth: PAYROLL_MONTH,
  });
  await payroll.postPayrollToGl({
    companyId: ctx.companyId,
    userId: ctx.userId,
    runId: result.run_id,
  });
  const n = await pool.query(
    'SELECT COUNT(*)::int AS n FROM erp_payslips WHERE payroll_run_id = $1',
    [result.run_id],
  );
  console.log(`[${TAG}] Payroll posted — ${n.rows[0].n} payslips`);
}

async function runSimulation() {
  console.log(`\n=== ${TAG} data accuracy simulation ===`);
  const ctx = await getCtx();
  await runSalesMonthSim(ctx);
  await runInventorySim(ctx);
  await runPayrollSim(ctx);
  console.log(`\n[${TAG}] Simulation complete\n`);
}

if (require.main === module) {
  runSimulation()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { runSimulation, TAG, PAYROLL_MONTH };
