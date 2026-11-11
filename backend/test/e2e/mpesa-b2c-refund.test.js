const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const integrationSettings = require("../../src/services/integrationSettingsService");
const b2c = require("../../src/services/mpesaB2cService");

test("E2E B2C refund requires separate approval, registered recipient, and records callback replay", async () => {
  const ctx = await getTestContext();
  const suffix = Date.now();
  const customerCode = `E2E-B2C-${suffix}`;
  const invoiceNo = `E2E-B2C-INV-${suffix}`;
  const creditNoteNo = `E2E-B2C-CN-${suffix}`;
  const account = await pool.query(
    `SELECT id FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code='1120' AND is_active=TRUE AND is_postable=TRUE LIMIT 1`,
    [ctx.companyId],
  );
  const existingJournal = await pool.query(
    "SELECT id FROM erp_journals WHERE company_id=$1 AND status='posted' LIMIT 1", [ctx.companyId],
  );
  const otherUser = await pool.query(
    "SELECT id FROM erp_users WHERE company_id=$1 AND id<>$2 AND is_deleted=FALSE LIMIT 1", [ctx.companyId, ctx.userId],
  );
  assert.ok(account.rowCount && existingJournal.rowCount && otherUser.rowCount);
  const previousSettings = await pool.query(
    `SELECT id,branch_id,provider_mode,environment,public_config,secret_payload_encrypted,policy,updated_by
     FROM erp_integration_settings WHERE company_id=$1 AND provider='mpesa' AND branch_id IS NULL AND environment='sandbox'`,
    [ctx.companyId],
  );
  const customer = await pool.query(
    `INSERT INTO erp_customers (company_id,customer_code,name,phone,created_by)
     VALUES ($1,$2,'B2C refund customer','0712345678',$3) RETURNING id`,
    [ctx.companyId, customerCode, ctx.userId],
  );
  const invoice = await pool.query(
    `INSERT INTO erp_customer_invoices (company_id,customer_id,invoice_no,invoice_date,status,total_amount,created_by)
     VALUES ($1,$2,$3,CURRENT_DATE,'posted',10,$4) RETURNING id`,
    [ctx.companyId, customer.rows[0].id, invoiceNo, ctx.userId],
  );
  const note = await pool.query(
    `INSERT INTO erp_customer_credit_notes
       (company_id,invoice_id,customer_id,credit_note_no,credit_date,reason,subtotal,tax_amount,total_amount,
        refund_amount,refund_bank_account_id,refund_reference_no,refund_journal_id,status,created_by,posted_by,posted_at)
     VALUES ($1,$2,$3,$4,CURRENT_DATE,'B2C refund test',10,0,10,10,$5,'B2C-REF',$6,'posted',$7,$7,NOW()) RETURNING id`,
    [ctx.companyId, invoice.rows[0].id, customer.rows[0].id, creditNoteNo, account.rows[0].id,
      existingJournal.rows[0].id, ctx.userId],
  );
  let requestId;
  try {
    await integrationSettings.saveIntegrationSettings({
      companyId: ctx.companyId, userId: ctx.userId, provider: "mpesa", providerMode: "mock", environment: "sandbox",
      publicConfig: { shortcode: "174379" },
      secrets: { callbackToken: "b2c-test-callback-token" },
      policy: { b2c_enabled: true, b2c_daily_limit: 100, mpesa_clearing_account_id: account.rows[0].id },
    });
    const prepared = await b2c.prepareB2cRefund({
      companyId: ctx.companyId, userId: ctx.userId, creditNoteId: note.rows[0].id,
      phone: "0712345678", idempotencyKey: `B2C-${suffix}`,
    });
    requestId = prepared.id;
    assert.equal(prepared.status, "prepared");
    await assert.rejects(() => b2c.approveAndReleaseB2cRefund({
      companyId: ctx.companyId, userId: ctx.userId, requestId,
      adapter: { buildCallbackUrl: () => "https://example.test/callback", sendB2c: async () => ({ accepted: true }) },
    }), /cannot approve their own document/);
    const submitted = await b2c.approveAndReleaseB2cRefund({
      companyId: ctx.companyId,
      userId: otherUser.rows[0].id,
      requestId,
      adapter: {
        buildCallbackUrl: (kind) => `https://example.test/${kind}`,
        async sendB2c(request) {
          assert.equal(request.phone, "254712345678");
          assert.equal(request.amount, 10);
          return { accepted: true, originator_conversation_id: `origin-${suffix}`, conversation_id: `conversation-${suffix}` };
        },
      },
    });
    assert.equal(submitted.status, "submitted");
    const callback = await b2c.receiveB2cResult({
      companyId: ctx.companyId, token: "b2c-test-callback-token",
      payload: { Result: { OriginatorConversationID: `origin-${suffix}`, ResultCode: 0, TransactionID: `MPESA-${suffix}` } },
    });
    assert.equal(callback.status, "confirmed");
    const replay = await b2c.receiveB2cResult({
      companyId: ctx.companyId, token: "b2c-test-callback-token",
      payload: { Result: { OriginatorConversationID: `origin-${suffix}`, ResultCode: 0, TransactionID: `MPESA-${suffix}` } },
    });
    assert.equal(replay.duplicate, true);
  } finally {
    if (requestId) await pool.query("DELETE FROM erp_mpesa_b2c_refund_requests WHERE id=$1 AND company_id=$2", [requestId, ctx.companyId]);
    await pool.query("UPDATE erp_customer_credit_notes SET status='void',void_reason='E2E cleanup',voided_at=NOW() WHERE id=$1 AND company_id=$2", [note.rows[0].id, ctx.companyId]);
    await pool.query("UPDATE erp_customer_invoices SET is_deleted=TRUE WHERE id=$1 AND company_id=$2", [invoice.rows[0].id, ctx.companyId]);
    await pool.query("UPDATE erp_customers SET is_deleted=TRUE WHERE id=$1 AND company_id=$2", [customer.rows[0].id, ctx.companyId]);
    if (previousSettings.rowCount) {
      const previous = previousSettings.rows[0];
      await pool.query(
        `UPDATE erp_integration_settings SET branch_id=$2,provider_mode=$3,environment=$4,
           public_config=$5::jsonb,secret_payload_encrypted=$6,policy=$7::jsonb,updated_by=$8,updated_at=NOW()
         WHERE id=$1`,
        [previous.id, previous.branch_id, previous.provider_mode, previous.environment,
          JSON.stringify(previous.public_config), previous.secret_payload_encrypted,
          JSON.stringify(previous.policy), previous.updated_by],
      );
    } else await pool.query("DELETE FROM erp_integration_settings WHERE company_id=$1 AND provider='mpesa' AND environment='sandbox'", [ctx.companyId]);
  }
});