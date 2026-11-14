const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getCustomerId, getItemId, pool } = require("./helpers");
const sales = require("../../src/services/salesService");
const integration = require("../../src/services/integrationService");
const mpesa = require("../../src/services/mpesaService");
const integrationSettings = require("../../src/services/integrationSettingsService");
const { buildInvoiceVerificationHash } = require("../../src/services/documentVerificationService");

test("E2E sales flow: SO confirm -> delivery -> invoice -> payment", async (t) => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const stockBefore = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  const quantityBefore = Number(stockBefore.rows[0]?.quantity || 0);

  const so = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    requiredDate: new Date().toISOString().slice(0, 10),
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70 }],
  });

  const confirm = await sales.confirmSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    orderId: so.id,
  });
  assert.equal(confirm.ok, true);

  const sol = await pool.query(
    "SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1",
    [so.id],
  );

  const delivery = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: so.id,
    warehouseId: ctx.warehouseId,
    lines: [{ so_line_id: sol.rows[0].id, item_id: itemId, quantity: 10 }],
  });
  assert.equal(delivery.ok, true);

  const stockAfterDelivery = await pool.query(
    `SELECT quantity FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
    [ctx.companyId, ctx.warehouseId, itemId],
  );
  assert.equal(Number(stockAfterDelivery.rows[0]?.quantity), quantityBefore - 10);

  const stockMovement = await pool.query(
    `SELECT quantity, movement_type, reference_type, reference_id
     FROM erp_stock_ledger
     WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND reference_id = $4
     ORDER BY created_at DESC LIMIT 1`,
    [ctx.companyId, ctx.warehouseId, itemId, delivery.delivery_id],
  );
  assert.equal(stockMovement.rows[0]?.movement_type, "issue");
  assert.equal(Number(stockMovement.rows[0]?.quantity), -10);
  assert.equal(stockMovement.rows[0]?.reference_type, "delivery_note");

  const invoice = await sales.createCustomerInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    salesOrderId: so.id,
    lines: [{ item_id: itemId, quantity: 10, unit_price: 70, so_line_id: sol.rows[0].id }],
  });
  assert.equal(invoice.ok, true);

  const inv = await pool.query(
    `SELECT id, invoice_no, status, total_amount, amount_paid, etims_status
     FROM erp_customer_invoices WHERE sales_order_id = $1`,
    [so.id],
  );
  assert.equal(inv.rows[0].status, "posted");
  assert.equal(inv.rows[0].etims_status, "pending");

  const unconfiguredWorker = await integration.runEtimsOutboxBatch();
  assert.equal(unconfiguredWorker.configured, false);
  assert.equal(unconfiguredWorker.processed, 0);

  const firstSubmission = await pool.query(
    `SELECT id, status, payload FROM erp_etims_submissions
     WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(firstSubmission.rowCount, 1);
  assert.equal(firstSubmission.rows[0].status, "pending");
  assert.equal(firstSubmission.rows[0].payload.invoice_no, inv.rows[0].invoice_no);
  assert.equal(firstSubmission.rows[0].payload.lines.length, 1);
  assert.equal(firstSubmission.rows[0].payload.lines[0].quantity, 10);

  const retryResult = await integration.queueEtimsInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
  });
  assert.equal(retryResult.status, "pending");
  assert.equal(retryResult.configured, false);
  assert.match(retryResult.message, /not KRA-accepted/);
  const retryCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_etims_submissions
     WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(retryCount.rows[0].n, 1);
  await pool.query(
    `UPDATE erp_etims_submissions SET status = 'failed', last_error = 'simulated provider timeout'
     WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  await pool.query(
    `UPDATE erp_customer_invoices SET etims_status = 'failed'
     WHERE company_id = $1 AND id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  const requeued = await integration.queueEtimsInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
  });
  assert.equal(requeued.status, "pending");
  const retriedSubmission = await pool.query(
    `SELECT status, last_error FROM erp_etims_submissions
     WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(retriedSubmission.rows[0].status, "pending");
  assert.equal(retriedSubmission.rows[0].last_error, null);

  const transientResult = await integration.runEtimsOutboxBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: {
      async submitInvoice() {
        throw new Error("simulated temporary provider outage");
      },
    },
  });
  assert.equal(transientResult.retrying, 1);
  const retryScheduled = await pool.query(
    `SELECT status, attempt_count, next_attempt_at, last_error
     FROM erp_etims_submissions WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(retryScheduled.rows[0].status, "retry");
  assert.equal(Number(retryScheduled.rows[0].attempt_count), 1);
  assert.match(retryScheduled.rows[0].last_error, /temporary provider outage/);
  await pool.query(
    `UPDATE erp_etims_submissions SET next_attempt_at = NOW()
     WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );

  const acceptedReference = `KRA-E2E-${Date.now()}`;
  const workerResult = await integration.runEtimsOutboxBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: {
      async submitInvoice({ payload, idempotencyKey }) {
        assert.equal(payload.invoice_no, inv.rows[0].invoice_no);
        assert.match(idempotencyKey, new RegExp(inv.rows[0].id));
        return { accepted: true, provider_reference: acceptedReference, qr_code: "e2e-qr" };
      },
      async lookupInvoiceStatus({ idempotencyKey }) {
        assert.match(idempotencyKey, new RegExp(inv.rows[0].id));
        return { status: "not_found" };
      },
    },
  });
  assert.equal(workerResult.processed, 1);
  assert.equal(workerResult.accepted, 1);
  const accepted = await pool.query(
    `SELECT submission.status, submission.provider_reference, invoice.etims_status, invoice.etims_ref
     FROM erp_etims_submissions submission
     JOIN erp_customer_invoices invoice ON invoice.id = submission.invoice_id
     WHERE submission.company_id = $1 AND submission.invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(accepted.rows[0].status, "accepted");
  assert.equal(accepted.rows[0].etims_status, "accepted");
  assert.equal(accepted.rows[0].provider_reference, acceptedReference);
  assert.equal(accepted.rows[0].etims_ref, acceptedReference);
  const attempts = await pool.query(
    `SELECT attempt_count FROM erp_etims_submissions WHERE company_id = $1 AND invoice_id = $2`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.equal(Number(attempts.rows[0].attempt_count), 2);

  const mpesaToken = `e2e-callback-${Date.now()}`;
  const oldMpesaToken = process.env.MPESA_CALLBACK_TOKEN;
  process.env.MPESA_CALLBACK_TOKEN = mpesaToken;
  const previousMpesaSettings = await pool.query(
    `SELECT * FROM erp_integration_settings WHERE company_id=$1 AND provider='mpesa' AND branch_id IS NULL AND environment='sandbox'`,
    [ctx.companyId],
  );
  await integrationSettings.saveIntegrationSettings({
    companyId: ctx.companyId, userId: ctx.userId, provider: "mpesa", providerMode: "mock", environment: "sandbox",
    publicConfig: { shortcode: "174379" }, secrets: { callbackToken: mpesaToken }, policy: { b2c_enabled: false },
  });
  t.after(() => {
    if (oldMpesaToken === undefined) delete process.env.MPESA_CALLBACK_TOKEN;
    else process.env.MPESA_CALLBACK_TOKEN = oldMpesaToken;
  });
  t.after(async () => {
    await pool.query("DELETE FROM erp_integration_settings WHERE company_id=$1 AND provider='mpesa' AND branch_id IS NULL AND environment='sandbox'", [ctx.companyId]);
    for (const setting of previousMpesaSettings.rows) {
      await pool.query(
        `INSERT INTO erp_integration_settings
           (id,company_id,branch_id,provider,provider_mode,environment,public_config,secret_payload_encrypted,policy,updated_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12)`,
        [setting.id,setting.company_id,setting.branch_id,setting.provider,setting.provider_mode,setting.environment,
          JSON.stringify(setting.public_config),setting.secret_payload_encrypted,JSON.stringify(setting.policy),setting.updated_by,
          setting.created_at,setting.updated_at],
      );
    }
  });
  const mpesaKey = `e2e-mpesa-${Date.now()}`;
  const request = await mpesa.createStkRequest({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
    phone: "0712345678",
    amount: Number(inv.rows[0].total_amount),
    idempotencyKey: mpesaKey,
  });
  const duplicateRequest = await mpesa.createStkRequest({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: inv.rows[0].id,
    phone: "+254 712 345678",
    amount: Number(inv.rows[0].total_amount),
    idempotencyKey: mpesaKey,
  });
  assert.equal(duplicateRequest.id, request.id);
  assert.equal(request.phone_number, "254712345678");
  const unconfiguredMpesaWorker = await mpesa.runMpesaInitiationBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
  });
  assert.equal(unconfiguredMpesaWorker.configured, false);
  assert.equal(unconfiguredMpesaWorker.processed, 0);
  const initiation = await mpesa.runMpesaInitiationBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: {
      async initiateStkPush({ idempotencyKey }) {
        assert.equal(idempotencyKey, mpesaKey);
        return { merchant_request_id: `merchant-${mpesaKey}`, checkout_request_id: `checkout-${mpesaKey}` };
      },
    },
  });
  assert.equal(initiation.initiated, 1);
  await assert.rejects(
    () => mpesa.receiveMpesaCallback({
      token: "wrong-callback-token",
      payload: { Body: { stkCallback: { MerchantRequestID: `merchant-${mpesaKey}`, CheckoutRequestID: `checkout-${mpesaKey}` } } },
    }),
    /Invalid M-Pesa callback token/,
  );
  const callback = await mpesa.receiveMpesaCallback({
    token: mpesaToken,
    payload: { Body: { stkCallback: { MerchantRequestID: `merchant-${mpesaKey}`, CheckoutRequestID: `checkout-${mpesaKey}`, ResultCode: 0 } } },
  });
  assert.equal(callback.status, "callback_received");
  const invoiceBeforeVerification = await pool.query(
    "SELECT amount_paid FROM erp_customer_invoices WHERE id = $1",
    [inv.rows[0].id],
  );
  assert.equal(Number(invoiceBeforeVerification.rows[0].amount_paid), 0);

  const transactionDate = new Date().toISOString().slice(0, 19).replace(/\D/g, "");
  const verification = await mpesa.runMpesaCallbackBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: {
      async verifyPayment({ checkoutRequestId }) {
        assert.equal(checkoutRequestId, `checkout-${mpesaKey}`);
        return {
          awaiting_status_callback: true,
          status_query_originator_id: `status-${mpesaKey}`,
          status_query_conversation_id: `status-conversation-${mpesaKey}`,
          phone: "254712345678",
          amount: Number(inv.rows[0].total_amount),
          receipt_number: `MPESA-${mpesaKey}`,
          transaction_date: transactionDate,
        };
      },
    },
  });
  assert.equal(verification.confirmed, 0);
  assert.equal(verification.retrying, 1);
  const pendingStatusRequest = await mpesa.getMpesaPaymentRequest({ companyId: ctx.companyId, requestId: request.id });
  assert.equal(pendingStatusRequest.status, "awaiting_status_callback");
  const callbackReplay = await mpesa.receiveMpesaCallback({
    companyId: ctx.companyId,
    token: mpesaToken,
    payload: { Body: { stkCallback: {
      MerchantRequestID: `merchant-${mpesaKey}`, CheckoutRequestID: `checkout-${mpesaKey}`, ResultCode: 0,
    } } },
  });
  assert.equal(callbackReplay.duplicate, true);
  const nonFinalStatus = await mpesa.receiveMpesaStatusResult({
    companyId: ctx.companyId,
    token: mpesaToken,
    payload: { Result: { OriginatorConversationID: `status-${mpesaKey}`, ResultCode: 0, ResultType: 1,
      ResultDesc: "Waiting for further messages" } },
  });
  assert.equal(nonFinalStatus.status, "awaiting_status_callback");
  await mpesa.receiveMpesaStatusResult({
    companyId: ctx.companyId,
    token: mpesaToken,
    payload: { Result: {
      OriginatorConversationID: `status-${mpesaKey}`,
      ResultCode: 0,
      ResultType: 0,
      ResultDesc: "The service request is processed successfully.",
      TransactionID: `MPESA-${mpesaKey}`,
      ResultParameters: { ResultParameter: [
        { Key: "TransactionStatus", Value: "Completed" },
        { Key: "ReceiptNo", Value: `MPESA-${mpesaKey}` },
        { Key: "Amount", Value: Number(inv.rows[0].total_amount) },
      ] },
    } },
  });
  const finalVerification = await mpesa.runMpesaCallbackBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: { verifyPayment: async () => { throw new Error("must not query again after final callback"); } },
  });
  assert.equal(finalVerification.confirmed, 1);
  const payment = { ok: true, status: "paid" };
  assert.equal(payment.ok, true);
  assert.equal(payment.status, "paid");

  const confirmedRequest = await mpesa.getMpesaPaymentRequest({ companyId: ctx.companyId, requestId: request.id });
  assert.equal(confirmedRequest.status, "confirmed");
  assert.equal(confirmedRequest.provider_receipt_no, `MPESA-${mpesaKey}`);

  const duplicateVerification = await mpesa.runMpesaCallbackBatch({
    companyId: ctx.companyId,
    invoiceId: inv.rows[0].id,
    adapter: { verifyPayment: async () => { throw new Error("confirmed request must not run again"); } },
  });
  assert.equal(duplicateVerification.processed, 0);

  const mpesaReceipt = await pool.query(
    `SELECT COUNT(*)::int AS n FROM erp_customer_receipts
     WHERE company_id = $1 AND provider_receipt_no = $2 AND payment_method = 'mpesa'`,
    [ctx.companyId, `MPESA-${mpesaKey}`],
  );
  assert.equal(mpesaReceipt.rows[0].n, 1);

  const paidInvoice = await pool.query(
    `SELECT status, amount_paid, total_amount FROM erp_customer_invoices WHERE id = $1`,
    [inv.rows[0].id],
  );
  assert.equal(paidInvoice.rows[0].status, "paid");
  assert.equal(Number(paidInvoice.rows[0].amount_paid), Number(paidInvoice.rows[0].total_amount));

  const receipt = await pool.query(
    `SELECT r.amount
     FROM erp_customer_receipts r
     JOIN erp_receipt_allocations ra ON ra.receipt_id = r.id
     WHERE r.company_id = $1 AND ra.invoice_id = $2
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [ctx.companyId, inv.rows[0].id],
  );
  assert.ok(receipt.rowCount > 0);
  assert.equal(Number(receipt.rows[0].amount), Number(paidInvoice.rows[0].total_amount));

  const verifySource = await pool.query(
    `SELECT company_id, invoice_no, customer_id, invoice_date, total_amount, status,
            issuer_snapshot, issuer_snapshot_at
     FROM erp_customer_invoices
     WHERE id = $1`,
    [inv.rows[0].id],
  );
  assert.equal(verifySource.rows[0].issuer_snapshot.version, 1);
  assert.ok(verifySource.rows[0].issuer_snapshot.legal_name);
  assert.ok(verifySource.rows[0].issuer_snapshot_at);
  const verificationHash = buildInvoiceVerificationHash(verifySource.rows[0]);
  assert.match(verificationHash, /^[a-f0-9]{64}$/);

  const tamperedHash = buildInvoiceVerificationHash({
    ...verifySource.rows[0],
    total_amount: Number(verifySource.rows[0].total_amount) + 1,
  });
  assert.notEqual(tamperedHash, verificationHash);

  const tamperedIssuerHash = buildInvoiceVerificationHash({
    ...verifySource.rows[0],
    issuer_snapshot: { ...verifySource.rows[0].issuer_snapshot, legal_name: "Tampered Issuer" },
  });
  assert.notEqual(tamperedIssuerHash, verificationHash);

  await assert.rejects(pool.query(
    `UPDATE erp_customer_invoices
     SET issuer_snapshot = jsonb_set(issuer_snapshot, '{legal_name}', '"Tampered Issuer"'::jsonb)
     WHERE id = $1`,
    [inv.rows[0].id],
  ), /issuer snapshot is immutable/i);
});

test("E2E route close: proof exception -> rejection -> corrected proof -> collection match -> approval", async () => {
  const ctx = await getTestContext();
  const customerId = await getCustomerId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const routeCode = `E2E-${ctx.userId.slice(0, 8)}-${Date.now()}`;
  const routeDateResult = await pool.query("SELECT CURRENT_DATE::text AS route_date");
  const routeDate = routeDateResult.rows[0].route_date;
  const suffix = Date.now();
  const driverRole = await pool.query(
    `INSERT INTO erp_roles (company_id, name, description, is_system)
     VALUES ($1, $2, 'E2E route delivery driver', FALSE)
     ON CONFLICT (company_id, name) DO UPDATE SET is_deleted = FALSE, updated_at = NOW()
     RETURNING id`,
    [ctx.companyId, `E2E Driver ${suffix}`],
  );
  const driver = await pool.query(
    `INSERT INTO erp_users (company_id, default_branch_id, role_id, username, email, full_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING id`,
    [ctx.companyId, ctx.branchId, driverRole.rows[0].id, `e2edriver${suffix}`, `e2edriver${suffix}@example.test`, `E2E Driver ${suffix}`],
  );
  const driverId = driver.rows[0].id;
  const vehicle = await pool.query(
    `INSERT INTO erp_warehouses (
       company_id, code, name, location_type, vehicle_registration,
       assigned_driver_user_id, is_active, created_by
     ) VALUES ($1, $2, $3, 'vehicle', $4, $5, TRUE, $6)
     RETURNING id`,
    [ctx.companyId, `E2E-${suffix}`, `E2E vehicle ${suffix}`, `E2E-${suffix}`, driverId, ctx.userId],
  );

  const order = await sales.createSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    warehouseId: ctx.warehouseId,
    requiredDate: routeDate,
    lines: [{ item_id: itemId, quantity: 2, unit_price: 70 }],
  });
  const confirmed = await sales.confirmSalesOrder({
    companyId: ctx.companyId,
    userId: ctx.userId,
    orderId: order.id,
  });
  assert.equal(confirmed.ok, true);

  const orderLine = await pool.query(
    "SELECT id FROM erp_sales_order_lines WHERE sales_order_id = $1 LIMIT 1",
    [order.id],
  );
  const delivery = await sales.createAndPostDelivery({
    companyId: ctx.companyId,
    userId: ctx.userId,
    salesOrderId: order.id,
    warehouseId: ctx.warehouseId,
    deliveryDate: routeDate,
    lines: [{ so_line_id: orderLine.rows[0].id, item_id: itemId, quantity: 2 }],
  });
  assert.equal(delivery.ok, true);

  const deliveryLine = await pool.query(
    "SELECT id FROM erp_delivery_note_lines WHERE delivery_note_id = $1 LIMIT 1",
    [delivery.delivery_id],
  );
  const proofLines = [{
    delivery_line_id: deliveryLine.rows[0].id,
    delivered_quantity: 2,
    short_quantity: 0,
    damaged_quantity: 0,
    customer_accepted_quantity: 2,
  }];

  await sales.recordDeliveryProof({
    companyId: ctx.companyId,
    userId: ctx.userId,
    user: { id: ctx.userId, role_name: "System Administrator" },
    deliveryId: delivery.delivery_id,
    routeCode,
    driverUserId: driverId,
    vehicleWarehouseId: vehicle.rows[0].id,
    customerConfirmed: false,
  });
  await sales.recordDeliveryProof({
    companyId: ctx.companyId,
    userId: driverId,
    user: { id: driverId, role_name: "Driver" },
    deliveryId: delivery.delivery_id,
    customerConfirmed: false,
    vehicleWarehouseId: vehicle.rows[0].id,
    deliveredAt: `${routeDate}T12:00:00.000Z`,
    lines: proofLines,
  });

  const invoice = await sales.createCustomerInvoice({
    companyId: ctx.companyId,
    userId: ctx.userId,
    customerId,
    salesOrderId: order.id,
    deliveryNoteId: delivery.delivery_id,
    lines: [{ item_id: itemId, quantity: 2, unit_price: 70, so_line_id: orderLine.rows[0].id }],
  });
  assert.equal(invoice.ok, true);

  const invoiceResult = await pool.query(
    "SELECT id, total_amount FROM erp_customer_invoices WHERE id = $1",
    [invoice.invoice_id],
  );
  const invoiceTotal = Number(invoiceResult.rows[0].total_amount);
  await sales.recordCustomerPayment({
    companyId: ctx.companyId,
    userId: ctx.userId,
    invoiceId: invoice.invoice_id,
    paymentDate: routeDate,
    amount: invoiceTotal,
    referenceNo: routeCode,
  });

  const submitted = await sales.submitRouteClosure({
    companyId: ctx.companyId,
    user: { id: ctx.userId },
    routeCode,
    routeDate,
    driverUserId: driverId,
    declaredCollection: invoiceTotal,
  });
  assert.equal(Number(submitted.proof_pending_count), 1);
  assert.equal(Number(submitted.collection_variance), 0);
  await assert.rejects(
    () => sales.reviewRouteClosure({
      companyId: ctx.companyId,
      closureId: submitted.id,
      decision: "approve",
      user: { id: ctx.userId },
    }),
    /Resolve pending customer proof/,
  );

  const rejected = await sales.reviewRouteClosure({
    companyId: ctx.companyId,
    closureId: submitted.id,
    decision: "reject",
    note: "Confirm customer delivery proof",
    user: { id: ctx.userId },
  });
  assert.equal(rejected.status, "rejected");

  await sales.recordDeliveryProof({
    companyId: ctx.companyId,
    userId: driverId,
    user: { id: driverId, role_name: "Driver" },
    deliveryId: delivery.delivery_id,
    customerConfirmed: true,
    vehicleWarehouseId: vehicle.rows[0].id,
    deliveredAt: `${routeDate}T12:00:00.000Z`,
    lines: proofLines,
  });
  const resubmitted = await sales.submitRouteClosure({
    companyId: ctx.companyId,
    user: { id: ctx.userId },
    routeCode,
    routeDate,
    driverUserId: driverId,
    declaredCollection: invoiceTotal,
  });
  assert.equal(resubmitted.status, "submitted");
  assert.equal(Number(resubmitted.proof_pending_count), 0);
  assert.equal(Number(resubmitted.matched_collection), invoiceTotal);

  const approved = await sales.reviewRouteClosure({
    companyId: ctx.companyId,
    closureId: resubmitted.id,
    decision: "approve",
    user: { id: ctx.userId },
  });
  assert.equal(approved.status, "approved");
  await assert.rejects(
    () => sales.recordDeliveryProof({
      companyId: ctx.companyId,
      userId: driverId,
      user: { id: driverId, role_name: "Driver" },
      deliveryId: delivery.delivery_id,
      customerConfirmed: false,
      vehicleWarehouseId: vehicle.rows[0].id,
      lines: proofLines,
    }),
    /approved route closure cannot be changed/,
  );
});
