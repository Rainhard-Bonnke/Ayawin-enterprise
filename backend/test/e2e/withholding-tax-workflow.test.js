const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getTestContext, getVendorId, pool } = require("./helpers");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
if (
  !process.env.MFA_ENCRYPTION_KEY ||
  process.env.MFA_ENCRYPTION_KEY.length < 32 ||
  process.env.MFA_ENCRYPTION_KEY === process.env.JWT_SECRET
)
  process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(48).toString("hex");
if (!process.env.DOC_VERIFY_SECRET || process.env.DOC_VERIFY_SECRET.length < 32)
  process.env.DOC_VERIFY_SECRET = crypto.randomBytes(48).toString("hex");

const accountsPayable = require("../../src/services/accountsPayableService");
const financeClose = require("../../src/services/financeCloseService");
const userService = require("../../src/services/userService");
const tokenService = require("../../src/services/tokenService");
const { app } = require("../../src/index");

async function createFinanceActor(context, suffix, role) {
  const result = await pool.query(
    `INSERT INTO erp_users (
       company_id, default_branch_id, role_id, username, email, full_name,
       status, created_by
     )
     SELECT source.company_id, source.default_branch_id, source.role_id,
            $2, $3, $4, 'active', source.id
     FROM erp_users source
     WHERE source.id=$1 RETURNING id`,
    [
      context.userId,
      `e2e-wht-${role}-${suffix}`,
      `e2e-wht-${role}-${suffix}@example.test`,
      `E2E WHT ${role}`,
    ],
  );
  return result.rows[0].id;
}

test("approved WHT config deducts supplier payments and remits with a posted journal and certificate", async () => {
  const context = await getTestContext();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const year = 2600 + (Number.parseInt(suffix.slice(0, 6), 16) % 300);
  const preparerId = await createFinanceActor(context, suffix, "preparer");
  const approverId = await createFinanceActor(context, suffix, "approver");
  const remitterId = await createFinanceActor(context, suffix, "remitter");
  const vendorId = await getVendorId(context.companyId, `WHT-${suffix}`);
  await pool.query(
    "UPDATE erp_vendors SET tax_residency='resident' WHERE id=$1 AND company_id=$2",
    [vendorId, context.companyId],
  );

  const yearRow = await pool.query(
    `INSERT INTO erp_fiscal_years (company_id, year_label, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [context.companyId, `E2E-WHT-${suffix}`, `${year}-01-01`, `${year}-12-31`, context.userId],
  );
  const periodRow = await pool.query(
    `INSERT INTO erp_fiscal_periods (
       company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
     ) VALUES ($1,$2,1,$3,$4,$5,'open',$6) RETURNING id`,
    [
      context.companyId,
      yearRow.rows[0].id,
      `E2E WHT ${suffix}`,
      `${year}-01-01`,
      `${year}-01-31`,
      context.userId,
    ],
  );
  const accounts = await pool.query(
    `SELECT id, account_code FROM erp_chart_of_accounts
     WHERE company_id=$1 AND account_code=ANY($2::text[]) AND is_active=TRUE
       AND is_postable=TRUE AND is_deleted=FALSE`,
    [context.companyId, ["1100", "2100", "2190", "6300"]],
  );
  const byCode = Object.fromEntries(accounts.rows.map((row) => [row.account_code, row.id]));
  for (const code of ["1100", "2100", "2190", "6300"])
    assert.ok(byCode[code], `missing account ${code}`);

  const userRows = await Promise.all(
    [preparerId, approverId, remitterId].map((id) => userService.findUserById(id)),
  );
  const tokens = userRows.map((actor) => tokenService.generateAccessToken(actor));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/tax`;
  const postJson = (token, path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const created = await postJson(tokens[0], "/withholding/categories", {
      code: `E2E-${suffix}`,
      name: "E2E resident services withholding",
      residency: "resident",
      rate: 5,
      taxable_basis: "net_before_vat",
      effective_from: `${year}-01-01`,
      effective_to: null,
      remittance_working_days: 5,
      liability_account_id: byCode["2190"],
    });
    const category = await created.json();
    assert.equal(created.status, 201, JSON.stringify(category));
    const approvedCategory = await postJson(
      tokens[1],
      `/withholding/categories/${category.id}/approve`,
      {},
    );
    assert.equal(approvedCategory.status, 200, await approvedCategory.text());

    const bill = await accountsPayable.createBill({
      companyId: context.companyId,
      userId: preparerId,
      vendorId,
      supplierInvoiceNo: `WHT-${suffix}`,
      billDate: `${year}-01-10`,
      dueDate: `${year}-01-31`,
      lines: [
        {
          description: "Professional service",
          quantity: 1,
          unit_price: 1000,
          tax_rate: 0,
          account_id: byCode["6300"],
          withholding_category_id: category.id,
        },
      ],
    });
    await accountsPayable.postBill({
      companyId: context.companyId,
      userId: approverId,
      billId: bill.id,
    });
    const payment = await accountsPayable.createPayment({
      companyId: context.companyId,
      userId: preparerId,
      vendorId,
      paymentDate: `${year}-01-20`,
      bankAccountId: byCode["1100"],
      referenceNo: `BANK-WHT-${suffix}`,
      allocations: [{ bill_id: bill.id, amount: 1000 }],
    });
    const paymentPost = await accountsPayable.postPayment({
      companyId: context.companyId,
      userId: approverId,
      paymentId: payment.id,
    });

    const obligationResult = await pool.query(
      `SELECT * FROM erp_withholding_obligations WHERE company_id=$1 AND payment_id=$2`,
      [context.companyId, payment.id],
    );
    assert.equal(obligationResult.rowCount, 1);
    const obligation = obligationResult.rows[0];
    assert.equal(Number(obligation.taxable_base), 1000);
    assert.equal(Number(obligation.amount), 50);
    assert.equal(obligation.status, "outstanding");
    assert.ok(obligation.due_date);
    const blockedClose = await financeClose.getPeriodCloseChecklist(context.companyId, periodRow.rows[0].id);
    assert.ok(blockedClose.blockers.some((blocker) => blocker.code === "wht_not_remitted"));

    const paymentJournal = await pool.query(
      `SELECT SUM(line.debit)::numeric AS debits, SUM(line.credit)::numeric AS credits,
              ARRAY_AGG(account.account_code ORDER BY line.line_no) AS codes
       FROM erp_journal_lines line
       JOIN erp_chart_of_accounts account ON account.id=line.account_id
       WHERE line.journal_id=$1`,
      [paymentPost.journal_id],
    );
    assert.equal(Number(paymentJournal.rows[0].debits), 1000);
    assert.equal(Number(paymentJournal.rows[0].credits), 1000);
    assert.deepEqual(paymentJournal.rows[0].codes, ["2100", "2190", "1100"]);

    const remitted = await postJson(tokens[2], "/withholding/remittances", {
      obligation_ids: [obligation.id],
      remittance_date: `${year}-01-30`,
      payment_reference: `KRA-WHT-${suffix}`,
      bank_account_id: byCode["1100"],
    });
    const remittance = await remitted.json();
    assert.equal(remitted.status, 201, JSON.stringify(remittance));
    assert.equal(remittance.certificate_count, 1);
    const afterRemittance = await pool.query(
      `SELECT status, certificate_no, remittance_id FROM erp_withholding_obligations WHERE id=$1`,
      [obligation.id],
    );
    assert.equal(afterRemittance.rows[0].status, "remitted");
    assert.match(afterRemittance.rows[0].certificate_no, /^WHT-/);
    assert.equal(afterRemittance.rows[0].remittance_id, remittance.remittance.id);
    const clearedClose = await financeClose.getPeriodCloseChecklist(context.companyId, periodRow.rows[0].id);
    assert.equal(clearedClose.blockers.some((blocker) => blocker.code === "wht_not_remitted"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("UPDATE erp_users SET status='inactive' WHERE id=ANY($1::uuid[])", [
      [preparerId, approverId, remitterId],
    ]);
  }
});
