const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, getCustomerId, getVendorId, getItemId, pool } = require("./helpers");
const { masterDataBlockers } = require("../../src/routes/v1/masterData");

test("master data cannot be deleted while open financial, stock or employment records reference it", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId);
  const employee = await pool.query("SELECT id FROM erp_employees WHERE company_id=$1 AND is_deleted=FALSE LIMIT 1", [ctx.companyId]);
  const billNo = `E2E-GUARD-${Date.now()}`;
  const invoiceNo = `${billNo}-INV`;
  const poNo = `${billNo}-PO`;
  const transferNo = `${billNo}-TR`;
  const runNo = `${billNo}-PAY`;
  const contractId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const poId = crypto.randomUUID();
  const transferId = crypto.randomUUID();
  const payrollRunId = crypto.randomUUID();
  const stock = await pool.query("SELECT quantity FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3", [ctx.companyId,ctx.warehouseId,itemId]);
  try {
    await pool.query(`INSERT INTO erp_customer_invoices(company_id,customer_id,invoice_no,invoice_date,due_date,status,subtotal,total_amount,created_by)
      VALUES($1,$2,$3,CURRENT_DATE,CURRENT_DATE+30,'posted',1,1,$4)`, [ctx.companyId,customerId,invoiceNo,ctx.userId]);
    await pool.query(`INSERT INTO erp_supplier_bills(company_id,vendor_id,bill_no,supplier_invoice_no,bill_date,due_date,subtotal,tax_amount,total_amount,status,created_by)
      VALUES($1,$2,$3,$3,CURRENT_DATE,CURRENT_DATE+30,1,0,1,'posted',$4)`, [ctx.companyId,vendorId,billNo,ctx.userId]);
    await pool.query(`INSERT INTO erp_purchase_orders(id,company_id,vendor_id,warehouse_id,po_number,status,created_by)
      VALUES($1,$2,$3,$4,$5,'submitted',$6)`, [poId,ctx.companyId,vendorId,ctx.warehouseId,poNo,ctx.userId]);
    await pool.query(`INSERT INTO erp_purchase_order_lines(company_id,purchase_order_id,line_no,item_id,quantity)
      VALUES($1,$2,1,$3,1)`, [ctx.companyId,poId,itemId]);
    await pool.query(`INSERT INTO erp_sales_orders(id,company_id,customer_id,order_no,status,created_by)
      VALUES($1,$2,$3,$4,'draft',$5)`, [orderId,ctx.companyId,customerId,`${billNo}-SO`,ctx.userId]);
    await pool.query(`INSERT INTO erp_sales_order_lines(company_id,sales_order_id,line_no,item_id,quantity)
      VALUES($1,$2,1,$3,1)`, [ctx.companyId,orderId,itemId]);
    await pool.query(`INSERT INTO erp_stock_transfers(id,company_id,transfer_no,from_warehouse_id,to_warehouse_id,status,created_by)
      VALUES($1,$2,$3,$4,$5,'in_transit',$6)`, [transferId,ctx.companyId,transferNo,ctx.warehouseId,ctx.warehouseId,ctx.userId]);
    await pool.query(`INSERT INTO erp_stock_on_hand(company_id,warehouse_id,item_id,quantity,avg_unit_cost)
      VALUES($1,$2,$3,1,1) ON CONFLICT(company_id,warehouse_id,item_id) DO UPDATE SET quantity=erp_stock_on_hand.quantity+1`, [ctx.companyId,ctx.warehouseId,itemId]);
    await pool.query(`INSERT INTO erp_employee_contracts(id,company_id,employee_id,contract_type,start_date,status,created_by)
      VALUES($1,$2,$3,'permanent',CURRENT_DATE,'active',$4)`, [contractId,ctx.companyId,employee.rows[0].id,ctx.userId]);
    await pool.query(`INSERT INTO erp_payroll_runs(id,company_id,run_no,payroll_month,status,created_by)
      VALUES($1,$2,$3,DATE_TRUNC('month',CURRENT_DATE)::date,'calculated',$4)`, [payrollRunId,ctx.companyId,runNo,ctx.userId]);
    await pool.query(`INSERT INTO erp_payslips(company_id,payroll_run_id,employee_id)
      VALUES($1,$2,$3)`, [ctx.companyId,payrollRunId,employee.rows[0].id]);
    for (const [table,id,expected] of [
      ["erp_customers",customerId,"open invoices"], ["erp_customers",customerId,"open sales orders"],
      ["erp_vendors",vendorId,"open supplier bills"], ["erp_vendors",vendorId,"open purchase orders"],
      ["erp_items",itemId,"on-hand stock"], ["erp_items",itemId,"open sales documents"], ["erp_items",itemId,"open purchase documents"],
      ["erp_warehouses",ctx.warehouseId,"on-hand stock"], ["erp_warehouses",ctx.warehouseId,"open stock transfers"],
      ["erp_employees",employee.rows[0].id,"active contracts"], ["erp_employees",employee.rows[0].id,"open payroll runs"],
    ]) {
      const blockers = await masterDataBlockers(table,id,ctx.companyId);
      assert.ok(blockers.some((blocker) => blocker.kind===expected), `${table} must report ${expected}`);
    }
  } finally {
    await pool.query("UPDATE erp_customer_invoices SET is_deleted=TRUE WHERE company_id=$1 AND invoice_no=$2", [ctx.companyId,invoiceNo]);
    await pool.query("UPDATE erp_supplier_bills SET is_deleted=TRUE WHERE company_id=$1 AND bill_no=$2", [ctx.companyId,billNo]);
    await pool.query("UPDATE erp_purchase_orders SET is_deleted=TRUE WHERE id=$1", [poId]);
    await pool.query("UPDATE erp_sales_orders SET is_deleted=TRUE WHERE id=$1", [orderId]);
    await pool.query("UPDATE erp_stock_transfers SET is_deleted=TRUE WHERE id=$1", [transferId]);
    await pool.query("UPDATE erp_employee_contracts SET is_deleted=TRUE WHERE id=$1", [contractId]);
    await pool.query("UPDATE erp_payslips SET is_deleted=TRUE WHERE payroll_run_id=$1", [payrollRunId]);
    await pool.query("UPDATE erp_payroll_runs SET is_deleted=TRUE,status='cancelled' WHERE id=$1", [payrollRunId]);
    if (stock.rowCount) await pool.query("UPDATE erp_stock_on_hand SET quantity=$4 WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3", [ctx.companyId,ctx.warehouseId,itemId,stock.rows[0].quantity]);
    else await pool.query("DELETE FROM erp_stock_on_hand WHERE company_id=$1 AND warehouse_id=$2 AND item_id=$3", [ctx.companyId,ctx.warehouseId,itemId]);
  }
});

