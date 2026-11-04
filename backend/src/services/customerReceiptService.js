const crypto = require("crypto");
const pool = require("../db");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");
const { logAudit, assertDifferentUser } = require("./auditService");
const { nextDocumentNo } = require("./documentNumberingService");

function normalizeAllocations(invoiceId, allocations, amount) {
  const values = Array.isArray(allocations) && allocations.length
    ? allocations.map((allocation) => ({ invoiceId: String(allocation.invoice_id || allocation.invoiceId || ""), amount: Number(allocation.amount) }))
    : (invoiceId ? [{ invoiceId: String(invoiceId), amount: Number(amount) }] : []);
  if (values.some((value) => !value.invoiceId || !Number.isFinite(value.amount) || value.amount <= 0)) {
    throw new Error("Receipt allocations need an invoice and a positive amount");
  }
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value.invoiceId)) throw new Error("Use one allocation per invoice");
    seen.add(value.invoiceId);
  }
  if (values.reduce((sum, value) => sum + value.amount, 0) - Number(amount) > 0.0001) {
    throw new Error("Receipt allocations exceed the receipt amount");
  }
  return values.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
}

function receiptRequestHash({ customerId, amount, paymentMethod, referenceNo, paymentDate, allocations, tillSessionId }) {
  const payload = JSON.stringify({ customerId, amount: Number(amount), paymentMethod, referenceNo: referenceNo || null,
    paymentDate: paymentDate || null, allocations, tillSessionId: tillSessionId || null });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function nextReceiptNo(client, companyId) {
  return nextDocumentNo(client, { companyId, docType: "erp_customer_receipts", prefix: "RCP" });
}

async function applyReceiptAllocations(client, { companyId, customerId, allocations, userId }) {
  for (const allocation of allocations) {
    const invoiceResult = await client.query(
      `SELECT id,invoice_no,total_amount,amount_paid,credited_amount,status FROM erp_customer_invoices
       WHERE id=$1 AND company_id=$2 AND customer_id=$3 AND is_deleted=FALSE FOR UPDATE`,
      [allocation.invoiceId, companyId, customerId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || !["posted","partial","overdue"].includes(invoice.status)) throw new Error("An allocation invoice is not an open invoice for this customer");
    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0) - Number(invoice.credited_amount || 0);
    if (Number(allocation.amount) - outstanding > 0.0001) throw new Error(`Allocation exceeds the open balance on invoice ${invoice.invoice_no}`);
    const newPaid = Number(invoice.amount_paid || 0) + Number(allocation.amount);
    const status = newPaid + Number(invoice.credited_amount || 0) >= Number(invoice.total_amount) - 0.0001
      ? "paid" : "partial";
    await client.query("UPDATE erp_customer_invoices SET amount_paid=$3,status=$4,updated_at=NOW(),updated_by=$5 WHERE id=$1 AND company_id=$2",
      [invoice.id, companyId, newPaid, status, userId]);
  }
}

async function postReceipt(client, { companyId, userId, receipt, method }) {
  const ar = await client.query(
    `SELECT id FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=$2
       AND is_active=TRUE AND is_postable=TRUE AND is_deleted=FALSE`, [companyId, ACCOUNT_CODES.accountsReceivable],
  );
  if (!ar.rowCount || !method.account_id) throw new Error("Mapped payment and accounts receivable accounts must be active and postable");
  const allocations = await client.query(
    "SELECT invoice_id,amount FROM erp_receipt_allocations WHERE company_id=$1 AND receipt_id=$2 ORDER BY invoice_id",
    [companyId, receipt.id],
  );
  await applyReceiptAllocations(client, { companyId, customerId: receipt.customer_id,
    allocations: allocations.rows.map((row) => ({ invoiceId: row.invoice_id, amount: Number(row.amount) })), userId });
  const allocationTotal = allocations.rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const unapplied = Math.max(0, Number(receipt.amount) - allocationTotal);
  const journal = await gl.createJournalInTransaction(client, {
    companyId, userId, entryDate: receipt.receipt_date, journalType: "receipt", source: "module",
    referenceNo: receipt.receipt_no, description: `Customer receipt ${receipt.receipt_no} (${method.method_code})`,
    lines: [
      { account_id: method.account_id, debit: Number(receipt.amount), credit: 0, description: `Receipt by ${method.display_name}` },
      { account_id: ar.rows[0].id, debit: 0, credit: Number(receipt.amount), description: "Customer accounts receivable" },
    ],
  });
  await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
  await client.query(
    `UPDATE erp_customer_receipts SET status='posted',journal_id=$2,unapplied_amount=$3,
       clearing_status=CASE WHEN payment_method='cheque' THEN 'in_transit' ELSE 'not_applicable' END,
       updated_at=NOW(),updated_by=$4 WHERE id=$1 AND company_id=$5`,
    [receipt.id, journal.id, unapplied, userId, companyId],
  );
  return { journalId: journal.id, unappliedAmount: unapplied };
}

async function createCustomerReceipt({
  companyId, userId, customerId = null, invoiceId = null, allocations = [], amount, paymentMethod,
  referenceNo = null, providerReceiptNo = null, paymentDate = null, notes = null,
  idempotencyKey = null, tillSessionId = null,
}) {
  const paymentAmount = Number(amount);
  const methodCode = String(paymentMethod || "").toLowerCase();
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error("Receipt amount must be greater than zero");
  if (!["cash","mpesa","bank_transfer","cheque","card"].includes(methodCode)) throw new Error("Choose a supported payment method");
  const clientAllocations = normalizeAllocations(invoiceId, allocations, paymentAmount);
  const hash = receiptRequestHash({ customerId, amount: paymentAmount, paymentMethod: methodCode,
    referenceNo, paymentDate, allocations: clientAllocations, tillSessionId });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (idempotencyKey) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [companyId, `receipt-idempotency:${idempotencyKey}`]);
      const previous = await client.query(
        `SELECT id,receipt_no,amount,status,journal_id,request_hash FROM erp_customer_receipts
         WHERE company_id=$1 AND idempotency_key=$2 AND is_deleted=FALSE FOR UPDATE`, [companyId, idempotencyKey],
      );
      if (previous.rowCount) {
        if (previous.rows[0].request_hash !== hash) throw new Error("Idempotency-Key was already used for a different receipt request");
        await client.query("COMMIT");
        return { ok: true, receipt_id: previous.rows[0].id, payment_no: previous.rows[0].receipt_no,
          status: previous.rows[0].status, journal_id: previous.rows[0].journal_id, idempotent: true };
      }
    }
    if (!customerId && clientAllocations.length) {
      const customer = await client.query("SELECT customer_id FROM erp_customer_invoices WHERE id=$1 AND company_id=$2", [clientAllocations[0].invoiceId, companyId]);
      customerId = customer.rows[0]?.customer_id;
    }
    if (!customerId) throw new Error("A customer is required for a payment on account");
    const customerCheck = await client.query("SELECT id FROM erp_customers WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE FOR SHARE", [customerId, companyId]);
    if (!customerCheck.rowCount) throw new Error("Choose an active customer in this company");
    const methodResult = await client.query(
      `SELECT method.id,method.method_code,method.display_name,method.account_id,account.account_code
       FROM erp_payment_methods method JOIN erp_chart_of_accounts account ON account.id=method.account_id AND account.company_id=method.company_id
       WHERE method.company_id=$1 AND method.method_code=$2 AND method.is_active=TRUE AND method.is_deleted=FALSE
         AND account.is_active=TRUE AND account.is_postable=TRUE AND account.is_deleted=FALSE`, [companyId, methodCode],
    );
    const method = methodResult.rows[0];
    if (!method) throw new Error("The payment method has no active mapped ledger account");
    if (methodCode === "cash") {
      const till = await client.query(
        `SELECT id FROM erp_pos_till_sessions WHERE company_id=$1 AND cashier_user_id=$2 AND status='open'
          AND ($3::uuid IS NULL OR id=$3) FOR UPDATE`, [companyId, userId, tillSessionId],
      );
      if (!till.rowCount) throw new Error("Cash receipts require this cashier's open till session");
      tillSessionId = till.rows[0].id;
    }
    const settings = await client.query(
      `SELECT setting_value FROM erp_system_settings WHERE company_id=$1 AND category='sales'
       AND setting_key='receipt_approval_threshold' AND is_deleted=FALSE`, [companyId],
    );
    const thresholdValue = Number(settings.rows[0]?.setting_value ?? 100000);
    const threshold = Number.isFinite(thresholdValue) && thresholdValue >= 0 ? thresholdValue : 100000;
    const pending = paymentAmount > threshold;
    const receiptNo = await nextReceiptNo(client, companyId);
    const inserted = await client.query(
      `INSERT INTO erp_customer_receipts
       (company_id,customer_id,receipt_no,receipt_date,amount,payment_method,provider_receipt_no,reference_no,
        status,unapplied_amount,idempotency_key,request_hash,clearing_status,till_session_id,notes,created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [companyId, customerId, receiptNo, paymentDate, paymentAmount, methodCode, providerReceiptNo, referenceNo,
        pending ? "pending_approval" : "draft", 0, idempotencyKey, hash, methodCode === "cheque" ? "in_transit" : "not_applicable",
        tillSessionId, notes, userId],
    );
    const receipt = inserted.rows[0];
    for (const allocation of clientAllocations) {
      await client.query("INSERT INTO erp_receipt_allocations (company_id,receipt_id,invoice_id,amount,created_by) VALUES ($1,$2,$3,$4,$5)",
        [companyId, receipt.id, allocation.invoiceId, allocation.amount, userId]);
    }
    let posted = null;
    if (!pending) posted = await postReceipt(client, { companyId, userId, receipt, method });
    await logAudit({ client, companyId, userId, entityType: "erp_customer_receipts", entityId: receipt.id,
      action: pending ? "customer_receipt_pending_approval" : "customer_receipt_posted",
      newValues: { receipt_no: receiptNo, payment_method: methodCode, amount: paymentAmount,
        allocation_count: clientAllocations.length, unapplied_amount: posted?.unappliedAmount ?? 0 } });
    await client.query("COMMIT");
    return { ok: true, receipt_id: receipt.id, payment_no: receiptNo,
      status: pending ? "pending_approval" : "posted", journal_id: posted?.journalId || null,
      unapplied_amount: posted?.unappliedAmount ?? 0, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505" && /erp_customer_receipts_reference_uq|erp_customer_receipts_provider_receipt_no_uq|erp_customer_receipts_mpesa_provider_receipt_uidx/.test(error.constraint || "")) {
      throw new Error("This payment reference has already been recorded");
    }
    throw error;
  } finally { client.release(); }
}

async function approveCustomerReceipt({ companyId, userId, receiptId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM erp_customer_receipts WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE", [receiptId, companyId]);
    const receipt = result.rows[0];
    if (!receipt || receipt.status !== "pending_approval") throw new Error("Receipt is not awaiting approval");
    assertDifferentUser(receipt.created_by, userId);
    const methodResult = await client.query("SELECT id,method_code,display_name,account_id FROM erp_payment_methods WHERE company_id=$1 AND method_code=$2 AND is_active=TRUE AND is_deleted=FALSE", [companyId, receipt.payment_method]);
    if (!methodResult.rowCount) throw new Error("Receipt payment method is unavailable");
    const posted = await postReceipt(client, { companyId, userId, receipt, method: methodResult.rows[0] });
    await client.query("UPDATE erp_customer_receipts SET approved_by=$3,approved_at=NOW(),updated_by=$3 WHERE id=$1 AND company_id=$2", [receiptId, companyId, userId]);
    await logAudit({ client, companyId, userId, entityType: "erp_customer_receipts", entityId: receiptId,
      action: "customer_receipt_approved", newValues: { journal_id: posted.journalId } });
    await client.query("COMMIT");
    return { ok: true, receipt_id: receiptId, status: "posted", journal_id: posted.journalId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function allocateCustomerReceipt({ companyId, userId, receiptId, allocations }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM erp_customer_receipts WHERE id=$1 AND company_id=$2 AND status='posted' AND is_deleted=FALSE FOR UPDATE", [receiptId, companyId]);
    const receipt = result.rows[0];
    if (!receipt) throw new Error("Posted receipt not found");
    const available = Number(receipt.unapplied_amount || 0);
    if (available <= 0) throw new Error("Receipt has no unapplied balance");
    const normalized = normalizeAllocations(null, allocations, available);
    const allocationTotal = normalized.reduce((sum, allocation) => sum + allocation.amount, 0);
    for (const allocation of normalized) {
      await client.query("INSERT INTO erp_receipt_allocations (company_id,receipt_id,invoice_id,amount,created_by) VALUES ($1,$2,$3,$4,$5)",
        [companyId, receiptId, allocation.invoiceId, allocation.amount, userId]);
    }
    await applyReceiptAllocations(client, { companyId, customerId: receipt.customer_id, allocations: normalized, userId });
    const newUnapplied = available - allocationTotal;
    await client.query("UPDATE erp_customer_receipts SET unapplied_amount=$3,updated_at=NOW(),updated_by=$4 WHERE id=$1 AND company_id=$2", [receiptId, companyId, newUnapplied, userId]);
    await logAudit({ client, companyId, userId, entityType: "erp_customer_receipts", entityId: receiptId,
      action: "customer_receipt_allocated", newValues: { allocations: normalized, unapplied_amount: newUnapplied } });
    await client.query("COMMIT");
    return { ok: true, receipt_id: receiptId, unapplied_amount: newUnapplied };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function openTillSession({ companyId, userId, openingFloat = 0 }) {
  const amount = Number(openingFloat);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Opening float must be a non-negative amount");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query("SELECT id FROM erp_pos_till_sessions WHERE company_id=$1 AND cashier_user_id=$2 AND status='open' FOR UPDATE", [companyId, userId]);
    if (existing.rowCount) throw new Error("This cashier already has an open till session");
    const session = await client.query("INSERT INTO erp_pos_till_sessions (company_id,cashier_user_id,opening_float,created_by) VALUES ($1,$2,$3,$2) RETURNING *", [companyId, userId, amount]);
    await logAudit({ client, companyId, userId, entityType: "erp_pos_till_sessions", entityId: session.rows[0].id,
      action: "pos_till_opened", newValues: { opening_float: amount } });
    await client.query("COMMIT");
    return session.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function closeTillSession({ companyId, userId, sessionId, countedCash }) {
  const counted = Number(countedCash);
  if (!Number.isFinite(counted) || counted < 0) throw new Error("Counted cash must be a non-negative amount");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM erp_pos_till_sessions WHERE id=$1 AND company_id=$2 AND cashier_user_id=$3 AND status='open' FOR UPDATE", [sessionId, companyId, userId]);
    const session = result.rows[0];
    if (!session) throw new Error("Open till session not found for this cashier");
    const pending = await client.query("SELECT COUNT(*)::int AS count FROM erp_customer_receipts WHERE till_session_id=$1 AND status='pending_approval' AND is_deleted=FALSE", [sessionId]);
    if (Number(pending.rows[0].count)) throw new Error("Approve or cancel pending cash receipts before closing the till");
    const receipts = await client.query("SELECT COALESCE(SUM(amount),0) AS amount FROM erp_customer_receipts WHERE till_session_id=$1 AND payment_method='cash' AND status='posted' AND is_deleted=FALSE", [sessionId]);
    const expected = Number(session.opening_float) + Number(receipts.rows[0].amount || 0);
    const variance = counted - expected;
    let journalId = null;
    if (Math.abs(variance) >= 0.005) {
      const accounts = await client.query("SELECT id,account_code FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=ANY($2::text[]) AND is_active=TRUE AND is_postable=TRUE AND is_deleted=FALSE", [companyId, ["1110","5300"]]);
      const byCode = Object.fromEntries(accounts.rows.map((row) => [row.account_code,row.id]));
      if (!byCode["1110"] || !byCode["5300"]) throw new Error("Cash on hand and cash over/short accounts are required");
      const amount = Math.abs(variance);
      const lines = variance > 0
        ? [{ account_id: byCode["1110"], debit: amount, credit: 0 }, { account_id: byCode["5300"], debit: 0, credit: amount }]
        : [{ account_id: byCode["5300"], debit: amount, credit: 0 }, { account_id: byCode["1110"], debit: 0, credit: amount }];
      const journal = await gl.createJournalInTransaction(client, { companyId, userId, journalType: "adjustment", source: "module",
        referenceNo: `TILL-${session.id}`, description: "POS till cash over/short", lines });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;
    }
    const closed = await client.query("UPDATE erp_pos_till_sessions SET status='closed',closed_at=NOW(),expected_cash=$3,counted_cash=$4,variance=$5,closing_journal_id=$6,updated_at=NOW(),updated_by=$7 WHERE id=$1 AND company_id=$2 RETURNING *", [sessionId, companyId, expected, counted, variance, journalId, userId]);
    await logAudit({ client, companyId, userId, entityType: "erp_pos_till_sessions", entityId: sessionId,
      action: "pos_till_closed", newValues: { expected_cash: expected, counted_cash: counted, variance, journal_id: journalId } });
    await client.query("COMMIT");
    return closed.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function clearCheque({ companyId, userId, receiptId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM erp_customer_receipts WHERE id=$1 AND company_id=$2 AND payment_method='cheque' AND status='posted' AND clearing_status='in_transit' FOR UPDATE", [receiptId, companyId]);
    const receipt = result.rows[0];
    if (!receipt) throw new Error("Cheque receipt is not awaiting clearance");
    const accounts = await client.query("SELECT id,account_code FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=ANY($2::text[]) AND is_active=TRUE AND is_postable=TRUE AND is_deleted=FALSE", [companyId, ["1100","1130"]]);
    const byCode = Object.fromEntries(accounts.rows.map((row) => [row.account_code,row.id]));
    if (!byCode["1100"] || !byCode["1130"]) throw new Error("Bank and cheques in transit accounts are unavailable");
    const journal = await gl.createJournalInTransaction(client, { companyId, userId, journalType: "receipt", source: "module",
      referenceNo: receipt.receipt_no, description: `Clear cheque ${receipt.receipt_no}`,
      lines: [{ account_id: byCode["1100"], debit: receipt.amount, credit: 0 }, { account_id: byCode["1130"], debit: 0, credit: receipt.amount }] });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    await client.query("UPDATE erp_customer_receipts SET clearing_status='cleared',updated_at=NOW(),updated_by=$3 WHERE id=$1 AND company_id=$2", [receiptId, companyId, userId]);
    await logAudit({ client, companyId, userId, entityType: "erp_customer_receipts", entityId: receiptId,
      action: "customer_cheque_cleared", newValues: { journal_id: journal.id } });
    await client.query("COMMIT");
    return { ok: true, receipt_id: receiptId, clearing_status: "cleared", journal_id: journal.id };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function getCustomerStatement({ companyId, customerId, fromDate = null, toDate = null }) {
  const customer = await pool.query("SELECT id,customer_code,name FROM erp_customers WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE", [customerId, companyId]);
  if (!customer.rowCount) throw new Error("Customer not found");
  const from = fromDate || "0001-01-01";
  const to = toDate || new Date().toISOString().slice(0,10);
  const events = await pool.query(
    `SELECT invoice_date AS event_date,invoice_no AS reference,'invoice'::text AS event_type,
            total_amount AS debit,0::numeric AS credit
       FROM erp_customer_invoices WHERE company_id=$1 AND customer_id=$2 AND status IN ('posted','partial','overdue','paid') AND is_deleted=FALSE
     UNION ALL
     SELECT credit_date,credit_note_no,'credit_note',0::numeric,total_amount
       FROM erp_customer_credit_notes WHERE company_id=$1 AND customer_id=$2 AND status='posted'
     UNION ALL
     SELECT receipt_date,receipt_no,'receipt',0::numeric,amount
       FROM erp_customer_receipts WHERE company_id=$1 AND customer_id=$2 AND status='posted' AND is_deleted=FALSE`,
    [companyId, customerId],
  );
  const dateKey = (value) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
  const ordered = events.rows.sort((a,b) => dateKey(a.event_date).localeCompare(dateKey(b.event_date)) || String(a.reference).localeCompare(String(b.reference)));
  let opening = 0;
  const visible = [];
  for (const event of ordered) {
    const value = Number(event.debit) - Number(event.credit);
    if (dateKey(event.event_date) < from) opening += value;
    else if (dateKey(event.event_date) <= to) visible.push({ ...event, event_date: dateKey(event.event_date), debit: Number(event.debit), credit: Number(event.credit), amount: value });
  }
  let balance = opening;
  const transactions = visible.map((event) => ({ ...event, balance: (balance += event.amount) }));
  return { customer: customer.rows[0], from, to, opening_balance: opening, transactions,
    closing_balance: balance };
}

module.exports = { createCustomerReceipt, approveCustomerReceipt, allocateCustomerReceipt, openTillSession, closeTillSession, clearCheque, getCustomerStatement };
