const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getVendorId, pool } = require("./helpers");
const vatReturns = require("../../src/services/vatReturnService");

async function getOtherUser(companyId, excludedId) {
  const result = await pool.query(
    `SELECT id FROM erp_users WHERE company_id = $1 AND id <> $2
       AND status = 'active' AND is_deleted = FALSE ORDER BY created_at LIMIT 1`,
    [companyId, excludedId],
  );
  if (!result.rowCount) throw new Error("VAT return E2E requires a second active user");
  return result.rows[0].id;
}

test("E2E VAT return: prepare, independent approval, lock, and block back-dated bill posting", async () => {
  const ctx = await getTestContext();
  const checkerId = await getOtherUser(ctx.companyId, ctx.userId);
  const vendorId = await getVendorId(ctx.companyId);
  const suffix = Date.now();
  let yearId;
  let periodId;
  let billId;
  let returnId;

  try {
    const year = await pool.query(
      `INSERT INTO erp_fiscal_years (company_id, year_label, start_date, end_date, created_by)
       VALUES ($1,$2,'2099-01-01','2099-12-31',$3) RETURNING id`,
      [ctx.companyId, `E2E-VAT-${suffix}`, ctx.userId],
    );
    yearId = year.rows[0].id;
    const period = await pool.query(
      `INSERT INTO erp_fiscal_periods
       (company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by)
       VALUES ($1,$2,12,'E2E VAT December','2099-12-01','2099-12-31','open',$3) RETURNING id`,
      [ctx.companyId, yearId, ctx.userId],
    );
    periodId = period.rows[0].id;

    const prepared = await vatReturns.prepareVatReturn({ companyId: ctx.companyId, userId: ctx.userId, periodId });
    returnId = prepared.id;
    assert.equal(prepared.status, "draft");
    assert.equal(prepared.filing_status, "working_paper_only");

    await vatReturns.approveVatReturn({ companyId: ctx.companyId, userId: checkerId, returnId });
    await vatReturns.lockVatReturn({ companyId: ctx.companyId, userId: checkerId, returnId });

    const bill = await pool.query(
      `INSERT INTO erp_supplier_bills
       (company_id, vendor_id, bill_no, supplier_invoice_no, bill_date, due_date,
        subtotal, tax_amount, total_amount, status, created_by)
       VALUES ($1,$2,$3,$4,'2099-12-10','2099-12-20',100,16,116,'draft',$5) RETURNING id`,
      [ctx.companyId, vendorId, `E2E-VAT-BILL-${suffix}`, `E2E-VAT-INV-${suffix}`, ctx.userId],
    );
    billId = bill.rows[0].id;
    await assert.rejects(
      () => pool.query(`UPDATE erp_supplier_bills SET status = 'posted' WHERE id = $1`, [billId]),
      /VAT return is locked/,
    );
  } finally {
    if (billId) await pool.query("DELETE FROM erp_supplier_bills WHERE id = $1 AND company_id = $2", [billId, ctx.companyId]);
    if (returnId) await pool.query("DELETE FROM erp_vat_returns WHERE id = $1 AND company_id = $2", [returnId, ctx.companyId]);
    if (periodId) await pool.query("DELETE FROM erp_fiscal_periods WHERE id = $1 AND company_id = $2", [periodId, ctx.companyId]);
    if (yearId) await pool.query("DELETE FROM erp_fiscal_years WHERE id = $1 AND company_id = $2", [yearId, ctx.companyId]);
  }
});
