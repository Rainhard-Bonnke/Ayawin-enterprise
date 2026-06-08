const pool = require('../db');
const gl = require('./glPostingService');

const VAT_RATE = 0.16;
const ACCOUNT_CODES = { accountsPayable: '2100', cashAtBank: '1100' };

async function nextNo(client, companyId, table, prefix) {
  const result = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`, [companyId]);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(result.rows[0].n) + 1).padStart(4, '0')}`;
}

function computeMatchStatus(lines) {
  let hasVariance = false;
  let hasFailure = false;
  for (const line of lines) {
    const poQty = Number(line.po_quantity ?? line.quantity);
    const grnQty = Number(line.grn_quantity ?? line.quantity);
    const billQty = Number(line.quantity);
    const poCost = Number(line.po_unit_cost ?? line.unit_cost);
    const billCost = Number(line.unit_cost);
    if (billQty - grnQty > 0.0001 || grnQty - poQty > 0.0001) hasFailure = true;
    if (Math.abs(billCost - poCost) > 0.01 || Number(line.variance_amount) > 0.01) hasVariance = true;
  }
  if (hasFailure) return { status: 'failed', notes: 'Bill quantity exceeds GRN or GRN exceeds PO' };
  if (hasVariance) return { status: 'variance', notes: 'Unit cost variance vs purchase order' };
  return { status: 'matched', notes: 'PO, GRN and bill quantities/costs align' };
}

async function createVendorBillFromGrn({ companyId, userId, goodsReceiptId, vendorRef, billDate, dueDate }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const grnResult = await client.query(
      `SELECT g.*, po.vendor_id, po.id AS po_id, po.po_number
       FROM erp_goods_receipts g
       JOIN erp_purchase_orders po ON po.id = g.purchase_order_id
       WHERE g.id = $1 AND g.company_id = $2 AND g.status = 'posted' AND g.is_deleted = FALSE`,
      [goodsReceiptId, companyId],
    );
    const grn = grnResult.rows[0];
    if (!grn) throw new Error('Posted GRN not found');

    const existing = await client.query(
      `SELECT id FROM erp_vendor_invoices WHERE goods_receipt_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status != 'cancelled'`,
      [goodsReceiptId, companyId],
    );
    if (existing.rowCount) throw new Error('Vendor bill already exists for this GRN');

    const grnLines = await client.query(
      `SELECT gl.*, pol.quantity AS po_quantity, pol.unit_cost AS po_unit_cost, i.item_code, i.name AS item_name
       FROM erp_goods_receipt_lines gl
       LEFT JOIN erp_purchase_order_lines pol ON pol.id = gl.po_line_id
       JOIN erp_items i ON i.id = gl.item_id
       WHERE gl.goods_receipt_id = $1 AND gl.is_deleted = FALSE
       ORDER BY gl.line_no`,
      [goodsReceiptId],
    );
    if (!grnLines.rowCount) throw new Error('GRN has no lines');

    const matchLines = grnLines.rows.map((row) => {
      const qty = Number(row.quantity);
      const unitCost = Number(row.unit_cost);
      const poCost = Number(row.po_unit_cost ?? unitCost);
      const variance = Math.abs(unitCost - poCost) * qty;
      return {
        item_id: row.item_id,
        po_line_id: row.po_line_id,
        grn_line_id: row.id,
        quantity: qty,
        unit_cost: unitCost,
        po_quantity: Number(row.po_quantity ?? qty),
        grn_quantity: qty,
        po_unit_cost: poCost,
        variance_amount: variance,
        line_total: qty * unitCost,
      };
    });

    const match = computeMatchStatus(matchLines);
    let subtotal = 0;
    for (const l of matchLines) subtotal += l.line_total;
    const taxAmount = Math.round(subtotal * VAT_RATE * 100) / 100;
    const total = subtotal + taxAmount;

    const billNo = await nextNo(client, companyId, 'erp_vendor_invoices', 'VB');
    const invResult = await client.query(
      `INSERT INTO erp_vendor_invoices (
         company_id, vendor_id, purchase_order_id, goods_receipt_id, bill_no, vendor_ref,
         bill_date, due_date, status, match_status, match_notes, subtotal, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8,'draft',$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        companyId, grn.vendor_id, grn.po_id, goodsReceiptId, billNo, vendorRef || null,
        billDate, dueDate || null, match.status, match.notes, subtotal, taxAmount, total, userId,
      ],
    );
    const bill = invResult.rows[0];

    let lineNo = 1;
    for (const line of matchLines) {
      await client.query(
        `INSERT INTO erp_vendor_invoice_lines (
           company_id, invoice_id, line_no, item_id, po_line_id, grn_line_id,
           quantity, unit_cost, po_quantity, grn_quantity, variance_amount, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          companyId, bill.id, lineNo++, line.item_id, line.po_line_id, line.grn_line_id,
          line.quantity, line.unit_cost, line.po_quantity, line.grn_quantity, line.variance_amount, line.line_total, userId,
        ],
      );
    }

    await client.query('COMMIT');
    return { ...bill, lines: matchLines, po_number: grn.po_number, grn_number: grn.grn_number };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postVendorBill({ companyId, userId, billId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE erp_vendor_invoices
       SET status = 'posted', posted_at = NOW(), updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2 AND status = 'draft' AND match_status != 'failed'
       RETURNING *`,
      [billId, companyId, userId],
    );
    if (!result.rowCount) throw new Error('Bill not found, already posted, or 3-way match failed');
    const bill = result.rows[0];
    await client.query(
      `UPDATE erp_vendors SET ap_balance = ap_balance + $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3`,
      [bill.vendor_id, bill.total_amount, companyId],
    );
    await client.query('COMMIT');
    return bill;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordVendorPayment({ companyId, userId, invoiceId, paymentDate, amount, referenceNo, paymentMethod, postGl = true }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invResult = await client.query(
      `SELECT * FROM erp_vendor_invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [invoiceId, companyId],
    );
    const inv = invResult.rows[0];
    if (!inv) throw new Error('Vendor bill not found');
    if (inv.status === 'cancelled') throw new Error('Cannot pay cancelled bill');
    if (inv.status === 'draft') throw new Error('Post the vendor bill before payment');
    if (inv.match_status === 'failed') {
      throw new Error('3-way match failed — resolve PO/GRN/bill variances before payment');
    }
    if (!inv.goods_receipt_id) {
      throw new Error('Vendor bill must be linked to a posted GRN before payment');
    }

    const paymentAmount = Number(amount || 0);
    if (!paymentAmount || paymentAmount <= 0) throw new Error('Payment amount must be greater than zero');

    const outstanding = Number(inv.total_amount || 0) - Number(inv.amount_paid || 0);
    if (paymentAmount - outstanding > 0.0001) throw new Error('Payment exceeds outstanding balance');

    const paymentNo = await nextNo(client, companyId, 'erp_vendor_payments', 'VPY');
    const payResult = await client.query(
      `INSERT INTO erp_vendor_payments (
         company_id, vendor_id, payment_no, payment_date, amount, payment_method, reference_no, status, created_by
       ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,'posted',$8) RETURNING *`,
      [companyId, inv.vendor_id, paymentNo, paymentDate, paymentAmount, paymentMethod || 'bank_transfer', referenceNo, userId],
    );
    const payment = payResult.rows[0];

    await client.query(
      `INSERT INTO erp_vendor_payment_allocations (company_id, payment_id, invoice_id, amount, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [companyId, payment.id, invoiceId, paymentAmount, userId],
    );

    const newPaid = Number(inv.amount_paid || 0) + paymentAmount;
    const status = newPaid >= Number(inv.total_amount || 0) ? 'paid' : 'partial';
    await client.query(
      `UPDATE erp_vendor_invoices SET amount_paid = $2, status = $3, updated_at = NOW(), updated_by = $4 WHERE id = $1`,
      [invoiceId, newPaid, status, userId],
    );

    await client.query(
      `UPDATE erp_vendors SET ap_balance = GREATEST(ap_balance - $2, 0), updated_at = NOW()
       WHERE id = $1 AND company_id = $3`,
      [inv.vendor_id, paymentAmount, companyId],
    );

    await client.query('COMMIT');

    let journalId = null;
    if (postGl) {
      try {
        const accounts = await pool.query(
          `SELECT id, account_code FROM erp_chart_of_accounts
           WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_deleted = FALSE`,
          [companyId, [ACCOUNT_CODES.accountsPayable, ACCOUNT_CODES.cashAtBank]],
        );
        const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
        if (byCode[ACCOUNT_CODES.accountsPayable] && byCode[ACCOUNT_CODES.cashAtBank]) {
          const journal = await gl.createJournal({
            companyId,
            userId,
            entryDate: payment.payment_date,
            journalType: 'purchase',
            referenceNo: payment.payment_no,
            description: `Vendor payment ${payment.payment_no} for ${inv.bill_no}`,
            lines: [
              { account_id: byCode[ACCOUNT_CODES.accountsPayable], debit: paymentAmount, credit: 0 },
              { account_id: byCode[ACCOUNT_CODES.cashAtBank], debit: 0, credit: paymentAmount },
            ],
          });
          await gl.postJournal({ journalId: journal.id, companyId, userId });
          journalId = journal.id;
          await pool.query('UPDATE erp_vendor_payments SET journal_id = $1 WHERE id = $2', [journalId, payment.id]);
        }
      } catch (glErr) {
        console.error('AP payment GL posting failed', glErr);
      }
    }

    return { ok: true, payment_no: payment.payment_no, status, amount_paid: newPaid, journal_id: journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createVendorBillFromGrn,
  postVendorBill,
  recordVendorPayment,
  computeMatchStatus,
};
