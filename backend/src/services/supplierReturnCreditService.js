const pool = require("../db");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");
const { logAudit } = require("./auditService");

const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function getSetup(companyId) {
  const [claims, bills, sourceLines, accounts] = await Promise.all([
    pool.query(
      `SELECT d.id AS disposition_id, d.disposition_no, d.vendor_id, v.vendor_code, v.name AS vendor_name,
              d.reference_no, a.account_code AS claim_account_code, a.account_name AS claim_account_name,
              i.item_code, i.name AS item_name, dl.quantity, dl.unit_cost,
              dl.quantity * dl.unit_cost AS claim_value,
              COALESCE(SUM(c.inventory_claim_amount) FILTER (WHERE c.status <> 'cancelled' AND c.is_deleted = FALSE), 0) AS reserved_value
       FROM erp_inventory_dispositions d
       JOIN erp_inventory_disposition_lines dl ON dl.disposition_id = d.id AND dl.company_id = d.company_id
       JOIN erp_vendors v ON v.id = d.vendor_id AND v.company_id = d.company_id
       JOIN erp_chart_of_accounts a ON a.id = d.offset_account_id AND a.company_id = d.company_id
       JOIN erp_items i ON i.id = dl.item_id AND i.company_id = dl.company_id
       LEFT JOIN erp_supplier_return_credit_notes c ON c.disposition_id = d.id AND c.company_id = d.company_id
       WHERE d.company_id = $1 AND d.disposition_type = 'supplier_return' AND d.status = 'posted'
         AND d.is_deleted = FALSE AND a.account_type = 'asset'
       GROUP BY d.id, v.id, a.id, i.id, dl.id
       HAVING dl.quantity * dl.unit_cost - COALESCE(SUM(c.inventory_claim_amount) FILTER (WHERE c.status <> 'cancelled' AND c.is_deleted = FALSE), 0) > 0.005
       ORDER BY d.posted_at DESC`,
      [companyId],
    ),
    pool.query(
      `SELECT b.id, b.bill_no, b.supplier_invoice_no, b.vendor_id, v.vendor_code, v.name AS vendor_name,
              b.currency_code, b.total_amount, b.amount_paid,
              GREATEST(b.total_amount - b.amount_paid, 0) AS balance_due, b.due_date, b.status
       FROM erp_supplier_bills b JOIN erp_vendors v ON v.id = b.vendor_id AND v.company_id = b.company_id
       WHERE b.company_id = $1 AND b.is_deleted = FALSE AND b.status IN ('posted','partial','overdue')
         AND b.total_amount > b.amount_paid
       ORDER BY b.due_date, b.bill_date`,
      [companyId],
    ),
    pool.query(
      `SELECT d.id AS disposition_id, bl.id AS source_bill_line_id, b.id AS bill_id, b.vendor_id,
              b.bill_no, b.supplier_invoice_no, b.bill_date, bl.description, bl.quantity AS billed_quantity,
              bl.net_amount, bl.tax_amount, bl.tax_rate, grl.item_id, grl.quantity AS receipt_quantity,
              grl.batch_no, grl.expiry_date,
              receipt_lot.id AS receipt_lot_id, grll.quantity_received AS linked_receipt_quantity,
              receipt_layer.id AS receipt_layer_id,
              i.item_code, i.name AS item_name,
              GREATEST(LEAST(bl.quantity, grl.quantity,
                CASE WHEN i.lot_tracking_enabled THEN COALESCE(layer_use.quantity, 0) ELSE dl.quantity END)
                - COALESCE(credit_usage.returned_quantity, 0), 0) AS available_return_quantity,
              GREATEST(bl.tax_amount - COALESCE(credit_usage.vat_amount, 0), 0) AS available_vat
       FROM erp_inventory_dispositions d
       JOIN erp_inventory_disposition_lines dl ON dl.disposition_id = d.id AND dl.company_id = d.company_id
       JOIN erp_supplier_bill_lines bl ON bl.company_id = d.company_id
       JOIN erp_supplier_bills b ON b.id = bl.bill_id AND b.company_id = bl.company_id
       JOIN erp_goods_receipt_lines grl ON grl.id = bl.goods_receipt_line_id AND grl.company_id = bl.company_id AND grl.is_deleted = FALSE
       JOIN erp_goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.company_id = grl.company_id AND gr.status = 'posted' AND gr.is_deleted = FALSE
       JOIN erp_items i ON i.id = grl.item_id AND i.company_id = grl.company_id
       LEFT JOIN erp_goods_receipt_lot_links grll ON grll.goods_receipt_line_id = grl.id AND grll.company_id = grl.company_id
       LEFT JOIN erp_inventory_lots receipt_lot ON receipt_lot.id = grll.lot_id AND receipt_lot.company_id = grl.company_id
         AND receipt_lot.warehouse_id = gr.warehouse_id AND receipt_lot.item_id = grl.item_id
         AND receipt_lot.batch_no = grl.batch_no AND receipt_lot.expiry_date = grl.expiry_date
       LEFT JOIN erp_inventory_lot_layers receipt_layer ON receipt_layer.id = grll.layer_id
         AND receipt_layer.company_id = grll.company_id AND receipt_layer.source_receipt_line_id = grl.id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(a.quantity), 0) AS quantity
         FROM erp_inventory_disposition_layer_allocations a
         JOIN erp_inventory_lot_layers source_layer ON source_layer.id = a.layer_id AND source_layer.company_id = a.company_id
         WHERE a.disposition_line_id = dl.id AND source_layer.source_receipt_line_id = grl.id
       ) layer_use ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(c.returned_quantity), 0) AS returned_quantity,
                COALESCE(SUM(c.vat_amount), 0) AS vat_amount
         FROM erp_supplier_return_credit_notes c
         WHERE c.disposition_id = d.id AND c.source_bill_line_id = bl.id
           AND c.company_id = d.company_id AND c.status <> 'cancelled' AND c.is_deleted = FALSE
       ) credit_usage ON TRUE
       WHERE d.company_id = $1 AND d.disposition_type = 'supplier_return' AND d.status = 'posted' AND d.is_deleted = FALSE
         AND b.vendor_id = d.vendor_id AND b.status <> 'cancelled' AND b.is_deleted = FALSE
         AND grl.item_id = dl.item_id AND b.goods_receipt_id = gr.id AND b.purchase_order_id = gr.purchase_order_id
         AND ((i.lot_tracking_enabled = TRUE AND receipt_layer.id IS NOT NULL AND layer_use.quantity > 0)
           OR (i.lot_tracking_enabled = FALSE AND dl.lot_id IS NULL))
         AND GREATEST(LEAST(bl.quantity, grl.quantity,
           CASE WHEN i.lot_tracking_enabled THEN COALESCE(layer_use.quantity, 0) ELSE dl.quantity END)
           - COALESCE(credit_usage.returned_quantity, 0), 0) > 0.00005
       ORDER BY b.bill_date DESC, b.bill_no`,
      [companyId],
    ),
    pool.query(
      `SELECT id, account_code, account_name FROM erp_chart_of_accounts
       WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE AND account_type = 'asset'
       ORDER BY account_code`, [companyId],
    ),
  ]);
  return { claims: claims.rows, bills: bills.rows, sourceLines: sourceLines.rows, accounts: accounts.rows };
}

async function list(companyId) {
  const result = await pool.query(
    `SELECT c.*, v.vendor_code, v.name AS vendor_name, d.disposition_no,
            sb.bill_no AS source_bill_no, sb.supplier_invoice_no,
            j.journal_no, creator.full_name AS created_by_name, poster.full_name AS posted_by_name,
            COALESCE(SUM(a.amount), 0) AS allocated_amount,
            STRING_AGG(DISTINCT b.bill_no, ', ' ORDER BY b.bill_no) AS bill_numbers
     FROM erp_supplier_return_credit_notes c
     JOIN erp_vendors v ON v.id = c.vendor_id AND v.company_id = c.company_id
     JOIN erp_inventory_dispositions d ON d.id = c.disposition_id AND d.company_id = c.company_id
     LEFT JOIN erp_supplier_bill_lines sbl ON sbl.id = c.source_bill_line_id AND sbl.company_id = c.company_id
     LEFT JOIN erp_supplier_bills sb ON sb.id = sbl.bill_id AND sb.company_id = sbl.company_id
     LEFT JOIN erp_journals j ON j.id = c.journal_id AND j.company_id = c.company_id
     LEFT JOIN erp_users creator ON creator.id = c.created_by
     LEFT JOIN erp_users poster ON poster.id = c.posted_by
     LEFT JOIN erp_supplier_return_credit_allocations a ON a.credit_note_id = c.id AND a.company_id = c.company_id
     LEFT JOIN erp_supplier_bills b ON b.id = a.bill_id AND b.company_id = a.company_id
     WHERE c.company_id = $1 AND c.is_deleted = FALSE
     GROUP BY c.id, v.id, d.id, sb.id, j.id, creator.id, poster.id
     ORDER BY c.created_at DESC LIMIT 300`,
    [companyId],
  );
  return result.rows;
}

async function create({ companyId, user, dispositionId, sourceBillLineId, creditNoteNo, creditDate, receivedDate, referenceNo,
  returnedQuantity, inventoryClaimAmount, vatAmount, allocations, refundAmount, refundBankAccountId,
  refundReferenceNo, unappliedAmount, unappliedAccountId, courtDisputeDeterminedOn, courtCaseReference }) {
  const principal = money(inventoryClaimAmount);
  const tax = money(vatAmount);
  const total = money(principal + tax);
  const noteNo = String(creditNoteNo || "").trim().slice(0, 100);
  const normalized = (Array.isArray(allocations) ? allocations : []).map((entry) => ({ billId: entry.bill_id, amount: money(entry.amount) }));
  const refund = money(refundAmount || 0);
  const unapplied = money(unappliedAmount || 0);
  const rma = String(referenceNo || "").trim().slice(0, 100) || null;
  const refundRef = refund > 0 ? String(refundReferenceNo || "").trim().slice(0, 100) || null : null;
  const caseRef = String(courtCaseReference || "").trim().slice(0, 100) || null;
  if (!dispositionId || !sourceBillLineId || !noteNo || total <= 0 || principal < 0 || tax < 0) {
    throw new Error("Select a posted return claim and original supplier invoice, then enter the credit note amounts");
  }
  if (normalized.some((entry) => !entry.billId || !Number.isFinite(entry.amount) || entry.amount <= 0)
      || new Set(normalized.map((entry) => entry.billId)).size !== normalized.length) {
    throw new Error("Each bill allocation needs a unique open bill and a positive amount");
  }
  const allocated = money(normalized.reduce((sum, entry) => sum + entry.amount, 0));
  if (Math.abs(allocated + refund + unapplied - total) > 0.005) throw new Error("Bill allocations, cash refund and unapplied supplier credit must equal the full credit note amount");
  if (refund > 0 && (!refundBankAccountId || !refundRef)) throw new Error("Choose the receiving bank/cash account and enter the refund reference");
  if (unapplied > 0 && !unappliedAccountId) throw new Error("Choose an asset account to hold unapplied supplier credit");
  if ((creditDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(creditDate)))
      || (receivedDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(receivedDate)))) throw new Error("Enter valid credit note and received dates");
  const returnedQty = Number(returnedQuantity);
  if (!Number.isFinite(returnedQty) || returnedQty <= 0) throw new Error("Enter the quantity covered by this supplier credit note");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dispositionResult = await client.query(
      `SELECT d.id, d.vendor_id, d.disposition_no, d.offset_account_id,
              d.created_by, d.status, d.posted_at::date AS posted_date
       FROM erp_inventory_dispositions d
       WHERE d.id = $1 AND d.company_id = $2 AND d.disposition_type = 'supplier_return'
         AND d.status = 'posted' AND d.is_deleted = FALSE FOR UPDATE OF d`,
      [dispositionId, companyId],
    );
    const disposition = dispositionResult.rows[0];
    if (!disposition) throw new Error("Posted supplier-return disposition not found");
    const dates = await client.query(
      `SELECT $1::date >= $2::date AS received_after_return, $3::date <= $1::date AS received_after_issue`,
      [receivedDate || new Date().toISOString().slice(0, 10), disposition.posted_date,
        creditDate || new Date().toISOString().slice(0, 10)],
    );
    if (!dates.rows[0].received_after_return || !dates.rows[0].received_after_issue) throw new Error("Credit note issue/received dates must follow the posted supplier return");
    const sourceResult = await client.query(
      `SELECT bl.id, bl.quantity, bl.net_amount, bl.tax_amount, bl.tax_rate, bl.goods_receipt_line_id AS receipt_line_id,
              b.id AS bill_id, b.vendor_id, b.currency_code, b.supplier_invoice_no, b.bill_date, b.status AS bill_status,
              grl.item_id, grl.quantity AS receipt_quantity, grl.batch_no, receipt_lot.id AS receipt_lot_id,
              grll.quantity_received AS linked_receipt_quantity, receipt_layer.id AS receipt_layer_id,
              i.lot_tracking_enabled
       FROM erp_supplier_bill_lines bl
       JOIN erp_supplier_bills b ON b.id = bl.bill_id AND b.company_id = bl.company_id
       JOIN erp_goods_receipt_lines grl ON grl.id = bl.goods_receipt_line_id AND grl.company_id = bl.company_id
       JOIN erp_goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.company_id = grl.company_id
       JOIN erp_items i ON i.id = grl.item_id AND i.company_id = grl.company_id
       LEFT JOIN erp_goods_receipt_lot_links grll ON grll.goods_receipt_line_id = grl.id AND grll.company_id = grl.company_id
       LEFT JOIN erp_inventory_lots receipt_lot ON receipt_lot.id = grll.lot_id AND receipt_lot.company_id = grl.company_id
         AND receipt_lot.warehouse_id = gr.warehouse_id AND receipt_lot.item_id = grl.item_id
         AND receipt_lot.batch_no = grl.batch_no AND receipt_lot.expiry_date = grl.expiry_date
       LEFT JOIN erp_inventory_lot_layers receipt_layer ON receipt_layer.id = grll.layer_id
         AND receipt_layer.company_id = grll.company_id AND receipt_layer.source_receipt_line_id = grl.id
       WHERE bl.id = $1 AND bl.company_id = $2 AND bl.is_deleted = FALSE
         AND b.vendor_id = $3 AND b.status <> 'cancelled' AND b.is_deleted = FALSE
         AND b.currency_code = 'KES' AND gr.status = 'posted' AND gr.is_deleted = FALSE
         AND grl.is_deleted = FALSE AND b.goods_receipt_id = gr.id
         AND b.purchase_order_id = gr.purchase_order_id
       FOR UPDATE OF bl, b`,
      [sourceBillLineId, companyId, disposition.vendor_id],
    );
    const source = sourceResult.rows[0];
    if (!source) throw new Error("Select a posted supplier invoice line linked to a goods receipt for this supplier");
    if (source.lot_tracking_enabled && (!source.receipt_lot_id || !source.receipt_layer_id
        || Math.abs(Number(source.linked_receipt_quantity) - Number(source.receipt_quantity)) > 0.00005)) throw new Error("Tracked receipt line has no valid lot layer lineage; reconcile the receipt before preparing its credit note");
    const dispositionLineResult = await client.query(
      `SELECT COALESCE(SUM(CASE WHEN $4::boolean THEN a.quantity ELSE dl.quantity END), 0) AS quantity,
              COALESCE(SUM(CASE WHEN $4::boolean THEN a.quantity ELSE dl.quantity END * dl.unit_cost), 0) AS value
       FROM erp_inventory_dispositions d
       JOIN erp_inventory_disposition_lines dl ON dl.disposition_id = d.id AND dl.company_id = d.company_id
       LEFT JOIN erp_inventory_disposition_layer_allocations a ON a.disposition_line_id = dl.id AND a.company_id = dl.company_id
       LEFT JOIN erp_inventory_lot_layers source_layer ON source_layer.id = a.layer_id AND source_layer.company_id = a.company_id
         AND source_layer.source_receipt_line_id = $5
       WHERE d.id = $1 AND d.company_id = $2 AND dl.item_id = $3
         AND (($4::boolean AND source_layer.id IS NOT NULL) OR (NOT $4::boolean AND dl.lot_id IS NULL))`,
      [dispositionId, companyId, source.item_id, source.lot_tracking_enabled, source.receipt_line_id],
    );
    const dispositionLine = dispositionLineResult.rows[0];
    if (!dispositionLine || Number(dispositionLine.quantity) <= 0) throw new Error("The selected invoice receipt item/lot does not match this supplier-return claim");
    const statutoryDate = await client.query(
      `SELECT $1::date >= $2::date AS note_after_invoice,
              $1::date <= ($2::date + INTERVAL '6 months')::date AS within_six_months,
              $1::date <= ($3::date + INTERVAL '30 days')::date AS within_dispute_window`,
      [creditDate || new Date().toISOString().slice(0, 10), source.bill_date, courtDisputeDeterminedOn || "1900-01-01"],
    );
    if (!statutoryDate.rows[0].note_after_invoice) throw new Error("Supplier credit note date cannot predate the original tax invoice");
    if (courtDisputeDeterminedOn && String(creditDate || new Date().toISOString().slice(0, 10)) < String(courtDisputeDeterminedOn)) throw new Error("Credit note date cannot predate the court price-dispute determination");
    if (!statutoryDate.rows[0].within_six_months && (!courtDisputeDeterminedOn || !caseRef || !statutoryDate.rows[0].within_dispute_window)) {
      throw new Error("Kenyan VAT credit notes must reference the original invoice and be issued within six months, unless a court price dispute was determined and the note is issued within 30 days");
    }
    const sourceUsage = await client.query(
      `SELECT COALESCE(SUM(returned_quantity), 0) AS quantity,
              COALESCE(SUM(inventory_claim_amount), 0) AS principal,
              COALESCE(SUM(vat_amount), 0) AS tax
       FROM erp_supplier_return_credit_notes
       WHERE company_id = $1 AND source_bill_line_id = $2 AND status <> 'cancelled' AND is_deleted = FALSE`,
      [companyId, sourceBillLineId],
    );
    const used = sourceUsage.rows[0];
    const sourceQty = Math.min(Number(source.quantity), Number(source.receipt_quantity));
    if (returnedQty > sourceQty - Number(used.quantity) + 0.00005) throw new Error("Returned quantity exceeds the unreturned quantity on this received supplier invoice line");
    const sourceNetRemaining = Number(source.net_amount) - Number(used.principal);
    const sourceVatRemaining = Number(source.tax_amount) - Number(used.tax);
    if (principal > sourceNetRemaining + 0.005 || principal > Number(source.net_amount) / Number(source.quantity) * returnedQty + 0.005) {
      throw new Error("Inventory claim amount exceeds the uncredited value for the quantity on the original supplier invoice");
    }
    const expectedTax = money(principal * Number(source.tax_rate || 0) / 100);
    if (Math.abs(tax - expectedTax) > 0.02 || tax > sourceVatRemaining + 0.005
        || tax > Number(source.tax_amount) / Number(source.quantity) * returnedQty + 0.005) {
      throw new Error("VAT reversal must match the original invoice line tax rate and remaining deductible input VAT");
    }
    const claimValue = money(Number(dispositionLine.value));
    const claimReserved = await client.query(
      `SELECT COALESCE(SUM(inventory_claim_amount), 0) AS amount,
              COALESCE(SUM(returned_quantity), 0) AS quantity FROM erp_supplier_return_credit_notes
       WHERE company_id = $1 AND disposition_id = $2 AND source_bill_line_id = $3
         AND status <> 'cancelled' AND is_deleted = FALSE`,
      [companyId, dispositionId, sourceBillLineId],
    );
    if (principal > claimValue - Number(claimReserved.rows[0].amount) + 0.005) throw new Error("Inventory credit amount exceeds the remaining supplier-return claim value");
    if (returnedQty > Number(dispositionLine.quantity) - Number(claimReserved.rows[0].quantity) + 0.00005) throw new Error("Returned quantity exceeds the remaining quantity on this return claim");

    const billIds = normalized.map((entry) => entry.billId);
    if (billIds.length) {
      const billResult = await client.query(
        `SELECT id, vendor_id, currency_code, total_amount, amount_paid, status
         FROM erp_supplier_bills WHERE company_id = $1 AND vendor_id = $2 AND id = ANY($3::uuid[])
           AND is_deleted = FALSE FOR UPDATE`,
        [companyId, disposition.vendor_id, billIds],
      );
      if (billResult.rowCount !== normalized.length) throw new Error("Every allocated bill must belong to the supplier on the return claim");
      const billById = new Map(billResult.rows.map((bill) => [bill.id, bill]));
      for (const allocation of normalized) {
        const bill = billById.get(allocation.billId);
        if (!bill || !["posted", "partial", "overdue"].includes(bill.status)) throw new Error("Credit allocations can only use open posted bills for this supplier");
        if (bill.currency_code !== "KES") throw new Error("Supplier return credit allocation currently requires KES bills");
        if (allocation.amount > Number(bill.total_amount) - Number(bill.amount_paid) + 0.005) throw new Error("An allocation exceeds the bill's remaining payable balance");
      }
    }
    if (refund > 0) {
      const bank = await client.query(`SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset' AND account_code LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [refundBankAccountId, companyId]);
      if (!bank.rowCount) throw new Error("Choose an active postable bank or cash account");
    }
    if (unapplied > 0) {
      const account = await client.query(`SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset' AND account_code NOT IN ('1100','1200','1300','1400') AND account_code NOT LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [unappliedAccountId, companyId]);
      if (!account.rowCount) throw new Error("Choose an active postable supplier-credit asset account");
    }
    const credit = await client.query(
      `INSERT INTO erp_supplier_return_credit_notes
       (company_id, disposition_id, vendor_id, credit_note_no, credit_date, received_date, reference_no,
        amount, source_bill_line_id, original_invoice_no, returned_quantity, inventory_claim_amount, vat_amount,
        allocated_amount, refund_amount, unapplied_amount, refund_bank_account_id, unapplied_account_id,
        refund_reference_no, court_dispute_determined_on, court_case_reference, created_by, updated_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$22)
       RETURNING *`,
      [companyId, dispositionId, disposition.vendor_id, noteNo, creditDate || null, receivedDate || null, rma, total,
        sourceBillLineId, source.supplier_invoice_no, returnedQty, principal, tax, allocated, refund, unapplied,
        (refund > 0 ? refundBankAccountId : null) || null, (unapplied > 0 ? unappliedAccountId : null) || null,
        refundRef, courtDisputeDeterminedOn || null, caseRef, user.id],
    );
    for (const allocation of normalized) {
      await client.query(
        `INSERT INTO erp_supplier_return_credit_allocations (company_id, credit_note_id, bill_id, amount, created_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [companyId, credit.rows[0].id, allocation.billId, allocation.amount, user.id],
      );
    }
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_supplier_return_credit_notes", entityId: credit.rows[0].id,
      action: "supplier_return_credit_draft_created", newValues: { credit_note_no: noteNo, disposition_id: dispositionId,
        source_invoice: source.supplier_invoice_no, returned_quantity: returnedQty, inventory_claim_amount: principal,
        vat_amount: tax, allocated_amount: allocated, refund_amount: refund, unapplied_amount: unapplied, allocations: normalized } });
    await client.query("COMMIT");
    return credit.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function post({ companyId, id, user }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const creditResult = await client.query(
      `SELECT * FROM erp_supplier_return_credit_notes
       WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE FOR UPDATE`,
      [id, companyId],
    );
    const credit = creditResult.rows[0];
    if (!credit) throw new Error("Supplier credit note draft not found");
    if (String(credit.created_by) === String(user.id)) throw new Error("The preparer cannot approve their own supplier credit note");
    const dispositionResult = await client.query(
      `SELECT d.disposition_no, d.offset_account_id,
              SUM(dl.quantity) AS quantity, SUM(dl.quantity * dl.unit_cost) AS value
       FROM erp_inventory_dispositions d JOIN erp_inventory_disposition_lines dl
         ON dl.disposition_id = d.id AND dl.company_id = d.company_id
       WHERE d.id = $1 AND d.company_id = $2 AND d.status = 'posted'
         AND d.disposition_type = 'supplier_return' AND d.vendor_id = $3
       GROUP BY d.id FOR UPDATE OF d`,
      [credit.disposition_id, companyId, credit.vendor_id],
    );
    const disposition = dispositionResult.rows[0];
    if (!disposition) throw new Error("The linked supplier-return claim is no longer available");
    const claimValue = money(Number(disposition.value));
    const reserved = await client.query(
      `SELECT COALESCE(SUM(inventory_claim_amount), 0) AS amount,
              COALESCE(SUM(returned_quantity), 0) AS quantity FROM erp_supplier_return_credit_notes
       WHERE company_id = $1 AND disposition_id = $2 AND id <> $3 AND status <> 'cancelled' AND is_deleted = FALSE`,
      [companyId, credit.disposition_id, id],
    );
    if (Number(credit.inventory_claim_amount) > claimValue - Number(reserved.rows[0].amount) + 0.005) throw new Error("Posted and draft credits exceed the return claim value");
    if (Number(credit.returned_quantity) > Number(disposition.quantity) - Number(reserved.rows[0].quantity) + 0.00005) throw new Error("Posted and draft credits exceed the return claim quantity");
    if (Math.abs(Number(credit.amount) - Number(credit.inventory_claim_amount) - Number(credit.vat_amount)) > 0.005
        || Math.abs(Number(credit.amount) - Number(credit.allocated_amount) - Number(credit.refund_amount) - Number(credit.unapplied_amount)) > 0.005) {
      throw new Error("Credit note values or settlement split no longer balance");
    }
    if (credit.source_bill_line_id) {
      const sourceResult = await client.query(
        `SELECT bl.quantity, bl.net_amount, bl.tax_amount, bl.tax_rate, bl.goods_receipt_line_id AS receipt_line_id,
                b.bill_date, b.supplier_invoice_no, b.vendor_id, b.currency_code,
                grl.item_id, grl.quantity AS receipt_quantity, grl.batch_no,
                receipt_lot.id AS receipt_lot_id, grll.quantity_received AS linked_receipt_quantity,
                receipt_layer.id AS receipt_layer_id,
                i.lot_tracking_enabled
         FROM erp_supplier_bill_lines bl
         JOIN erp_supplier_bills b ON b.id = bl.bill_id AND b.company_id = bl.company_id
         JOIN erp_goods_receipt_lines grl ON grl.id = bl.goods_receipt_line_id AND grl.company_id = bl.company_id
         JOIN erp_goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.company_id = grl.company_id
         JOIN erp_items i ON i.id = grl.item_id AND i.company_id = grl.company_id
         LEFT JOIN erp_goods_receipt_lot_links grll ON grll.goods_receipt_line_id = grl.id AND grll.company_id = grl.company_id
         LEFT JOIN erp_inventory_lots receipt_lot ON receipt_lot.id = grll.lot_id AND receipt_lot.company_id = grl.company_id
           AND receipt_lot.warehouse_id = gr.warehouse_id AND receipt_lot.item_id = grl.item_id
           AND receipt_lot.batch_no = grl.batch_no AND receipt_lot.expiry_date = grl.expiry_date
         LEFT JOIN erp_inventory_lot_layers receipt_layer ON receipt_layer.id = grll.layer_id
           AND receipt_layer.company_id = grll.company_id AND receipt_layer.source_receipt_line_id = grl.id
         WHERE bl.id = $1 AND bl.company_id = $2 AND bl.is_deleted = FALSE AND b.vendor_id = $3
           AND b.status <> 'cancelled' AND b.currency_code = 'KES' AND gr.status = 'posted'
           AND gr.is_deleted = FALSE AND grl.is_deleted = FALSE AND b.goods_receipt_id = gr.id
           AND b.purchase_order_id = gr.purchase_order_id FOR UPDATE OF bl, b`,
        [credit.source_bill_line_id, companyId, credit.vendor_id],
      );
      const source = sourceResult.rows[0];
      if (!source || source.supplier_invoice_no !== credit.original_invoice_no) throw new Error("Original supplier tax invoice source no longer matches");
      if (source.lot_tracking_enabled && (!source.receipt_lot_id || !source.receipt_layer_id
          || Math.abs(Number(source.linked_receipt_quantity) - Number(source.receipt_quantity)) > 0.00005)) throw new Error("Tracked receipt lot layer lineage no longer matches the source receipt");
      const matchedDisposition = await client.query(
        `SELECT COALESCE(SUM(CASE WHEN $5::boolean THEN a.quantity ELSE dl.quantity END), 0) AS quantity,
                COALESCE(SUM(CASE WHEN $5::boolean THEN a.quantity ELSE dl.quantity END * dl.unit_cost), 0) AS value
         FROM erp_inventory_dispositions d
         JOIN erp_inventory_disposition_lines dl ON dl.disposition_id = d.id AND dl.company_id = d.company_id
         LEFT JOIN erp_inventory_disposition_layer_allocations a ON a.disposition_line_id = dl.id AND a.company_id = dl.company_id
         LEFT JOIN erp_inventory_lot_layers source_layer ON source_layer.id = a.layer_id AND source_layer.company_id = a.company_id
           AND source_layer.source_receipt_line_id = $6
         WHERE d.id = $1 AND d.company_id = $2 AND d.status = 'posted'
           AND d.disposition_type = 'supplier_return' AND d.vendor_id = $3 AND dl.item_id = $4
           AND (($5::boolean AND source_layer.id IS NOT NULL) OR (NOT $5::boolean AND dl.lot_id IS NULL))`,
        [credit.disposition_id, companyId, credit.vendor_id, source.item_id, source.lot_tracking_enabled, source.receipt_line_id],
      );
      if (Number(matchedDisposition.rows[0]?.quantity || 0) <= 0) throw new Error("Original invoice receipt item/lot no longer matches the supplier-return claim");
      const matchedClaimUsage = await client.query(
        `SELECT COALESCE(SUM(returned_quantity),0) AS quantity,
                COALESCE(SUM(inventory_claim_amount),0) AS principal
         FROM erp_supplier_return_credit_notes WHERE company_id = $1 AND disposition_id = $2
           AND source_bill_line_id = $3 AND id <> $4 AND status <> 'cancelled' AND is_deleted = FALSE`,
        [companyId, credit.disposition_id, credit.source_bill_line_id, id],
      );
      if (Number(credit.returned_quantity) > Number(matchedDisposition.rows[0].quantity) - Number(matchedClaimUsage.rows[0].quantity) + 0.00005
          || Number(credit.inventory_claim_amount) > Number(matchedDisposition.rows[0].value) - Number(matchedClaimUsage.rows[0].principal) + 0.005) {
        throw new Error("Credit quantity or principal exceeds the remaining receipt-layer allocation on this return claim");
      }
      const usage = await client.query(
        `SELECT COALESCE(SUM(returned_quantity),0) AS quantity,
                COALESCE(SUM(inventory_claim_amount),0) AS principal, COALESCE(SUM(vat_amount),0) AS tax
         FROM erp_supplier_return_credit_notes WHERE company_id = $1 AND source_bill_line_id = $2
           AND id <> $3 AND status <> 'cancelled' AND is_deleted = FALSE`,
        [companyId, credit.source_bill_line_id, id],
      );
      const already = usage.rows[0];
      const availableQty = Math.min(Number(source.quantity), Number(source.receipt_quantity)) - Number(already.quantity);
      if (Number(credit.returned_quantity) > Number(matchedDisposition.rows[0].quantity) + 0.00005) throw new Error("Credited quantity exceeds the matching supplier-return claim line");
      const maxNetForQty = Number(source.net_amount) / Number(source.quantity) * Number(credit.returned_quantity);
      const maxVatForQty = Number(source.tax_amount) / Number(source.quantity) * Number(credit.returned_quantity);
      if (Number(credit.returned_quantity) > availableQty + 0.00005
          || Number(credit.inventory_claim_amount) > Number(source.net_amount) - Number(already.principal) + 0.005
          || Number(credit.inventory_claim_amount) > maxNetForQty + 0.005
          || Number(credit.vat_amount) > Number(source.tax_amount) - Number(already.tax) + 0.005
          || Number(credit.vat_amount) > maxVatForQty + 0.005
          || Math.abs(Number(credit.vat_amount) - money(Number(credit.inventory_claim_amount) * Number(source.tax_rate || 0) / 100)) > 0.02) {
        throw new Error("Return quantity, principal or VAT exceeds the remaining source invoice line amounts");
      }
      const timing = await client.query(
        `SELECT $1::date >= $2::date AS note_after_invoice,
                $3::date >= $1::date AS received_after_issue,
                ($4::date IS NULL OR $1::date >= $4::date) AS note_after_determination,
                $1::date <= ($2::date + INTERVAL '6 months')::date AS within_six_months,
                $1::date <= ($4::date + INTERVAL '30 days')::date AS within_dispute_window`,
        [credit.credit_date, source.bill_date, credit.received_date, credit.court_dispute_determined_on],
      );
      if (!timing.rows[0].note_after_invoice || !timing.rows[0].received_after_issue || !timing.rows[0].note_after_determination || (!timing.rows[0].within_six_months
          && (!credit.court_dispute_determined_on || !credit.court_case_reference || !timing.rows[0].within_dispute_window))) {
        throw new Error("Supplier credit note is outside the permitted date window for its original invoice");
      }
    } else if (Number(credit.vat_amount) > 0) {
      throw new Error("A VAT reversal requires a linked original supplier invoice line");
    }
    const allocationResult = await client.query(
      `SELECT a.bill_id, a.amount, b.vendor_id, b.currency_code, b.total_amount, b.amount_paid, b.status, b.supplier_invoice_no
       FROM erp_supplier_return_credit_allocations a JOIN erp_supplier_bills b
         ON b.id = a.bill_id AND b.company_id = a.company_id
       WHERE a.credit_note_id = $1 AND a.company_id = $2 ORDER BY b.id FOR UPDATE OF b`,
      [id, companyId],
    );
    if (Math.abs(allocationResult.rows.reduce((sum, row) => sum + Number(row.amount), 0) - Number(credit.allocated_amount)) > 0.005) {
      throw new Error("Supplier bill allocations must equal the allocated portion of the note");
    }
    for (const allocation of allocationResult.rows) {
      if (allocation.vendor_id !== credit.vendor_id || allocation.currency_code !== "KES"
          || !["posted", "partial", "overdue"].includes(allocation.status)
          || Number(allocation.amount) > Number(allocation.total_amount) - Number(allocation.amount_paid) + 0.005) {
        throw new Error(`Supplier bill ${allocation.supplier_invoice_no} is no longer available for this credit`);
      }
    }
    const claimAccount = await client.query(
      `SELECT id, account_type FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [disposition.offset_account_id, companyId],
    );
    if (!claimAccount.rowCount || claimAccount.rows[0].account_type !== "asset") throw new Error("Supplier-return claim asset account is unavailable");
    const allocations = allocationResult.rows;
    const journalLines = [];
    if (Number(credit.allocated_amount) > 0) {
      const payable = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = $2
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, ACCOUNT_CODES.accountsPayable],
      );
      if (!payable.rowCount) throw new Error("Accounts Payable control account is unavailable");
      journalLines.push({ account_id: payable.rows[0].id, debit: Number(credit.allocated_amount), credit: 0, description: `Apply supplier credit ${credit.credit_note_no}` });
    }
    if (Number(credit.refund_amount) > 0) {
      const bank = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
         AND account_code LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [credit.refund_bank_account_id, companyId],
      );
      if (!bank.rowCount || !credit.refund_reference_no) throw new Error("Refund bank account or bank reference is unavailable");
      journalLines.push({ account_id: bank.rows[0].id, debit: Number(credit.refund_amount), credit: 0, description: `Supplier refund ${credit.refund_reference_no}` });
    }
    if (Number(credit.unapplied_amount) > 0) {
      const account = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
         AND account_code NOT IN ('1100','1200','1300','1400') AND account_code NOT LIKE '11%'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [credit.unapplied_account_id, companyId],
      );
      if (!account.rowCount) throw new Error("Unapplied supplier-credit asset account is unavailable");
      journalLines.push({ account_id: account.rows[0].id, debit: Number(credit.unapplied_amount), credit: 0, description: `Unapplied supplier credit ${credit.credit_note_no}` });
    }
    journalLines.push({ account_id: claimAccount.rows[0].id, debit: 0, credit: Number(credit.inventory_claim_amount), description: `Clear supplier return claim ${disposition.disposition_no}` });
    if (Number(credit.vat_amount) > 0) {
      const inputVat = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = $2
         AND account_type = 'asset' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, ACCOUNT_CODES.vatInput],
      );
      if (!inputVat.rowCount) throw new Error("VAT Input control account 1400 is unavailable for the VAT reversal");
      journalLines.push({ account_id: inputVat.rows[0].id, debit: 0, credit: Number(credit.vat_amount), description: `Reverse input VAT on invoice ${credit.original_invoice_no}` });
    }
    const journal = await gl.createJournalInTransaction(client, {
      companyId, userId: user.id, entryDate: credit.received_date, journalType: "purchase",
      referenceNo: credit.credit_note_no,
      description: `Supplier credit note ${credit.credit_note_no} against ${disposition.disposition_no}`,
      lines: journalLines,
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId: user.id });
    for (const allocation of allocations) {
      const paid = Number(allocation.amount_paid) + Number(allocation.amount);
      const status = paid >= Number(allocation.total_amount) - 0.005 ? "paid" : "partial";
      await client.query(
        `UPDATE erp_supplier_bills SET amount_paid = $3, status = $4, updated_by = $5
         WHERE id = $1 AND company_id = $2`,
        [allocation.bill_id, companyId, paid, status, user.id],
      );
    }
    await client.query(
      `UPDATE erp_supplier_return_credit_notes SET status = 'posted', journal_id = $3,
       posted_at = NOW(), posted_by = $4, updated_at = NOW(), updated_by = $4
       WHERE id = $1 AND company_id = $2`,
      [id, companyId, journal.id, user.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_supplier_return_credit_notes", entityId: id,
      action: "supplier_return_credit_posted", newValues: { credit_note_no: credit.credit_note_no, disposition_id: credit.disposition_id,
        original_invoice_no: credit.original_invoice_no, inventory_claim_amount: Number(credit.inventory_claim_amount),
        vat_amount: Number(credit.vat_amount), allocated_amount: Number(credit.allocated_amount),
        refund_amount: Number(credit.refund_amount), unapplied_amount: Number(credit.unapplied_amount), journal_id: journal.id, allocations } });
    await client.query("COMMIT");
    return { ok: true, id, status: "posted", journal_id: journal.id, amount: Number(credit.amount) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function cancel({ companyId, id, user }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_supplier_return_credit_notes
       WHERE id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE FOR UPDATE`,
      [id, companyId],
    );
    const credit = result.rows[0];
    if (!credit) throw new Error("Supplier credit note draft not found");
    if (String(credit.created_by) !== String(user.id) && (user.role || user.role_name) !== "Admin") throw new Error("Only the preparer or an administrator can cancel this draft");
    await client.query(
      `UPDATE erp_supplier_return_credit_notes SET status = 'cancelled', updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2`,
      [id, companyId, user.id],
    );
    await logAudit({ client, companyId, userId: user.id, entityType: "erp_supplier_return_credit_notes", entityId: id,
      action: "supplier_return_credit_draft_cancelled", oldValues: { status: "draft" }, newValues: { status: "cancelled", credit_note_no: credit.credit_note_no } });
    await client.query("COMMIT");
    return { ok: true, id, status: "cancelled" };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

module.exports = { getSetup, list, create, post, cancel };
