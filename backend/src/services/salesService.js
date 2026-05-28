const pool = require('../db');
const { recordIssue } = require('./inventoryService');
const gl = require('./glPostingService');
const { ACCOUNT_CODES } = require('./accountCodes');

const VAT_RATE = 0.16;

async function nextNo(client, companyId, table, prefix) {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`, [companyId]);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
}

async function checkAtp(companyId, warehouseId, lines) {
  const shortages = [];
  for (const line of lines) {
    const stock = await pool.query(
      `SELECT quantity FROM erp_stock_on_hand
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [companyId, warehouseId, line.item_id],
    );
    const available = Number(stock.rows[0]?.quantity || 0);
    if (available < Number(line.quantity)) {
      shortages.push({ item_id: line.item_id, requested: line.quantity, available });
    }
  }
  return { ok: shortages.length === 0, shortages };
}

async function checkCreditLimit(companyId, customerId, orderTotal) {
  const result = await pool.query(
    `SELECT credit_limit FROM erp_customers WHERE id = $1 AND company_id = $2`,
    [customerId, companyId],
  );
  if (!result.rowCount) throw new Error('Customer not found');
  const limit = Number(result.rows[0].credit_limit || 0);

  const outstanding = await pool.query(
    `SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS outstanding
     FROM erp_customer_invoices
     WHERE company_id = $1 AND customer_id = $2 AND status IN ('posted','partial','overdue')`,
    [companyId, customerId],
  );
  const exposure = Number(outstanding.rows[0].outstanding) + Number(orderTotal);
  return { ok: exposure <= limit, credit_limit: limit, exposure };
}

async function createSalesOrder({ companyId, userId, customerId, warehouseId, quotationId, lines, orderDate, notes }) {
  if (!lines?.length) throw new Error('Order lines required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderNo = await nextNo(client, companyId, 'erp_sales_orders', 'SO');
    let subtotal = 0;
    for (const l of lines) subtotal += Number(l.quantity) * Number(l.unit_price);

    const taxAmount = Math.round(subtotal * VAT_RATE * 100) / 100;
    const total = subtotal + taxAmount;

    const soResult = await client.query(
      `INSERT INTO erp_sales_orders (
         company_id, customer_id, quotation_id, warehouse_id, order_no, order_date,
         status, subtotal, tax_amount, total_amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),'draft',$7,$8,$9,$10,$11) RETURNING *`,
      [companyId, customerId, quotationId, warehouseId, orderNo, orderDate, subtotal, taxAmount, total, notes, userId],
    );
    const so = soResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      const lt = Number(line.quantity) * Number(line.unit_price);
      await client.query(
        `INSERT INTO erp_sales_order_lines (
           company_id, sales_order_id, line_no, item_id, quantity, unit_price, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, so.id, lineNo++, line.item_id, line.quantity, line.unit_price, lt, userId],
      );
    }

    await client.query('COMMIT');
    return so;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function confirmSalesOrder({ companyId, userId, orderId }) {
  const soResult = await pool.query(
    `SELECT * FROM erp_sales_orders WHERE id = $1 AND company_id = $2 AND status = 'draft'`,
    [orderId, companyId],
  );
  const so = soResult.rows[0];
  if (!so) throw new Error('Sales order not found or not draft');

  const lines = await pool.query(
    `SELECT item_id, quantity FROM erp_sales_order_lines WHERE sales_order_id = $1`,
    [orderId],
  );

  const atp = await checkAtp(companyId, so.warehouse_id, lines.rows);
  if (!atp.ok) {
    return { ok: false, reason: 'atp_failed', shortages: atp.shortages };
  }

  const credit = await checkCreditLimit(companyId, so.customer_id, so.total_amount);
  if (!credit.ok) {
    return { ok: false, reason: 'credit_limit_exceeded', ...credit };
  }

  await pool.query(
    `UPDATE erp_sales_orders SET status = 'confirmed', credit_check_passed = TRUE, updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2`,
    [orderId, companyId, userId],
  );
  return { ok: true, order_id: orderId };
}

async function postDeliveryNote({ companyId, userId, deliveryId, postGl = true }) {
  let client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dnResult = await client.query(
      `SELECT * FROM erp_delivery_notes WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [deliveryId, companyId],
    );
    const dn = dnResult.rows[0];
    if (!dn) throw new Error('Delivery note not found or already posted');

    const lines = await client.query(`SELECT * FROM erp_delivery_note_lines WHERE delivery_note_id = $1`, [deliveryId]);
    let cogsTotal = 0;

    for (const line of lines.rows) {
      const cost = await recordIssue(client, {
        companyId,
        warehouseId: dn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        referenceType: 'delivery_note',
        referenceId: deliveryId,
        userId,
      });
      cogsTotal += Number(line.quantity) * Number(cost || line.unit_cost);

      if (line.so_line_id) {
        await client.query(
          `UPDATE erp_sales_order_lines SET qty_delivered = qty_delivered + $2, updated_at = NOW() WHERE id = $1`,
          [line.so_line_id, line.quantity],
        );
      }
    }

    await client.query(
      `UPDATE erp_delivery_notes SET status = 'posted', posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [deliveryId],
    );

    await client.query(
      `UPDATE erp_sales_orders so SET status = CASE
         WHEN (SELECT SUM(qty_delivered) FROM erp_sales_order_lines WHERE sales_order_id = so.id)
              >= (SELECT SUM(quantity) FROM erp_sales_order_lines WHERE sales_order_id = so.id)
         THEN 'delivered' ELSE 'partial' END WHERE id = $1`,
      [dn.sales_order_id],
    );

    await client.query('COMMIT');
    client.release();
    client = null;

    let journalId = null;
    if (postGl && cogsTotal > 0) {
      const accounts = await pool.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code = ANY($2::text[])`,
        [companyId, [ACCOUNT_CODES.cogs, ACCOUNT_CODES.inventory]],
      );
      const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
      if (byCode[ACCOUNT_CODES.cogs] && byCode[ACCOUNT_CODES.inventory]) {
        const journal = await gl.createJournal({
          companyId,
          userId,
          entryDate: dn.delivery_date,
          journalType: 'sales',
          referenceNo: dn.delivery_no,
          description: `COGS - ${dn.delivery_no}`,
          lines: [
            { account_id: byCode[ACCOUNT_CODES.cogs], debit: cogsTotal, credit: 0 },
            { account_id: byCode[ACCOUNT_CODES.inventory], debit: 0, credit: cogsTotal },
          ],
        });
        await gl.postJournal({ journalId: journal.id, companyId, userId });
        journalId = journal.id;
        await pool.query('UPDATE erp_delivery_notes SET journal_id = $1 WHERE id = $2', [journalId, deliveryId]);
      }
    }

    return { ok: true, delivery_id: deliveryId, cogs_total: cogsTotal, journal_id: journalId };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function createAndPostDelivery({ companyId, userId, salesOrderId, warehouseId, lines, deliveryDate }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deliveryNo = await nextNo(client, companyId, 'erp_delivery_notes', 'DN');
    const dnResult = await client.query(
      `INSERT INTO erp_delivery_notes (company_id, sales_order_id, warehouse_id, delivery_no, delivery_date, status, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),'draft',$6) RETURNING *`,
      [companyId, salesOrderId, warehouseId, deliveryNo, deliveryDate, userId],
    );
    const dn = dnResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      const stock = await client.query(
        `SELECT avg_unit_cost FROM erp_stock_on_hand WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
        [companyId, warehouseId, line.item_id],
      );
      const unitCost = line.unit_cost ?? stock.rows[0]?.avg_unit_cost ?? 0;
      await client.query(
        `INSERT INTO erp_delivery_note_lines (
           company_id, delivery_note_id, so_line_id, line_no, item_id, quantity, unit_cost, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, dn.id, line.so_line_id, lineNo++, line.item_id, line.quantity, unitCost, userId],
      );
    }
    await client.query('COMMIT');
    return postDeliveryNote({ companyId, userId, deliveryId: dn.id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postCustomerInvoice({ companyId, userId, invoiceId, postGl = true }) {
  let client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invResult = await client.query(
      `SELECT * FROM erp_customer_invoices WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [invoiceId, companyId],
    );
    const inv = invResult.rows[0];
    if (!inv) throw new Error('Invoice not found or already posted');

    await client.query(
      `UPDATE erp_customer_invoices SET status = 'posted', posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [invoiceId],
    );

    if (inv.sales_order_id) {
      await client.query(
        `UPDATE erp_sales_orders SET status = 'invoiced', updated_at = NOW() WHERE id = $1`,
        [inv.sales_order_id],
      );
    }

    await client.query('COMMIT');
    client.release();
    client = null;

    let journalId = null;
    let glWarning = null;
    if (postGl) {
      try {
        const accounts = await pool.query(
          `SELECT id, account_code FROM erp_chart_of_accounts
           WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_deleted = FALSE`,
          [companyId, [ACCOUNT_CODES.accountsReceivable, ACCOUNT_CODES.salesRevenue, ACCOUNT_CODES.vatOutput]],
        );
        const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
        if (byCode[ACCOUNT_CODES.accountsReceivable] && byCode[ACCOUNT_CODES.salesRevenue]) {
          const lines = [
            { account_id: byCode[ACCOUNT_CODES.accountsReceivable], debit: inv.total_amount, credit: 0, description: 'AR' },
            { account_id: byCode[ACCOUNT_CODES.salesRevenue], debit: 0, credit: inv.subtotal, description: 'Revenue' },
          ];
          if (byCode[ACCOUNT_CODES.vatOutput] && Number(inv.tax_amount) > 0) {
            lines.push({ account_id: byCode[ACCOUNT_CODES.vatOutput], debit: 0, credit: inv.tax_amount, description: 'VAT' });
          }
          const journal = await gl.createJournal({
            companyId,
            userId,
            entryDate: inv.invoice_date,
            journalType: 'sales',
            referenceNo: inv.invoice_no,
            description: `Customer invoice ${inv.invoice_no}`,
            lines,
          });
          await gl.postJournal({ journalId: journal.id, companyId, userId });
          journalId = journal.id;
          await pool.query('UPDATE erp_customer_invoices SET journal_id = $1 WHERE id = $2', [journalId, invoiceId]);
        } else {
          glWarning = 'Chart of accounts 1200/4000 missing — invoice posted without GL entry';
        }
      } catch (glErr) {
        console.error('Invoice GL posting failed', glErr);
        glWarning = glErr.message || 'GL posting failed';
      }
    }

    return { ok: true, invoice_id: invoiceId, journal_id: journalId, gl_warning: glWarning };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function createCustomerInvoice({ companyId, userId, customerId, salesOrderId, deliveryNoteId, lines, invoiceDate, dueDate }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceNo = await nextNo(client, companyId, 'erp_customer_invoices', 'INV');
    let subtotal = 0;
    for (const l of lines) subtotal += Number(l.quantity) * Number(l.unit_price);
    const taxAmount = Math.round(subtotal * VAT_RATE * 100) / 100;
    const total = subtotal + taxAmount;

    const invResult = await client.query(
      `INSERT INTO erp_customer_invoices (
         company_id, customer_id, sales_order_id, delivery_note_id, invoice_no, invoice_date, due_date,
         status, subtotal, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,'draft',$8,$9,$10,$11) RETURNING *`,
      [companyId, customerId, salesOrderId, deliveryNoteId, invoiceNo, invoiceDate, dueDate, subtotal, taxAmount, total, userId],
    );
    const inv = invResult.rows[0];

    let lineNo = 1;
    for (const line of lines) {
      const lt = Number(line.quantity) * Number(line.unit_price);
      const lineTax = Math.round(lt * VAT_RATE * 100) / 100;
      await client.query(
        `INSERT INTO erp_customer_invoice_lines (
           company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, inv.id, lineNo++, line.item_id, line.quantity, line.unit_price, lineTax, lt, userId],
      );
      if (line.so_line_id) {
        await client.query(
          `UPDATE erp_sales_order_lines SET qty_invoiced = qty_invoiced + $2 WHERE id = $1`,
          [line.so_line_id, line.quantity],
        );
      }
    }

    await client.query('COMMIT');
    return postCustomerInvoice({ companyId, userId, invoiceId: inv.id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function recordCustomerPayment({
  companyId,
  userId,
  invoiceId,
  paymentDate,
  amount,
  referenceNo,
  notes,
  postGl = true,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invResult = await client.query(
      `SELECT * FROM erp_customer_invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [invoiceId, companyId],
    );
    const inv = invResult.rows[0];
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'cancelled') throw new Error('Cannot pay cancelled invoice');

    const paymentAmount = Number(amount || 0);
    if (!paymentAmount || paymentAmount <= 0) throw new Error('Payment amount must be greater than zero');

    const outstanding = Number(inv.total_amount || 0) - Number(inv.amount_paid || 0);
    if (paymentAmount - outstanding > 0.0001) {
      throw new Error('Payment amount exceeds outstanding balance');
    }

    const paymentNo = await nextNo(client, companyId, 'erp_customer_receipts', 'RCP');
    const payResult = await client.query(
      `INSERT INTO erp_customer_receipts (
        company_id, receipt_no, customer_id, receipt_date, amount, payment_method, reference_no, status, created_by
      ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,'bank_transfer',$6,$7,$8)
      RETURNING *`,
      [companyId, paymentNo, inv.customer_id, paymentDate, paymentAmount, referenceNo, 'posted', userId],
    );
    const payment = payResult.rows[0];

    await client.query(
      `INSERT INTO erp_receipt_allocations (company_id, receipt_id, invoice_id, amount, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [companyId, payment.id, invoiceId, paymentAmount, userId],
    );

    const newPaid = Number(inv.amount_paid || 0) + paymentAmount;
    const status = newPaid >= Number(inv.total_amount || 0) ? 'paid' : 'partial';
    await client.query(
      `UPDATE erp_customer_invoices
       SET amount_paid = $2, status = $3, updated_at = NOW(), updated_by = $4
       WHERE id = $1`,
      [invoiceId, newPaid, status, userId],
    );

    await client.query('COMMIT');

    let journalId = null;
    if (postGl) {
      try {
        const accounts = await pool.query(
          `SELECT id, account_code FROM erp_chart_of_accounts
           WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_deleted = FALSE`,
          [companyId, [ACCOUNT_CODES.cashAtBank, ACCOUNT_CODES.accountsReceivable]],
        );
        const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
        if (byCode[ACCOUNT_CODES.cashAtBank] && byCode[ACCOUNT_CODES.accountsReceivable]) {
          const journal = await gl.createJournal({
            companyId,
            userId,
            entryDate: payment.receipt_date,
            journalType: 'sales',
            referenceNo: payment.receipt_no,
            description: `Customer payment ${payment.receipt_no} for ${inv.invoice_no}`,
            lines: [
              { account_id: byCode[ACCOUNT_CODES.cashAtBank], debit: paymentAmount, credit: 0 },
              { account_id: byCode[ACCOUNT_CODES.accountsReceivable], debit: 0, credit: paymentAmount },
            ],
          });
          await gl.postJournal({ journalId: journal.id, companyId, userId });
          journalId = journal.id;
          await pool.query('UPDATE erp_customer_receipts SET journal_id = $1 WHERE id = $2', [journalId, payment.id]);
        }
      } catch (glErr) {
        console.error('AR payment GL posting failed', glErr);
      }
    }

    return { ok: true, payment_no: payment.receipt_no, status, amount_paid: newPaid, journal_id: journalId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  checkAtp,
  checkCreditLimit,
  createSalesOrder,
  confirmSalesOrder,
  postDeliveryNote,
  createAndPostDelivery,
  createCustomerInvoice,
  postCustomerInvoice,
  recordCustomerPayment,
};
