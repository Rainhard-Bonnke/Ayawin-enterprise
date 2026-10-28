const pool = require("../db");
const gl = require("./glPostingService");

async function nextNumber(client, companyId, prefix) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
    companyId,
    prefix,
  ]);
  const result = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${prefix === "BILL" ? "erp_supplier_bills" : "erp_supplier_payments"} WHERE company_id = $1`,
    [companyId],
  );
  return `${prefix}-${new Date().getFullYear()}-${String(Number(result.rows[0].count) + 1).padStart(5, "0")}`;
}

async function createBill({
  companyId,
  userId,
  vendorId,
  supplierInvoiceNo,
  billDate,
  dueDate,
  lines,
  notes,
  purchaseOrderId,
  goodsReceiptId,
}) {
  if (!vendorId || !String(supplierInvoiceNo || "").trim())
    throw new Error("Supplier and supplier invoice number are required");
  if (!Array.isArray(lines) || !lines.length) throw new Error("At least one bill line is required");
  if (
    lines.some((line) => {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      const taxRate = Number(line.tax_rate || 0);
      return (
        !line.description ||
        !line.account_id ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0 ||
        !Number.isFinite(taxRate) ||
        taxRate < 0 ||
        taxRate > 100
      );
    })
  ) {
    throw new Error(
      "Each line needs a description, expense account, positive quantity and non-negative unit price",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vendor = await client.query(
      "SELECT id, currency_code FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE",
      [vendorId, companyId],
    );
    if (!vendor.rowCount) throw new Error("Supplier not found or inactive");
    if (Boolean(purchaseOrderId) !== Boolean(goodsReceiptId)) {
      throw new Error("A matched supplier bill must reference both its purchase order and goods receipt");
    }
    if (goodsReceiptId) {
      const receipt = await client.query(
        `SELECT gr.id, gr.purchase_order_id, po.vendor_id
         FROM erp_goods_receipts gr JOIN erp_purchase_orders po ON po.id = gr.purchase_order_id
         WHERE gr.id = $1 AND gr.company_id = $2 AND po.company_id = $2
           AND gr.purchase_order_id = $3 AND po.vendor_id = $4
           AND gr.status = 'posted' AND gr.is_deleted = FALSE
         FOR UPDATE OF gr`,
        [goodsReceiptId, companyId, purchaseOrderId, vendorId],
      );
      if (!receipt.rowCount) throw new Error("The posted goods receipt, purchase order and supplier do not match");
    }
    const accountIds = [...new Set(lines.map((line) => line.account_id))];
    const accounts = await client.query(
      "SELECT id, account_type, is_postable FROM erp_chart_of_accounts WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE AND is_deleted = FALSE",
      [companyId, accountIds],
    );
    if (
      accounts.rowCount !== accountIds.length ||
      accounts.rows.some(
        (account) => !account.is_postable || !["expense", "asset"].includes(account.account_type),
      )
    ) {
      throw new Error(
        "Bill lines must use active postable expense or asset accounts from this company",
      );
    }

    const billNo = await nextNumber(client, companyId, "BILL");
    let subtotal = 0;
    let taxAmount = 0;
    const normalized = lines.map((line, index) => {
      const net = Math.round(Number(line.quantity) * Number(line.unit_price) * 100) / 100;
      const tax = Math.round(net * Number(line.tax_rate || 0) * 100) / 10000;
      subtotal += net;
      taxAmount += tax;
      return { ...line, lineNo: index + 1, net, tax };
    });
    if (goodsReceiptId) {
      const matchedIds = new Set();
      for (const line of normalized) {
        const receiptLineId = line.goods_receipt_line_id;
        if (!receiptLineId || matchedIds.has(receiptLineId)) {
          throw new Error("Every matched bill line must reference a different goods receipt line");
        }
        matchedIds.add(receiptLineId);
        const receiptLine = await client.query(
          `SELECT gl.id, gl.quantity, gl.unit_cost, gl.po_line_id
           FROM erp_goods_receipt_lines gl
           JOIN erp_goods_receipts gr ON gr.id = gl.goods_receipt_id
           JOIN erp_purchase_order_lines pol ON pol.id = gl.po_line_id
           WHERE gl.id = $1 AND gl.goods_receipt_id = $2 AND gl.company_id = $3
             AND gr.purchase_order_id = $4 AND pol.purchase_order_id = $4
             AND gl.is_deleted = FALSE AND pol.is_deleted = FALSE`,
          [receiptLineId, goodsReceiptId, companyId, purchaseOrderId],
        );
        const source = receiptLine.rows[0];
        if (!source) throw new Error("A bill line does not belong to the selected goods receipt and purchase order");
        const alreadyBilled = await client.query(
          `SELECT COALESCE(SUM(bl.quantity), 0) AS quantity
           FROM erp_supplier_bill_lines bl
           JOIN erp_supplier_bills b ON b.id = bl.bill_id
           WHERE bl.company_id = $1 AND bl.goods_receipt_line_id = $2
             AND b.status <> 'cancelled' AND b.is_deleted = FALSE`,
          [companyId, receiptLineId],
        );
        const remaining = Number(source.quantity) - Number(alreadyBilled.rows[0].quantity);
        if (Number(line.quantity) > remaining + 0.00005) {
          throw new Error("Supplier bill quantity exceeds the unbilled received quantity");
        }
        if (Math.abs(Number(line.unit_price) - Number(source.unit_cost)) > 0.00005) {
          throw new Error("Supplier bill price differs from the received purchase order price; route the variance for approval");
        }
      }
    } else if (normalized.some((line) => line.goods_receipt_line_id)) {
      throw new Error("Receipt-linked bill lines require the purchase order and goods receipt on the bill");
    }
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    const bill = await client.query(
      `INSERT INTO erp_supplier_bills
       (company_id, vendor_id, purchase_order_id, goods_receipt_id, bill_no, supplier_invoice_no,
        bill_date, due_date, currency_code, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),COALESCE($8,COALESCE($7,CURRENT_DATE)),
        COALESCE($9,'KES'),$10,$11,$12,$13,$14) RETURNING *`,
      [
        companyId,
        vendorId,
        purchaseOrderId || null,
        goodsReceiptId || null,
        billNo,
        String(supplierInvoiceNo).trim(),
        billDate || null,
        dueDate || null,
        vendor.rows[0].currency_code || "KES",
        subtotal,
        taxAmount,
        total,
        notes || null,
        userId,
      ],
    );
    for (const line of normalized) {
      await client.query(
        `INSERT INTO erp_supplier_bill_lines
         (company_id, bill_id, line_no, description, quantity, unit_price, tax_rate, net_amount, tax_amount, account_id, goods_receipt_line_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          companyId,
          bill.rows[0].id,
          line.lineNo,
          line.description,
          line.quantity,
          line.unit_price,
          line.tax_rate || 0,
          line.net,
          line.tax,
          line.account_id,
          line.goods_receipt_line_id || null,
          userId,
        ],
      );
    }
    await client.query("COMMIT");
    return bill.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function postBill({ companyId, userId, billId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_supplier_bills WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [billId, companyId],
    );
    const bill = result.rows[0];
    if (!bill) throw new Error("Supplier bill not found");
    if (!["draft", "approved"].includes(bill.status)) throw new Error("Supplier bill cannot be posted in its current state");
    if (bill.created_by === userId) throw new Error("The bill preparer cannot approve and post their own supplier bill");
    const lineResult = await client.query(
      `SELECT l.*, a.account_name FROM erp_supplier_bill_lines l
       JOIN erp_chart_of_accounts a ON a.id = l.account_id
       WHERE l.bill_id = $1 AND l.company_id = $2 ORDER BY l.line_no`,
      [billId, companyId],
    );
    if (!lineResult.rowCount) throw new Error("Supplier bill has no lines");
    if (bill.goods_receipt_id) {
      if (!bill.purchase_order_id || lineResult.rows.some((line) => !line.goods_receipt_line_id)) {
        throw new Error("A receipt-linked bill must match every line to a goods receipt line before posting");
      }
      const receipt = await client.query(
        `SELECT gr.id FROM erp_goods_receipts gr
         JOIN erp_purchase_orders po ON po.id = gr.purchase_order_id
         WHERE gr.id = $1 AND gr.company_id = $2 AND gr.purchase_order_id = $3
           AND po.vendor_id = $4 AND gr.status = 'posted' AND gr.is_deleted = FALSE
         FOR UPDATE OF gr`,
        [bill.goods_receipt_id, companyId, bill.purchase_order_id, bill.vendor_id],
      );
      if (!receipt.rowCount) throw new Error("The posted goods receipt, purchase order and supplier no longer match");
      const matchedReceiptLineIds = new Set();
      for (const line of lineResult.rows) {
        if (matchedReceiptLineIds.has(line.goods_receipt_line_id)) throw new Error("A goods receipt line appears more than once on the bill");
        matchedReceiptLineIds.add(line.goods_receipt_line_id);
        const source = await client.query(
          `SELECT gl.quantity, gl.unit_cost
           FROM erp_goods_receipt_lines gl
           WHERE gl.id = $1 AND gl.goods_receipt_id = $2 AND gl.company_id = $3 AND gl.is_deleted = FALSE`,
          [line.goods_receipt_line_id, bill.goods_receipt_id, companyId],
        );
        if (!source.rowCount) throw new Error("A bill line references a goods receipt line outside its receipt");
        const billedElsewhere = await client.query(
          `SELECT COALESCE(SUM(bl.quantity), 0) AS quantity
           FROM erp_supplier_bill_lines bl JOIN erp_supplier_bills b ON b.id = bl.bill_id
           WHERE bl.company_id = $1 AND bl.goods_receipt_line_id = $2
             AND b.id <> $3 AND b.status <> 'cancelled' AND b.is_deleted = FALSE`,
          [companyId, line.goods_receipt_line_id, billId],
        );
        const remaining = Number(source.rows[0].quantity) - Number(billedElsewhere.rows[0].quantity);
        if (Number(line.quantity) > remaining + 0.00005
          || Math.abs(Number(line.unit_price) - Number(source.rows[0].unit_cost)) > 0.00005) {
          throw new Error("Bill quantity or price no longer matches the unbilled goods receipt balance");
        }
      }
    }
    const payable = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '2100'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [companyId],
    );
    if (!payable.rowCount) throw new Error("Accounts Payable control account 2100 is missing or not postable");
    const tax = Number(bill.tax_amount);
    let inputVatId = null;
    if (tax > 0) {
      const inputVat = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '1400'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [companyId],
      );
      if (!inputVat.rowCount) throw new Error("Input VAT account 1400 is missing or not postable");
      inputVatId = inputVat.rows[0].id;
    }
    let journalLines;
    if (bill.goods_receipt_id) {
      const accrual = await client.query(
        `SELECT jl.account_id AS id, a.account_code
         FROM erp_goods_receipts gr
         JOIN erp_journals j ON j.id = gr.journal_id AND j.company_id = gr.company_id AND j.status = 'posted'
         JOIN erp_journal_lines jl ON jl.journal_id = j.id AND jl.company_id = j.company_id AND jl.credit > 0
         JOIN erp_chart_of_accounts a ON a.id = jl.account_id AND a.company_id = gr.company_id
         WHERE gr.id = $1 AND gr.company_id = $2 AND a.account_type = 'liability'
           AND a.is_active = TRUE AND a.is_deleted = FALSE AND a.is_postable = TRUE
         ORDER BY jl.line_no LIMIT 1`,
        [bill.goods_receipt_id, companyId],
      );
      if (!accrual.rowCount) throw new Error("The goods receipt has no posted receipt accrual to clear");
      journalLines = [{
        account_id: accrual.rows[0].id,
        debit: Number(bill.subtotal),
        credit: 0,
        description: `Clear ${accrual.rows[0].account_code} receipt accrual for ${bill.supplier_invoice_no}`,
      }];
    } else {
      journalLines = lineResult.rows.map((line) => ({
        account_id: line.account_id, debit: Number(line.net_amount), credit: 0, description: line.description,
      }));
    }
    if (tax > 0) journalLines.push({ account_id: inputVatId, debit: tax, credit: 0, description: "Input VAT on supplier bill" });
    journalLines.push({ account_id: payable.rows[0].id, debit: 0, credit: Number(bill.total_amount), description: `Supplier payable ${bill.supplier_invoice_no}` });
    const journal = await gl.createJournalInTransaction(client, {
      companyId, userId, entryDate: bill.bill_date, journalType: "purchase",
      referenceNo: bill.bill_no, description: `Supplier bill ${bill.supplier_invoice_no}`,
      lines: journalLines, currencyCode: bill.currency_code || "KES",
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    const posted = await client.query(
      `UPDATE erp_supplier_bills SET status = 'posted', journal_id = $3, posted_at = NOW(), updated_by = $4
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [billId, companyId, journal.id, userId],
    );
    await client.query("COMMIT");
    return { bill: posted.rows[0], journal_id: journal.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}


async function createPayment({
  companyId,
  userId,
  vendorId,
  paymentDate,
  paymentMethod,
  referenceNo,
  bankAccountId,
  notes,
  allocations,
}) {
  if (!vendorId || !bankAccountId || !Array.isArray(allocations) || !allocations.length) {
    throw new Error("Supplier, bank account and at least one bill allocation are required");
  }
  const normalized = allocations.map((entry) => ({
    billId: entry.bill_id,
    amount: Math.round(Number(entry.amount) * 100) / 100,
  }));
  if (
    normalized.some((entry) => !entry.billId || !Number.isFinite(entry.amount) || entry.amount <= 0)
  ) {
    throw new Error("Every allocation needs a bill and a positive amount");
  }
  if (new Set(normalized.map((entry) => entry.billId)).size !== normalized.length) {
    throw new Error("A bill can only appear once in a payment allocation");
  }
  const amount = Math.round(normalized.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vendor = await client.query(
      "SELECT id FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE",
      [vendorId, companyId],
    );
    if (!vendor.rowCount) throw new Error("Supplier not found or inactive");
    const bills = await client.query(
      `SELECT id, vendor_id, total_amount, amount_paid FROM erp_supplier_bills
       WHERE company_id = $1 AND vendor_id = $2 AND id = ANY($3::uuid[]) AND status IN ('posted','partial','overdue') AND is_deleted = FALSE
       FOR UPDATE`,
      [companyId, vendorId, normalized.map((entry) => entry.billId)],
    );
    if (bills.rowCount !== normalized.length)
      throw new Error("Every allocated bill must be posted and belong to the selected supplier");
    const byId = Object.fromEntries(bills.rows.map((bill) => [bill.id, bill]));
    for (const allocation of normalized) {
      const bill = byId[allocation.billId];
      if (allocation.amount > Number(bill.total_amount) - Number(bill.amount_paid) + 0.0001)
        throw new Error("An allocation exceeds the outstanding bill balance");
    }
    const bank = await client.query(
      "SELECT id, is_postable FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset' AND is_active = TRUE AND is_deleted = FALSE",
      [bankAccountId, companyId],
    );
    if (!bank.rowCount || !bank.rows[0].is_postable)
      throw new Error("Choose a postable bank or cash asset account");
    const paymentNo = await nextNumber(client, companyId, "PAY");
    const payment = await client.query(
      `INSERT INTO erp_supplier_payments (company_id, vendor_id, payment_no, payment_date, amount, payment_method, reference_no, bank_account_id, notes, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,COALESCE($6,'bank'),$7,$8,$9,$10) RETURNING *`,
      [
        companyId,
        vendorId,
        paymentNo,
        paymentDate || null,
        amount,
        paymentMethod || "bank",
        referenceNo || null,
        bankAccountId,
        notes || null,
        userId,
      ],
    );
    for (const allocation of normalized) {
      await client.query(
        `INSERT INTO erp_supplier_payment_allocations (company_id, payment_id, bill_id, amount, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [companyId, payment.rows[0].id, allocation.billId, allocation.amount, userId],
      );
    }
    await client.query("COMMIT");
    return payment.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function postPayment({ companyId, userId, paymentId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_supplier_payments WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [paymentId, companyId],
    );
    const payment = result.rows[0];
    if (!payment || payment.status !== "draft") throw new Error("Supplier payment not found or already processed");
    if (payment.created_by === userId) throw new Error("The payment preparer cannot approve and post their own supplier payment");
    const allocations = await client.query(
      `SELECT a.bill_id, a.amount, b.vendor_id, b.total_amount, b.amount_paid, b.status, b.supplier_invoice_no
       FROM erp_supplier_payment_allocations a JOIN erp_supplier_bills b ON b.id = a.bill_id
       WHERE a.payment_id = $1 AND a.company_id = $2 FOR UPDATE OF b`,
      [paymentId, companyId],
    );
    if (!allocations.rowCount || Math.abs(allocations.rows.reduce((sum, row) => sum + Number(row.amount), 0) - Number(payment.amount)) > 0.01) {
      throw new Error("Payment allocations do not match the payment total");
    }
    for (const allocation of allocations.rows) {
      if (allocation.vendor_id !== payment.vendor_id || !["posted", "partial", "overdue"].includes(allocation.status)
        || Number(allocation.amount) > Number(allocation.total_amount) - Number(allocation.amount_paid) + 0.0001) {
        throw new Error(`Bill ${allocation.supplier_invoice_no} is no longer available for this payment`);
      }
    }
    const payable = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '2100'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [companyId],
    );
    if (!payable.rowCount) throw new Error("Accounts Payable control account 2100 is missing or not postable");
    const bank = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [payment.bank_account_id, companyId],
    );
    if (!bank.rowCount) throw new Error("Payment bank/cash account is missing or not postable");
    const journal = await gl.createJournalInTransaction(client, {
      companyId, userId, entryDate: payment.payment_date, journalType: "payment",
      referenceNo: payment.payment_no, description: `Supplier payment ${payment.payment_no}`,
      lines: [
        { account_id: payable.rows[0].id, debit: Number(payment.amount), credit: 0, description: "Settle supplier balance" },
        { account_id: payment.bank_account_id, debit: 0, credit: Number(payment.amount), description: `Bank payment ${payment.reference_no || payment.payment_no}` },
      ],
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    for (const allocation of allocations.rows) {
      const nextPaid = Number(allocation.amount_paid) + Number(allocation.amount);
      const status = nextPaid >= Number(allocation.total_amount) - 0.01 ? "paid" : "partial";
      await client.query(
        `UPDATE erp_supplier_bills SET amount_paid = $3, status = $4, updated_by = $5
         WHERE id = $1 AND company_id = $2`,
        [allocation.bill_id, companyId, nextPaid, status, userId],
      );
    }
    await client.query(
      `UPDATE erp_supplier_payments SET status = 'posted', journal_id = $3
       WHERE id = $1 AND company_id = $2`,
      [paymentId, companyId, journal.id],
    );
    await client.query("COMMIT");
    return { ok: true, journal_id: journal.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}


module.exports = { createBill, postBill, createPayment, postPayment };
