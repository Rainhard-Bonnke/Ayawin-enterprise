const pool = require('../db');
const { recordIssue, recordReceipt, publishInventoryUpdate, afterStockMovement } = require('./inventoryService');
const gl = require('./glPostingService');
const { ACCOUNT_CODES } = require('./accountCodes');
const integration = require('./integrationService');
const taxEngine = require('../lib/taxEngine');
const discountPolicy = require('../lib/discountPolicy');
const { resolveUnitPrice } = require('../lib/salesPricing');
const orderWorkflow = require('../lib/orderWorkflow');
const liveEvents = require('./liveEventsService');
const { nextSequentialNo } = require('../lib/documentNumbers');
const { applyCreditLimitCheck } = require('../lib/creditLimitPolicy');

const VAT_RATE = taxEngine.VAT_RATE;

async function nextNo(client, companyId, table, prefix) {
  const columnByTable = {
    erp_customer_invoices: 'invoice_no',
    erp_customer_receipts: 'receipt_no',
    erp_sales_orders: 'order_no',
    erp_delivery_notes: 'delivery_no',
  };
  const column = columnByTable[table];
  if (column) {
    return nextSequentialNo(client, { companyId, table, column, prefix });
  }
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`, [companyId]);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, '0')}`;
}

async function getReservedQuantity(companyId, warehouseId, itemId, excludeOrderId = null) {
  const params = [companyId, warehouseId, itemId];
  let exclude = '';
  if (excludeOrderId) {
    params.push(excludeOrderId);
    exclude = ` AND so.id <> $${params.length}`;
  }
  const result = await pool.query(
    `SELECT COALESCE(SUM(sol.quantity), 0)::numeric AS reserved
     FROM erp_sales_order_lines sol
     JOIN erp_sales_orders so ON so.id = sol.sales_order_id AND so.is_deleted = FALSE
     WHERE so.company_id = $1 AND so.warehouse_id = $2 AND sol.item_id = $3
       AND so.status = 'confirmed'${exclude}`,
    params,
  );
  return Number(result.rows[0]?.reserved || 0);
}

async function checkAtp(companyId, warehouseId, lines, { excludeOrderId } = {}) {
  const shortages = [];
  for (const line of lines) {
    const stock = await pool.query(
      `SELECT quantity FROM erp_stock_on_hand
       WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3`,
      [companyId, warehouseId, line.item_id],
    );
    const onHand = Number(stock.rows[0]?.quantity || 0);
    const reserved = await getReservedQuantity(companyId, warehouseId, line.item_id, excludeOrderId);
    const available = onHand - reserved;
    if (available < Number(line.quantity)) {
      shortages.push({
        item_id: line.item_id,
        requested: line.quantity,
        available: Math.max(available, 0),
        on_hand: onHand,
        reserved,
      });
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
  if (limit <= 0) {
    return { ok: true, credit_limit: limit, exposure: Number(orderTotal), unlimited: true };
  }

  const outstanding = await pool.query(
    `SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS outstanding
     FROM erp_customer_invoices
     WHERE company_id = $1 AND customer_id = $2 AND status IN ('posted','partial','overdue')`,
    [companyId, customerId],
  );
  const exposure = Number(outstanding.rows[0].outstanding) + Number(orderTotal);
  return { ok: exposure <= limit, credit_limit: limit, exposure };
}

async function assertCustomerActive(companyId, customerId) {
  const result = await pool.query(
    `SELECT is_active FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [customerId, companyId],
  );
  if (!result.rowCount) throw new Error('Customer not found');
  if (result.rows[0].is_active === false) throw new Error('Customer is inactive — cannot create orders or invoices');
}

async function previewOrderTotals({ companyId, customerId, lines }) {
  if (!lines?.length) throw new Error('Order lines required');
  const client = await pool.connect();
  try {
    const itemIds = lines.map((l) => l.item_id);
    const itemMeta = await taxEngine.loadItemTaxMeta(client, companyId, itemIds);
    const priced = taxEngine.computeDocumentLines(lines, itemMeta);
    return priced;
  } finally {
    client.release();
  }
}

async function createSalesOrder({
  companyId, userId, customerId, warehouseId, quotationId, lines, orderDate, notes, actor, salesRepId,
}) {
  if (!lines?.length) throw new Error('Order lines required');
  if (actor) discountPolicy.assertLineDiscounts(actor, lines);
  await assertCustomerActive(companyId, customerId);

  const pricedLines = [];
  for (const line of lines) {
    let unitPrice = Number(line.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      const resolved = await resolveUnitPrice(pool, companyId, customerId, line.item_id);
      unitPrice = resolved.unit_price;
    }
    pricedLines.push({ ...line, unit_price: unitPrice });
  }

  // ATP is enforced on confirm, not on draft creation (quotation convert / new order draft).

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderNo = await nextNo(client, companyId, 'erp_sales_orders', 'SO');
    const itemIds = pricedLines.map((l) => l.item_id);
    const itemMeta = await taxEngine.loadItemTaxMeta(client, companyId, itemIds);
    const priced = taxEngine.computeDocumentLines(pricedLines, itemMeta);
    const { subtotal, exciseAmount, taxAmount, total } = priced;
    const repId = salesRepId || userId;

    const credit = applyCreditLimitCheck(await checkCreditLimit(companyId, customerId, total));

    const soResult = await client.query(
      `INSERT INTO erp_sales_orders (
         company_id, customer_id, quotation_id, warehouse_id, order_no, order_date,
         status, subtotal, excise_amount, tax_amount, total_amount, notes, created_by, sales_rep_id
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),'draft',$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [companyId, customerId, quotationId, warehouseId, orderNo, orderDate, subtotal, exciseAmount, taxAmount, total, notes, userId, repId],
    );
    const so = soResult.rows[0];

    let lineNo = 1;
    for (let i = 0; i < priced.lines.length; i++) {
      const line = priced.lines[i];
      const src = pricedLines[i];
      await client.query(
        `INSERT INTO erp_sales_order_lines (
           company_id, sales_order_id, line_no, item_id, quantity, unit_price, discount_percent, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          companyId, so.id, lineNo++, line.item_id, line.quantity, line.unit_price,
          src.discount_percent || 0, line.lineSubtotal, userId,
        ],
      );
    }

    await client.query('COMMIT');
    return { ...so, credit_warning: credit.warning ? credit.message : undefined };
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
  await assertCustomerActive(companyId, so.customer_id);
  const transitionErr = orderWorkflow.assertCanTransition(so.status, 'confirmed');
  if (transitionErr) throw transitionErr;

  const lines = await pool.query(
    `SELECT item_id, quantity FROM erp_sales_order_lines WHERE sales_order_id = $1`,
    [orderId],
  );

  const atp = await checkAtp(companyId, so.warehouse_id, lines.rows, { excludeOrderId: orderId });
  if (!atp.ok) {
    const err = new Error('Insufficient stock — cannot confirm order');
    err.code = 'ATP_FAILED';
    err.details = atp.shortages;
    throw err;
  }

  const credit = applyCreditLimitCheck(await checkCreditLimit(companyId, so.customer_id, so.total_amount));

  await pool.query(
    `UPDATE erp_sales_orders SET status = 'confirmed', credit_check_passed = TRUE, updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2`,
    [orderId, companyId, userId],
  );
  liveEvents.publish(companyId, 'sales_order.confirmed', {
    order_id: orderId,
    order_no: so.order_no,
    warehouse_id: so.warehouse_id,
  });
  liveEvents.publish(companyId, 'inventory.updated', {
    sales_order_id: orderId,
    reason: 'confirmed',
  });
  return {
    ok: true,
    order_id: orderId,
    credit_warning: credit.warning ? credit.message : undefined,
  };
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

    if (process.env.AUTO_INVOICE_ON_DELIVERY !== 'false') {
      try {
        await tryAutoInvoiceFromDeliveredOrder({ companyId, userId, salesOrderId: dn.sales_order_id });
      } catch (autoErr) {
        console.error('Auto-invoice after delivery failed', autoErr.message);
      }
    }

    for (const line of lines.rows) {
      await afterStockMovement(companyId, {
        warehouseId: dn.warehouse_id,
        itemId: line.item_id,
        delivery_id: deliveryId,
        type: 'delivery',
      });
    }
    liveEvents.publish(companyId, 'delivery.updated', {
      delivery_id: deliveryId,
      logistics_status: 'posted',
    });
    return { ok: true, delivery_id: deliveryId, cogs_total: cogsTotal, journal_id: journalId };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function tryAutoInvoiceFromDeliveredOrder({ companyId, userId, salesOrderId }) {
  const so = await pool.query(
    `SELECT id, customer_id, status FROM erp_sales_orders WHERE id = $1 AND company_id = $2`,
    [salesOrderId, companyId],
  );
  if (!so.rowCount || so.rows[0].status !== 'delivered') return null;

  const existing = await pool.query(
    `SELECT id FROM erp_customer_invoices
     WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status <> 'cancelled'`,
    [salesOrderId, companyId],
  );
  if (existing.rowCount) return existing.rows[0];

  const lineRows = await pool.query(
    `SELECT id, item_id, unit_price, qty_delivered, qty_invoiced
     FROM erp_sales_order_lines WHERE sales_order_id = $1 AND is_deleted = FALSE`,
    [salesOrderId],
  );
  const lines = lineRows.rows
    .map((l) => ({
      so_line_id: l.id,
      item_id: l.item_id,
      quantity: Number(l.qty_delivered) - Number(l.qty_invoiced),
      unit_price: Number(l.unit_price),
    }))
    .filter((l) => l.quantity > 0);
  if (!lines.length) return null;

  return createCustomerInvoice({
    companyId,
    userId,
    customerId: so.rows[0].customer_id,
    salesOrderId,
    lines,
    invoiceDate: new Date().toISOString().slice(0, 10),
  });
}

async function reversePostedDeliveries(client, companyId, userId, orderId) {
  const dns = await client.query(
    `SELECT id, warehouse_id FROM erp_delivery_notes
     WHERE sales_order_id = $1 AND company_id = $2 AND status = 'posted' AND is_deleted = FALSE`,
    [orderId, companyId],
  );
  for (const dn of dns.rows) {
    const lines = await client.query(
      `SELECT * FROM erp_delivery_note_lines WHERE delivery_note_id = $1`,
      [dn.id],
    );
    for (const line of lines.rows) {
      await recordReceipt(client, {
        companyId,
        warehouseId: dn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        referenceType: 'order_cancel_reversal',
        referenceId: orderId,
        userId,
      });
      if (line.so_line_id) {
        await client.query(
          `UPDATE erp_sales_order_lines
           SET qty_delivered = GREATEST(0, qty_delivered - $2), updated_at = NOW()
           WHERE id = $1`,
          [line.so_line_id, line.quantity],
        );
      }
    }
    await client.query(
      `UPDATE erp_delivery_notes SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [dn.id],
    );
  }
}

async function createAndPostDelivery({
  companyId, userId, salesOrderId, warehouseId, lines, deliveryDate, driverId, vehicleId,
}) {
  const soCheck = await pool.query(
    `SELECT status FROM erp_sales_orders WHERE id = $1 AND company_id = $2`,
    [salesOrderId, companyId],
  );
  if (!soCheck.rowCount) throw new Error('Sales order not found');
  orderWorkflow.assertDispatchAllowed(soCheck.rows[0].status);

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
    const deliveryLogistics = require('./deliveryService');
    await deliveryLogistics.enrichAfterCreate(companyId, dn.id, { driverId, vehicleId });
    const result = await postDeliveryNote({ companyId, userId, deliveryId: dn.id });
    await deliveryLogistics.markDeliveredAfterPost(companyId, dn.id, userId);
    return result;
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
    const isProforma = String(inv.invoice_type || 'tax') === 'proforma';

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
    if (postGl && !isProforma) {
      try {
        const accounts = await pool.query(
          `SELECT id, account_code FROM erp_chart_of_accounts
           WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_deleted = FALSE`,
          [companyId, [
            ACCOUNT_CODES.accountsReceivable,
            ACCOUNT_CODES.salesRevenue,
            ACCOUNT_CODES.vatOutput,
            ACCOUNT_CODES.excisePayable,
          ]],
        );
        const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
        if (byCode[ACCOUNT_CODES.accountsReceivable] && byCode[ACCOUNT_CODES.salesRevenue]) {
          const lines = [
            { account_id: byCode[ACCOUNT_CODES.accountsReceivable], debit: inv.total_amount, credit: 0, description: 'AR' },
            { account_id: byCode[ACCOUNT_CODES.salesRevenue], debit: 0, credit: inv.subtotal, description: 'Revenue' },
          ];
          const exciseAmt = Number(inv.excise_amount || 0);
          if (byCode[ACCOUNT_CODES.excisePayable] && exciseAmt > 0) {
            lines.push({ account_id: byCode[ACCOUNT_CODES.excisePayable], debit: 0, credit: exciseAmt, description: 'Excise' });
          }
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

    let etimsRef = null;
    if (!isProforma) {
      try {
        const etims = await submitInvoiceToEtims({ companyId, invoiceId });
        etimsRef = etims.etims_ref || null;
      } catch (etimsErr) {
        console.error('eTIMS auto-submit failed', etimsErr);
      }
    }

    liveEvents.publish(companyId, 'invoice.updated', { invoice_id: invoiceId });

    return {
      ok: true,
      invoice_id: invoiceId,
      journal_id: journalId,
      gl_warning: glWarning,
      etims_ref: etimsRef,
      proforma: isProforma,
    };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function submitInvoiceToEtims({ companyId, invoiceId }) {
  const invResult = await pool.query(
    `SELECT inv.*, c.tax_id, c.name AS customer_name
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.id = $1 AND inv.company_id = $2`,
    [invoiceId, companyId],
  );
  const inv = invResult.rows[0];
  if (!inv) throw new Error('Invoice not found');

  const lines = await pool.query(
    `SELECT vil.*, i.item_code, i.name AS item_name
     FROM erp_customer_invoice_lines vil JOIN erp_items i ON i.id = vil.item_id
     WHERE vil.invoice_id = $1`,
    [invoiceId],
  );

  const result = await integration.submitEtimsInvoice({
    companyId,
    invoice: {
      invoice_no: inv.invoice_no,
      tax_id: inv.tax_id,
      total_amount: inv.total_amount,
      lines: lines.rows,
    },
  });

  if (result.etims_ref) {
    await pool.query('UPDATE erp_customer_invoices SET etims_ref = $2, updated_at = NOW() WHERE id = $1', [
      invoiceId,
      result.etims_ref,
    ]);
  }
  return result;
}

async function createCustomerInvoice({
  companyId, userId, customerId, salesOrderId, deliveryNoteId, lines, invoiceDate, dueDate, invoiceType = 'tax',
}) {
  if (salesOrderId) {
    const existingInv = await pool.query(
      `SELECT id, status FROM erp_customer_invoices
       WHERE sales_order_id = $1 AND company_id = $2 AND is_deleted = FALSE AND status <> 'cancelled'
       ORDER BY created_at DESC LIMIT 1`,
      [salesOrderId, companyId],
    );
    if (existingInv.rowCount) {
      const row = existingInv.rows[0];
      if (row.status === 'draft') {
        return postCustomerInvoice({ companyId, userId, invoiceId: row.id });
      }
      return { ok: true, invoice_id: row.id, already_exists: true };
    }

    const soCheck = await pool.query(
      `SELECT status FROM erp_sales_orders WHERE id = $1 AND company_id = $2`,
      [salesOrderId, companyId],
    );
    if (!soCheck.rowCount) throw new Error('Sales order not found');
    orderWorkflow.assertInvoiceFromOrderAllowed(soCheck.rows[0].status);
    const delivered = await pool.query(
      `SELECT COALESCE(SUM(qty_delivered), 0) AS d, COALESCE(SUM(quantity), 0) AS q
       FROM erp_sales_order_lines WHERE sales_order_id = $1`,
      [salesOrderId],
    );
    if (Number(delivered.rows[0].d) <= 0) {
      throw new Error('No delivered quantities to invoice');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const invoiceNo = await nextNo(client, companyId, 'erp_customer_invoices', 'INV');
    const itemIds = lines.map((l) => l.item_id);
    const itemMeta = await taxEngine.loadItemTaxMeta(client, companyId, itemIds);
    const priced = taxEngine.computeDocumentLines(lines, itemMeta);
    const { subtotal, exciseAmount, taxAmount, total } = priced;
    const invType = invoiceType === 'proforma' ? 'proforma' : 'tax';

    const invResult = await client.query(
      `INSERT INTO erp_customer_invoices (
         company_id, customer_id, sales_order_id, delivery_note_id, invoice_no, invoice_date, due_date,
         status, invoice_type, subtotal, excise_amount, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,'draft',$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        companyId, customerId, salesOrderId, deliveryNoteId, invoiceNo, invoiceDate, dueDate,
        invType, subtotal, exciseAmount, taxAmount, total, userId,
      ],
    );
    const inv = invResult.rows[0];

    let lineNo = 1;
    for (const line of priced.lines) {
      await client.query(
        `INSERT INTO erp_customer_invoice_lines (
           company_id, invoice_id, line_no, item_id, quantity, unit_price, excise_amount, tax_amount, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          companyId, inv.id, lineNo++, line.item_id, line.quantity, line.unit_price,
          line.lineExcise, line.lineVat, line.lineSubtotal, userId,
        ],
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
  paymentMethod = 'bank_transfer',
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
    if (String(inv.invoice_type || 'tax') === 'proforma') {
      throw new Error('Proforma invoices cannot receive payments — convert to tax invoice first');
    }

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
      ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9)
      RETURNING *`,
      [companyId, paymentNo, inv.customer_id, paymentDate, paymentAmount, paymentMethod, referenceNo, 'posted', userId],
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

    liveEvents.publish(companyId, 'payment.received', {
      invoice_id: invoiceId,
      invoice_no: inv.invoice_no,
      amount: paymentAmount,
      status,
    });
    liveEvents.publish(companyId, 'invoice.updated', { invoice_id: invoiceId, invoice_no: inv.invoice_no, status });

    return {
      ok: true,
      payment_id: payment.id,
      payment_no: payment.receipt_no,
      receipt_no: payment.receipt_no,
      status,
      amount_paid: newPaid,
      journal_id: journalId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function cancelSalesOrder({ companyId, userId, orderId, reason }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const so = await client.query(
      `SELECT * FROM erp_sales_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [orderId, companyId],
    );
    if (!so.rowCount) throw new Error('Sales order not found');
    const order = so.rows[0];
    if (order.status === 'cancelled') {
      await client.query('COMMIT');
      return { ok: true, already_cancelled: true };
    }
    orderWorkflow.assertCancelAllowed(order.status);

    if (['partial', 'delivered'].includes(order.status)) {
      await reversePostedDeliveries(client, companyId, userId, orderId);
    }

    await client.query(
      `UPDATE erp_sales_orders SET status = 'cancelled', notes = COALESCE(notes,'') || $4,
       updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2`,
      [orderId, companyId, userId, reason ? `\nCancelled: ${reason}` : '\nCancelled'],
    );
    await client.query('COMMIT');
    liveEvents.publish(companyId, 'inventory.updated', { sales_order_id: orderId, reason: 'cancel' });
    return { ok: true, order_id: orderId, stock_reversed: ['partial', 'delivered'].includes(order.status) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createAndPostCreditNote({
  companyId, userId, customerId, invoiceId, reason, lines,
}) {
  if (!reason?.trim()) throw new Error('Credit note reason is required');
  if (!lines?.length) throw new Error('Credit note lines required');
  await assertCustomerActive(companyId, customerId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const countR = await client.query(
      `SELECT COUNT(*)::int AS n FROM erp_credit_notes WHERE company_id = $1`,
      [companyId],
    );
    const cnNo = `CN-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, '0')}`;

    const itemIds = lines.filter((l) => l.item_id).map((l) => l.item_id);
    const itemMeta = await taxEngine.loadItemTaxMeta(client, companyId, itemIds);
    const priced = taxEngine.computeDocumentLines(
      lines.map((l) => ({
        item_id: l.item_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percent: 0,
      })),
      itemMeta,
    );
    const { subtotal, exciseAmount, taxAmount, total } = priced;

    const cnResult = await client.query(
      `INSERT INTO erp_credit_notes (
         company_id, customer_id, invoice_id, credit_note_no, reason,
         status, subtotal, excise_amount, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,'posted',$6,$7,$8,$9,$10) RETURNING *`,
      [companyId, customerId, invoiceId, cnNo, reason.trim(), subtotal, exciseAmount, taxAmount, total, userId],
    );
    const cn = cnResult.rows[0];

    let lineNo = 1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const pricedLine = priced.lines[i];
      await client.query(
        `INSERT INTO erp_credit_note_lines (
           company_id, credit_note_id, line_no, item_id, description, quantity, unit_price, line_total, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          companyId, cn.id, lineNo++, line.item_id, line.description || null,
          line.quantity, line.unit_price, pricedLine?.lineSubtotal ?? line.quantity * line.unit_price, userId,
        ],
      );
      if (line.item_id && line.warehouse_id && line.quantity > 0) {
        await recordReceipt(client, {
          companyId,
          warehouseId: line.warehouse_id,
          itemId: line.item_id,
          quantity: line.quantity,
          unitCost: line.unit_cost || line.unit_price,
          referenceType: 'credit_note',
          referenceId: cn.id,
          userId,
        });
      }
    }

    if (invoiceId) {
      const invRow = await client.query(
        `SELECT total_amount, amount_paid, status FROM erp_customer_invoices WHERE id = $1 FOR UPDATE`,
        [invoiceId],
      );
      const inv = invRow.rows[0];
      const creditAmt = Number(total);
      const outstanding = Math.max(0, Number(inv.total_amount) - Number(inv.amount_paid));
      const applied = Math.min(creditAmt, outstanding);
      const newPaid = Number(inv.amount_paid) + applied;
      const newStatus =
        newPaid >= Number(inv.total_amount)
          ? 'paid'
          : newPaid > 0
            ? 'partial'
            : inv.status;
      await client.query(
        `UPDATE erp_customer_invoices
         SET amount_paid = $3, status = $4, updated_at = NOW()
         WHERE id = $1 AND company_id = $2`,
        [invoiceId, companyId, newPaid, newStatus],
      );
    }

    await client.query(
      `UPDATE erp_credit_notes SET posted_at = NOW() WHERE id = $1`,
      [cn.id],
    );

    await client.query('COMMIT');
    return cn;
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
  assertCustomerActive,
  previewOrderTotals,
  createSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
  postDeliveryNote,
  createAndPostDelivery,
  createCustomerInvoice,
  postCustomerInvoice,
  recordCustomerPayment,
  submitInvoiceToEtims,
  createAndPostCreditNote,
  tryAutoInvoiceFromDeliveredOrder,
};
