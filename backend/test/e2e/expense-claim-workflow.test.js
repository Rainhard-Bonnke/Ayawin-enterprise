const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { getTestContext, pool } = require("./helpers");

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
     WHERE source.id=$1
     RETURNING id`,
    [
      context.userId,
      `e2e-expense-${role}-${suffix}`,
      `e2e-expense-${role}-${suffix}@example.test`,
      `E2E Expense ${role}`,
    ],
  );
  return result.rows[0].id;
}

test("expense claim requires receipt and independent reviewers before GL accrual and reimbursement", async () => {
  const context = await getTestContext();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const year = 2600 + (Number.parseInt(suffix.slice(0, 6), 16) % 300);
  const claimantId = await createFinanceActor(context, suffix, "claimant");
  const approverId = await createFinanceActor(context, suffix, "approver");
  const payerId = await createFinanceActor(context, suffix, "payer");
  const branch = await pool.query(
    "SELECT id FROM erp_branches WHERE company_id=$1 AND code='HQ' AND is_deleted=FALSE LIMIT 1",
    [context.companyId],
  );
  const employee = await pool.query(
    `INSERT INTO erp_employees (
       company_id, branch_id, user_id, employee_code, first_name, last_name,
       is_active, created_by
     ) VALUES ($1,$2,$3,$4,'E2E','Expense Claim',TRUE,$5) RETURNING id`,
    [context.companyId, branch.rows[0].id, claimantId, `E2E-EXP-${suffix}`, context.userId],
  );
  const yearRow = await pool.query(
    `INSERT INTO erp_fiscal_years (company_id, year_label, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [context.companyId, `E2E-EXP-${suffix}`, `${year}-01-01`, `${year}-12-31`, context.userId],
  );
  await pool.query(
    `INSERT INTO erp_fiscal_periods (
       company_id, fiscal_year_id, period_no, name, start_date, end_date, status, created_by
     ) VALUES ($1,$2,1,$3,$4,$5,'open',$6)`,
    [
      context.companyId,
      yearRow.rows[0].id,
      `E2E expense ${suffix}`,
      `${year}-01-01`,
      `${year}-01-31`,
      context.userId,
    ],
  );

  const [claimant, approver, payer] = await Promise.all([
    userService.findUserById(claimantId),
    userService.findUserById(approverId),
    userService.findUserById(payerId),
  ]);
  const tokens = [claimant, approver, payer].map((actor) =>
    tokenService.generateAccessToken(actor),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/expenses`;
  const request = (token, path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const categories = await pool.query(
      `SELECT id FROM erp_expense_categories
       WHERE company_id=$1 AND code='TRAVEL' AND is_active=TRUE AND is_deleted=FALSE`,
      [context.companyId],
    );
    assert.equal(categories.rowCount, 1);
    const submitted = await request(tokens[0], "/claims", {
      claim_date: `${year}-01-15`,
      description: "E2E travel expense",
      currency_code: "KES",
      lines: [
        {
          category_id: categories.rows[0].id,
          description: "Taxi fare",
          amount: 1250.5,
          cost_centre: "HQ",
        },
      ],
    });
    const claim = await submitted.json();
    assert.equal(submitted.status, 201, JSON.stringify(claim));

    const selfApproval = await request(tokens[0], `/claims/${claim.id}/decision`, {
      action: "approve",
    });
    assert.equal(selfApproval.status, 403);

    const missingReceiptApproval = await request(tokens[1], `/claims/${claim.id}/decision`, {
      action: "approve",
    });
    assert.equal(missingReceiptApproval.status, 400);
    assert.match((await missingReceiptApproval.json()).error, /receipt/i);

    const receipt = await fetch(`${baseUrl}/claims/${claim.id}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens[0]}`,
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent("taxi-receipt.pdf"),
        "X-Receipt-Content-Type": "application/pdf",
      },
      body: Buffer.from("%PDF-1.4 E2E receipt"),
    });
    assert.equal(receipt.status, 201);

    const approved = await request(tokens[1], `/claims/${claim.id}/decision`, {
      action: "approve",
    });
    const approvalResult = await approved.json();
    assert.equal(approved.status, 200, JSON.stringify(approvalResult));
    assert.equal(approvalResult.status, "approved");
    assert.ok(approvalResult.approval_journal_id);

    const accrual = await pool.query(
      `SELECT journal.status, journal.total_debit, journal.total_credit,
              ARRAY_AGG(account.account_code ORDER BY line.line_no) AS account_codes
       FROM erp_journals journal
       JOIN erp_journal_lines line ON line.journal_id=journal.id
       JOIN erp_chart_of_accounts account ON account.id=line.account_id
       WHERE journal.id=$1 AND journal.company_id=$2
       GROUP BY journal.id`,
      [approvalResult.approval_journal_id, context.companyId],
    );
    assert.equal(accrual.rows[0].status, "posted");
    assert.equal(Number(accrual.rows[0].total_debit), 1250.5);
    assert.equal(Number(accrual.rows[0].total_credit), 1250.5);
    assert.deepEqual(accrual.rows[0].account_codes, ["6310", "2180"]);

    const bank = await pool.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE company_id=$1 AND account_code='1100' AND is_active=TRUE
         AND is_postable=TRUE AND is_deleted=FALSE LIMIT 1`,
      [context.companyId],
    );
    assert.equal(bank.rowCount, 1);
    const sameApproverPayment = await request(tokens[1], `/claims/${claim.id}/payments`, {
      payment_date: `${year}-01-20`,
      payment_reference: `E2E-EXP-PAY-${suffix}`,
      bank_account_id: bank.rows[0].id,
    });
    assert.equal(sameApproverPayment.status, 403);

    const paid = await request(tokens[2], `/claims/${claim.id}/payments`, {
      payment_date: `${year}-01-20`,
      payment_reference: `E2E-EXP-PAY-${suffix}`,
      bank_account_id: bank.rows[0].id,
    });
    const paymentResult = await paid.json();
    assert.equal(paid.status, 200, JSON.stringify(paymentResult));
    assert.equal(paymentResult.status, "paid");
    assert.ok(paymentResult.payment_journal_id);

    const payment = await pool.query(
      `SELECT journal.status, journal.total_debit, journal.total_credit,
              ARRAY_AGG(account.account_code ORDER BY line.line_no) AS account_codes
       FROM erp_journals journal
       JOIN erp_journal_lines line ON line.journal_id=journal.id
       JOIN erp_chart_of_accounts account ON account.id=line.account_id
       WHERE journal.id=$1 AND journal.company_id=$2
       GROUP BY journal.id`,
      [paymentResult.payment_journal_id, context.companyId],
    );
    assert.equal(payment.rows[0].status, "posted");
    assert.equal(Number(payment.rows[0].total_debit), 1250.5);
    assert.equal(Number(payment.rows[0].total_credit), 1250.5);
    assert.deepEqual(payment.rows[0].account_codes, ["2180", "1100"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("UPDATE erp_users SET status='inactive' WHERE id=ANY($1::uuid[])", [
      [claimantId, approverId, payerId],
    ]);
    await pool.query("UPDATE erp_employees SET is_active=FALSE,is_deleted=TRUE WHERE id=$1", [
      employee.rows[0].id,
    ]);
  }
});
