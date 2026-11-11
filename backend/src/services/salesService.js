const pool = require("../db");
const { recordIssue, getSellableQuantity } = require("./inventoryService");
const gl = require("./glPostingService");
const { ACCOUNT_CODES } = require("./accountCodes");
const integration = require("./integrationService");
const etimsEvents = require("./etimsEventService");
const { logAudit, assertDifferentUser } = require("./auditService");
const { nextDocumentNo } = require("./documentNumberingService");
const { roundMoney, sumMoney, lineMoney } = require("../lib/money");

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
  return roundMoney(net * Number(rate) / 100);
}

async function getMaximumDiscountPercent(client, companyId) {
  const setting = await client.query(
    `SELECT setting_value FROM erp_system_settings
     WHERE company_id=$1 AND category='sales' AND setting_key='maximum_discount_percent' AND is_deleted=FALSE`,
    [companyId],
  );
  const value = Number(setting.rows[0]?.setting_value ?? 10);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : 10;
}

async function resolveCustomerPrice(client, { companyId, customerId, itemId, quantity, priceDate, suppliedPrice, permissions = [], freeIssueReasonCode = null }) {
  const customer = await client.query(
    `SELECT c.price_list_id, item.minimum_sale_price, item.is_free_issue
     FROM erp_customers c CROSS JOIN erp_items item
     WHERE c.id=$1 AND c.company_id=$2 AND c.is_deleted=FALSE
       AND item.id=$3 AND item.company_id=$2 AND item.is_deleted=FALSE AND item.is_active=TRUE AND item.is_saleable=TRUE`,
    [customerId, companyId, itemId],
  );
  if (!customer.rowCount) throw new Error("Customer or saleable item was not found in this company");
  const assignedPriceList = customer.rows[0].price_list_id;
  const priceList = await client.query(
    `SELECT id FROM erp_price_lists WHERE company_id=$1 AND is_deleted=FALSE AND is_active=TRUE
       AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
       AND ${assignedPriceList ? "id=$3" : "is_default=TRUE"}
     ORDER BY is_default DESC, effective_from DESC LIMIT 1`,
    assignedPriceList ? [companyId, priceDate, assignedPriceList] : [companyId, priceDate],
  );
  if (!priceList.rowCount) throw new Error("No active customer price list is effective on the sale date");
  const listed = await client.query(
    `SELECT unit_price FROM erp_price_list_items
     WHERE company_id=$1 AND price_list_id=$2 AND item_id=$3 AND min_qty <= $4 AND is_deleted=FALSE
     ORDER BY min_qty DESC LIMIT 1`,
    [companyId, priceList.rows[0].id, itemId, quantity],
  );
  const hasSuppliedPrice = suppliedPrice !== undefined && suppliedPrice !== null && suppliedPrice !== "";
  const supplied = hasSuppliedPrice ? Number(suppliedPrice) : null;
  if (hasSuppliedPrice && (!Number.isFinite(supplied) || supplied < 0)) throw new Error("Unit price must be a non-negative amount");
  const permissionsSet = new Set(permissions || []);
  const isFreeIssue = customer.rows[0].is_free_issue === true;
  if (supplied === 0 && (!isFreeIssue || !String(freeIssueReasonCode || "").trim())) {
    throw new Error("Zero price is allowed only for a free-issue item with a reason code");
  }
  const listPrice = listed.rowCount ? Number(listed.rows[0].unit_price) : null;
  if (listPrice === null && !(hasSuppliedPrice && permissionsSet.has("sales.price_override"))) {
    throw new Error("No effective price exists for this item on the customer price list");
  }
  const chosenPrice = hasSuppliedPrice ? supplied : listPrice;
  if (chosenPrice === 0 && (!isFreeIssue || !String(freeIssueReasonCode || "").trim())) {
    throw new Error("Zero price is allowed only for a free-issue item with a reason code");
  }
  const floor = customer.rows[0].minimum_sale_price == null ? null : Number(customer.rows[0].minimum_sale_price);
  const floorOverride = floor !== null && chosenPrice < floor;
  const overridden = listPrice === null || Math.abs(chosenPrice - listPrice) > 0.00005 || floorOverride;
  if ((overridden || floorOverride) && !permissionsSet.has("sales.price_override")
      && !(chosenPrice === 0 && isFreeIssue && String(freeIssueReasonCode || "").trim())) {
    throw new Error("Price override permission is required for a price different from the effective list price or below the item floor");
  }
  return { unitPrice: chosenPrice, listPrice, priceListId: priceList.rows[0].id, overridden, freeIssueReasonCode: chosenPrice === 0 ? String(freeIssueReasonCode).trim() : null };
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
      const net = lineMoney(quantity, unitPrice);
      const tax = await resolveSaleTax(client, companyId, line.item_id, line.tax_group_id || null, taxDate);
      const taxValue = lineTax(net, tax.rate);
      subtotal = sumMoney([subtotal, net]);
      taxAmount = sumMoney([taxAmount, taxValue]);
      preparedLines.push({ item_id: line.item_id, quantity, unit_price: unitPrice, net_amount: net,
        tax_code: tax.code, tax_treatment: tax.treatment, tax_rate: tax.rate, tax_amount: taxValue,
        total_amount: sumMoney([net, taxValue]) });
    }
    return { subtotal, tax_amount: taxAmount, total_amount: sumMoney([subtotal, taxAmount]), lines: preparedLines };
  } finally { client.release(); }
}

async function nextNo(client, companyId, table, prefix) {
  return nextDocumentNo(client, { companyId, docType: table, prefix });
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

async function checkCreditLimit(companyId, customerId, orderTotal, { client = pool, lockCustomer = false, excludeOrderId = null } = {}) {
  const result = await client.query(
    `SELECT credit_limit, credit_hold FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted=FALSE ${lockCustomer ? "FOR UPDATE" : ""}`,
    [customerId, companyId],
  );
  if (!result.rowCount) throw new Error("Customer not found");
  const limit = Number(result.rows[0].credit_limit || 0);
  const customerHold = result.rows[0].credit_hold === true;
  const setting = await client.query(
    `SELECT setting_value FROM erp_system_settings WHERE company_id=$1 AND category='sales'
     AND setting_key='overdue_block_days' AND is_deleted=FALSE`, [companyId]);
  const overdueDaysRaw = Number(setting.rows[0]?.setting_value ?? 30);
  const overdueDays = Number.isFinite(overdueDaysRaw) && overdueDaysRaw >= 0 ? Math.floor(overdueDaysRaw) : 30;
  const invoiceRows = await client.query(
    `SELECT COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount, 0)), 0) AS outstanding
     FROM erp_customer_invoices
     WHERE company_id = $1 AND customer_id = $2 AND status IN ('posted','partial','overdue') AND is_deleted=FALSE`,
    [companyId, customerId],
  );
  const orderRows = await client.query(
    `SELECT COALESCE(SUM(GREATEST(sol.quantity-sol.qty_delivered,0) * sol.unit_price
                  * (1-sol.discount_percent/100) * (1+COALESCE(sol.tax_rate,0)/100)),0) AS confirmed_orders,
              COALESCE(SUM(GREATEST(sol.qty_delivered-sol.qty_invoiced,0) * sol.unit_price
                  * (1-sol.discount_percent/100) * (1+COALESCE(sol.tax_rate,0)/100)),0) AS delivered_uninvoiced
       FROM erp_sales_orders so JOIN erp_sales_order_lines sol ON sol.sales_order_id=so.id AND sol.company_id=so.company_id
       WHERE so.company_id=$1 AND so.customer_id=$2 AND so.is_deleted=FALSE
         AND so.status IN ('confirmed','partial','delivered','invoiced') AND ($3::uuid IS NULL OR so.id<>$3)`,
    [companyId, customerId, excludeOrderId],
  );
  const unappliedRows = await client.query(
    `SELECT COALESCE(SUM(unapplied_amount),0) AS unapplied
       FROM erp_customer_receipts WHERE company_id=$1 AND customer_id=$2 AND status IN ('posted','partial') AND is_deleted=FALSE`,
    [companyId, customerId],
  );
  const overdue = await client.query(
    `SELECT COUNT(*)::int AS count, MIN(due_date) AS oldest_due_date
       FROM erp_customer_invoices
       WHERE company_id=$1 AND customer_id=$2 AND status IN ('posted','partial','overdue')
         AND due_date < CURRENT_DATE - ($3::int * INTERVAL '1 day')
         AND total_amount-amount_paid-credited_amount > 0 AND is_deleted=FALSE`,
    [companyId, customerId, overdueDays],
  );
  const invoiceOpen = Number(invoiceRows.rows[0].outstanding || 0);
  const unappliedReceipts = Number(unappliedRows.rows[0].unapplied || 0);
  const invoiceExposure = Math.max(0, invoiceOpen - unappliedReceipts);
  const confirmedOrderExposure = Number(orderRows.rows[0].confirmed_orders || 0);
  const deliveredUninvoicedExposure = Number(orderRows.rows[0].delivered_uninvoiced || 0);
  const requestedOrder = Number(orderTotal || 0);
  const exposure = invoiceExposure + confirmedOrderExposure + deliveredUninvoicedExposure + requestedOrder;
  const overdueCount = Number(overdue.rows[0].count || 0);
  const exceeded = exposure > limit;
  return { ok: !customerHold && overdueCount === 0 && !exceeded, credit_limit: limit, exposure,
    breakdown: { open_invoice_balance: invoiceOpen, unapplied_receipts: unappliedReceipts,
      invoice_exposure: invoiceExposure, confirmed_orders: confirmedOrderExposure,
      delivered_uninvoiced: deliveredUninvoicedExposure, this_order: requestedOrder },
    credit_hold: customerHold, overdue_blocked: overdueCount > 0, overdue_count: overdueCount,
    overdue_days: overdueDays, exceeded };
}

async function createSalesOrder({
  companyId,
  userId,
  customerId,
  warehouseId,
  quotationId,
  lines,
  orderDate,
  requiredDate,
  notes,
  permissions = [],
}) {
  if (!lines?.length) throw new Error("Order lines required");
  const parsedRequiredDate = new Date(`${requiredDate}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(requiredDate || "")) ||
    Number.isNaN(parsedRequiredDate.getTime()) ||
    parsedRequiredDate.toISOString().slice(0, 10) !== requiredDate
  ) {
    throw new Error("A valid required delivery date is required");
  }
  if (orderDate && requiredDate < orderDate) {
    throw new Error("Required delivery date cannot be before the order date");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const partyAndWarehouse = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM erp_customers WHERE id = $1 AND company_id = $3 AND is_deleted = FALSE AND is_active = TRUE) AS customer_ok,
         EXISTS (SELECT 1 FROM erp_warehouses WHERE id = $2 AND company_id = $3 AND is_deleted = FALSE) AS warehouse_ok`,
      [customerId, warehouseId, companyId],
    );
    if (!partyAndWarehouse.rows[0].customer_ok) throw new Error("Customer does not belong to this company or is inactive");
    if (!partyAndWarehouse.rows[0].warehouse_ok) throw new Error("Warehouse does not belong to this company or is inactive");
    const orderNo = await nextNo(client, companyId, "erp_sales_orders", "SO");
    const maxDiscountPercent = await getMaximumDiscountPercent(client, companyId);
    const pricingDate = orderDate || new Date().toISOString().slice(0, 10);
    let subtotal = 0;
    let taxAmount = 0;
    let discountAmount = 0;
    const preparedLines = [];
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const discountPercent = Number(line.discount_percent || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        throw new Error("Each line requires a positive quantity and a discount from 0 to 100 percent");
      }
      const price = await resolveCustomerPrice(client, { companyId, customerId, itemId: line.item_id, quantity,
        priceDate: pricingDate, suppliedPrice: line.unit_price, permissions, freeIssueReasonCode: line.reason_code });
      const gross = lineMoney(quantity, price.unitPrice);
      const lineDiscount = roundMoney(gross * discountPercent / 100);
      const net = sumMoney([gross, -lineDiscount]);
      const tax = await resolveSaleTax(client, companyId, line.item_id, null, pricingDate);
      const taxValue = lineTax(net, tax.rate);
      subtotal = sumMoney([subtotal, net]);
      discountAmount = sumMoney([discountAmount, lineDiscount]);
      taxAmount = sumMoney([taxAmount, taxValue]);
      preparedLines.push({ ...line, quantity, unit_price: price.unitPrice, listUnitPrice: price.listPrice,
        priceListId: price.priceListId, priceOverridden: price.overridden, freeIssueReasonCode: price.freeIssueReasonCode,
        discount_percent: discountPercent, discountAmount: lineDiscount, netAmount: net,
        requiresDiscountApproval: discountPercent > maxDiscountPercent, tax, taxValue });
    }
    const total = sumMoney([subtotal, taxAmount]);
    const discountApprovalStatus = preparedLines.some((line) => line.requiresDiscountApproval) ? "pending" : "not_required";
    const priceListId = preparedLines[0].priceListId;

    const soResult = await client.query(
      `INSERT INTO erp_sales_orders (
         company_id, customer_id, quotation_id, warehouse_id, price_list_id, order_no, order_date, required_date,
         status, subtotal, discount_amount, discount_approval_status, tax_amount, total_amount, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),$8,'draft',$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        companyId,
        customerId,
        quotationId,
        warehouseId,
        priceListId,
        orderNo,
        orderDate,
        requiredDate,
        subtotal,
        discountAmount,
        discountApprovalStatus,
        taxAmount,
        total,
        notes,
        userId,
      ],
    );
    const so = soResult.rows[0];

    let lineNo = 1;
    for (const line of preparedLines) {
      await client.query(
        `INSERT INTO erp_sales_order_lines (
           company_id, sales_order_id, line_no, item_id, quantity, unit_price, list_unit_price,
           discount_percent, discount_amount, free_issue_reason_code, line_total,
           tax_group_id, tax_rate_id, tax_code, tax_treatment, tax_rate, tax_amount, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [companyId, so.id, lineNo++, line.item_id, line.quantity, line.unit_price, line.listUnitPrice ?? line.unit_price,
          line.discount_percent, line.discountAmount, line.freeIssueReasonCode, line.netAmount,
          line.tax.groupId, line.tax.rateId, line.tax.code, line.tax.treatment, line.tax.rate, line.taxValue, userId],
      );
      if (line.priceOverridden) {
        await logAudit({ client, companyId, userId, entityType: "erp_sales_orders", entityId: so.id,
          action: "sales_price_overridden", oldValues: { item_id: line.item_id, list_unit_price: line.listUnitPrice },
          newValues: { unit_price: line.unit_price, quantity: line.quantity } });
      }
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
    if (so.discount_approval_status === "pending") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "discount_approval_required", message: "A second user must approve this discount before confirmation" };
    }

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

    const credit = await checkCreditLimit(companyId, so.customer_id, so.total_amount,
      { client, lockCustomer: true, excludeOrderId: orderId });
    const creditOverrideValid = so.credit_override_approved_by
      && String(so.credit_override_approved_by) !== String(so.created_by)
      && so.credit_override_expires_at && new Date(so.credit_override_expires_at) > new Date();
    if (credit.credit_hold || (!creditOverrideValid && (credit.overdue_blocked || credit.exceeded))) {
      await client.query("ROLLBACK");
      const reason = credit.credit_hold ? "customer_credit_hold" : credit.overdue_blocked ? "overdue_credit_block" : "credit_limit_exceeded";
      return { ok: false, reason, ...credit };
    }
    if (creditOverrideValid && !credit.ok) await logAudit({ client, companyId, userId,
      entityType: "erp_sales_orders", entityId: orderId, action: "sales_credit_override_used",
      newValues: { reason: so.credit_override_reason, approved_by: so.credit_override_approved_by,
        expires_at: so.credit_override_expires_at, exposure: credit.exposure } });
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

async function approveSalesOrderDiscount({ companyId, userId, orderId, reason }) {
  if (!String(reason || "").trim()) throw new Error("A reason is required to approve an above-limit discount");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, created_by, discount_approval_status FROM erp_sales_orders
       WHERE id=$1 AND company_id=$2 AND status='draft' AND is_deleted=FALSE FOR UPDATE`, [orderId, companyId],
    );
    const order = result.rows[0];
    if (!order || order.discount_approval_status !== "pending") throw new Error("Sales order is not awaiting discount approval");
    assertDifferentUser(order.created_by, userId);
    await client.query(
      `UPDATE erp_sales_orders SET discount_approval_status='approved', discount_approved_by=$3,
         discount_approved_at=NOW(), discount_approval_reason=$4, updated_at=NOW(), updated_by=$3
       WHERE id=$1 AND company_id=$2`, [orderId, companyId, userId, String(reason).trim().slice(0, 1000)],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_sales_orders", entityId: orderId,
      action: "sales_discount_approved", newValues: { reason: String(reason).trim().slice(0, 1000), discount_approval_status: "approved" } });
    await client.query("COMMIT");
    return { ok: true, order_id: orderId, discount_approval_status: "approved" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function approveSalesOrderCreditOverride({ companyId, userId, orderId, reason }) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("A reason is required to approve a credit override");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT id, created_by, customer_id FROM erp_sales_orders
       WHERE id=$1 AND company_id=$2 AND status='draft' AND is_deleted=FALSE FOR UPDATE`, [orderId, companyId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error("Draft sales order not found");
    assertDifferentUser(order.created_by, userId);
    const customer = await client.query("SELECT credit_hold FROM erp_customers WHERE id=$1 AND company_id=$2 FOR UPDATE", [order.customer_id, companyId]);
    if (customer.rows[0]?.credit_hold) throw new Error("A customer on manual credit hold cannot receive a credit override");
    await client.query(
      `UPDATE erp_sales_orders SET credit_override_approved_by=$3, credit_override_reason=$4,
         credit_override_approved_at=NOW(), credit_override_expires_at=NOW()+INTERVAL '1 hour', updated_at=NOW(), updated_by=$3
       WHERE id=$1 AND company_id=$2`, [orderId, companyId, userId, cleanReason.slice(0, 1000)],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_sales_orders", entityId: orderId,
      action: "sales_credit_override_approved", newValues: { reason: cleanReason.slice(0, 1000), expires_in_minutes: 60 } });
    await client.query("COMMIT");
    return { ok: true, order_id: orderId, credit_override_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function postDeliveryNote({ companyId, userId, deliveryId, postGl = true, client: transactionClient = null }) {
  const ownsClient = !transactionClient;
  const client = transactionClient || await pool.connect();
  try {
    if (ownsClient) await client.query("BEGIN");
    const dnResult = await client.query(
      `SELECT * FROM erp_delivery_notes WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [deliveryId, companyId],
    );
    const dn = dnResult.rows[0];
    if (!dn) throw new Error("Delivery note not found or already posted");

    const orderResult = await client.query(
      `SELECT so.status, customer.credit_hold FROM erp_sales_orders so
       JOIN erp_customers customer ON customer.id=so.customer_id AND customer.company_id=so.company_id
       WHERE so.id = $1 AND so.company_id = $2 FOR UPDATE OF so, customer`,
      [dn.sales_order_id, companyId],
    );
    if (!orderResult.rowCount || !["confirmed", "partial"].includes(orderResult.rows[0].status)) {
      throw new Error("The sales order is not open for delivery");
    }
    if (orderResult.rows[0].credit_hold) throw new Error("Customer is on manual credit hold; delivery is blocked");

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
        referenceType: "delivery_note",
        referenceId: deliveryId,
        userId,
        returnAllocations: true,
      });
      const allocations = issued.allocations.length ? issued.allocations
        : [{ quantity: Number(line.quantity), unit_cost: issued.unitCost, layer_id: null,
          batch_no: null, expiry_date: null }];
      cogsTotal += allocations.reduce((sum, allocation) => sum + Number(allocation.quantity) * Number(allocation.unit_cost || 0), 0);
      for (const allocation of allocations) {
        await client.query(
          `INSERT INTO erp_delivery_note_layer_allocations
           (company_id, delivery_note_line_id, layer_id, batch_no, expiry_date, quantity, unit_cost, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, line.id, allocation.layer_id || allocation.layerId || null, allocation.batch_no || allocation.batchNo || null,
            allocation.expiry_date || allocation.expiryDate || null, allocation.quantity,
            allocation.unit_cost ?? allocation.unitCost ?? issued.unitCost ?? 0, userId],
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
    const stockItems = await client.query(
      `SELECT line.item_id,line.quantity,COALESCE(order_line.unit_price,0) AS unit_price
       FROM erp_delivery_note_lines line
       LEFT JOIN erp_sales_order_lines order_line ON order_line.id=line.so_line_id AND order_line.company_id=line.company_id
       WHERE line.company_id=$1 AND line.delivery_note_id=$2`,
      [companyId, deliveryId],
    );
    await etimsEvents.queueEtimsStockMovementInTransaction(client, {
      companyId,
      userId,
      sourceType: "delivery_note",
      sourceId: deliveryId,
      eventType: "sale",
      occurredDate: dn.delivery_date,
      lines: stockItems.rows.map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), unit_price: Number(line.unit_price) })),
    });
    if (ownsClient) await client.query("COMMIT");

    return { ok: true, delivery_id: deliveryId, cogs_total: cogsTotal, journal_id: journalId };
  } catch (err) {
    if (ownsClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

function toDeliveryQuantity(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isDriverUser(user) {
  return String(user?.role_name || user?.role || "").toLowerCase().includes("driver");
}

function summarizeDeliveryProof({
  customer_confirmed = false,
  route_code = null,
  lines = [],
  proof_note = null,
  signature_url = null,
  delivered_at = null,
} = {}) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).map((line) => ({
    delivered_quantity: toDeliveryQuantity(line.delivered_quantity ?? line.quantity),
    short_quantity: toDeliveryQuantity(line.short_quantity),
    damaged_quantity: toDeliveryQuantity(line.damaged_quantity),
    customer_accepted_quantity: toDeliveryQuantity(line.customer_accepted_quantity ?? line.delivered_quantity ?? line.quantity),
  }));

  const deliveredQuantity = normalizedLines.reduce((sum, line) => sum + line.delivered_quantity, 0);
  const discrepancyQuantity = normalizedLines.reduce((sum, line) => sum + line.short_quantity + line.damaged_quantity, 0);
  const acceptedQuantity = normalizedLines.reduce((sum, line) => sum + line.customer_accepted_quantity, 0);
  const hasDiscrepancy = discrepancyQuantity > 0 || deliveredQuantity > acceptedQuantity;
  const proofStatus = customer_confirmed === false
    ? "pending_customer_confirmation"
    : (hasDiscrepancy ? "discrepancy_reported" : "confirmed");

  return {
    route_code: route_code || null,
    customer_confirmed: Boolean(customer_confirmed),
    proof_status: proofStatus,
    delivered_quantity: deliveredQuantity,
    discrepancy_quantity: discrepancyQuantity,
    accepted_quantity: acceptedQuantity,
    delivered_at: delivered_at || null,
    proof_note: proof_note || null,
    signature_url: signature_url || null,
    lines: normalizedLines,
  };
}

function reconcileRouteCollections({ route_code = null, deliveries = [] } = {}) {
  const normalizedDeliveries = (Array.isArray(deliveries) ? deliveries : []).map((delivery) => ({
    accepted_quantity: toDeliveryQuantity(delivery.accepted_quantity),
    discrepancy_quantity: toDeliveryQuantity(delivery.discrepancy_quantity),
    invoice_value: Number(delivery.invoice_value || 0),
    collected_amount: Number(delivery.collected_amount || 0),
  }));

  const confirmedQuantity = normalizedDeliveries.reduce((sum, delivery) => sum + delivery.accepted_quantity, 0);
  const discrepancyQuantity = normalizedDeliveries.reduce((sum, delivery) => sum + delivery.discrepancy_quantity, 0);
  const invoiceValue = normalizedDeliveries.reduce((sum, delivery) => sum + delivery.invoice_value, 0);
  const collectedAmount = normalizedDeliveries.reduce((sum, delivery) => sum + delivery.collected_amount, 0);
  const outstandingAmount = Math.max(0, invoiceValue - collectedAmount);

  let status = "balanced";
  if (outstandingAmount > 0) status = "collection_gap";
  else if (discrepancyQuantity > 0) status = "discrepancy_open";

  return {
    route_code: route_code || null,
    confirmed_quantity: confirmedQuantity,
    discrepancy_quantity: discrepancyQuantity,
    invoice_value: invoiceValue,
    collected_amount: collectedAmount,
    outstanding_amount: outstandingAmount,
    status,
    deliveries: normalizedDeliveries,
  };
}

function summarizeRouteClosure({
  declared_collection = 0,
  matched_collection = 0,
  proof_pending_count = 0,
  discrepancy_count = 0,
} = {}) {
  const declaredCollection = Number(declared_collection || 0);
  const matchedCollection = Number(matched_collection || 0);
  const proofPendingCount = Number(proof_pending_count || 0);
  const discrepancyCount = Number(discrepancy_count || 0);
  const collectionVariance = Math.round((declaredCollection - matchedCollection + Number.EPSILON) * 100) / 100;

  let status = "ready_for_approval";
  if (proofPendingCount > 0) status = "proof_exceptions";
  else if (Math.abs(collectionVariance) > 0.005) status = "cash_variance";
  else if (discrepancyCount > 0) status = "discrepancy_review";

  return {
    declared_collection: declaredCollection,
    matched_collection: matchedCollection,
    collection_variance: collectionVariance,
    proof_pending_count: proofPendingCount,
    discrepancy_count: discrepancyCount,
    status,
    can_approve: proofPendingCount === 0,
  };
}

async function loadRouteClosureFacts(client, { companyId, routeCode, routeDate, driverUserId, lockDeliveries = false }) {
  const result = await client.query(
    `SELECT dn.id, dn.proof_status, dn.discrepancy_quantity,
            COALESCE((
              SELECT SUM(inv.total_amount)
              FROM erp_customer_invoices inv
              WHERE inv.delivery_note_id = dn.id AND inv.company_id = dn.company_id
                AND inv.is_deleted = FALSE AND inv.status IN ('posted', 'partial', 'overdue', 'paid', 'credited')
            ), 0) AS invoice_value,
            COALESCE((
              SELECT SUM(ra.amount)
              FROM erp_customer_invoices inv
              JOIN erp_receipt_allocations ra ON ra.invoice_id = inv.id AND ra.company_id = inv.company_id
              JOIN erp_customer_receipts receipt ON receipt.id = ra.receipt_id
                AND receipt.company_id = ra.company_id AND receipt.status = 'posted'
              WHERE inv.delivery_note_id = dn.id AND inv.company_id = dn.company_id
                AND inv.is_deleted = FALSE AND receipt.receipt_date = $2::date
            ), 0) AS matched_collection
     FROM erp_delivery_notes dn
     WHERE dn.company_id = $1 AND dn.route_code = $3 AND dn.delivery_date = $2::date
       AND dn.driver_user_id = $4 AND dn.status = 'posted' AND dn.is_deleted = FALSE
     ORDER BY dn.id${lockDeliveries ? " FOR UPDATE OF dn" : ""}`,
    [companyId, routeDate, routeCode, driverUserId],
  );
  const deliveries = result.rows;
  return {
    deliveries,
    deliveryCount: deliveries.length,
    proofPendingCount: deliveries.filter((delivery) => delivery.proof_status === "pending_customer_confirmation").length,
    discrepancyCount: deliveries.filter((delivery) =>
      delivery.proof_status === "discrepancy_reported" || Number(delivery.discrepancy_quantity || 0) > 0
    ).length,
    invoiceValue: deliveries.reduce((sum, delivery) => sum + Number(delivery.invoice_value || 0), 0),
    matchedCollection: deliveries.reduce((sum, delivery) => sum + Number(delivery.matched_collection || 0), 0),
  };
}

async function getRouteCollections({ companyId, routeCode, fromDate = null, toDate = null, driverUserId = null } = {}) {
  if (!routeCode) throw new Error("route_code is required");
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT dn.id, dn.route_code, dn.delivery_no, dn.delivery_date,
              COALESCE(dn.accepted_quantity, 0) AS accepted_quantity,
              COALESCE(dn.discrepancy_quantity, 0) AS discrepancy_quantity,
              COALESCE(inv.total_amount, 0) AS invoice_value,
              COALESCE(receipts.received_amount, 0) AS collected_amount
       FROM erp_delivery_notes dn
       LEFT JOIN erp_customer_invoices inv ON inv.delivery_note_id = dn.id AND inv.company_id = dn.company_id AND inv.is_deleted = FALSE
       LEFT JOIN (
         SELECT ra.invoice_id, SUM(ra.amount) AS received_amount
         FROM erp_receipt_allocations ra
         JOIN erp_customer_receipts r ON r.id = ra.receipt_id AND r.company_id = ra.company_id AND r.status = 'posted'
         WHERE ra.company_id = $1
         GROUP BY ra.invoice_id
       ) receipts ON receipts.invoice_id = inv.id
       WHERE dn.company_id = $1 AND dn.is_deleted = FALSE AND dn.route_code = $2
         AND ($3::date IS NULL OR dn.delivery_date >= $3::date)
         AND ($4::date IS NULL OR dn.delivery_date <= $4::date)
         AND ($5::uuid IS NULL OR dn.driver_user_id = $5)
       ORDER BY dn.delivery_date DESC, dn.created_at DESC`,
      [companyId, String(routeCode).trim(), fromDate || null, toDate || null, driverUserId],
    );
    return reconcileRouteCollections({
      route_code: routeCode,
      deliveries: result.rows.map((row) => ({
        accepted_quantity: Number(row.accepted_quantity || 0),
        discrepancy_quantity: Number(row.discrepancy_quantity || 0),
        invoice_value: Number(row.invoice_value || 0),
        collected_amount: Number(row.collected_amount || 0),
      })),
    });
  } finally {
    client.release();
  }
}

async function submitRouteClosure({
  companyId,
  user,
  routeCode,
  routeDate,
  driverUserId,
  declaredCollection,
  note,
}) {
  const route = String(routeCode || "").trim();
  const declared = Number(declaredCollection);
  if (!route || !/^\d{4}-\d{2}-\d{2}$/.test(String(routeDate || "")) || !driverUserId) {
    throw new Error("route_code, route_date and driver_user_id are required");
  }
  if (isDriverUser(user) && driverUserId !== user.id) {
    throw new Error("Drivers can only submit their own route closure");
  }
  if (!Number.isFinite(declared) || declared < 0) throw new Error("Declared collection must be a non-negative amount");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `route-close:${companyId}:${routeDate}:${route}:${driverUserId}`,
    ]);

    const facts = await loadRouteClosureFacts(client, {
      companyId,
      routeCode: route,
      routeDate,
      driverUserId,
      lockDeliveries: true,
    });
    if (!facts.deliveryCount) throw new Error("No posted deliveries match this route, date and driver");

    const summary = summarizeRouteClosure({
      declared_collection: declared,
      matched_collection: facts.matchedCollection,
      proof_pending_count: facts.proofPendingCount,
      discrepancy_count: facts.discrepancyCount,
    });

    const closureResult = await client.query(
      `INSERT INTO erp_route_closures (
         company_id, route_code, route_date, driver_user_id, status, delivery_count,
         proof_pending_count, discrepancy_count, invoice_value, matched_collection,
         declared_collection, collection_variance, close_note, submitted_at, submitted_by, created_by
       ) VALUES ($1,$2,$3,$4,'submitted',$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,$13)
       ON CONFLICT (company_id, route_code, route_date, driver_user_id)
       DO UPDATE SET status = 'submitted', delivery_count = EXCLUDED.delivery_count,
         proof_pending_count = EXCLUDED.proof_pending_count, discrepancy_count = EXCLUDED.discrepancy_count,
         invoice_value = EXCLUDED.invoice_value, matched_collection = EXCLUDED.matched_collection,
         declared_collection = EXCLUDED.declared_collection, collection_variance = EXCLUDED.collection_variance,
         close_note = EXCLUDED.close_note, submitted_at = NOW(), submitted_by = EXCLUDED.submitted_by,
         reviewed_at = NULL, reviewed_by = NULL, review_note = NULL, updated_at = NOW()
       WHERE erp_route_closures.status = 'rejected'
       RETURNING *`,
      [companyId, route, routeDate, driverUserId, facts.deliveryCount, facts.proofPendingCount, facts.discrepancyCount,
        facts.invoiceValue, facts.matchedCollection, declared, summary.collection_variance, String(note || "").trim() || null, user.id],
    );

    if (!closureResult.rowCount) {
      throw new Error("A route closure has already been submitted or approved for this driver and date");
    }
    await client.query("COMMIT");
    return { ...closureResult.rows[0], can_approve: summary.can_approve };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listRouteClosures(companyId, { status = null, routeDate = null, user = null } = {}) {
  const result = await pool.query(
    `SELECT rc.*, driver.full_name AS driver_name,
            submitter.full_name AS submitted_by_name, reviewer.full_name AS reviewed_by_name
     FROM erp_route_closures rc
     LEFT JOIN erp_users driver ON driver.id = rc.driver_user_id
     LEFT JOIN erp_users submitter ON submitter.id = rc.submitted_by
     LEFT JOIN erp_users reviewer ON reviewer.id = rc.reviewed_by
     WHERE rc.company_id = $1
       AND ($2::text IS NULL OR rc.status = $2)
       AND ($3::date IS NULL OR rc.route_date = $3::date)
       AND ($4::boolean = FALSE OR rc.driver_user_id = $5)
     ORDER BY rc.route_date DESC, rc.created_at DESC
     LIMIT 500`,
     [companyId, status || null, routeDate || null, isDriverUser(user), user?.id || null],
  );
  return result.rows;
}

async function reviewRouteClosure({ companyId, closureId, decision, note, user }) {
  if (!["approve", "reject"].includes(decision)) throw new Error("Decision must be approve or reject");
  const reviewNote = String(note || "").trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT *, TO_CHAR(route_date, 'YYYY-MM-DD') AS route_date_iso FROM erp_route_closures
       WHERE id = $1 AND company_id = $2 AND status = 'submitted' FOR UPDATE`,
      [closureId, companyId],
    );
    const closure = result.rows[0];
    if (!closure) throw new Error("Submitted route closure not found");
    const facts = await loadRouteClosureFacts(client, {
      companyId,
      routeCode: closure.route_code,
      routeDate: closure.route_date_iso,
      driverUserId: closure.driver_user_id,
    });
    if (!facts.deliveryCount) throw new Error("No posted deliveries remain for this route closure");
    const summary = summarizeRouteClosure({
      declared_collection: closure.declared_collection,
      matched_collection: facts.matchedCollection,
      proof_pending_count: facts.proofPendingCount,
      discrepancy_count: facts.discrepancyCount,
    });
    if (decision === "approve" && !summary.can_approve) {
      throw new Error("Resolve pending customer proof before approving this route closure");
    }
    if (decision === "reject" && !reviewNote) throw new Error("A review note is required when rejecting a route closure");
    if (decision === "approve" && (Math.abs(summary.collection_variance) > 0.005 || facts.discrepancyCount > 0) && !reviewNote) {
      throw new Error("A review note is required to approve a route closure with cash variance or delivery discrepancies");
    }

    const updated = await client.query(
      `UPDATE erp_route_closures
       SET status = $3, delivery_count = $6, proof_pending_count = $7, discrepancy_count = $8,
           invoice_value = $9, matched_collection = $10, collection_variance = $11,
           reviewed_at = NOW(), reviewed_by = $4, review_note = $5, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [closureId, companyId, decision === "approve" ? "approved" : "rejected", user.id, reviewNote || null,
        facts.deliveryCount, facts.proofPendingCount, facts.discrepancyCount, facts.invoiceValue, facts.matchedCollection,
        summary.collection_variance],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordDeliveryProof({
  companyId,
  userId,
  user = null,
  deliveryId,
  routeCode,
  driverUserId,
  vehicleWarehouseId,
  customerConfirmed,
  deliveredAt,
  proofNote,
  signatureUrl,
  lines,
}) {
  const summary = summarizeDeliveryProof({
    customer_confirmed: Boolean(customerConfirmed),
    route_code: routeCode,
    lines,
    proof_note: proofNote,
    signature_url: signatureUrl,
    delivered_at: deliveredAt,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliveryResult = await client.query(
      `SELECT * FROM erp_delivery_notes WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [deliveryId, companyId],
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) throw new Error("Delivery note not found");

    const actor = user || { id: userId };
    const actorIsDriver = isDriverUser(actor);
    const effectiveDriverUserId = actorIsDriver ? actor.id : (driverUserId || null);
    if (actorIsDriver && driverUserId && driverUserId !== actor.id) {
      throw new Error("Drivers can only submit proof for their own deliveries");
    }
    if (actorIsDriver && !delivery.driver_user_id) {
      throw new Error("A manager must assign this delivery before the driver can submit proof");
    }
    if (actorIsDriver && delivery.driver_user_id && delivery.driver_user_id !== actor.id) {
      throw new Error("Delivery is assigned to another driver");
    }
    if (actorIsDriver && !vehicleWarehouseId) {
      throw new Error("Drivers must submit proof from their assigned vehicle");
    }
    if (effectiveDriverUserId) {
      const assignedDriver = await client.query(
        `SELECT u.id
         FROM erp_users u
         JOIN erp_roles r ON r.id = u.role_id
         WHERE u.id = $1 AND u.company_id = $2 AND u.status = 'active'
           AND u.is_deleted = FALSE AND LOWER(r.name) LIKE '%driver%'`,
        [effectiveDriverUserId, companyId],
      );
      if (!assignedDriver.rowCount) throw new Error("Choose an active driver in this company");
    }
    if (vehicleWarehouseId) {
      const vehicle = await client.query(
        `SELECT id, assigned_driver_user_id
         FROM erp_warehouses
         WHERE id = $1 AND company_id = $2 AND location_type = 'vehicle'
           AND is_active = TRUE AND is_deleted = FALSE`,
        [vehicleWarehouseId, companyId],
      );
      if (!vehicle.rowCount) throw new Error("Choose an active vehicle stock location in this company");
      if (effectiveDriverUserId && vehicle.rows[0].assigned_driver_user_id !== effectiveDriverUserId) {
        throw new Error("Vehicle is not assigned to the selected driver");
      }
    }

    if (delivery.route_code && delivery.driver_user_id) {
      const closureResult = await client.query(
        `SELECT id, status FROM erp_route_closures
         WHERE company_id = $1 AND route_code = $2 AND route_date = $3::date
           AND driver_user_id = $4 AND status IN ('submitted', 'approved')
         FOR UPDATE`,
        [companyId, delivery.route_code, delivery.delivery_date, delivery.driver_user_id],
      );
      const closure = closureResult.rows[0];
      if (closure?.status === "approved") {
        throw new Error("Proof for an approved route closure cannot be changed");
      }
      if (closure?.status === "submitted" && (
        (routeCode && String(routeCode).trim() !== delivery.route_code) ||
        (driverUserId && driverUserId !== delivery.driver_user_id)
      )) {
        throw new Error("Route and driver assignments cannot change while the route closure is under review");
      }
    }

    if (routeCode && String(routeCode).trim()) {
      await client.query(
        `UPDATE erp_delivery_notes SET route_code = $3, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
        [deliveryId, companyId, String(routeCode).trim(), userId],
      );
    }
    if (driverUserId) {
      await client.query(
        `UPDATE erp_delivery_notes SET driver_user_id = $3, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
        [deliveryId, companyId, effectiveDriverUserId, userId],
      );
    }
    if (vehicleWarehouseId) {
      await client.query(
        `UPDATE erp_delivery_notes SET vehicle_warehouse_id = $3, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND company_id = $2`,
        [deliveryId, companyId, vehicleWarehouseId, userId],
      );
    }

    if (Array.isArray(lines) && lines.length > 0) {
      for (const line of lines) {
        const lineId = line.delivery_line_id || line.id;
        if (!lineId) throw new Error("Each proof line needs a delivery_line_id");

        const deliveredQty = toDeliveryQuantity(line.delivered_quantity ?? line.quantity);
        const shortQty = toDeliveryQuantity(line.short_quantity);
        const damagedQty = toDeliveryQuantity(line.damaged_quantity);
        const acceptedQty = toDeliveryQuantity(line.customer_accepted_quantity ?? deliveredQty);

        await client.query(
          `UPDATE erp_delivery_note_lines
           SET delivered_quantity = $3,
               short_quantity = $4,
               damaged_quantity = $5,
               customer_accepted_quantity = $6,
               updated_at = NOW(),
               updated_by = $7
           WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
          [lineId, companyId, deliveredQty, shortQty, damagedQty, acceptedQty, userId],
        );
      }
    }

    const updated = await client.query(
      `UPDATE erp_delivery_notes
       SET route_code = COALESCE($3, route_code),
           driver_user_id = COALESCE($4, driver_user_id),
           vehicle_warehouse_id = COALESCE($5, vehicle_warehouse_id),
           proof_status = $6,
           proof_note = COALESCE($7, proof_note),
           signature_url = COALESCE($8, signature_url),
           delivered_at = COALESCE($9::timestamptz, delivered_at),
           customer_confirmed = $10,
           customer_confirmed_at = CASE WHEN $10 = TRUE AND customer_confirmed_at IS NULL THEN NOW() ELSE customer_confirmed_at END,
           delivered_quantity = COALESCE($11, delivered_quantity),
           discrepancy_quantity = COALESCE($12, discrepancy_quantity),
           accepted_quantity = COALESCE($13, accepted_quantity),
           updated_at = NOW(),
           updated_by = $14
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [
        deliveryId,
        companyId,
        summary.route_code,
        effectiveDriverUserId,
        vehicleWarehouseId || null,
        summary.proof_status,
        summary.proof_note,
        summary.signature_url,
        deliveredAt || null,
        summary.customer_confirmed,
        summary.delivered_quantity,
        summary.discrepancy_quantity,
        summary.accepted_quantity,
        userId,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, delivery_id: deliveryId, ...summary, record: updated.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
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
          0,
          userId,
        ],
      );
    }
    const posted = await postDeliveryNote({ companyId, userId, deliveryId: dn.id, client });
    await client.query("COMMIT");
    return posted;
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
    let invoice = result.rows[0];
    if (!invoice) throw new Error("Invoice not found or already posted");
    const legalInvoiceNo = await nextNo(client, companyId, "erp_customer_invoices", "INV");
    const numbered = await client.query(
      "UPDATE erp_customer_invoices SET invoice_no=$3 WHERE id=$1 AND company_id=$2 RETURNING *",
      [invoiceId, companyId, legalInvoiceNo],
    );
    invoice = numbered.rows[0];
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
    const etimsSubmission = await integration.enqueueEtimsInvoiceInTransaction(client, {
      companyId,
      userId,
      invoiceId,
    });
    await client.query("COMMIT");
    return {
      ok: true,
      invoice_id: invoiceId,
      invoice_no: invoice.invoice_no,
      journal_id: journalId,
      etims_status: etimsSubmission.status,
      etims_configured: etimsSubmission.configured,
      gl_warning: null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function voidCustomerInvoice({ companyId, userId, invoiceId, reason }) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("A void reason is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id,invoice_no,status FROM erp_customer_invoices WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE",
      [invoiceId, companyId],
    );
    const invoice = result.rows[0];
    if (!invoice || invoice.status !== "draft") throw new Error("Only an unposted draft invoice can be voided");
    const voided = await client.query(
      "UPDATE erp_customer_invoices SET status='void',void_reason=$3,voided_by=$4,voided_at=NOW(),updated_by=$4,updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *",
      [invoiceId, companyId, cleanReason, userId],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_customer_invoices", entityId: invoiceId,
      action: "void", oldValues: invoice, newValues: { status: "void", reason: cleanReason } });
    await client.query("COMMIT");
    return voided.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
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
  permissions = [],
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
    const invoiceNo = `TMP-${require("crypto").randomUUID()}`;
    const customer = await client.query(
      `SELECT price_list_id FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR SHARE`,
      [customerId, companyId],
    );
    if (!customer.rowCount) throw new Error("Customer does not belong to this company or is inactive");
    const etimsEnabled = await client.query(
      `SELECT 1 FROM erp_integration_settings
       WHERE company_id=$1 AND provider='etims' AND provider_mode IN ('sandbox','production') LIMIT 1`,
      [companyId],
    );
    if (etimsEnabled.rowCount) {
      for (const line of lines) {
        const registered = await client.query(
          `SELECT etims_sync_status FROM erp_items
           WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE AND is_active=TRUE AND is_saleable=TRUE`,
          [line.item_id, companyId],
        );
        if (!registered.rowCount || registered.rows[0].etims_sync_status !== "synced") {
          throw new Error("Item must be registered with KRA before invoicing while eTIMS is enabled");
        }
      }
    }
    let subtotal = 0;
    let discountAmount = 0;
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
          `SELECT id, sales_order_id, item_id, unit_price, discount_percent, tax_group_id, tax_code, tax_treatment, quantity, qty_delivered, qty_invoiced
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
      const price = orderLine ? { unitPrice: Number(orderLine.unit_price), listPrice: Number(orderLine.unit_price), overridden: false }
        : await resolveCustomerPrice(client, { companyId, customerId, itemId: line.item_id,
          quantity: Number(line.quantity), priceDate: invoiceDate || new Date().toISOString().slice(0, 10),
          suppliedPrice: line.unit_price, permissions, freeIssueReasonCode: line.reason_code });
      const discountPercent = orderLine ? Number(orderLine.discount_percent || 0) : Number(line.discount_percent || 0);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) throw new Error("Invoice discount must be from 0 to 100 percent");
      if (discountPercent > 0 && !orderLine && discountPercent > await getMaximumDiscountPercent(client, companyId)) {
        throw new Error("Above-limit discounts must be approved on a sales order before invoicing");
      }
      const gross = lineMoney(line.quantity, price.unitPrice);
      const lineDiscount = roundMoney(gross * discountPercent / 100);
      const net = sumMoney([gross, -lineDiscount]);
      const tax = await resolveSaleTax(client, companyId, line.item_id, orderLine?.tax_group_id || null, invoiceDate || undefined,
        orderLine ? { tax_code: orderLine.tax_code, tax_treatment: orderLine.tax_treatment } : null);
      const taxValue = lineTax(net, tax.rate);
      subtotal = sumMoney([subtotal, net]);
      discountAmount = sumMoney([discountAmount, lineDiscount]);
      taxAmount = sumMoney([taxAmount, taxValue]);
      preparedLines.push({ ...line, unit_price: price.unitPrice, discount_percent: discountPercent,
        discount_amount: lineDiscount, net_amount: net, priceOverridden: price.overridden, listPrice: price.listPrice, tax, taxValue });
    }
    const total = sumMoney([subtotal, taxAmount]);

    const invResult = await client.query(
      `INSERT INTO erp_customer_invoices (
         company_id, customer_id, sales_order_id, delivery_note_id, invoice_no, invoice_date, due_date,
         status, subtotal, discount_amount, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,'draft',$8,$9,$10,$11,$12) RETURNING *`,
      [
        companyId,
        customerId,
        salesOrderId,
        deliveryNoteId,
        invoiceNo,
        invoiceDate,
        dueDate,
        subtotal,
        discountAmount,
        taxAmount,
        total,
        userId,
      ],
    );
    const inv = invResult.rows[0];

    let lineNo = 1;
    for (const line of preparedLines) {
      await client.query(
        `INSERT INTO erp_customer_invoice_lines (
           company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total,
           discount_percent, discount_amount, tax_group_id, tax_rate_id, tax_code, tax_treatment, tax_rate, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          companyId,
          inv.id,
          lineNo++,
          line.item_id,
          line.quantity,
          line.unit_price,
          line.taxValue,
          line.net_amount,
          line.discount_percent,
          line.discount_amount,
          line.tax.groupId,
          line.tax.rateId,
          line.tax.code,
          line.tax.treatment,
          line.tax.rate,
          userId,
        ],
      );
      if (line.priceOverridden) {
        await logAudit({ client, companyId, userId, entityType: "erp_customer_invoices", entityId: inv.id,
          action: "sales_price_overridden", oldValues: { item_id: line.item_id, list_unit_price: line.listPrice },
          newValues: { unit_price: line.unit_price, quantity: line.quantity } });
      }
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

async function legacyRecordCustomerPayment({
  companyId, userId, invoiceId, paymentDate, amount, referenceNo, notes,
  paymentMethod = "bank_transfer", providerReceiptNo = null, postGl = true,
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
    const method = String(paymentMethod || "bank_transfer").toLowerCase();
    if (!["bank_transfer", "bank", "cash", "mpesa"].includes(method)) {
      throw new Error("Unsupported customer payment method");
    }
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }
    if (providerReceiptNo) {
      const existing = await client.query(
        `SELECT receipt.id, receipt.receipt_no, receipt.amount, allocation.invoice_id
         FROM erp_customer_receipts receipt
         JOIN erp_receipt_allocations allocation
           ON allocation.receipt_id = receipt.id AND allocation.company_id = receipt.company_id
         WHERE receipt.company_id = $1 AND receipt.payment_method = 'mpesa'
           AND receipt.provider_receipt_no = $2 AND receipt.is_deleted = FALSE
         FOR UPDATE OF receipt`,
        [companyId, providerReceiptNo],
      );
      if (existing.rowCount) {
        const receipt = existing.rows[0];
        if (receipt.invoice_id !== invoiceId || Math.abs(Number(receipt.amount) - paymentAmount) > 0.0001) {
          throw new Error("M-Pesa receipt number is already allocated to a different payment");
        }
        return {
          ok: true,
          payment_no: receipt.receipt_no,
          receipt_id: receipt.id,
          status: invoice.status,
          amount_paid: Number(invoice.amount_paid || 0),
          idempotent: true,
          journal_id: null,
        };
      }
    }
    const outstanding = Number(invoice.total_amount) - Number(invoice.amount_paid || 0) - Number(invoice.credited_amount || 0);
    if (outstanding <= 0) throw new Error("Invoice has no outstanding balance");
    if (paymentAmount - outstanding > 0.0001) throw new Error("Payment amount exceeds outstanding balance");

    const paymentNo = await nextNo(client, companyId, "erp_customer_receipts", "RCP");
    const created = await client.query(
      `INSERT INTO erp_customer_receipts (
         company_id, receipt_no, customer_id, receipt_date, amount, payment_method,
         provider_receipt_no, reference_no, status, created_by
       ) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,'draft',$9) RETURNING *`,
      [companyId, paymentNo, invoice.customer_id, paymentDate || null, paymentAmount, method,
        providerReceiptNo, referenceNo || null, userId],
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
    return { ok: true, payment_no: paymentNo, receipt_id: receipt.id, status, amount_paid: newPaid, journal_id: journalId, gl_warning: null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function recordCustomerPayment(options) {
  const receipts = require("./customerReceiptService");
  return receipts.createCustomerReceipt({
    companyId: options.companyId, userId: options.userId, customerId: options.customerId,
    invoiceId: options.invoiceId, allocations: options.allocations, amount: options.amount,
    paymentMethod: options.paymentMethod || "bank_transfer", referenceNo: options.referenceNo,
    providerReceiptNo: options.providerReceiptNo, paymentDate: options.paymentDate, notes: options.notes,
    idempotencyKey: options.idempotencyKey, tillSessionId: options.tillSessionId,
  });
}


module.exports = {
  checkAtp,
  previewSaleTax,
  checkCreditLimit,
  createSalesOrder,
  confirmSalesOrder,
  approveSalesOrderDiscount,
  approveSalesOrderCreditOverride,
  summarizeDeliveryProof,
  reconcileRouteCollections,
  summarizeRouteClosure,
  getRouteCollections,
  submitRouteClosure,
  listRouteClosures,
  reviewRouteClosure,
  recordDeliveryProof,
  cancelSalesOrder,
  postDeliveryNote,
  createAndPostDelivery,
  createCustomerInvoice,
  postCustomerInvoice,
  voidCustomerInvoice,
  recordCustomerPayment,
};
