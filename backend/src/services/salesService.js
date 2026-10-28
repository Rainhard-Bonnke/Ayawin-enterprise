const pool = require("../db");
const { recordIssue, getSellableQuantity } = require("./inventoryService");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");

const TAX_TREATMENTS = new Set(["standard", "zero_rated", "exempt", "out_of_scope"]);

async function resolveSaleTax(client, companyId, itemId, taxGroupId = null, taxDate = new Date().toISOString().slice(0, 10), snapshot = null) {
  const item = await client.query(
    `SELECT tax_group_id FROM erp_items
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND is_active = TRUE AND is_saleable = TRUE`,
    [itemId, companyId],
  );
  if (!item.rowCount) throw new Error(`Saleable item ${itemId} was not found`);
  const groupId = taxGroupId || item.rows[0].tax_group_id;
  if (!groupId) throw new Error(`Assign a tax group to item ${itemId} before selling it`);
  const groupResult = await client.query(
    `SELECT id, code, name, tax_treatment FROM erp_tax_groups
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE ${snapshot ? "" : "AND is_active = TRUE"}`,
    [groupId, companyId],
  );
  const group = groupResult.rows[0];
  if (!group || !TAX_TREATMENTS.has(group.tax_treatment)) throw new Error(`Tax group for item ${itemId} is invalid or inactive`);
  const treatment = snapshot?.tax_treatment || group.tax_treatment;
  if (!TAX_TREATMENTS.has(treatment)) throw new Error(`Tax treatment for item ${itemId} is invalid`);
  const rateResult = snapshot?.tax_code
    ? await client.query(
      `SELECT id, code, rate, tax_type, basis FROM erp_tax_rates
       WHERE company_id = $1 AND code = $2 AND is_active = TRUE AND is_deleted = FALSE
         AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)`,
      [companyId, snapshot.tax_code, taxDate],
    )
    : await client.query(
    `SELECT r.id, r.code, r.rate, r.tax_type, r.basis
     FROM erp_tax_group_rates gr
     JOIN erp_tax_rates r ON r.id = gr.tax_rate_id AND r.company_id = gr.company_id
     WHERE gr.company_id = $1 AND gr.tax_group_id = $2
       AND gr.is_deleted = FALSE AND r.is_active = TRUE AND r.is_deleted = FALSE
       AND r.effective_from <= $3::date AND (r.effective_to IS NULL OR r.effective_to >= $3::date)`,
    [companyId, groupId, taxDate],
  );
  const rates = rateResult.rows;
  if (treatment === "standard" || treatment === "zero_rated") {
    if (rates.length !== 1 || rates[0].tax_type !== "vat" || rates[0].basis !== "percentage") {
      throw new Error(`Tax group ${group.code} must have exactly one active percentage VAT rate; excise and withholding tax need separate workflows`);
    }
    const rate = Number(rates[0].rate);
    if (treatment === "zero_rated" && rate !== 0) throw new Error(`Zero-rated group ${group.code} must use a 0% VAT rate`);
    return { groupId: group.id, treatment, code: rates[0].code, rateId: rates[0].id, rate };
  }
  if (rates.length) throw new Error(`Tax group ${group.code} is ${group.tax_treatment} and cannot include active tax rates`);
  return { groupId: group.id, treatment, code: snapshot?.tax_code || group.code, rateId: null, rate: 0 };
}

function lineTax(net, rate) {
  return Math.round((net * rate / 100 + Number.EPSILON) * 100) / 100;
}

async function previewSaleTax(companyId, lines, taxDate) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("At least one sale line is required for tax preview");
  const client = await pool.connect();
  try {
    let subtotal = 0;
    let taxAmount = 0;
    const preparedLines = [];
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unit_price);
      if (!line.item_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error("Each preview line needs an item, positive quantity and non-negative unit price");
      }
      const net = quantity * unitPrice;
      const tax = await resolveSaleTax(client, companyId, line.item_id, line.tax_group_id || null, taxDate);
      const taxValue = lineTax(net, tax.rate);
      subtotal += net;
      taxAmount += taxValue;
      preparedLines.push({ item_id: line.item_id, quantity, unit_price: unitPrice, net_amount: net,
        tax_code: tax.code, tax_treatment: tax.treatment, tax_rate: tax.rate, tax_amount: taxValue,
        total_amount: net + taxValue });
    }
    return { subtotal, tax_amount: taxAmount, total_amount: subtotal + taxAmount, lines: preparedLines };
  } finally { client.release(); }
}

async function nextNo(client, companyId, table, prefix) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [companyId, table]);
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE company_id = $1`, [
    companyId,
  ]);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(4, "0")}`;
}

async function checkAtp(companyId, warehouseId, lines) {
  const shortages = [];
  const requestedByItem = new Map();
  for (const line of lines) {
    requestedByItem.set(line.item_id, (requestedByItem.get(line.item_id) || 0) + Number(line.quantity));
  }
  for (const [itemId, requested] of requestedByItem) {
    const stock = await pool.query(
      `SELECT s.quantity,
         COALESCE((SELECT SUM(r.reserved_quantity - r.fulfilled_quantity - r.released_quantity)
                   FROM erp_sales_order_reservations r
                   WHERE r.company_id = s.company_id AND r.warehouse_id = s.warehouse_id
                     AND r.item_id = s.item_id AND r.status = 'active'), 0) AS reserved
       FROM erp_stock_on_hand s
       WHERE s.company_id = $1 AND s.warehouse_id = $2 AND s.item_id = $3 AND s.is_deleted = FALSE`,
      [companyId, warehouseId, itemId],
    );
    const sellable = await getSellableQuantity(pool, companyId, warehouseId, itemId, Number(stock.rows[0]?.quantity || 0));
    const available = Math.max(0, sellable - Number(stock.rows[0]?.reserved || 0));
    if (available < requested) {
      shortages.push({ item_id: itemId, requested, available });
    }
  }
  return { ok: shortages.length === 0, shortages };
}

async function checkCreditLimit(companyId, customerId, orderTotal) {
  const result = await pool.query(
    `SELECT credit_limit FROM erp_customers WHERE id = $1 AND company_id = $2`,
    [customerId, companyId],
  );
  if (!result.rowCount) throw new Error("Customer not found");
  const limit = Number(result.rows[0].credit_limit || 0);

  const outstanding = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount, 0)), 0) AS outstanding
     FROM erp_customer_invoices
     WHERE company_id = $1 AND customer_id = $2 AND status IN ('posted','partial','overdue')`,
    [companyId, customerId],
  );
  const exposure = Number(outstanding.rows[0].outstanding) + Number(orderTotal);
  return { ok: exposure <= limit, credit_limit: limit, exposure };
}

async function createSalesOrder({
  companyId,
  userId,
  customerId,
  warehouseId,
  quotationId,
  lines,
  orderDate,
  notes,
}) {
  if (!lines?.length) throw new Error("Order lines required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const partyAndWarehouse = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM erp_customers WHERE id = $1 AND company_id = $3 AND is_deleted = FALSE) AS customer_ok,
         EXISTS (SELECT 1 FROM erp_warehouses WHERE id = $2 AND company_id = $3 AND is_deleted = FALSE) AS warehouse_ok`,
      [customerId, warehouseId, companyId],
    );
    if (!partyAndWarehouse.rows[0].customer_ok) throw new Error("Customer does not belong to this company or is inactive");
    if (!partyAndWarehouse.rows[0].warehouse_ok) throw new Error("Warehouse does not belong to this company or is inactive");
    const orderNo = await nextNo(client, companyId, "erp_sales_orders", "SO");
    let subtotal = 0;
    let taxAmount = 0;
    const preparedLines = [];
    for (const line of lines) {
      const net = Number(line.quantity) * Number(line.unit_price);
      const tax = await resolveSaleTax(client, companyId, line.item_id, null, orderDate || undefined);
      const taxValue = lineTax(net, tax.rate);
      subtotal += net;
      taxAmount += taxValue;
      preparedLines.push({ ...line, tax, taxValue });
    }
    const total = subtotal + taxAmount;

    const soResult = await client.query(
      `INSERT INTO erp_sales_orders (
         company_id, customer_id, quotation_id, warehouse_id, order_no, order_date,
         status, subtotal, tax_amount, total_amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),'draft',$7,$8,$9,$10,$11) RETURNING *`,
      [
        companyId,
        customerId,
        quotationId,
        warehouseId,
        orderNo,
        orderDate,
        subtotal,
        taxAmount,
        total,
        notes,
        userId,
      ],
    );
    const so = soResult.rows[0];

    let lineNo = 1;
    for (const line of preparedLines) {
      const lt = Number(line.quantity) * Number(line.unit_price);
      await client.query(
        `INSERT INTO erp_sales_order_lines (
           company_id, sales_order_id, line_no, item_id, quantity, unit_price, line_total,
           tax_group_id, tax_rate_id, tax_code, tax_treatment, tax_rate, tax_amount, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [companyId, so.id, lineNo++, line.item_id, line.quantity, line.unit_price, lt,
          line.tax.groupId, line.tax.rateId, line.tax.code, line.tax.treatment, line.tax.rate, line.taxValue, userId],
      );
    }

    await client.query("COMMIT");
    return so;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function confirmSalesOrder({ companyId, userId, orderId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const soResult = await client.query(
      `SELECT * FROM erp_sales_orders WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [orderId, companyId],
    );
    const so = soResult.rows[0];
    if (!so) throw new Error("Sales order not found or not draft");

    const lines = await client.query(
      `SELECT id, item_id, quantity FROM erp_sales_order_lines WHERE sales_order_id = $1 ORDER BY item_id FOR UPDATE`,
      [orderId],
    );
    const shortages = [];
    const requiredByItem = new Map();
    for (const line of lines.rows) {
      requiredByItem.set(line.item_id, (requiredByItem.get(line.item_id) || 0) + Number(line.quantity));
    }
    for (const [itemId, requestedQuantity] of requiredByItem) {
      const stock = await client.query(
        `SELECT s.quantity FROM erp_stock_on_hand s
         WHERE s.company_id = $1 AND s.warehouse_id = $2 AND s.item_id = $3 AND s.is_deleted = FALSE FOR UPDATE`,
        [companyId, so.warehouse_id, itemId],
      );
      const reservations = await client.query(
        `SELECT COALESCE(SUM(reserved_quantity - fulfilled_quantity - released_quantity), 0) AS quantity
         FROM erp_sales_order_reservations
         WHERE company_id = $1 AND warehouse_id = $2 AND item_id = $3 AND status = 'active'`,
        [companyId, so.warehouse_id, itemId],
      );
      const sellable = await getSellableQuantity(client, companyId, so.warehouse_id, itemId, Number(stock.rows[0]?.quantity || 0));
      const available = Math.max(0, sellable - Number(reservations.rows[0]?.quantity || 0));
      if (available < requestedQuantity) shortages.push({ item_id: itemId, requested: requestedQuantity, available });
    }
    if (shortages.length) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "atp_failed", shortages };
    }

    const credit = await checkCreditLimit(companyId, so.customer_id, so.total_amount);
    if (!credit.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "credit_limit_exceeded", ...credit };
    }
    for (const line of lines.rows) {
      await client.query(
        `INSERT INTO erp_sales_order_reservations
           (company_id, sales_order_id, sales_order_line_id, warehouse_id, item_id, reserved_quantity, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, orderId, line.id, so.warehouse_id, line.item_id, line.quantity, userId],
      );
    }
    await client.query(
      `UPDATE erp_sales_orders SET status = 'confirmed', credit_check_passed = TRUE, updated_at = NOW(), updated_by = $3
       WHERE id = $1 AND company_id = $2`,
      [orderId, companyId, userId],
    );
    await client.query("COMMIT");
    return { ok: true, order_id: orderId, reserved_lines: lines.rowCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function postDeliveryNote({ companyId, userId, deliveryId, postGl = true }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dnResult = await client.query(
      `SELECT * FROM erp_delivery_notes WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [deliveryId, companyId],
    );
    const dn = dnResult.rows[0];
    if (!dn) throw new Error("Delivery note not found or already posted");

    const orderResult = await client.query(
      `SELECT status FROM erp_sales_orders
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [dn.sales_order_id, companyId],
    );
    if (!orderResult.rowCount || !["confirmed", "partial"].includes(orderResult.rows[0].status)) {
      throw new Error("The sales order is not open for delivery");
    }

    const lines = await client.query(
      `SELECT * FROM erp_delivery_note_lines WHERE delivery_note_id = $1`,
      [deliveryId],
    );
    let cogsTotal = 0;

    for (const line of lines.rows) {
      if (line.so_line_id) {
        const reservation = await client.query(
          `UPDATE erp_sales_order_reservations
           SET fulfilled_quantity = fulfilled_quantity + $2,
               status = CASE WHEN fulfilled_quantity + $2 + released_quantity >= reserved_quantity THEN 'fulfilled' ELSE status END,
               updated_at = NOW()
           WHERE sales_order_line_id = $1 AND company_id = $3 AND status = 'active'
             AND fulfilled_quantity + released_quantity + $2 <= reserved_quantity
           RETURNING id`,
          [line.so_line_id, line.quantity, companyId],
        );
        if (!reservation.rowCount) throw new Error(`No active stock reservation covers delivery line ${line.so_line_id}`);
      }
      const issued = await recordIssue(client, {
        companyId,
        warehouseId: dn.warehouse_id,
        itemId: line.item_id,
        quantity: line.quantity,
        unitCost: line.unit_cost,
        referenceType: "delivery_note",
        referenceId: deliveryId,
        userId,
        returnAllocations: true,
      });
      const allocations = issued.allocations.length ? issued.allocations
        : [{ quantity: Number(line.quantity), unit_cost: issued.unitCost ?? line.unit_cost, layer_id: null,
          batch_no: null, expiry_date: null }];
      cogsTotal += allocations.reduce((sum, allocation) => sum + Number(allocation.quantity) * Number(allocation.unit_cost || 0), 0);
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO erp_delivery_note_layer_allocations
           (company_id, delivery_note_line_id, layer_id, batch_no, expiry_date, quantity, unit_cost, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, line.id, allocation.layer_id || allocation.layerId || null, allocation.batch_no || allocation.batchNo || null,
            allocation.expiry_date || allocation.expiryDate || null, allocation.quantity,
            allocation.unit_cost ?? allocation.unitCost ?? issued.unitCost ?? line.unit_cost ?? 0, userId],
        );
      }

      if (line.so_line_id) {
        await client.query(
          `UPDATE erp_sales_order_lines SET qty_delivered = qty_delivered + $2, updated_at = NOW() WHERE id = $1`,
          [line.so_line_id, line.quantity],
        );
      }
    }

    await client.query(
      `UPDATE erp_sales_orders so SET status = CASE
         WHEN (SELECT SUM(qty_delivered) FROM erp_sales_order_lines WHERE sales_order_id = so.id)
              >= (SELECT SUM(quantity) FROM erp_sales_order_lines WHERE sales_order_id = so.id)
         THEN 'delivered' ELSE 'partial' END WHERE id = $1`,
      [dn.sales_order_id],
    );

    let journalId = null;
    if (postGl && cogsTotal > 0) {
      const accounts = await client.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_active = TRUE
           AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, [ACCOUNT_CODES.cogs, ACCOUNT_CODES.inventory]],
      );
      const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
      if (!byCode[ACCOUNT_CODES.cogs] || !byCode[ACCOUNT_CODES.inventory]) {
        throw new Error("COGS or inventory control account is missing or not postable; delivery was not posted");
      }
      if (byCode[ACCOUNT_CODES.cogs] && byCode[ACCOUNT_CODES.inventory]) {
        const journal = await gl.createJournalInTransaction(client, {
          companyId,
          userId,
          entryDate: dn.delivery_date,
          journalType: "sales",
          referenceNo: dn.delivery_no,
          description: `COGS - ${dn.delivery_no}`,
          lines: [
            { account_id: byCode[ACCOUNT_CODES.cogs], debit: cogsTotal, credit: 0 },
            { account_id: byCode[ACCOUNT_CODES.inventory], debit: 0, credit: cogsTotal },
          ],
        });
        await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
        journalId = journal.id;
      }
    }

    await client.query(
      `UPDATE erp_delivery_notes SET status = 'posted', posted_at = NOW(), journal_id = $2, updated_at = NOW()
       WHERE id = $1`,
      [deliveryId, journalId],
    );
    await client.query("COMMIT");

    return { ok: true, delivery_id: deliveryId, cogs_total: cogsTotal, journal_id: journalId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cancelSalesOrder({ companyId, userId, orderId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Keep delivery-note -> order lock ordering consistent with delivery posting.
    await client.query(
      `SELECT id FROM erp_delivery_notes
       WHERE sales_order_id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE
       ORDER BY id FOR UPDATE`,
      [orderId, companyId],
    );
    const order = await client.query(
      `SELECT id, status FROM erp_sales_orders
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [orderId, companyId],
    );
    if (!order.rowCount || !["draft", "confirmed", "partial"].includes(order.rows[0].status)) {
      throw new Error("Only a draft, confirmed or partially delivered sales order can be cancelled");
    }
    await client.query(
      `UPDATE erp_delivery_notes SET status = 'cancelled', updated_by = $3, updated_at = NOW()
       WHERE sales_order_id = $1 AND company_id = $2 AND status = 'draft' AND is_deleted = FALSE`,
      [orderId, companyId, userId],
    );
    await client.query(
      `UPDATE erp_sales_order_reservations
       SET released_quantity = reserved_quantity - fulfilled_quantity,
           status = 'released', updated_at = NOW()
       WHERE sales_order_id = $1 AND company_id = $2 AND status = 'active'`,
      [orderId, companyId],
    );
    await client.query(
      `UPDATE erp_sales_orders SET status = 'cancelled', updated_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [orderId, companyId, userId],
    );
    await client.query("COMMIT");
    return { ok: true, order_id: orderId, status: "cancelled" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function createAndPostDelivery({
  companyId,
  userId,
  salesOrderId,
  warehouseId,
  lines,
  deliveryDate,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT id, warehouse_id, status FROM erp_sales_orders
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [salesOrderId, companyId],
    );
    const order = orderResult.rows[0];
    if (!order || !["confirmed", "partial"].includes(order.status)) {
      throw new Error("Only a confirmed or partially delivered sales order can be dispatched");
    }
    if (order.warehouse_id !== warehouseId) throw new Error("Delivery warehouse must match the warehouse reserved on the sales order");
    if (!Array.isArray(lines) || !lines.length || lines.some((line) => !line.so_line_id || Number(line.quantity) <= 0)) {
      throw new Error("Delivery lines must reference sales order lines and have positive quantities");
    }
    const requestedByLine = new Map();
    for (const line of lines) requestedByLine.set(line.so_line_id, (requestedByLine.get(line.so_line_id) || 0) + Number(line.quantity));
    for (const [soLineId, requested] of requestedByLine) {
      const orderLine = await client.query(
        `SELECT sol.item_id, sol.quantity - sol.qty_delivered AS open_quantity,
                r.reserved_quantity - r.fulfilled_quantity - r.released_quantity AS reserved_quantity
         FROM erp_sales_order_lines sol
         JOIN erp_sales_order_reservations r ON r.sales_order_line_id = sol.id AND r.company_id = sol.company_id
         WHERE sol.id = $1 AND sol.sales_order_id = $2 AND sol.company_id = $3 AND r.status = 'active'
         FOR UPDATE OF r`,
        [soLineId, salesOrderId, companyId],
      );
      const detail = orderLine.rows[0];
      if (!detail) throw new Error("A delivery line has no active reservation for this order");
      const inputLines = lines.filter((line) => line.so_line_id === soLineId);
      if (inputLines.some((line) => line.item_id !== detail.item_id)) throw new Error("Delivery item does not match its sales order line");
      if (requested > Number(detail.open_quantity) || requested > Number(detail.reserved_quantity)) {
        throw new Error("Delivery quantity exceeds the open, reserved quantity on its sales order line");
      }
    }
    const deliveryNo = await nextNo(client, companyId, "erp_delivery_notes", "DN");
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
        [
          companyId,
          dn.id,
          line.so_line_id,
          lineNo++,
          line.item_id,
          line.quantity,
          unitCost,
          userId,
        ],
      );
    }
    await client.query("COMMIT");
    return postDeliveryNote({ companyId, userId, deliveryId: dn.id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function postCustomerInvoice({ companyId, userId, invoiceId, postGl = true }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_customer_invoices WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [invoiceId, companyId],
    );
    const invoice = result.rows[0];
    if (!invoice) throw new Error("Invoice not found or already posted");
    let journalId = null;
    if (postGl) {
      const accountResult = await client.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_active = TRUE
           AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, [ACCOUNT_CODES.accountsReceivable, ACCOUNT_CODES.salesRevenue, ACCOUNT_CODES.vatOutput]],
      );
      const accounts = Object.fromEntries(accountResult.rows.map((account) => [account.account_code, account.id]));
      if (!accounts[ACCOUNT_CODES.accountsReceivable] || !accounts[ACCOUNT_CODES.salesRevenue]) {
        throw new Error("Accounts Receivable or Sales Revenue control account is missing; invoice was not posted");
      }
      if (Number(invoice.tax_amount) > 0 && !accounts[ACCOUNT_CODES.vatOutput]) {
        throw new Error("Output VAT control account is missing; invoice was not posted");
      }
      const journalLines = [
        { account_id: accounts[ACCOUNT_CODES.accountsReceivable], debit: Number(invoice.total_amount), credit: 0, description: "Accounts receivable" },
        { account_id: accounts[ACCOUNT_CODES.salesRevenue], debit: 0, credit: Number(invoice.subtotal), description: "Sales revenue" },
      ];
      if (Number(invoice.tax_amount) > 0) journalLines.push({
        account_id: accounts[ACCOUNT_CODES.vatOutput], debit: 0, credit: Number(invoice.tax_amount), description: "Output VAT",
      });
      const journal = await gl.createJournalInTransaction(client, {
        companyId, userId, entryDate: invoice.invoice_date, journalType: "sales",
        referenceNo: invoice.invoice_no, description: `Customer invoice ${invoice.invoice_no}`, lines: journalLines,
      });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;
    }
    if (invoice.sales_order_id) {
      await client.query(
        `UPDATE erp_sales_orders so SET status = CASE
           WHEN EXISTS (
             SELECT 1 FROM erp_sales_order_lines sol WHERE sol.sales_order_id = so.id
               AND sol.qty_delivered < sol.quantity
           ) THEN 'partial'
           WHEN EXISTS (
             SELECT 1 FROM erp_sales_order_lines sol WHERE sol.sales_order_id = so.id
               AND sol.qty_invoiced < sol.quantity
           ) THEN 'delivered'
           ELSE 'invoiced' END,
           updated_at = NOW()
         WHERE so.id = $1 AND so.company_id = $2`,
        [invoice.sales_order_id, companyId],
      );
    }
    await client.query(
      `UPDATE erp_customer_invoices SET status = 'posted', posted_at = NOW(), journal_id = $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3`,
      [invoiceId, journalId, companyId],
    );
    await client.query("COMMIT");
    return { ok: true, invoice_id: invoiceId, invoice_no: invoice.invoice_no, journal_id: journalId, gl_warning: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function createCustomerInvoice({
  companyId,
  userId,
  customerId,
  salesOrderId,
  deliveryNoteId,
  lines,
  invoiceDate,
  dueDate,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let order = null;
    if (salesOrderId) {
      const orderResult = await client.query(
        `SELECT id, customer_id, status FROM erp_sales_orders
         WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
        [salesOrderId, companyId],
      );
      order = orderResult.rows[0];
      if (!order) throw new Error("Sales order not found");
      if (order.customer_id !== customerId) throw new Error("Invoice customer must match the sales order customer");
    }
    if (salesOrderId && lines.some((line) => !line.so_line_id)) {
      throw new Error("Every line on a sales-order invoice must reference its sales-order line");
    }
    const invoiceNo = await nextNo(client, companyId, "erp_customer_invoices", "INV");
    const customer = await client.query(
      `SELECT 1 FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR SHARE`,
      [customerId, companyId],
    );
    if (!customer.rowCount) throw new Error("Customer does not belong to this company or is inactive");
    let subtotal = 0;
    let taxAmount = 0;
    const preparedLines = [];
    const requestedBySalesLine = new Map();
    for (const line of lines) {
      if (line.so_line_id) requestedBySalesLine.set(line.so_line_id, (requestedBySalesLine.get(line.so_line_id) || 0) + Number(line.quantity));
    }
    for (const line of lines) {
      let orderLine = null;
      if (line.so_line_id) {
        if (!salesOrderId) throw new Error("A sales-order line can only be invoiced with its sales order");
        const lineResult = await client.query(
          `SELECT id, sales_order_id, item_id, tax_group_id, tax_code, tax_treatment, quantity, qty_delivered, qty_invoiced
           FROM erp_sales_order_lines WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [line.so_line_id, companyId],
        );
        orderLine = lineResult.rows[0];
        if (!orderLine || orderLine.sales_order_id !== salesOrderId || orderLine.item_id !== line.item_id) {
          throw new Error("Invoice line does not match a line on the selected sales order");
        }
        const billable = Number(orderLine.qty_delivered) - Number(orderLine.qty_invoiced);
        if (Number(requestedBySalesLine.get(line.so_line_id)) > billable) throw new Error("Invoice quantity exceeds the delivered, uninvoiced quantity");
      }
      const net = Number(line.quantity) * Number(line.unit_price);
      const tax = await resolveSaleTax(client, companyId, line.item_id, orderLine?.tax_group_id || null, invoiceDate || undefined,
        orderLine ? { tax_code: orderLine.tax_code, tax_treatment: orderLine.tax_treatment } : null);
      const taxValue = lineTax(net, tax.rate);
      subtotal += net;
      taxAmount += taxValue;
      preparedLines.push({ ...line, tax, taxValue });
    }
    const total = subtotal + taxAmount;

    const invResult = await client.query(
      `INSERT INTO erp_customer_invoices (
         company_id, customer_id, sales_order_id, delivery_note_id, invoice_no, invoice_date, due_date,
         status, subtotal, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,'draft',$8,$9,$10,$11) RETURNING *`,
      [
        companyId,
        customerId,
        salesOrderId,
        deliveryNoteId,
        invoiceNo,
        invoiceDate,
        dueDate,
        subtotal,
        taxAmount,
        total,
        userId,
      ],
    );
    const inv = invResult.rows[0];

    let lineNo = 1;
    for (const line of preparedLines) {
      const lt = Number(line.quantity) * Number(line.unit_price);
      await client.query(
        `INSERT INTO erp_customer_invoice_lines (
           company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total,
           tax_group_id, tax_rate_id, tax_code, tax_treatment, tax_rate, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          companyId,
          inv.id,
          lineNo++,
          line.item_id,
          line.quantity,
          line.unit_price,
          line.taxValue,
          lt,
          line.tax.groupId,
          line.tax.rateId,
          line.tax.code,
          line.tax.treatment,
          line.tax.rate,
          userId,
        ],
      );
      if (line.so_line_id) {
        await client.query(
          `UPDATE erp_sales_order_lines SET qty_invoiced = qty_invoiced + $2 WHERE id = $1`,
          [line.so_line_id, line.quantity],
        );
      }
    }

    await client.query("COMMIT");
    return postCustomerInvoice({ companyId, userId, invoiceId: inv.id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function recordCustomerPayment({
  companyId, userId, invoiceId, paymentDate, amount, referenceNo, notes, postGl = true,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_customer_invoices WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [invoiceId, companyId],
    );
    const invoice = result.rows[0];
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "cancelled") throw new Error("Cannot pay a cancelled invoice");
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error("Payment amount must be greater than zero");
    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0) - Number(invoice.credited_amount || 0);
    if (outstanding <= 0) throw new Error("Invoice has no outstanding balance");
    if (paymentAmount - outstanding > 0.0001) throw new Error("Payment amount exceeds outstanding balance");

    const paymentNo = await nextNo(client, companyId, "erp_customer_receipts", "RCP");
    const created = await client.query(
      `INSERT INTO erp_customer_receipts (
         company_id, receipt_no, customer_id, receipt_date, amount, payment_method, reference_no, status, created_by
       ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,'bank_transfer',$6,'draft',$7) RETURNING *`,
      [companyId, paymentNo, invoice.customer_id, paymentDate || null, paymentAmount, referenceNo || null, userId],
    );
    const receipt = created.rows[0];
    await client.query(
      `INSERT INTO erp_receipt_allocations (company_id, receipt_id, invoice_id, amount, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [companyId, receipt.id, invoiceId, paymentAmount, userId],
    );

    let journalId = null;
    if (postGl) {
      const accountResult = await client.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code = ANY($2::text[]) AND is_active = TRUE
           AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, [ACCOUNT_CODES.cashAtBank, ACCOUNT_CODES.accountsReceivable]],
      );
      const accounts = Object.fromEntries(accountResult.rows.map((account) => [account.account_code, account.id]));
      if (!accounts[ACCOUNT_CODES.cashAtBank] || !accounts[ACCOUNT_CODES.accountsReceivable]) {
        throw new Error("Cash/Bank or Accounts Receivable control account is missing; receipt was not posted");
      }
      const journal = await gl.createJournalInTransaction(client, {
        companyId, userId, entryDate: receipt.receipt_date, journalType: "sales",
        referenceNo: paymentNo, description: `Customer receipt ${paymentNo} for ${invoice.invoice_no}`,
        lines: [
          { account_id: accounts[ACCOUNT_CODES.cashAtBank], debit: paymentAmount, credit: 0, description: "Customer receipt" },
          { account_id: accounts[ACCOUNT_CODES.accountsReceivable], debit: 0, credit: paymentAmount, description: "Settle customer balance" },
        ],
      });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;
    }

    const newPaid = Number(invoice.amount_paid || 0) + paymentAmount;
    const status = newPaid + Number(invoice.credited_amount || 0) >= Number(invoice.total_amount) - 0.0001
      ? (Number(invoice.credited_amount || 0) > 0 ? "credited" : "paid") : "partial";
    await client.query(
      `UPDATE erp_customer_invoices SET amount_paid = $3, status = $4, updated_at = NOW(), updated_by = $5
       WHERE id = $1 AND company_id = $2`,
      [invoiceId, companyId, newPaid, status, userId],
    );
    await client.query(
      `UPDATE erp_customer_receipts SET status = 'posted', journal_id = $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3`,
      [receipt.id, journalId, companyId],
    );
    await client.query("COMMIT");
    return { ok: true, payment_no: paymentNo, status, amount_paid: newPaid, journal_id: journalId, gl_warning: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}


module.exports = {
  checkAtp,
  previewSaleTax,
  checkCreditLimit,
  createSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
  postDeliveryNote,
  createAndPostDelivery,
  createCustomerInvoice,
  postCustomerInvoice,
  recordCustomerPayment,
};
