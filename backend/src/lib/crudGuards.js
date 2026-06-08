const pool = require('../db');

async function hasActiveSalesOrders(companyId, customerId) {
  const r = await pool.query(
    `SELECT 1 FROM erp_sales_orders
     WHERE company_id = $1 AND customer_id = $2 AND is_deleted = FALSE
       AND status NOT IN ('cancelled','closed') LIMIT 1`,
    [companyId, customerId],
  );
  return r.rowCount > 0;
}

async function hasOpenInvoices(companyId, customerId) {
  const r = await pool.query(
    `SELECT 1 FROM erp_customer_invoices
     WHERE company_id = $1 AND customer_id = $2 AND is_deleted = FALSE
       AND status IN ('draft','posted','partial','overdue') LIMIT 1`,
    [companyId, customerId],
  );
  return r.rowCount > 0;
}

async function assertCanDeleteCustomer(companyId, customerId) {
  if (await hasActiveSalesOrders(companyId, customerId)) {
    throw new Error('Cannot delete customer with active sales orders');
  }
  if (await hasOpenInvoices(companyId, customerId)) {
    throw new Error('Cannot delete customer with open invoices');
  }
}

async function assertCanDeleteItem(companyId, itemId) {
  const stock = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0) AS qty FROM erp_stock_on_hand
     WHERE company_id = $1 AND item_id = $2`,
    [companyId, itemId],
  );
  if (Number(stock.rows[0].qty) > 0.0001) {
    throw new Error('Cannot delete item with stock on hand — transfer or adjust stock first');
  }
  const lines = await pool.query(
    `SELECT 1 FROM erp_sales_order_lines sol
     JOIN erp_sales_orders so ON so.id = sol.sales_order_id
     WHERE sol.company_id = $1 AND sol.item_id = $2 AND sol.is_deleted = FALSE
       AND so.status NOT IN ('cancelled','closed') AND so.is_deleted = FALSE LIMIT 1`,
    [companyId, itemId],
  );
  if (lines.rowCount) {
    throw new Error('Cannot delete item referenced on open sales orders');
  }
}

async function assertCanDeleteEmployee(companyId, employeeId) {
  const r = await pool.query(
    `SELECT 1 FROM erp_payslips ps
     JOIN erp_payroll_runs pr ON pr.id = ps.payroll_run_id
     WHERE ps.company_id = $1 AND ps.employee_id = $2 AND pr.status = 'posted' LIMIT 1`,
    [companyId, employeeId],
  );
  if (r.rowCount) {
    throw new Error('Cannot delete employee with posted payroll history');
  }
}

async function assertCanDeleteVendor(companyId, vendorId) {
  const r = await pool.query(
    `SELECT 1 FROM erp_purchase_orders
     WHERE company_id = $1 AND vendor_id = $2 AND is_deleted = FALSE
       AND status NOT IN ('cancelled','closed') LIMIT 1`,
    [companyId, vendorId],
  );
  if (r.rowCount) {
    throw new Error('Cannot delete vendor with open purchase orders');
  }
}

async function assertCanDeleteWarehouse(companyId, warehouseId) {
  const stock = await pool.query(
    `SELECT 1 FROM erp_stock_on_hand
     WHERE company_id = $1 AND warehouse_id = $2 AND quantity > 0.0001 LIMIT 1`,
    [companyId, warehouseId],
  );
  if (stock.rowCount) {
    throw new Error('Cannot delete warehouse with stock on hand');
  }
  const openSo = await pool.query(
    `SELECT 1 FROM erp_sales_orders
     WHERE company_id = $1 AND warehouse_id = $2 AND is_deleted = FALSE
       AND status NOT IN ('cancelled','closed') LIMIT 1`,
    [companyId, warehouseId],
  );
  if (openSo.rowCount) {
    throw new Error('Cannot delete warehouse referenced on open sales orders');
  }
  const openPo = await pool.query(
    `SELECT 1 FROM erp_purchase_orders
     WHERE company_id = $1 AND warehouse_id = $2 AND is_deleted = FALSE
       AND status NOT IN ('cancelled','closed') LIMIT 1`,
    [companyId, warehouseId],
  );
  if (openPo.rowCount) {
    throw new Error('Cannot delete warehouse referenced on open purchase orders');
  }
}

async function assertCanDeleteChartAccount(companyId, accountId) {
  const children = await pool.query(
    `SELECT 1 FROM erp_chart_of_accounts
     WHERE company_id = $1 AND parent_id = $2 AND is_deleted = FALSE LIMIT 1`,
    [companyId, accountId],
  );
  if (children.rowCount) {
    throw new Error('Cannot delete account with child accounts — remove or re-parent children first');
  }
  const journals = await pool.query(
    `SELECT 1 FROM erp_journal_lines WHERE company_id = $1 AND account_id = $2 LIMIT 1`,
    [companyId, accountId],
  );
  if (journals.rowCount) {
    throw new Error('Cannot delete account with journal entries');
  }
  const balances = await pool.query(
    `SELECT 1 FROM erp_gl_balances
     WHERE company_id = $1 AND account_id = $2
       AND (period_debit <> 0 OR period_credit <> 0 OR closing_debit <> 0 OR closing_credit <> 0)
     LIMIT 1`,
    [companyId, accountId],
  );
  if (balances.rowCount) {
    throw new Error('Cannot delete account with GL balances');
  }
}

module.exports = {
  assertCanDeleteCustomer,
  assertCanDeleteItem,
  assertCanDeleteEmployee,
  assertCanDeleteVendor,
  assertCanDeleteWarehouse,
  assertCanDeleteChartAccount,
};
