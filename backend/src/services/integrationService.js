const pool = require("../db");
const { normalizeKraPin } = require("../lib/kraPin");
const { lineMoney, sumMoney } = require("../lib/money");

function maskPhone(value) {
  const text = String(value);
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return "[REDACTED]";
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(3, digits.length - 7))}${digits.slice(-4)}`;
}

async function runEtimsCreditNoteBatch({ adapter, companyId = null, limit = 20, maxAttempts = 8 } = {}) {
  if (!adapter || typeof adapter.submitCreditNote !== "function") {
    return { configured: false, processed: 0, accepted: 0, retrying: 0, rejected: 0, failed: 0 };
  }
  const client = await pool.connect();
  let submissions;
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH due AS (
         SELECT id FROM erp_etims_credit_note_submissions
         WHERE ((status IN ('pending','retry') AND next_attempt_at <= NOW())
           OR (status='processing' AND updated_at < NOW()-INTERVAL '5 minutes'))
           AND ($2::uuid IS NULL OR company_id=$2)
         ORDER BY next_attempt_at,queued_at FOR UPDATE SKIP LOCKED LIMIT $1
       ) UPDATE erp_etims_credit_note_submissions submission
         SET status='processing',attempt_count=attempt_count+1,updated_at=NOW()
         FROM due WHERE submission.id=due.id RETURNING submission.*`,
      [Math.max(1, Math.min(100, Number(limit) || 20)), companyId],
    );
    submissions = claimed.rows;
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const summary = { configured: true, processed: submissions.length, accepted: 0, retrying: 0, rejected: 0, failed: 0 };
  for (const submission of submissions) {
    try {
      if (submission.attempt_count > 1) {
        if (typeof adapter.lookupInvoiceStatus !== "function") {
          throw Object.assign(new Error("Credit-note retry blocked: provider status lookup is unavailable"), { terminal: true });
        }
        const status = await adapter.lookupInvoiceStatus({ payload: submission.payload, idempotencyKey: submission.idempotency_key });
        if (status?.status === "accepted") {
          const reference = String(status.provider_reference || status.reference || "").trim();
          if (!reference) throw Object.assign(new Error("KRA accepted the credit note without a provider reference"), { terminal: true });
          await finishEtimsCreditNote(submission, { status: "accepted", response: status, providerReference: reference });
          summary.accepted += 1;
          continue;
        }
        if (status?.status === "pending") {
          await finishEtimsCreditNote(submission, { status: "retry", response: status,
            error: status.message || "KRA credit-note status is still pending", retryDelaySeconds: 300 });
          summary.retrying += 1;
          continue;
        }
        if (status?.status !== "not_found") {
          throw Object.assign(new Error("Credit-note retry blocked: KRA status is ambiguous"), { terminal: true });
        }
      }
      const response = await adapter.submitCreditNote({ companyId: submission.company_id, payload: submission.payload, idempotencyKey: submission.idempotency_key });
      if (response?.accepted === true) {
        const reference = String(response.provider_reference || response.reference || "").trim();
        if (!reference) throw new Error("Provider reported credit-note acceptance without a KRA reference");
        await finishEtimsCreditNote(submission, { status: "accepted", response, providerReference: reference });
        summary.accepted += 1;
      } else {
        const rejected = response?.retryable !== true;
        const terminal = rejected || submission.attempt_count >= maxAttempts;
        await finishEtimsCreditNote(submission, { status: rejected ? "rejected" : terminal ? "failed" : "retry",
          response, error: response?.message || "KRA did not accept the credit note",
          retryDelaySeconds: terminal ? null : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400) });
        summary[rejected ? "rejected" : terminal ? "failed" : "retrying"] += 1;
      }
    } catch (error) {
      const terminal = error.terminal === true || submission.attempt_count >= maxAttempts;
      await finishEtimsCreditNote(submission, { status: terminal ? "failed" : "retry",
        error: String(error.message || "eTIMS credit-note request failed").slice(0, 2000),
        retryDelaySeconds: terminal ? null : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400) });
      summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

async function finishEtimsCreditNote(submission, { status, response = {}, providerReference = null, error = null, retryDelaySeconds = null }) {
  await pool.query(
    `UPDATE erp_etims_credit_note_submissions SET status=$3,response_payload=$4::jsonb,
       provider_reference=COALESCE($5,provider_reference),last_error=$6,
       next_attempt_at=CASE WHEN $7::int IS NULL THEN next_attempt_at ELSE NOW()+($7::int*INTERVAL '1 second') END,
       accepted_at=CASE WHEN $3='accepted' THEN NOW() ELSE accepted_at END,updated_at=NOW()
     WHERE id=$1 AND company_id=$2 AND status='processing'`,
    [submission.id, submission.company_id, status, JSON.stringify(response || {}), providerReference,
      error ? String(error).slice(0, 2000) : null, retryDelaySeconds],
  );
  const noteStatus = status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : status === "failed" ? "failed" : "pending";
  await pool.query(
    `UPDATE erp_customer_credit_notes SET etims_status=$3,
       etims_provider_reference=COALESCE($4,etims_provider_reference),updated_at=NOW()
     WHERE id=$1 AND company_id=$2`,
    [submission.credit_note_id, submission.company_id, noteStatus, providerReference],
  );
}

function redactIntegrationPayload(value, key = "") {
  if (/secret|pass(key|word)|credential|token|cmcKey|key$|^(tin|kraPin|taxpayerPin)$/i.test(key)) return "[REDACTED]";
  if (/phone|msisdn/i.test(key) && value != null) return maskPhone(value);
  if (Array.isArray(value)) return value.map((entry) => redactIntegrationPayload(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    redactIntegrationPayload(childValue, childKey),
  ]));
}

async function logIntegrationInTransaction(client, { companyId, provider, action, request, response, status, durationMs, correlationId, outcome }) {
  const result = await client.query(
    `INSERT INTO erp_integration_logs (
       company_id, provider, action, request_payload, response_payload, status,
       duration_ms, correlation_id, outcome
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [companyId, provider, action, JSON.stringify(redactIntegrationPayload(request || {})),
      JSON.stringify(redactIntegrationPayload(response || {})), status, durationMs ?? null,
      correlationId || null, outcome || status],
  );
  return result.rows[0].id;
}

async function logIntegration({ companyId, provider, action, request, response, status, durationMs, correlationId, outcome }) {
  const result = await pool.query(
    `INSERT INTO erp_integration_logs (
       company_id, provider, action, request_payload, response_payload, status,
       duration_ms, correlation_id, outcome
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
    [companyId, provider, action, JSON.stringify(redactIntegrationPayload(request || {})),
      JSON.stringify(redactIntegrationPayload(response || {})), status, durationMs ?? null,
      correlationId || null, outcome || status],
  );
  return result.rows[0].id;
}

async function allocateEtimsInvoiceNumber(client, companyId) {
  const result = await client.query(
    `INSERT INTO erp_etims_invoice_sequences (company_id,next_invoice_no)
     VALUES ($1,2)
     ON CONFLICT (company_id) DO UPDATE
       SET next_invoice_no=erp_etims_invoice_sequences.next_invoice_no+1,updated_at=NOW()
     RETURNING next_invoice_no-1 AS invoice_no`,
    [companyId],
  );
  return Number(result.rows[0].invoice_no);
}

function paymentCodeFor(method, policy) {
  const explicit = policy?.kra_payment_type_codes?.[method];
  if (explicit) return String(explicit);
  const defaults = { cash: "01", cheque: "04", card: "05", mpesa: "06", credit: "02" };
  return defaults[method] || null;
}

async function resolveEtimsPaymentCode(client, companyId, invoiceId, policy) {
  const receipts = await client.query(
    `SELECT DISTINCT receipt.payment_method,
            SUM(allocation.amount) OVER () AS allocated_total,
            invoice.total_amount
     FROM erp_receipt_allocations allocation
     JOIN erp_customer_receipts receipt ON receipt.id=allocation.receipt_id AND receipt.company_id=allocation.company_id
     JOIN erp_customer_invoices invoice ON invoice.id=allocation.invoice_id AND invoice.company_id=allocation.company_id
     WHERE allocation.company_id=$1 AND allocation.invoice_id=$2 AND receipt.status='posted'
     ORDER BY receipt.payment_method`,
    [companyId, invoiceId],
  );
  const allocatedTotal = Number(receipts.rows[0]?.allocated_total || 0);
  const totalAmount = Number(receipts.rows[0]?.total_amount || 0);
  if (receipts.rows.length > 1 || (allocatedTotal > 0 && allocatedTotal < totalAmount)) {
    const mixed = paymentCodeFor("cash_credit", policy);
    if (!mixed) throw new Error("Configure the KRA payment type for mixed invoice settlements before eTIMS submission");
    return mixed;
  }
  const method = receipts.rows[0]?.payment_method || "credit";
  const code = paymentCodeFor(method, policy);
  if (!code) throw new Error(`Configure a KRA payment type for ${method} before eTIMS submission`);
  const valid = await client.query(
    `SELECT 1 FROM erp_etims_code_lists WHERE company_id=$1 AND code_class='payment_type'
     AND code=$2 AND is_active=TRUE LIMIT 1`, [companyId, code],
  );
  if (!valid.rowCount) throw new Error(`KRA payment type ${code} is not active in the synchronized code list`);
  return code;
}

function buildOfficialEtimsSalesPayload({ invoice, lines, kraInvoiceNo, paymentTypeCode }) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Invoice has no lines to submit to eTIMS");
  const taxTypes = ["A", "B", "C", "D", "E"];
  const byType = Object.fromEntries(taxTypes.map((taxType) => [taxType, { taxable: [], tax: [], rates: new Set() }]));
  const itemList = lines.map((line, index) => {
    const taxType = String(line.etims_tax_type_code || "").trim();
    if (!taxTypes.includes(taxType)) throw new Error(`Item ${line.item_code} has no supported synchronized KRA tax type`);
    if (!line.etims_item_code || !line.etims_item_classification_code || !line.etims_packaging_unit_code
      || !line.etims_quantity_unit_code || !line.etims_item_type_code) {
      throw new Error(`Item ${line.item_code} is missing KRA registration fields`);
    }
    const netAmount = Number(line.line_total);
    const taxAmount = Number(line.tax_amount);
    const grossAmount = lineMoney(line.quantity, line.unit_price);
    const discountAmount = Number(line.discount_amount || 0);
    const expectedNet = sumMoney([grossAmount, -discountAmount]);
    if (Math.round(netAmount * 100) !== Math.round(expectedNet * 100)) {
      throw new Error(`Invoice line ${line.item_code} discount total does not reconcile to the stored line total`);
    }
    byType[taxType].taxable.push(netAmount);
    byType[taxType].tax.push(taxAmount);
    byType[taxType].rates.add(Number(line.tax_rate));
    return {
      itemSeq: index + 1,
      itemClsCd: line.etims_item_classification_code,
      itemCd: line.etims_item_code,
      itemNm: String(line.description || "").slice(0, 200),
      bcd: null,
      pkgUnitCd: line.etims_packaging_unit_code,
      pkg: Number(line.etims_package_quantity || 1),
      qtyUnitCd: line.etims_quantity_unit_code,
      qty: Number(line.quantity),
      prc: Number(line.unit_price),
      splyAmt: grossAmount,
      dcRt: Number(line.discount_percent || 0),
      dcAmt: discountAmount,
      taxTyCd: taxType,
      taxblAmt: netAmount,
      totTaxAmt: taxAmount,
      totAmt: sumMoney([netAmount, taxAmount]),
    };
  });
  const taxable = Object.fromEntries(taxTypes.map((code) => [code, sumMoney(byType[code].taxable)]));
  const taxes = Object.fromEntries(taxTypes.map((code) => [code, sumMoney(byType[code].tax)]));
  const rates = Object.fromEntries(taxTypes.map((code) => {
    if (byType[code].rates.size > 1) throw new Error(`Invoice has conflicting KRA tax rates for tax type ${code}`);
    return [code, byType[code].rates.size ? [...byType[code].rates][0] : 0];
  }));
  if (sumMoney(Object.values(taxable)) !== Number(invoice.subtotal)
    || sumMoney(Object.values(taxes)) !== Number(invoice.tax_amount)
    || sumMoney([invoice.subtotal, invoice.tax_amount]) !== Number(invoice.total_amount)) {
    throw new Error("eTIMS tax totals do not reconcile exactly to the posted invoice and GL amounts");
  }
  const customerPin = normalizeKraPin(invoice.customer_tax_id);
  const confirmedAt = invoice.posted_at ? new Date(invoice.posted_at) : new Date(`${String(invoice.invoice_date).slice(0, 10)}T00:00:00Z`);
  const cfmDt = confirmedAt.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return {
    trdInvcNo: String(invoice.invoice_no),
    invcNo: Number(kraInvoiceNo),
    orgInvcNo: 0,
    custTin: customerPin,
    custNm: String(invoice.customer_name || "").slice(0, 60),
    salesTyCd: "N",
    rcptTyCd: "S",
    pmtTyCd: paymentTypeCode,
    salesSttsCd: "02",
    cfmDt,
    salesDt: String(invoice.invoice_date).slice(0, 10).replace(/-/g, ""),
    stockRlsDt: "",
    cnclReqDt: "",
    cnclDt: "",
    rfdDt: "",
    rfdRsnCd: "",
    totItemCnt: itemList.length,
    ...Object.fromEntries(taxTypes.map((code) => [`taxblAmt${code}`, taxable[code]])),
    ...Object.fromEntries(taxTypes.map((code) => [`taxRt${code}`, rates[code]])),
    ...Object.fromEntries(taxTypes.map((code) => [`taxAmt${code}`, taxes[code]])),
    totTaxblAmt: Number(invoice.subtotal),
    totTaxAmt: Number(invoice.tax_amount),
    totAmt: Number(invoice.total_amount),
    prchrAcptcYn: "N",
    remark: null,
    regrId: "AYAWIN-ERP",
    regrNm: "Ayawin ERP",
    modrId: "AYAWIN-ERP",
    modrNm: "Ayawin ERP",
    itemList,
  };
}

async function enqueueEtimsCreditNoteInTransaction(client, { companyId, userId, noteId, invoice, note, lines }) {
  const config = await require("./integrationSettingsService").getProviderRuntimeConfig({ companyId, provider: "etims" });
  if (config.provider_mode === "disabled") return { queued: false, configured: false, status: "not_submitted" };
  if (invoice.etims_status !== "accepted" || !invoice.etims_kra_invoice_no) {
    throw new Error("KRA eTIMS must have accepted the original invoice before this credit note can be posted");
  }
  const originalSubmission = await client.query(
    `SELECT payload FROM erp_etims_submissions WHERE company_id=$1 AND invoice_id=$2 AND status='accepted'`,
    [companyId, invoice.id],
  );
  const paymentTypeCode = originalSubmission.rows[0]?.payload?.pmtTyCd;
  if (!paymentTypeCode) throw new Error("Original accepted eTIMS invoice has no recorded payment type");
  const reasonCode = String(config.policy.kra_credit_note_reason_code || "");
  const validReason = await client.query(
    `SELECT 1 FROM erp_etims_code_lists WHERE company_id=$1 AND code_class='credit_note_reason'
     AND code=$2 AND is_active=TRUE LIMIT 1`, [companyId, reasonCode],
  );
  if (!validReason.rowCount) throw new Error("Configure a synchronized KRA credit-note reason code before posting this credit note");
  const kraInvoiceNo = await allocateEtimsInvoiceNumber(client, companyId);
  const creditDate = String(note.credit_date).slice(0, 10);
  const invoiceShape = {
    invoice_no: note.credit_note_no,
    invoice_date: note.credit_date,
    posted_at: new Date(`${creditDate}T00:00:00Z`),
    subtotal: Number(note.subtotal),
    discount_amount: 0,
    tax_amount: Number(note.tax_amount),
    total_amount: Number(note.total_amount),
    customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id,
  };
  const mappedLines = lines.map((line) => ({
    ...line,
    discount_percent: Number(line.unit_price) > 0
      ? Math.round((lineMoney(line.quantity, line.unit_price) - Number(line.net_amount)) / lineMoney(line.quantity, line.unit_price) * 10000) / 100
      : 0,
    discount_amount: sumMoney([lineMoney(line.quantity, line.unit_price), -Number(line.net_amount)]),
    line_total: Number(line.net_amount),
    tax_amount: Number(line.tax_amount),
  }));
  const payload = buildOfficialEtimsSalesPayload({
    invoice: invoiceShape,
    lines: mappedLines,
    kraInvoiceNo,
    paymentTypeCode,
  });
  payload.rcptTyCd = "R";
  payload.orgInvcNo = Number(invoice.etims_kra_invoice_no);
  payload.rfdRsnCd = reasonCode;
  payload.rfdDt = payload.cfmDt;
  const idempotencyKey = `etims-credit:${companyId}:${noteId}`;
  const inserted = await client.query(
    `INSERT INTO erp_etims_credit_note_submissions
       (company_id,credit_note_id,original_invoice_id,idempotency_key,status,payload,created_by)
     VALUES ($1,$2,$3,$4,'pending',$5::jsonb,$6)
     ON CONFLICT (company_id,credit_note_id) DO NOTHING RETURNING id`,
    [companyId, noteId, invoice.id, idempotencyKey, JSON.stringify(payload), userId],
  );
  if (!inserted.rowCount) throw new Error("An eTIMS submission already exists for this credit note");
  await client.query(
    `UPDATE erp_customer_credit_notes SET etims_status='pending',etims_kra_invoice_no=$3
     WHERE id=$1 AND company_id=$2`, [noteId, companyId, kraInvoiceNo],
  );
  return { queued: true, configured: true, status: "pending", submission_id: inserted.rows[0].id,
    idempotency_key: idempotencyKey, original_kra_invoice_no: Number(invoice.etims_kra_invoice_no) };
}

async function buildEtimsPayload(client, companyId, invoiceId, kraInvoiceNo, paymentTypeCode) {
  const invoiceResult = await client.query(
    `SELECT inv.id,inv.invoice_no,inv.invoice_date,inv.due_date,inv.currency_code,
            inv.subtotal,inv.discount_amount,inv.tax_amount,inv.total_amount,inv.status,inv.posted_at,
            customer.name AS customer_name,customer.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv JOIN erp_customers customer
       ON customer.id=inv.customer_id AND customer.company_id=inv.company_id
     WHERE inv.id=$1 AND inv.company_id=$2 AND inv.is_deleted=FALSE
       AND inv.status IN ('posted','partial','paid','overdue','credited')`, [invoiceId, companyId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new Error("Only a posted customer invoice can be queued for eTIMS");
  const lines = await client.query(
    `SELECT item.item_code,item.name AS description,item.etims_item_code,
            item.etims_item_classification_code,item.etims_item_type_code,
            item.etims_packaging_unit_code,item.etims_package_quantity,item.etims_quantity_unit_code,
            item.etims_tax_type_code,line.quantity,line.unit_price,line.discount_percent,line.discount_amount,
            line.line_total,line.tax_code,line.tax_treatment,line.tax_rate,line.tax_amount
     FROM erp_customer_invoice_lines line JOIN erp_items item
       ON item.id=line.item_id AND item.company_id=line.company_id
     WHERE line.invoice_id=$1 AND line.company_id=$2 AND line.is_deleted=FALSE ORDER BY line.line_no`,
    [invoiceId, companyId],
  );
  return buildOfficialEtimsSalesPayload({ invoice, lines: lines.rows, kraInvoiceNo, paymentTypeCode });
}

async function buildDisabledEtimsPayload(client, companyId, invoiceId) {
  const invoice = (await client.query(
    `SELECT inv.invoice_no,inv.invoice_date,inv.due_date,inv.currency_code,inv.subtotal,
            inv.tax_amount,inv.total_amount,customer.name AS customer_name,customer.tax_id AS customer_tax_id
     FROM erp_customer_invoices inv
     JOIN erp_customers customer ON customer.id=inv.customer_id AND customer.company_id=inv.company_id
     WHERE inv.id=$1 AND inv.company_id=$2 AND inv.status IN ('posted','partial','paid','overdue','credited')`,
    [invoiceId, companyId],
  )).rows[0];
  if (!invoice) throw new Error("Only a posted customer invoice can be queued for eTIMS");
  const lines = await client.query(
    `SELECT item.item_code,item.name AS description,line.quantity,line.unit_price,line.line_total,
            line.tax_code,line.tax_treatment,line.tax_rate,line.tax_amount
     FROM erp_customer_invoice_lines line JOIN erp_items item ON item.id=line.item_id AND item.company_id=line.company_id
     WHERE line.invoice_id=$1 AND line.company_id=$2 AND line.is_deleted=FALSE ORDER BY line.line_no`,
    [invoiceId, companyId],
  );
  return {
    invoice_no: invoice.invoice_no, invoice_date: String(invoice.invoice_date).slice(0, 10),
    due_date: invoice.due_date ? String(invoice.due_date).slice(0, 10) : null,
    currency_code: invoice.currency_code, customer_name: invoice.customer_name,
    customer_tax_id: invoice.customer_tax_id, subtotal: Number(invoice.subtotal),
    tax_amount: Number(invoice.tax_amount), total_amount: Number(invoice.total_amount),
    lines: lines.rows.map((line) => ({ ...line, quantity: Number(line.quantity), unit_price: Number(line.unit_price),
      line_total: Number(line.line_total), tax_rate: Number(line.tax_rate), tax_amount: Number(line.tax_amount) })),
  };
}

async function enqueueEtimsInvoiceInTransaction(client, { companyId, userId, invoiceId }) {
  if (!invoiceId) throw new Error("invoice_id is required");
  const idempotencyKey = `etims:${companyId}:${invoiceId}`;
  let submission = (await client.query(
    `SELECT * FROM erp_etims_submissions WHERE company_id = $1 AND invoice_id = $2 FOR UPDATE`,
    [companyId, invoiceId],
  )).rows[0];
  if (!submission) {
    const paymentConfig = await require("./integrationSettingsService").getProviderRuntimeConfig({ companyId, provider: "etims" });
    const kraInvoiceNo = paymentConfig.provider_mode === "disabled" ? null : await allocateEtimsInvoiceNumber(client, companyId);
    const paymentTypeCode = paymentConfig.provider_mode === "disabled"
      ? null : await resolveEtimsPaymentCode(client, companyId, invoiceId, paymentConfig.policy);
    const payload = paymentConfig.provider_mode === "disabled"
      ? await buildDisabledEtimsPayload(client, companyId, invoiceId)
      : await buildEtimsPayload(client, companyId, invoiceId, kraInvoiceNo, paymentTypeCode);
    const inserted = await client.query(
      `INSERT INTO erp_etims_submissions (
         company_id, invoice_id, idempotency_key, status, payload, created_by
       ) VALUES ($1,$2,$3,'pending',$4::jsonb,$5)
       ON CONFLICT (company_id, invoice_id) DO NOTHING
       RETURNING *`,
      [companyId, invoiceId, idempotencyKey, JSON.stringify(payload), userId],
    );
    submission = inserted.rows[0] || (await client.query(
      `SELECT * FROM erp_etims_submissions WHERE company_id=$1 AND invoice_id=$2 FOR UPDATE`,
      [companyId, invoiceId],
    )).rows[0];
    if (inserted.rowCount && kraInvoiceNo !== null) {
      await client.query(
        `UPDATE erp_customer_invoices SET etims_kra_invoice_no=$3
         WHERE id=$1 AND company_id=$2`, [invoiceId, companyId, kraInvoiceNo],
      );
    }
  }
  if (!submission) throw new Error("Unable to create or load eTIMS submission");

  if (["retry", "failed"].includes(submission.status)) {
    const requeued = await client.query(
      `UPDATE erp_etims_submissions
       SET status = 'pending', next_attempt_at = NOW(), last_error = NULL,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
        [submission.id, companyId],
    );
    submission = requeued.rows[0];
  }

  const invoiceStatus = submission.status === "accepted"
    ? "accepted"
    : submission.status === "rejected"
      ? "rejected"
      : submission.status === "failed"
        ? "failed"
        : submission.status === "processing"
          ? "processing"
          : "pending";
  await client.query(
    `UPDATE erp_customer_invoices
     SET etims_status = $3, etims_updated_at = NOW(),
         etims_ref = COALESCE($4, etims_ref), updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [invoiceId, companyId, invoiceStatus, submission.provider_reference || null],
  );

  return {
    ok: true,
    queued: ["pending", "retry"].includes(submission.status),
    configured: submission.status === "accepted",
    message: submission.status === "accepted"
      ? "KRA eTIMS acceptance is already recorded for this invoice."
      : submission.status === "rejected"
        ? "KRA eTIMS rejected this invoice; review the provider response and issue a corrected document if required."
        : submission.status === "processing"
          ? "An eTIMS provider submission is already in progress."
          : "Invoice submission is queued. It is not KRA-accepted until a certified eTIMS provider confirms acceptance.",
    submission_id: submission.id,
    invoice_id: invoiceId,
    status: submission.status,
    idempotency_key: submission.idempotency_key,
  };
}

async function queueEtimsInvoice({ companyId, userId, invoiceId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await enqueueEtimsInvoiceInTransaction(client, { companyId, userId, invoiceId });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getEtimsSubmission({ companyId, invoiceId }) {
  const result = await pool.query(
    `SELECT submission.id, submission.invoice_id, submission.status, submission.provider_reference,
            submission.qr_code, submission.attempt_count, submission.next_attempt_at,
            submission.last_error, submission.queued_at, submission.submitted_at, submission.accepted_at,
            inv.invoice_no, inv.etims_status, inv.etims_ref
     FROM erp_etims_submissions submission
     JOIN erp_customer_invoices inv ON inv.id = submission.invoice_id AND inv.company_id = submission.company_id
     WHERE submission.company_id = $1 AND submission.invoice_id = $2`,
    [companyId, invoiceId],
  );
  return result.rows[0] || null;
}

async function getEtimsExceptions({ companyId, limit = 100 }) {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const [invoices,creditNotes,items,events,mpesa] = await Promise.all([
    pool.query(`SELECT 'etims_invoice'::text AS type,submission.id,submission.invoice_id AS source_id,
      inv.invoice_no AS reference,submission.status,submission.attempt_count,submission.next_attempt_at,
      submission.last_error,submission.queued_at AS created_at,
      GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-submission.queued_at))))::int AS age_seconds,
      (submission.status IN ('retry','failed')) AS manually_retryable
      FROM erp_etims_submissions submission JOIN erp_customer_invoices inv
        ON inv.id=submission.invoice_id AND inv.company_id=submission.company_id
      WHERE submission.company_id=$1 AND submission.status IN ('pending','retry','rejected','failed')`,[companyId]),
    pool.query(`SELECT 'etims_credit_note'::text AS type,submission.id,submission.credit_note_id AS source_id,
      note.credit_note_no AS reference,submission.status,submission.attempt_count,submission.next_attempt_at,
      submission.last_error,submission.queued_at AS created_at,
      GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-submission.queued_at))))::int AS age_seconds,
      FALSE AS manually_retryable
      FROM erp_etims_credit_note_submissions submission JOIN erp_customer_credit_notes note
        ON note.id=submission.credit_note_id AND note.company_id=submission.company_id
      WHERE submission.company_id=$1 AND submission.status IN ('pending','retry','rejected','failed')`,[companyId]),
    pool.query(`SELECT 'etims_item'::text AS type,registration.id,registration.item_id AS source_id,
      item.item_code AS reference,registration.status,registration.attempt_count,registration.next_attempt_at,
      registration.last_error,registration.created_at,
      GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-registration.created_at))))::int AS age_seconds,
      FALSE AS manually_retryable
      FROM erp_etims_item_registrations registration JOIN erp_items item
        ON item.id=registration.item_id AND item.company_id=registration.company_id
      WHERE registration.company_id=$1 AND registration.status IN ('pending','failed')`,[companyId]),
    require("./etimsEventService").listEtimsEventExceptions({companyId,limit:boundedLimit}),
    require("./mpesaService").listMpesaExceptions({companyId,limit:boundedLimit}),
  ]);
  const normalizedEvents=events.map(row=>({...row,type:`etims_${row.event_kind}`,reference:`${row.source_type}:${row.source_id}`,manually_retryable:["failed","rejected"].includes(row.status)}));
  return [...invoices.rows,...creditNotes.rows,...items.rows,...normalizedEvents,...mpesa].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).slice(0,boundedLimit);
}

async function retryEtimsEvent({ companyId, eventId, userId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const event = await client.query(
      `SELECT * FROM erp_etims_event_submissions
       WHERE id=$1 AND company_id=$2 AND status IN ('failed','rejected','retry') FOR UPDATE`,
      [eventId,companyId],
    );
    const job=event.rows[0];
    if (!job) throw new Error("Retryable eTIMS event was not found");
    let result;
    if(job.event_kind==="purchase" && job.source_type==="supplier_bill"){
      result=await require("./etimsEventService").queueEtimsPurchaseInTransaction(client,{companyId,userId,billId:job.source_id});
    }else if(job.event_kind==="stock_movement" && job.source_type==="goods_receipt"){
      const source=await client.query(`SELECT gr.received_date,gl.item_id,gl.quantity,gl.unit_cost
        FROM erp_goods_receipts gr JOIN erp_goods_receipt_lines gl ON gl.goods_receipt_id=gr.id AND gl.company_id=gr.company_id
        WHERE gr.id=$1 AND gr.company_id=$2 AND gr.status='posted' AND gl.is_deleted=FALSE ORDER BY gl.line_no`,[job.source_id,companyId]);
      if(!source.rowCount)throw new Error("Posted goods receipt source cannot be rebuilt");
      result=await require("./etimsEventService").queueEtimsStockMovementInTransaction(client,{companyId,userId,sourceType:job.source_type,
        sourceId:job.source_id,eventType:"goods_receipt",occurredDate:source.rows[0].received_date,
        lines:source.rows.map(row=>({item_id:row.item_id,quantity:Number(row.quantity),unit_cost:Number(row.unit_cost)}))});
    }else if(job.event_kind==="stock_movement" && job.source_type==="delivery_note"){
      const source=await client.query(`SELECT delivery.delivery_date,line.item_id,line.quantity,order_line.unit_price
        FROM erp_delivery_notes delivery JOIN erp_delivery_note_lines line ON line.delivery_note_id=delivery.id
        LEFT JOIN erp_sales_order_lines order_line ON order_line.id=line.so_line_id AND order_line.company_id=line.company_id
        WHERE delivery.id=$1 AND delivery.company_id=$2 AND delivery.status='posted' ORDER BY line.line_no`,[job.source_id,companyId]);
      if(!source.rowCount)throw new Error("Posted delivery source cannot be rebuilt");
      result=await require("./etimsEventService").queueEtimsStockMovementInTransaction(client,{companyId,userId,sourceType:job.source_type,
        sourceId:job.source_id,eventType:"sale",occurredDate:source.rows[0].delivery_date,
        lines:source.rows.map(row=>({item_id:row.item_id,quantity:Number(row.quantity),unit_price:Number(row.unit_price||0)}))});
    }else throw new Error("This integration event source cannot yet be remapped for retry");
    if(result?.status==="failed")throw new Error(result.error||"Event payload is still blocked by KRA mapping errors");
    await require("./auditService").logAudit({client,companyId,userId,entityType:"erp_etims_event_submissions",
      entityId:eventId,action:"etims_event_retry_queued",newValues:{event_id:eventId,event_kind:job.event_kind,source_type:job.source_type,source_id:job.source_id}});
    await client.query("COMMIT");
    return {ok:true,event_id:eventId,status:"pending"};
  } catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

async function retryEtimsInvoice({companyId,invoiceId,userId}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const submission=await client.query(`SELECT id,status FROM erp_etims_submissions
      WHERE company_id=$1 AND invoice_id=$2 FOR UPDATE`,[companyId,invoiceId]);
    if(!submission.rowCount||!['retry','failed'].includes(submission.rows[0].status))throw new Error("Invoice submission is not eligible for manual retry");
    const result=await enqueueEtimsInvoiceInTransaction(client,{companyId,userId,invoiceId});
    await require("./auditService").logAudit({client,companyId,userId,entityType:"erp_etims_submissions",
      entityId:submission.rows[0].id,action:"etims_invoice_retry_queued",newValues:{invoice_id:invoiceId,status:"pending"}});
    await client.query("COMMIT");
    return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function updateEtimsAttempt({ submission, status, response, providerReference, qrCode, errorMessage, retryDelaySeconds }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE erp_etims_submissions
       SET status = $3,
           response_payload = $4::jsonb,
           provider_reference = COALESCE($5, provider_reference),
           qr_code = COALESCE($6, qr_code),
           last_error = $7,
           next_attempt_at = CASE WHEN $8::int IS NULL THEN next_attempt_at ELSE NOW() + ($8::int * INTERVAL '1 second') END,
           submitted_at = CASE WHEN $3 IN ('accepted','rejected') THEN NOW() ELSE submitted_at END,
           accepted_at = CASE WHEN $3 = 'accepted' THEN NOW() ELSE accepted_at END,
           updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'processing' AND attempt_count = $9
       RETURNING id, invoice_id, status, provider_reference`,
      [submission.id, submission.company_id, status, JSON.stringify(response || {}),
        providerReference || null, qrCode || null, errorMessage || null,
        retryDelaySeconds ?? null, submission.attempt_count],
    );
    if (!updated.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }

    const invoiceStatus = status === "accepted"
      ? "accepted"
      : status === "rejected"
        ? "rejected"
        : status === "failed"
          ? "failed"
          : "pending";
    await client.query(
      `UPDATE erp_customer_invoices
       SET etims_status = $3, etims_ref = COALESCE($4, etims_ref),
           etims_cu_invoice_no = COALESCE($5, etims_cu_invoice_no),
           etims_receipt_signature = COALESCE($6, etims_receipt_signature),
           etims_internal_data = COALESCE($7, etims_internal_data),
           etims_cu_id = COALESCE($8, etims_cu_id),
           etims_receipt_counter = COALESCE($9, etims_receipt_counter),
           etims_cu_timestamp = CASE WHEN $10::text ~ '^\\d{14}$'
             THEN (to_timestamp($10, 'YYYYMMDDHH24MISS') AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Nairobi'
             ELSE etims_cu_timestamp END,
           etims_verification_data = COALESCE($11, etims_verification_data),
           etims_response_payload = CASE WHEN $12::jsonb IS NULL THEN etims_response_payload ELSE $12::jsonb END,
           etims_updated_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [submission.invoice_id, submission.company_id, invoiceStatus, providerReference || null,
        response?.provider_reference || null, response?.receipt_signature || null,
        response?.internal_data || null, response?.cu_id || null,
        response?.receipt_counter == null ? null : String(response.receipt_counter),
        response?.cu_timestamp || null, response?.qr_code || null,
        response ? JSON.stringify(redactIntegrationPayload(response)) : null],
    );
    await client.query(
      `INSERT INTO erp_integration_logs
       (company_id, provider, action, request_payload, response_payload, status, correlation_id, outcome)
       VALUES ($1,'etims','submit_invoice',$2::jsonb,$3::jsonb,$4,$5,$4)`,
      [submission.company_id,
        JSON.stringify({ invoice_id: submission.invoice_id, idempotency_key: submission.idempotency_key }),
        JSON.stringify(redactIntegrationPayload(response || (errorMessage ? { error: errorMessage } : {}))),
        status, submission.correlation_id],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function claimEtimsSubmissions(limit, { companyId = null, invoiceId = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH due AS (
         SELECT id
         FROM erp_etims_submissions
        WHERE ((status IN ('pending','retry') AND next_attempt_at <= NOW())
          OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'))
        AND ($2::uuid IS NULL OR company_id = $2)
        AND ($3::uuid IS NULL OR invoice_id = $3)
         ORDER BY next_attempt_at, queued_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE erp_etims_submissions submission
       SET status = 'processing', attempt_count = attempt_count + 1, updated_at = NOW()
       FROM due
       WHERE submission.id = due.id
       RETURNING submission.*`,
      [limit, companyId, invoiceId],
    );
    for (const submission of claimed.rows) {
      await client.query(
        `UPDATE erp_customer_invoices SET etims_status = 'processing', etims_updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [submission.invoice_id, submission.company_id],
      );
    }
    await client.query("COMMIT");
    return claimed.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function inspectEtimsRetry(adapter, { payload, idempotencyKey }) {
  if (!adapter || typeof adapter.lookupInvoiceStatus !== "function") {
    return { action: "block", message: "Retry blocked: provider invoice-status lookup is unavailable" };
  }
  const result = await adapter.lookupInvoiceStatus({ payload, idempotencyKey });
  const status = String(result?.status || "").toLowerCase();
  if (status === "not_found") return { action: "submit" };
  if (status === "accepted") return { action: "accepted", response: result };
  if (status === "pending") return { action: "defer", response: result };
  return { action: "block", message: "Retry blocked: provider could not confirm the prior invoice submission status" };
}

async function runEtimsOutboxBatch({ adapter, limit = 20, maxAttempts = 8, companyId = null, invoiceId = null } = {}) {
  if (!adapter || typeof adapter.submitInvoice !== "function") {
    return { configured: false, processed: 0, accepted: 0, rejected: 0, retrying: 0, failed: 0 };
  }
  const batchSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const attemptsLimit = Math.max(1, Number(maxAttempts) || 8);
  const submissions = await claimEtimsSubmissions(batchSize, { companyId, invoiceId });
  const summary = { configured: true, processed: submissions.length, accepted: 0, rejected: 0, retrying: 0, failed: 0 };

  for (const submission of submissions) {
    try {
      if (submission.attempt_count > 1) {
        const reconciliation = await inspectEtimsRetry(adapter, {
          payload: submission.payload,
          idempotencyKey: submission.idempotency_key,
        });
        if (reconciliation.action === "accepted") {
          const providerReference = String(reconciliation.response.provider_reference || reconciliation.response.reference || "").trim();
          const saved = await updateEtimsAttempt({
            submission,
            status: "accepted",
            response: reconciliation.response,
            providerReference,
            qrCode: reconciliation.response.qr_code,
          });
          if (saved) summary.accepted += 1;
          continue;
        }
        if (reconciliation.action === "defer") {
          const retryDelaySeconds = Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400);
          const saved = await updateEtimsAttempt({
            submission,
            status: "retry",
            response: reconciliation.response,
            errorMessage: reconciliation.response?.message || "KRA submission is still pending; it will be checked again before any resend",
            retryDelaySeconds,
          });
          if (saved) summary.retrying += 1;
          continue;
        }
        if (reconciliation.action === "block") {
          const saved = await updateEtimsAttempt({
            submission,
            status: "failed",
            errorMessage: reconciliation.message,
          });
          if (saved) summary.failed += 1;
          continue;
        }
      }
      const response = await adapter.submitInvoice({
        companyId: submission.company_id,
        payload: submission.payload,
        idempotencyKey: submission.idempotency_key,
      });
      if (response?.accepted === true) {
        const providerReference = String(response.provider_reference || response.reference || "").trim();
        if (!providerReference) throw new Error("Provider reported acceptance without a KRA reference");
        const saved = await updateEtimsAttempt({
          submission,
          status: "accepted",
          response,
          providerReference,
          qrCode: response.qr_code,
        });
        if (saved) summary.accepted += 1;
      } else if (response?.retryable === true) {
        const terminal = submission.attempt_count >= attemptsLimit;
        const retryDelaySeconds = terminal
          ? null
          : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400);
        const saved = await updateEtimsAttempt({
          submission,
          status: terminal ? "failed" : "retry",
          response,
          errorMessage: response.message || "Provider requested retry",
          retryDelaySeconds,
        });
        if (saved) summary[terminal ? "failed" : "retrying"] += 1;
      } else {
        const saved = await updateEtimsAttempt({
          submission,
          status: "rejected",
          response,
          errorMessage: response?.message || "Provider rejected invoice",
        });
        if (saved) summary.rejected += 1;
      }
    } catch (error) {
      const terminal = submission.attempt_count >= attemptsLimit;
      const retryDelaySeconds = terminal
        ? null
        : Math.min(60 * (2 ** (submission.attempt_count - 1)), 86400);
      const saved = await updateEtimsAttempt({
        submission,
        status: terminal ? "failed" : "retry",
        errorMessage: String(error.message || "eTIMS provider request failed").slice(0, 2000),
        retryDelaySeconds,
      });
      if (saved) summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

module.exports = {
  logIntegration,
  logIntegrationInTransaction,
  redactIntegrationPayload,
  buildOfficialEtimsSalesPayload,
  enqueueEtimsCreditNoteInTransaction,
  inspectEtimsRetry,
  enqueueEtimsInvoiceInTransaction,
  queueEtimsInvoice,
  getEtimsSubmission,
  getEtimsExceptions,
  retryEtimsEvent,
  retryEtimsInvoice,
  runEtimsCreditNoteBatch,
  runEtimsOutboxBatch,
};
