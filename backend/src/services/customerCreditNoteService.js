const pool = require("../db");
const inventory = require("./inventoryService");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");
const { logAudit } = require("./auditService");

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const dateShape = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

async function nextNo(client, companyId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [companyId, "erp_customer_credit_notes"]);
  const result = await client.query("SELECT COUNT(*)::int AS n FROM erp_customer_credit_notes WHERE company_id = $1", [companyId]);
  return `CN-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(5, "0")}`;
}

async function getSetup(companyId) {
  const [invoices, notes, refundAccounts] = await Promise.all([
    pool.query(
      `SELECT inv.id, inv.invoice_no, inv.invoice_date, inv.due_date, inv.customer_id,
              c.name AS customer_name, inv.currency_code, inv.total_amount, inv.amount_paid,
              inv.credited_amount, inv.delivery_note_id, d.delivery_no,
              GREATEST(inv.total_amount - inv.amount_paid - inv.credited_amount - COALESCE(drafts.amount,0),0) AS creditable_balance
       FROM erp_customer_invoices inv
       JOIN erp_customers c ON c.id = inv.customer_id AND c.company_id = inv.company_id
       JOIN erp_delivery_notes d ON d.id = inv.delivery_note_id AND d.company_id = inv.company_id AND d.status = 'posted'
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(total_amount - refund_amount),0) AS amount FROM erp_customer_credit_notes
         WHERE company_id = inv.company_id AND invoice_id = inv.id AND status = 'draft'
       ) drafts ON TRUE
       WHERE inv.company_id = $1 AND inv.is_deleted = FALSE AND inv.status IN ('posted','partial','overdue','paid','credited')
         AND inv.currency_code = 'KES'
         AND (inv.total_amount - inv.amount_paid - inv.credited_amount - COALESCE(drafts.amount,0) > 0.005
           OR inv.status = 'paid')
       ORDER BY inv.invoice_date DESC, inv.invoice_no`, [companyId],
    ),
    pool.query(
      `SELECT n.*, inv.invoice_no, c.name AS customer_name, j.journal_no,
              creator.full_name AS created_by_name, poster.full_name AS posted_by_name,
              refund_account.account_code AS refund_account_code, refund_account.account_name AS refund_account_name,
              COUNT(l.id)::int AS line_count
       FROM erp_customer_credit_notes n
       JOIN erp_customer_invoices inv ON inv.id = n.invoice_id AND inv.company_id = n.company_id
       JOIN erp_customers c ON c.id = n.customer_id AND c.company_id = n.company_id
       LEFT JOIN erp_journals j ON j.id = n.journal_id AND j.company_id = n.company_id
       LEFT JOIN erp_chart_of_accounts refund_account ON refund_account.id = n.refund_bank_account_id AND refund_account.company_id = n.company_id
       LEFT JOIN erp_users creator ON creator.id = n.created_by
       LEFT JOIN erp_users poster ON poster.id = n.posted_by
       LEFT JOIN erp_customer_credit_note_lines l ON l.credit_note_id = n.id AND l.company_id = n.company_id
       WHERE n.company_id = $1 GROUP BY n.id, inv.id, c.id, j.id, creator.id, poster.id, refund_account.id
       ORDER BY n.created_at DESC LIMIT 300`, [companyId],
    ),
    pool.query(
      `SELECT id, account_code, account_name FROM erp_chart_of_accounts
       WHERE company_id = $1 AND account_type = 'asset' AND account_code LIKE '11%'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE ORDER BY account_code`, [companyId],
    ),
  ]);
  return { invoices: invoices.rows, notes: notes.rows, refundAccounts: refundAccounts.rows };
}

async function getReturnOptions(companyId, invoiceId) {
  const invoiceResult = await pool.query(
    `SELECT inv.*, c.name AS customer_name, d.delivery_no, d.warehouse_id, d.status AS delivery_status
     FROM erp_customer_invoices inv JOIN erp_customers c ON c.id = inv.customer_id AND c.company_id = inv.company_id
     JOIN erp_delivery_notes d ON d.id = inv.delivery_note_id AND d.company_id = inv.company_id
     WHERE inv.id = $1 AND inv.company_id = $2 AND inv.is_deleted = FALSE`, [invoiceId, companyId],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice || invoice.delivery_status !== "posted" || !["posted", "partial", "overdue", "paid", "credited"].includes(invoice.status)) {
    throw new Error("Select an invoice linked to a posted delivery note");
  }
  const linesResult = await pool.query(
    `SELECT il.*, i.item_code, i.name AS item_name, i.lot_tracking_enabled
     FROM erp_customer_invoice_lines il JOIN erp_items i ON i.id = il.item_id AND i.company_id = il.company_id
     WHERE il.company_id = $1 AND il.invoice_id = $2 AND il.is_deleted = FALSE ORDER BY il.line_no`, [companyId, invoiceId],
  );
  const lines = [];
  for (const invoiceLine of linesResult.rows) {
    const deliveryLines = await pool.query(
      `SELECT id, line_no, quantity FROM erp_delivery_note_lines
       WHERE company_id = $1 AND delivery_note_id = $2 AND item_id = $3 AND is_deleted = FALSE ORDER BY line_no`,
      [companyId, invoice.delivery_note_id, invoiceLine.item_id],
    );
    const invoiceReturned = await pool.query(
      `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM erp_customer_credit_note_lines l
       JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
       WHERE l.company_id = $1 AND l.invoice_line_id = $2 AND n.status <> 'cancelled'`, [companyId, invoiceLine.id],
    );
    let invoiceRemaining = Math.max(0, Number(invoiceLine.quantity) - Number(invoiceReturned.rows[0].quantity));
    for (const deliveryLine of deliveryLines.rows) {
      if (invoiceRemaining <= 0.00005) break;
      const priorDeliveryReturns = await pool.query(
        `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM erp_customer_credit_note_lines l
         JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
         WHERE l.company_id = $1 AND l.delivery_note_line_id = $2 AND n.status <> 'cancelled'`,
        [companyId, deliveryLine.id],
      );
      let sourceRemaining = Math.min(invoiceRemaining, Math.max(0, Number(deliveryLine.quantity) - Number(priorDeliveryReturns.rows[0].quantity)));
      if (sourceRemaining <= 0.00005) continue;
      const sources = await pool.query(
        `SELECT a.layer_id, a.batch_no, a.expiry_date, a.quantity, a.unit_cost,
                COALESCE(used.quantity,0) AS returned_quantity
         FROM erp_delivery_note_layer_allocations a
         LEFT JOIN LATERAL (
           SELECT SUM(l.quantity) AS quantity FROM erp_customer_credit_note_lines l
           JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
           WHERE l.company_id = a.company_id AND l.delivery_note_line_id = a.delivery_note_line_id
             AND n.status <> 'cancelled'
             AND ((a.layer_id IS NOT NULL AND l.source_layer_id = a.layer_id)
               OR (a.layer_id IS NULL AND l.source_layer_id IS NULL
                 AND l.batch_no IS NOT DISTINCT FROM a.batch_no AND l.expiry_date IS NOT DISTINCT FROM a.expiry_date))
         ) used ON TRUE
         WHERE a.company_id = $1 AND a.delivery_note_line_id = $2
           AND (a.layer_id IS NULL OR EXISTS (SELECT 1 FROM erp_inventory_lot_layers layer WHERE layer.id = a.layer_id))
         ORDER BY a.expiry_date NULLS LAST, a.created_at, a.id`, [companyId, deliveryLine.id],
      );
      for (const source of sources.rows) {
        if (sourceRemaining <= 0.00005) break;
        const available = Math.min(sourceRemaining, Math.max(0, Number(source.quantity) - Number(source.returned_quantity)));
        if (available <= 0.00005) continue;
        lines.push({
          invoice_line_id: invoiceLine.id, delivery_note_line_id: deliveryLine.id,
          item_id: invoiceLine.item_id, item_code: invoiceLine.item_code, item_name: invoiceLine.item_name,
          invoice_quantity: Number(invoiceLine.quantity), returnable_quantity: available,
          unit_price: Number(invoiceLine.unit_price), original_tax_amount: Number(invoiceLine.tax_amount),
          tax_code: invoiceLine.tax_code, tax_treatment: invoiceLine.tax_treatment, tax_rate: Number(invoiceLine.tax_rate),
          lot_tracking_enabled: invoiceLine.lot_tracking_enabled, source_layer_id: source.layer_id,
          batch_no: source.batch_no, expiry_date: source.expiry_date ? String(source.expiry_date).slice(0,10) : null,
          unit_cost: Number(source.unit_cost),
        });
        sourceRemaining -= available;
        invoiceRemaining -= available;
      }
    }
  }
  return { invoice, lines };
}

async function createDraft({ companyId, user, invoiceId, creditDate, reason, lines, refundAmount, refundBankAccountId, refundReferenceNo, courtDisputeDeterminedOn, courtCaseReference }) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) throw new Error("Add at least one returned invoice line");
  const noteDate = creditDate || new Date().toISOString().slice(0,10);
  const noteReason = String(reason || "").trim().slice(0,1000);
  const disputeDate = courtDisputeDeterminedOn || null;
  const caseRef = String(courtCaseReference || "").trim().slice(0,100) || null;
  const refund = money(refundAmount || 0);
  const refundRef = refund > 0 ? String(refundReferenceNo || "").trim().slice(0,100) || null : null;
  if (!Number.isFinite(refund) || refund < 0 || (refund > 0 && (!refundBankAccountId || !refundRef))) {
    throw new Error("For a cash refund, choose the bank/cash account and enter the refund reference");
  }
  if (!dateShape(noteDate) || (disputeDate && !dateShape(disputeDate)) || !noteReason) throw new Error("Enter a valid credit note date and return reason");
  if (Boolean(disputeDate) !== Boolean(caseRef)) throw new Error("A court determination date and case reference must be entered together");
  const seen = new Set();
  const normalized = lines.map((line) => {
    const key = `${line?.invoice_line_id}|${line?.delivery_note_line_id}|${line?.source_layer_id || "legacy"}`;
    const quantity = Number(line?.quantity);
    const condition = String(line?.condition || "");
    if (!line?.invoice_line_id || !line?.delivery_note_line_id || !Number.isFinite(quantity) || quantity <= 0 || !["good", "damaged"].includes(condition)) {
      throw new Error("Each credit note line needs a source invoice line, delivery line, positive quantity, and condition");
    }
    if (seen.has(key)) throw new Error("Combine duplicate credit note lines for the same delivery layer");
    seen.add(key);
    return { invoiceLineId: line.invoice_line_id, deliveryLineId: line.delivery_note_line_id,
      sourceLayerId: line.source_layer_id || null, batchNo: line.batch_no || null,
      expiryDate: line.expiry_date || null, quantity, condition };
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const invoiceResult = await client.query(
      `SELECT inv.*, d.warehouse_id, d.status AS delivery_status
       FROM erp_customer_invoices inv JOIN erp_delivery_notes d ON d.id = inv.delivery_note_id AND d.company_id = inv.company_id
       WHERE inv.id = $1 AND inv.company_id = $2 AND inv.is_deleted = FALSE FOR UPDATE OF inv`, [invoiceId, companyId],
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice || invoice.delivery_status !== "posted" || !["posted", "partial", "overdue", "paid", "credited"].includes(invoice.status)) {
      throw new Error("Select a posted invoice linked to a posted delivery note");
    }
    if (String(noteDate) < String(invoice.invoice_date)) throw new Error("Credit note date cannot predate the original invoice");
    const statute = await client.query(
      `SELECT $1::date <= ($2::date + INTERVAL '6 months')::date AS within_six_months,
              $1::date >= $3::date AND $1::date <= ($3::date + INTERVAL '30 days')::date AS within_dispute_window`,
      [noteDate, invoice.invoice_date, disputeDate || "1900-01-01"],
    );
    if (!statute.rows[0].within_six_months
      && (!disputeDate || String(noteDate) < String(disputeDate) || !statute.rows[0].within_dispute_window)) {
      throw new Error("Kenyan VAT credit notes must be issued within six months, unless a court price dispute was determined and the note is issued within 30 days");
    }
    const invoiceLines = await client.query(
      `SELECT il.*, i.lot_tracking_enabled FROM erp_customer_invoice_lines il
       JOIN erp_items i ON i.id = il.item_id AND i.company_id = il.company_id
       WHERE il.company_id = $1 AND il.invoice_id = $2 AND il.is_deleted = FALSE FOR UPDATE OF il`, [companyId, invoiceId],
    );
    const lineById = new Map(invoiceLines.rows.map((line) => [line.id, line]));
    const prepared = [];
    const stagedInvoiceQty = new Map();
    const stagedInvoiceTax = new Map();
    const stagedDeliveryQty = new Map();
    const stagedSourceQty = new Map();
    for (const input of normalized) {
      const invoiceLine = lineById.get(input.invoiceLineId);
      if (!invoiceLine) throw new Error("Credit note line must belong to the selected invoice");
      if (invoiceLine.lot_tracking_enabled && (!input.batchNo || !input.expiryDate)) throw new Error("Tracked returned goods must identify the batch and expiry from the original delivery");
      const sourceResult = await client.query(
        `SELECT a.* FROM erp_delivery_note_layer_allocations a
         JOIN erp_delivery_note_lines dl ON dl.id = a.delivery_note_line_id AND dl.company_id = a.company_id
         WHERE a.company_id = $1 AND a.delivery_note_line_id = $2 AND dl.delivery_note_id = $3 AND dl.item_id = $4
           AND a.batch_no IS NOT DISTINCT FROM $5::text AND a.expiry_date IS NOT DISTINCT FROM $6::date
           AND a.layer_id IS NOT DISTINCT FROM $7::uuid
         FOR UPDATE OF dl, a`,
        [companyId, input.deliveryLineId, invoice.delivery_note_id, invoiceLine.item_id, input.batchNo, input.expiryDate, input.sourceLayerId],
      );
      const source = sourceResult.rows[0];
      if (!source) throw new Error("Returned quantity must match a batch/layer recorded on the original delivery");
      const sourceKey = `${input.deliveryLineId}|${source.layer_id || "legacy"}|${input.batchNo || ""}|${input.expiryDate || ""}`;
      const [invoiceUse, deliveryUse, layerUse] = await Promise.all([
        client.query(
          `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM erp_customer_credit_note_lines l
           JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
           WHERE l.company_id = $1 AND l.invoice_line_id = $2 AND n.status <> 'cancelled'`, [companyId, input.invoiceLineId]),
        client.query(
          `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM erp_customer_credit_note_lines l
           JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
           WHERE l.company_id = $1 AND l.delivery_note_line_id = $2 AND n.status <> 'cancelled'`, [companyId, input.deliveryLineId]),
        client.query(
          `SELECT COALESCE(SUM(l.quantity),0) AS quantity FROM erp_customer_credit_note_lines l
           JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
           WHERE l.company_id = $1 AND l.delivery_note_line_id = $2 AND n.status <> 'cancelled'
             AND ((l.source_layer_id IS NOT DISTINCT FROM $3::uuid AND l.batch_no IS NOT DISTINCT FROM $4::text
               AND l.expiry_date IS NOT DISTINCT FROM $5::date))`, [companyId, input.deliveryLineId, input.sourceLayerId, input.batchNo, input.expiryDate]),
      ]);
      const [deliveryLine, invoiceCapacity] = await Promise.all([
        client.query("SELECT quantity FROM erp_delivery_note_lines WHERE id = $1 AND company_id = $2 FOR UPDATE", [input.deliveryLineId, companyId]),
        client.query("SELECT quantity FROM erp_customer_invoice_lines WHERE id = $1 AND company_id = $2", [input.invoiceLineId, companyId]),
      ]);
      if (!deliveryLine.rowCount || !invoiceCapacity.rowCount) throw new Error("Source invoice or delivery line not found");
      const available = Math.min(
        Number(invoiceCapacity.rows[0].quantity) - Number(invoiceUse.rows[0].quantity) - (stagedInvoiceQty.get(input.invoiceLineId) || 0),
        Number(deliveryLine.rows[0].quantity) - Number(deliveryUse.rows[0].quantity) - (stagedDeliveryQty.get(input.deliveryLineId) || 0),
        Number(source.quantity) - Number(layerUse.rows[0].quantity) - (stagedSourceQty.get(sourceKey) || 0),
      );
      if (input.quantity > available + 0.00005) throw new Error("Credit quantity exceeds the unreturned invoice, delivery, or batch quantity");
      const netAmount = money(input.quantity * Number(invoiceLine.unit_price));
      const priorLineTax = await client.query(
        `SELECT COALESCE(SUM(l.tax_amount),0) AS amount FROM erp_customer_credit_note_lines l
         JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
         WHERE l.company_id = $1 AND l.invoice_line_id = $2 AND n.status <> 'cancelled'`, [companyId, input.invoiceLineId],
      );
      const stagedQty = stagedInvoiceQty.get(input.invoiceLineId) || 0;
      const stagedTax = stagedInvoiceTax.get(input.invoiceLineId) || 0;
      const lineQtyRemaining = Number(invoiceLine.quantity) - Number(invoiceUse.rows[0].quantity) - stagedQty;
      const taxRemaining = Number(invoiceLine.tax_amount) - Number(priorLineTax.rows[0].amount) - stagedTax;
      const taxAmount = input.quantity >= lineQtyRemaining - 0.00005
        ? money(taxRemaining)
        : Math.min(money(taxRemaining), money(Number(invoiceLine.tax_amount) * input.quantity / Number(invoiceLine.quantity)));
      prepared.push({ ...input, itemId: invoiceLine.item_id, unitPrice: Number(invoiceLine.unit_price),
        unitCost: Number(source.unit_cost), taxCode: invoiceLine.tax_code, taxTreatment: invoiceLine.tax_treatment,
        taxRate: Number(invoiceLine.tax_rate), netAmount, taxAmount });
      stagedInvoiceQty.set(input.invoiceLineId, stagedQty + input.quantity);
      stagedInvoiceTax.set(input.invoiceLineId, stagedTax + taxAmount);
      stagedDeliveryQty.set(input.deliveryLineId, (stagedDeliveryQty.get(input.deliveryLineId) || 0) + input.quantity);
      stagedSourceQty.set(sourceKey, (stagedSourceQty.get(sourceKey) || 0) + input.quantity);
    }
    const subtotal = money(prepared.reduce((sum, line) => sum + line.netAmount, 0));
    const taxAmount = money(prepared.reduce((sum, line) => sum + line.taxAmount, 0));
    const total = money(subtotal + taxAmount);
    const drafts = await client.query(
      `SELECT COALESCE(SUM(total_amount - refund_amount),0) AS amount FROM erp_customer_credit_notes
       WHERE company_id = $1 AND invoice_id = $2 AND status = 'draft'`, [companyId, invoiceId],
    );
    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid) - Number(invoice.credited_amount) - Number(drafts.rows[0].amount);
    if (refund > total + 0.005) throw new Error("Cash refund cannot exceed the credit note total");
    if (total - refund > outstanding + 0.005) throw new Error("The amount applied to this invoice exceeds its open receivable balance; refund the excess");
    if (refund > 0) {
      const bank = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
          AND account_code LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [refundBankAccountId, companyId],
      );
      if (!bank.rowCount) throw new Error("Choose an active postable bank or cash account");
    }
    const noteNo = await nextNo(client, companyId);
    const note = await client.query(
      `INSERT INTO erp_customer_credit_notes
       (company_id, invoice_id, customer_id, credit_note_no, credit_date, reason, court_dispute_determined_on,
        court_case_reference, subtotal, tax_amount, total_amount, refund_amount, refund_bank_account_id, refund_reference_no, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING *`,
      [companyId, invoiceId, invoice.customer_id, noteNo, noteDate, noteReason, disputeDate, caseRef, subtotal, taxAmount, total,
        refund, refund > 0 ? refundBankAccountId : null, refundRef, user.id],
    );
    for (const line of prepared) {
      await client.query(
        `INSERT INTO erp_customer_credit_note_lines
         (company_id, credit_note_id, invoice_line_id, delivery_note_line_id, item_id, source_layer_id,
          batch_no, expiry_date, condition, quantity, unit_price, unit_cost, tax_code, tax_treatment, tax_rate,
          net_amount, tax_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [companyId, note.rows[0].id, line.invoiceLineId, line.deliveryLineId, line.itemId, line.sourceLayerId,
          line.batchNo, line.expiryDate, line.condition, line.quantity, line.unitPrice, line.unitCost,
          line.taxCode, line.taxTreatment, line.taxRate, line.netAmount, line.taxAmount, user.id],
      );
    }
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_customer_credit_notes", entityId: note.rows[0].id,
      action: "customer_credit_note_draft_created", newValues: { credit_note_no: noteNo, invoice_id: invoiceId, subtotal, tax_amount: taxAmount, total_amount: total, refund_amount: refund, line_count: prepared.length } });
    await client.query("COMMIT");
    return note.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function postCreditNote({ companyId, noteId, user }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const noteResult = await client.query(
      `SELECT * FROM erp_customer_credit_notes WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`, [noteId, companyId],
    );
    const note = noteResult.rows[0];
    if (!note) throw new Error("Customer credit note draft not found");
    if (String(note.created_by) === String(user.id)) throw new Error("The preparer cannot post their own customer credit note");
    const invoiceResult = await client.query(
      `SELECT * FROM erp_customer_invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`, [note.invoice_id, companyId],
    );
    const invoice = invoiceResult.rows[0];
    const otherDrafts = await client.query(
      `SELECT COALESCE(SUM(total_amount - refund_amount),0) AS amount FROM erp_customer_credit_notes
       WHERE company_id = $1 AND invoice_id = $2 AND status = 'draft' AND id <> $3`, [companyId, note.invoice_id, noteId],
    );
    const appliedAmount = Number(note.total_amount) - Number(note.refund_amount || 0);
    if (appliedAmount > Number(invoice.total_amount) - Number(invoice.amount_paid) - Number(invoice.credited_amount) - Number(otherDrafts.rows[0].amount) + 0.005) {
      throw new Error("Invoice balance changed; credit note exceeds the receivable still open");
    }
    const lines = await client.query(
      `SELECT l.*, w.warehouse_id FROM erp_customer_credit_note_lines l
       JOIN erp_customer_credit_notes n ON n.id = l.credit_note_id AND n.company_id = l.company_id
       JOIN erp_customer_invoices inv ON inv.id = n.invoice_id AND inv.company_id = n.company_id
       JOIN erp_delivery_notes w ON w.id = inv.delivery_note_id AND w.company_id = inv.company_id
       WHERE l.company_id = $1 AND l.credit_note_id = $2 ORDER BY l.created_at, l.id FOR UPDATE OF l`, [companyId, noteId],
    );
    let returnedCost = 0;
    for (const line of lines.rows) {
      const receipt = await inventory.recordReceipt(client, {
        companyId, warehouseId: line.warehouse_id, itemId: line.item_id, quantity: line.quantity,
        unitCost: line.unit_cost, referenceType: "customer_return", referenceId: noteId,
        batchNo: line.batch_no, expiryDate: line.expiry_date, userId: user.id,
        sourceType: "customer_return", parentLayerId: line.source_layer_id,
        allowExpiredForQuarantine: line.condition === "damaged",
      });
      returnedCost += Number(line.quantity) * Number(line.unit_cost);
      if (line.condition === "damaged") {
        const quarantineReason = `Customer return ${note.credit_note_no}: ${note.reason}`.slice(0, 1000);
        if (receipt?.lotId && receipt?.layerId) {
          const lotUpdate = await client.query(
            `UPDATE erp_inventory_lots SET quarantined_quantity = quarantined_quantity + $2, updated_by = $3
             WHERE id = $1 AND company_id = $4 AND quantity - quarantined_quantity >= $2 RETURNING id`,
            [receipt.lotId, line.quantity, user.id, companyId],
          );
          const layerUpdate = await client.query(
            `UPDATE erp_inventory_lot_layers SET quarantined_quantity = quarantined_quantity + $2
             WHERE id = $1 AND company_id = $3 AND quantity_remaining - quarantined_quantity >= $2 RETURNING id`,
            [receipt.layerId, line.quantity, companyId],
          );
          if (!lotUpdate.rowCount || !layerUpdate.rowCount) throw new Error("Damaged customer return did not reconcile to its quarantine layer");
          await client.query(
            `INSERT INTO erp_inventory_lot_events (company_id, warehouse_id, item_id, lot_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,$4,'quarantined',$5,$6,$7)`,
            [companyId, line.warehouse_id, line.item_id, receipt.lotId, line.quantity, quarantineReason, user.id],
          );
        } else {
          await client.query(
            `INSERT INTO erp_inventory_quarantine_balances (company_id, warehouse_id, item_id, quantity, updated_by)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id, warehouse_id, item_id)
             DO UPDATE SET quantity = erp_inventory_quarantine_balances.quantity + EXCLUDED.quantity, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
            [companyId, line.warehouse_id, line.item_id, line.quantity, user.id],
          );
          await client.query(
            `INSERT INTO erp_inventory_quarantine_events (company_id, warehouse_id, item_id, source_type, source_id, event_type, quantity, reason, created_by)
             VALUES ($1,$2,$3,'customer_credit_note',$4,'quarantined',$5,$6,$7)`,
            [companyId, line.warehouse_id, line.item_id, noteId, line.quantity, quarantineReason, user.id],
          );
        }
      }
    }

    const accountCodes = [ACCOUNT_CODES.salesRevenue, ACCOUNT_CODES.accountsReceivable];
    if (Number(note.tax_amount) > 0) accountCodes.push(ACCOUNT_CODES.vatOutput);
    if (returnedCost > 0.00005) accountCodes.push(ACCOUNT_CODES.inventory, ACCOUNT_CODES.cogs);
    const accountResult = await client.query(
      `SELECT id, account_code FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = ANY($2::text[])
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [companyId, accountCodes],
    );
    const accounts = Object.fromEntries(accountResult.rows.map((account) => [account.account_code, account.id]));
    for (const code of accountCodes) if (!accounts[code]) throw new Error(`Required account ${code} is missing or inactive`);
    const journalLines = [
      { account_id: accounts[ACCOUNT_CODES.salesRevenue], debit: Number(note.subtotal), credit: 0, description: "Sales return / credit" },
      { account_id: accounts[ACCOUNT_CODES.accountsReceivable], debit: 0, credit: Number(note.total_amount), description: "Customer receivable credit" },
    ];
    if (Number(note.tax_amount) > 0) journalLines.push({ account_id: accounts[ACCOUNT_CODES.vatOutput], debit: Number(note.tax_amount), credit: 0, description: "Reverse output VAT" });
    if (returnedCost > 0.00005) {
      journalLines.push({ account_id: accounts[ACCOUNT_CODES.inventory], debit: returnedCost, credit: 0, description: "Customer goods returned" });
      journalLines.push({ account_id: accounts[ACCOUNT_CODES.cogs], debit: 0, credit: returnedCost, description: "Reverse returned-goods cost" });
    }
    const journal = await gl.createJournalInTransaction(client, {
      companyId, userId: user.id, entryDate: note.credit_date, journalType: "sales",
      referenceNo: note.credit_note_no, description: `Customer credit note ${note.credit_note_no} for ${invoice.invoice_no}`,
      lines: journalLines,
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId: user.id });
    let refundJournalId = null;
    if (Number(note.refund_amount || 0) > 0) {
      const refundAccount = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
          AND account_code LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [note.refund_bank_account_id, companyId],
      );
      if (!refundAccount.rowCount || !note.refund_reference_no) throw new Error("Refund bank account or reference is no longer valid");
      const refundJournal = await gl.createJournalInTransaction(client, {
        companyId, userId: user.id, entryDate: note.credit_date, journalType: "sales",
        referenceNo: `${note.credit_note_no}-REFUND`, description: `Customer refund ${note.refund_reference_no} for ${note.credit_note_no}`,
        lines: [
          { account_id: accounts[ACCOUNT_CODES.accountsReceivable], debit: Number(note.refund_amount), credit: 0, description: `Refund against ${note.credit_note_no}` },
          { account_id: refundAccount.rows[0].id, debit: 0, credit: Number(note.refund_amount), description: `Cash refund ${note.refund_reference_no}` },
        ],
      });
      await gl.postJournalInTransaction(client, { journalId: refundJournal.id, companyId, userId: user.id });
      refundJournalId = refundJournal.id;
    }
    const credited = Number(invoice.credited_amount) + appliedAmount;
    const settled = Number(invoice.amount_paid) + credited >= Number(invoice.total_amount) - 0.005;
    const nextStatus = settled ? "credited" : invoice.status === "overdue" ? "overdue"
      : Number(invoice.amount_paid) + credited > 0 ? "partial" : invoice.status;
    await client.query(
      `UPDATE erp_customer_invoices SET credited_amount = $3, status = $4, updated_at = NOW(), updated_by = $5
       WHERE id = $1 AND company_id = $2`, [invoice.id, companyId, credited, nextStatus, user.id],
    );
    await client.query(
      `UPDATE erp_customer_credit_notes SET status = 'posted', journal_id = $3, posted_at = NOW(), posted_by = $4,
       refund_journal_id = $5, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
      [noteId, companyId, journal.id, user.id, refundJournalId],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_customer_credit_notes", entityId: noteId,
      action: "customer_credit_note_posted", newValues: { credit_note_no: note.credit_note_no, invoice_id: invoice.id,
        total_amount: Number(note.total_amount), applied_amount: appliedAmount, refund_amount: Number(note.refund_amount || 0),
        returned_cost: returnedCost, journal_id: journal.id, refund_journal_id: refundJournalId,
        inventory_lines: lines.rows.map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), condition: line.condition, layer_id: line.source_layer_id })) } });
    await client.query("COMMIT");
    return { ok: true, id: noteId, credit_note_no: note.credit_note_no, status: "posted", journal_id: journal.id,
      refund_journal_id: refundJournalId, total_amount: Number(note.total_amount), refund_amount: Number(note.refund_amount || 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function cancelDraft({ companyId, noteId, user }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_customer_credit_notes WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`, [noteId, companyId],
    );
    const note = result.rows[0];
    if (!note) throw new Error("Customer credit note draft not found");
    if (String(note.created_by) !== String(user.id)) throw new Error("Only the preparer can cancel this credit note draft");
    await client.query("UPDATE erp_customer_credit_notes SET status = 'cancelled', updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2", [noteId, companyId, user.id]);
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_customer_credit_notes", entityId: noteId,
      action: "customer_credit_note_draft_cancelled", oldValues: { status: "draft" }, newValues: { status: "cancelled" } });
    await client.query("COMMIT");
    return { ok: true, id: noteId, status: "cancelled" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

module.exports = { getSetup, getReturnOptions, createDraft, postCreditNote, cancelDraft };
