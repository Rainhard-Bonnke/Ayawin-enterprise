const pool = require("../db");
const gl = require("./glPostingService");
const { logAudit, assertDifferentUser } = require("./auditService");
const etimsEvents = require("./etimsEventService");

const PURCHASE_TAX_TREATMENTS = new Set(["standard", "zero_rated", "exempt", "out_of_scope"]);

function normalizeBillTaxLine(line, lineNo) {
  const taxTreatment = line.tax_treatment || "standard";
  const taxRate = Number(line.tax_rate || 0);
  const claimableVatRatio =
    line.claimable_vat_ratio === undefined
      ? taxTreatment === "standard"
        ? 1
        : 0
      : Number(line.claimable_vat_ratio);
  if (!PURCHASE_TAX_TREATMENTS.has(taxTreatment)) {
    throw new Error("Supplier bill line has an unsupported tax treatment");
  }
  if (!Number.isFinite(claimableVatRatio) || claimableVatRatio < 0 || claimableVatRatio > 1) {
    throw new Error("Claimable VAT ratio must be between 0 and 1");
  }
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    throw new Error("Supplier tax rate must be between 0 and 100");
  }
  if (taxTreatment !== "standard" && taxRate > 0) {
    throw new Error("Only standard-rated supplier bill lines can have a positive tax rate");
  }
  const net = Math.round(Number(line.quantity) * Number(line.unit_price) * 100) / 100;
  const tax = Math.round(net * taxRate * 100) / 10000;
  const claimableVat = Math.round(tax * claimableVatRatio * 100) / 100;
  return {
    ...line,
    lineNo,
    net,
    tax,
    taxTreatment,
    claimableVatRatio,
    claimableVat,
    nonClaimableVat: Math.round((tax - claimableVat) * 100) / 100,
  };
}

function calendarDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function addBusinessDays(dateValue, businessDays, holidays = new Set()) {
  const date = new Date(`${calendarDate(dateValue)}T00:00:00.000Z`);
  let added = 0;
  while (added < businessDays) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    const dateKey = date.toISOString().slice(0, 10);
    if (weekday !== 0 && weekday !== 6 && !holidays.has(dateKey)) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

async function resolveBillTaxLine(client, companyId, line, billDate, permissions = []) {
  let itemId = line.item_id || null;
  if (!itemId && line.goods_receipt_line_id) {
    const receiptItem = await client.query(
      `SELECT item_id FROM erp_goods_receipt_lines
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [line.goods_receipt_line_id, companyId],
    );
    if (!receiptItem.rowCount)
      throw new Error("Goods receipt line was not found for tax-group resolution");
    itemId = receiptItem.rows[0].item_id;
  }

  let taxGroupId = null;
  let defaultTreatment = "standard";
  let defaultRate = null;
  if (itemId) {
    const item = await client.query(
      `SELECT id, tax_group_id FROM erp_items
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE AND is_purchasable = TRUE`,
      [itemId, companyId],
    );
    if (!item.rowCount || !item.rows[0].tax_group_id) {
      throw new Error("Purchasable item must have an active tax group before it can be billed");
    }
    taxGroupId = item.rows[0].tax_group_id;
    const groupResult = await client.query(
      `SELECT id, code, tax_treatment FROM erp_tax_groups
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
      [taxGroupId, companyId],
    );
    const group = groupResult.rows[0];
    if (!group || !PURCHASE_TAX_TREATMENTS.has(group.tax_treatment)) {
      throw new Error("Purchasable item tax group is invalid or inactive");
    }
    defaultTreatment = group.tax_treatment;
    const rates = await client.query(
      `SELECT r.id, r.code, r.rate, r.tax_type, r.basis
       FROM erp_tax_group_rates gr
       JOIN erp_tax_rates r ON r.id = gr.tax_rate_id AND r.company_id = gr.company_id
       WHERE gr.company_id = $1 AND gr.tax_group_id = $2 AND gr.is_deleted = FALSE
         AND r.is_active = TRUE AND r.is_deleted = FALSE AND r.effective_from <= $3::date
         AND (r.effective_to IS NULL OR r.effective_to >= $3::date)`,
      [companyId, taxGroupId, billDate || new Date().toISOString().slice(0, 10)],
    );
    if (defaultTreatment === "standard" || defaultTreatment === "zero_rated") {
      if (
        rates.rowCount !== 1 ||
        rates.rows[0].tax_type !== "vat" ||
        rates.rows[0].basis !== "percentage"
      ) {
        throw new Error(
          `Tax group ${group.code} must have exactly one effective percentage VAT rate`,
        );
      }
      defaultRate = Number(rates.rows[0].rate);
      if (defaultTreatment === "zero_rated" && defaultRate !== 0) {
        throw new Error(`Zero-rated tax group ${group.code} must use a 0% VAT rate`);
      }
    } else if (rates.rowCount) {
      throw new Error(`Tax group ${group.code} cannot include active VAT rates for its treatment`);
    }
  }

  const taxTreatment = line.tax_treatment === undefined ? defaultTreatment : line.tax_treatment;
  const taxRate =
    line.tax_rate === undefined ||
    (itemId && Number(line.tax_rate) === 0 && line.tax_treatment === undefined && defaultRate > 0)
      ? (defaultRate ?? 0)
      : Number(line.tax_rate);
  const defaultClaimableRatio = defaultTreatment === "standard" ? 1 : 0;
  const claimableVatRatio =
    line.claimable_vat_ratio === undefined
      ? taxTreatment === defaultTreatment
        ? defaultClaimableRatio
        : taxTreatment === "standard"
          ? 1
          : 0
      : Number(line.claimable_vat_ratio);
  const taxOverride =
    taxTreatment !== defaultTreatment ||
    (defaultRate !== null && taxRate !== defaultRate) ||
    claimableVatRatio !==
      (taxTreatment === defaultTreatment
        ? defaultClaimableRatio
        : taxTreatment === "standard"
          ? 1
          : 0);
  if (taxOverride && !permissions.includes("tax.edit")) {
    throw new Error("Tax treatment, rate, or claimability overrides require tax.edit permission");
  }
  return {
    ...line,
    itemId,
    taxGroupId,
    tax_treatment: taxTreatment,
    tax_rate: taxRate,
    claimable_vat_ratio: claimableVatRatio,
    taxOverride,
    taxDefaults: {
      tax_treatment: defaultTreatment,
      tax_rate: defaultRate,
      claimable_vat_ratio: defaultClaimableRatio,
    },
  };
}

function buildBillPostingLines({
  bill,
  lines,
  payableAccountId,
  inputVatAccountId,
  pendingVatAccountId,
  nonClaimableVatTreatment = "add_to_cost",
  accrualAccount,
}) {
  const journalLines = accrualAccount
    ? [
        {
          account_id: accrualAccount.id,
          debit: Number(bill.subtotal),
          credit: 0,
          description: `Clear ${accrualAccount.account_code} receipt accrual for ${bill.supplier_invoice_no}`,
        },
      ]
    : [];

  if (!accrualAccount) {
    journalLines.push(
      ...lines.map((line) => ({
        account_id: line.account_id,
        debit:
          Number(line.net_amount) +
          (nonClaimableVatTreatment === "add_to_cost" ? Number(line.non_claimable_vat || 0) : 0),
        credit: 0,
        description: line.description,
      })),
    );
  }
  if (accrualAccount || nonClaimableVatTreatment === "separate_account") {
    for (const line of lines) {
      const nonClaimableVat = Number(line.non_claimable_vat || 0);
      if (nonClaimableVat > 0) {
        journalLines.push({
          account_id: line.non_claimable_vat_account_id || line.account_id,
          debit: nonClaimableVat,
          credit: 0,
          description: `Non-claimable VAT added to cost: ${line.description}`,
        });
      }
    }
  }

  const claimableVat = lines.reduce((sum, line) => sum + Number(line.claimable_vat || 0), 0);
  const verified = bill.evidence_status === "verified";
  const recognizedVat = verified ? claimableVat : 0;
  const pendingVat = verified ? 0 : claimableVat;
  if (recognizedVat > 0) {
    if (!inputVatAccountId) throw new Error("Input VAT account 1400 is missing or not postable");
    journalLines.push({
      account_id: inputVatAccountId,
      debit: recognizedVat,
      credit: 0,
      description: "Verified input VAT on supplier bill",
    });
  }
  if (pendingVat > 0) {
    if (!pendingVatAccountId)
      throw new Error("Input VAT pending evidence account 1401 is missing or not postable");
    journalLines.push({
      account_id: pendingVatAccountId,
      debit: pendingVat,
      credit: 0,
      description: "Input VAT pending supplier invoice evidence",
    });
  }
  journalLines.push({
    account_id: payableAccountId,
    debit: 0,
    credit: Number(bill.total_amount),
    description: `Supplier payable ${bill.supplier_invoice_no}`,
  });
  return journalLines;
}

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
  etimsInvoiceNo,
  etimsReceiptSignature,
  permissions = [],
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
      "SELECT id, currency_code, tax_residency FROM erp_vendors WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE",
      [vendorId, companyId],
    );
    if (!vendor.rowCount) throw new Error("Supplier not found or inactive");
    if (Boolean(purchaseOrderId) !== Boolean(goodsReceiptId)) {
      throw new Error(
        "A matched supplier bill must reference both its purchase order and goods receipt",
      );
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
      if (!receipt.rowCount)
        throw new Error("The posted goods receipt, purchase order and supplier do not match");
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
    const normalized = [];
    for (const [index, line] of lines.entries()) {
      const resolvedLine = await resolveBillTaxLine(client, companyId, line, billDate, permissions);
      const normalizedLine = normalizeBillTaxLine(resolvedLine, index + 1);
      const { net, tax } = normalizedLine;
      subtotal += net;
      taxAmount += tax;
      normalized.push(normalizedLine);
    }
    for (const line of normalized) {
      if (!line.withholding_category_id) continue;
      const category = await client.query(
        `SELECT id, residency FROM erp_withholding_categories
         WHERE id=$1 AND company_id=$2 AND status='approved' AND is_deleted=FALSE
           AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)`,
        [
          line.withholding_category_id,
          companyId,
          billDate || new Date().toISOString().slice(0, 10),
        ],
      );
      if (!category.rowCount)
        throw new Error(
          "Supplier bill uses a withholding category that is not approved and effective",
        );
      if (
        !vendor.rows[0].tax_residency ||
        vendor.rows[0].tax_residency !== category.rows[0].residency
      ) {
        throw new Error("Supplier tax residency must match the approved withholding category");
      }
    }
    if (goodsReceiptId) {
      const matchedIds = new Set();
      for (const line of normalized) {
        const receiptLineId = line.goods_receipt_line_id;
        if (!receiptLineId || matchedIds.has(receiptLineId)) {
          throw new Error("Every matched bill line must reference a different goods receipt line");
        }
        matchedIds.add(receiptLineId);
        const receiptLine = await client.query(
          `SELECT gl.id, gl.item_id, gl.quantity, gl.unit_cost, gl.po_line_id
           FROM erp_goods_receipt_lines gl
           JOIN erp_goods_receipts gr ON gr.id = gl.goods_receipt_id
           JOIN erp_purchase_order_lines pol ON pol.id = gl.po_line_id
           WHERE gl.id = $1 AND gl.goods_receipt_id = $2 AND gl.company_id = $3
             AND gr.purchase_order_id = $4 AND pol.purchase_order_id = $4
             AND gl.is_deleted = FALSE AND pol.is_deleted = FALSE`,
          [receiptLineId, goodsReceiptId, companyId, purchaseOrderId],
        );
        const source = receiptLine.rows[0];
        if (!source)
          throw new Error(
            "A bill line does not belong to the selected goods receipt and purchase order",
          );
        if (String(source.item_id) !== String(line.itemId))
          throw new Error("Supplier bill item does not match the selected goods receipt line");
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
          throw new Error(
            "Supplier bill price differs from the received purchase order price; route the variance for approval",
          );
        }
      }
    } else if (normalized.some((line) => line.goods_receipt_line_id)) {
      throw new Error(
        "Receipt-linked bill lines require the purchase order and goods receipt on the bill",
      );
    }
    const total = Math.round((subtotal + taxAmount) * 100) / 100;
    const bill = await client.query(
      `INSERT INTO erp_supplier_bills
      (company_id, vendor_id, purchase_order_id, goods_receipt_id, bill_no, supplier_invoice_no,
       bill_date, due_date, currency_code, subtotal, tax_amount, total_amount, notes, created_by,
       etims_invoice_no, etims_receipt_signature, evidence_status)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,CURRENT_DATE),COALESCE($8,COALESCE($7,CURRENT_DATE)),
       COALESCE($9,'KES'),$10,$11,$12,$13,$14,$15,$16,'unverified') RETURNING *`,
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
        etimsInvoiceNo || null,
        etimsReceiptSignature || null,
      ],
    );
    for (const line of normalized) {
      await client.query(
        `INSERT INTO erp_supplier_bill_lines
         (company_id, bill_id, line_no, description, quantity, unit_price, tax_rate, net_amount, tax_amount,
          account_id, goods_receipt_line_id, created_by, tax_treatment, claimable_vat_ratio, claimable_vat,
          withholding_category_id,
          item_id, tax_group_id,
          non_claimable_vat, input_vat_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
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
          line.taxTreatment,
          line.claimableVatRatio,
          line.claimableVat,
          line.withholding_category_id || null,
          line.itemId,
          line.taxGroupId,
          line.nonClaimableVat,
          line.claimableVat > 0 ? "held_no_evidence" : "non_claimable",
        ],
      );
      if (line.taxOverride) {
        await logAudit({
          client,
          companyId,
          userId,
          entityType: "erp_supplier_bill_lines",
          entityId: `${bill.rows[0].id}:${line.lineNo}`,
          action: "supplier_bill_tax_override",
          oldValues: line.taxDefaults,
          newValues: {
            item_id: line.itemId,
            tax_group_id: line.taxGroupId,
            tax_treatment: line.taxTreatment,
            tax_rate: line.tax_rate,
            claimable_vat_ratio: line.claimableVatRatio,
          },
        });
      }
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
    if (!["draft", "approved"].includes(bill.status))
      throw new Error("Supplier bill cannot be posted in its current state");
    if (bill.created_by === userId)
      throw new Error("The bill preparer cannot approve and post their own supplier bill");
    const lineResult = await client.query(
      `SELECT l.*, a.account_name FROM erp_supplier_bill_lines l
       JOIN erp_chart_of_accounts a ON a.id = l.account_id
       WHERE l.bill_id = $1 AND l.company_id = $2 ORDER BY l.line_no`,
      [billId, companyId],
    );
    if (!lineResult.rowCount) throw new Error("Supplier bill has no lines");
    if (bill.goods_receipt_id) {
      if (!bill.purchase_order_id || lineResult.rows.some((line) => !line.goods_receipt_line_id)) {
        throw new Error(
          "A receipt-linked bill must match every line to a goods receipt line before posting",
        );
      }
      const receipt = await client.query(
        `SELECT gr.id FROM erp_goods_receipts gr
         JOIN erp_purchase_orders po ON po.id = gr.purchase_order_id
         WHERE gr.id = $1 AND gr.company_id = $2 AND gr.purchase_order_id = $3
           AND po.vendor_id = $4 AND gr.status = 'posted' AND gr.is_deleted = FALSE
         FOR UPDATE OF gr`,
        [bill.goods_receipt_id, companyId, bill.purchase_order_id, bill.vendor_id],
      );
      if (!receipt.rowCount)
        throw new Error("The posted goods receipt, purchase order and supplier no longer match");
      const matchedReceiptLineIds = new Set();
      for (const line of lineResult.rows) {
        if (matchedReceiptLineIds.has(line.goods_receipt_line_id))
          throw new Error("A goods receipt line appears more than once on the bill");
        matchedReceiptLineIds.add(line.goods_receipt_line_id);
        const source = await client.query(
          `SELECT gl.quantity, gl.unit_cost
           FROM erp_goods_receipt_lines gl
           WHERE gl.id = $1 AND gl.goods_receipt_id = $2 AND gl.company_id = $3 AND gl.is_deleted = FALSE`,
          [line.goods_receipt_line_id, bill.goods_receipt_id, companyId],
        );
        if (!source.rowCount)
          throw new Error("A bill line references a goods receipt line outside its receipt");
        const billedElsewhere = await client.query(
          `SELECT COALESCE(SUM(bl.quantity), 0) AS quantity
           FROM erp_supplier_bill_lines bl JOIN erp_supplier_bills b ON b.id = bl.bill_id
           WHERE bl.company_id = $1 AND bl.goods_receipt_line_id = $2
             AND b.id <> $3 AND b.status <> 'cancelled' AND b.is_deleted = FALSE`,
          [companyId, line.goods_receipt_line_id, billId],
        );
        const remaining =
          Number(source.rows[0].quantity) - Number(billedElsewhere.rows[0].quantity);
        if (
          Number(line.quantity) > remaining + 0.00005 ||
          Math.abs(Number(line.unit_price) - Number(source.rows[0].unit_cost)) > 0.00005
        ) {
          throw new Error(
            "Bill quantity or price no longer matches the unbilled goods receipt balance",
          );
        }
      }
    }
    const payable = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '2100'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [companyId],
    );
    if (!payable.rowCount)
      throw new Error("Accounts Payable control account 2100 is missing or not postable");
    let inputVatId = null;
    const lineClaimableVat = lineResult.rows.reduce(
      (sum, line) => sum + Number(line.claimable_vat || 0),
      0,
    );
    const evidenceVerified = bill.evidence_status === "verified";
    if (lineClaimableVat > 0 && evidenceVerified) {
      const inputVat = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '1400'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId],
      );
      if (!inputVat.rowCount) throw new Error("Input VAT account 1400 is missing or not postable");
      inputVatId = inputVat.rows[0].id;
    }
    let pendingVatId = null;
    if (lineClaimableVat > 0 && !evidenceVerified) {
      const pendingVat = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '1401'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId],
      );
      if (!pendingVat.rowCount)
        throw new Error("Input VAT pending evidence account 1401 is missing or not postable");
      pendingVatId = pendingVat.rows[0].id;
    }
    const tax = Number(bill.tax_amount);
    const lineTax = lineResult.rows.reduce((sum, line) => sum + Number(line.tax_amount || 0), 0);
    const splitTax = lineResult.rows.reduce(
      (sum, line) => sum + Number(line.claimable_vat || 0) + Number(line.non_claimable_vat || 0),
      0,
    );
    if (Math.abs(tax - lineTax) > 0.01 || Math.abs(tax - splitTax) > 0.01) {
      throw new Error("Supplier bill tax totals do not match the stored line VAT split");
    }
    const nonClaimableTreatment = await client.query(
      `SELECT setting_value FROM erp_system_settings
       WHERE company_id = $1 AND category = 'finance' AND setting_key = 'non_claimable_vat_treatment'
         AND is_deleted = FALSE`,
      [companyId],
    );
    const rawTreatment = nonClaimableTreatment.rows[0]?.setting_value;
    const treatment =
      typeof rawTreatment === "string" && rawTreatment.startsWith('"')
        ? JSON.parse(rawTreatment)
        : rawTreatment;
    if (treatment && treatment !== "add_to_cost" && treatment !== '"add_to_cost"') {
      if (treatment !== "separate_account")
        throw new Error("The configured non-claimable VAT treatment is not supported for posting");
    }
    let nonClaimableVatAccountId = null;
    if (
      treatment === "separate_account" &&
      lineResult.rows.some((line) => Number(line.non_claimable_vat || 0) > 0)
    ) {
      const separateAccount = await client.query(
        `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '1402'
         AND account_type = 'expense' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId],
      );
      if (!separateAccount.rowCount)
        throw new Error("Non-claimable VAT account 1402 is missing or not postable");
      nonClaimableVatAccountId = separateAccount.rows[0].id;
    }
    const linesWithTaxSplit = lineResult.rows.map((line) => ({
      ...line,
      non_claimable_vat_account_id: nonClaimableVatAccountId || line.account_id,
      non_claimable_vat:
        line.non_claimable_vat === undefined
          ? Number(line.tax_amount) - Number(line.claimable_vat || 0)
          : line.non_claimable_vat,
    }));
    let accrualAccount = null;
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
      if (!accrual.rowCount)
        throw new Error("The goods receipt has no posted receipt accrual to clear");
      accrualAccount = accrual.rows[0];
    }
    const journalLines = buildBillPostingLines({
      bill,
      lines: linesWithTaxSplit,
      payableAccountId: payable.rows[0].id,
      inputVatAccountId: inputVatId,
      pendingVatAccountId: pendingVatId,
      nonClaimableVatTreatment: treatment || "add_to_cost",
      accrualAccount,
    });
    const journal = await gl.createJournalInTransaction(client, {
      companyId,
      userId,
      entryDate: bill.bill_date,
      journalType: "purchase",
      referenceNo: bill.bill_no,
      description: `Supplier bill ${bill.supplier_invoice_no}`,
      lines: journalLines,
      currencyCode: bill.currency_code || "KES",
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    await client.query(
      `UPDATE erp_supplier_bill_lines
       SET input_vat_status = CASE
         WHEN claimable_vat <= 0 THEN 'non_claimable'
         WHEN $3::boolean THEN 'claimable'
         ELSE 'held_no_evidence'
       END,
       non_claimable_vat_account_id = CASE WHEN $4::boolean THEN $5::uuid ELSE account_id END
       WHERE bill_id = $1 AND company_id = $2`,
      [
        billId,
        companyId,
        evidenceVerified,
        treatment === "separate_account",
        nonClaimableVatAccountId,
      ],
    );
    const posted = await client.query(
      `UPDATE erp_supplier_bills SET status = 'posted', journal_id = $3, posted_at = NOW(),
        input_vat_posting_status = CASE WHEN $5::boolean THEN 'claimable' ELSE 'held_no_evidence' END,
        updated_by = $4
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [billId, companyId, journal.id, userId, evidenceVerified],
    );
    if (evidenceVerified) {
      await etimsEvents.queueEtimsPurchaseInTransaction(client, { companyId, userId, billId });
    }
    await client.query("COMMIT");
    return { bill: posted.rows[0], journal_id: journal.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function verifySupplierBillEvidence({
  companyId,
  userId,
  billId,
  etimsInvoiceNo,
  etimsReceiptSignature,
  verificationNote,
}) {
  const invoiceNo = String(etimsInvoiceNo || "").trim();
  const receiptSignature = String(etimsReceiptSignature || "").trim();
  const note = String(verificationNote || "").trim();
  if (!invoiceNo || !receiptSignature || !note) {
    throw new Error(
      "Supplier eTIMS invoice number, receipt signature, and verification note are required",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const billResult = await client.query(
      `SELECT * FROM erp_supplier_bills
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [billId, companyId],
    );
    const bill = billResult.rows[0];
    if (!bill) throw new Error("Supplier bill not found");
    if (bill.evidence_status === "verified")
      throw new Error("Supplier invoice evidence is already verified");
    assertDifferentUser(bill.created_by, userId);
    if (bill.status !== "draft" && bill.status !== "approved" && bill.status !== "posted") {
      throw new Error("Evidence cannot be verified for this supplier bill state");
    }

    const lines = await client.query(
      `SELECT COALESCE(SUM(claimable_vat), 0) AS claimable_vat
       FROM erp_supplier_bill_lines WHERE bill_id = $1 AND company_id = $2`,
      [billId, companyId],
    );
    const claimableVat = Math.round(Number(lines.rows[0].claimable_vat) * 100) / 100;
    let journalId = null;
    if (
      bill.status === "posted" &&
      claimableVat > 0 &&
      bill.input_vat_posting_status === "held_no_evidence"
    ) {
      const accounts = await client.query(
        `SELECT id, account_code FROM erp_chart_of_accounts
         WHERE company_id = $1 AND account_code = ANY($2::text[])
           AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
        [companyId, ["1400", "1401"]],
      );
      const byCode = new Map(accounts.rows.map((account) => [account.account_code, account.id]));
      if (!byCode.has("1400") || !byCode.has("1401")) {
        throw new Error(
          "Input VAT accounts 1400 and 1401 must be postable before evidence can be verified",
        );
      }
      const dateResult = await client.query("SELECT CURRENT_DATE::text AS entry_date");
      const journal = await gl.createJournalInTransaction(client, {
        companyId,
        userId,
        entryDate: dateResult.rows[0].entry_date,
        journalType: "adjustment",
        referenceNo: `${bill.bill_no}-VAT-RECLASS`,
        description: `Reclassify verified supplier input VAT for ${bill.supplier_invoice_no}`,
        lines: [
          {
            account_id: byCode.get("1400"),
            debit: claimableVat,
            credit: 0,
            description: "Recognize verified supplier input VAT",
          },
          {
            account_id: byCode.get("1401"),
            debit: 0,
            credit: claimableVat,
            description: "Clear supplier VAT pending evidence",
          },
        ],
      });
      await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
      journalId = journal.id;
    }

    const updated = await client.query(
      `UPDATE erp_supplier_bills
       SET etims_invoice_no = $3, etims_receipt_signature = $4,
           evidence_status = 'verified', evidence_checked_at = NOW(),
           evidence_reclassification_journal_id = COALESCE($6, evidence_reclassification_journal_id),
           updated_at = NOW(), updated_by = $5
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [billId, companyId, invoiceNo, receiptSignature, userId, journalId],
    );
    await client.query(
      `UPDATE erp_supplier_bill_lines SET input_vat_status = CASE
         WHEN claimable_vat > 0 THEN 'claimable' ELSE 'non_claimable' END
       WHERE bill_id = $1 AND company_id = $2`,
      [billId, companyId],
    );
    if (bill.status === "posted" && bill.input_vat_posting_status === "legacy_input_vat_1400") {
      await client.query(
        `UPDATE erp_supplier_bills SET input_vat_posting_status = 'claimable'
         WHERE id = $1 AND company_id = $2`,
        [billId, companyId],
      );
    }
    if (bill.status === "posted") {
      await etimsEvents.queueEtimsPurchaseInTransaction(client, { companyId, userId, billId });
    }
    await logAudit({
      client,
      companyId,
      userId,
      entityType: "erp_supplier_bills",
      entityId: billId,
      action: "supplier_bill_evidence_verified",
      oldValues: { evidence_status: bill.evidence_status },
      newValues: {
        evidence_status: "verified",
        etims_invoice_no: invoiceNo,
        verification_note: note,
        reclassification_journal_id: journalId,
      },
    });
    await client.query("COMMIT");
    return { bill: updated.rows[0], reclassification_journal_id: journalId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    if (!payment || payment.status !== "draft")
      throw new Error("Supplier payment not found or already processed");
    if (payment.created_by === userId)
      throw new Error("The payment preparer cannot approve and post their own supplier payment");
    const allocations = await client.query(
      `SELECT a.bill_id, a.amount, b.vendor_id, b.total_amount, b.amount_paid, b.status, b.supplier_invoice_no
       FROM erp_supplier_payment_allocations a JOIN erp_supplier_bills b ON b.id = a.bill_id
       WHERE a.payment_id = $1 AND a.company_id = $2 FOR UPDATE OF b`,
      [paymentId, companyId],
    );
    if (
      !allocations.rowCount ||
      Math.abs(
        allocations.rows.reduce((sum, row) => sum + Number(row.amount), 0) - Number(payment.amount),
      ) > 0.01
    ) {
      throw new Error("Payment allocations do not match the payment total");
    }
    for (const allocation of allocations.rows) {
      if (
        allocation.vendor_id !== payment.vendor_id ||
        !["posted", "partial", "overdue"].includes(allocation.status) ||
        Number(allocation.amount) >
          Number(allocation.total_amount) - Number(allocation.amount_paid) + 0.0001
      ) {
        throw new Error(
          `Bill ${allocation.supplier_invoice_no} is no longer available for this payment`,
        );
      }
    }
    const payable = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code = '2100'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [companyId],
    );
    if (!payable.rowCount)
      throw new Error("Accounts Payable control account 2100 is missing or not postable");
    const bank = await client.query(
      `SELECT id FROM erp_chart_of_accounts WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [payment.bank_account_id, companyId],
    );
    if (!bank.rowCount) throw new Error("Payment bank/cash account is missing or not postable");
    const withholdingLines = await client.query(
      `SELECT bill.id AS bill_id, bill.total_amount, allocation.amount AS allocated_amount,
              bill_line.id AS bill_line_id, bill_line.net_amount, bill_line.tax_amount,
              category.id AS category_id, category.rate, category.taxable_basis,
              category.residency, category.status AS category_status,
              category.effective_from::text AS effective_from,
              category.effective_to::text AS effective_to,
              category.remittance_working_days, category.liability_account_id,
              vendor.tax_residency
       FROM erp_supplier_payment_allocations allocation
       JOIN erp_supplier_bills bill ON bill.id=allocation.bill_id AND bill.company_id=allocation.company_id
       JOIN erp_supplier_bill_lines bill_line ON bill_line.bill_id=bill.id AND bill_line.company_id=bill.company_id
       JOIN erp_vendors vendor ON vendor.id=bill.vendor_id AND vendor.company_id=bill.company_id
       JOIN erp_withholding_categories category
         ON category.id=bill_line.withholding_category_id AND category.company_id=bill_line.company_id
       WHERE allocation.payment_id=$1 AND allocation.company_id=$2
       ORDER BY bill.id, bill_line.line_no
       FOR UPDATE OF bill, bill_line, category`,
      [paymentId, companyId],
    );
    const holidays = new Set();
    if (withholdingLines.rowCount) {
      const holidayResult = await client.query(
        `SELECT holiday_date::text AS holiday_date FROM erp_holidays
         WHERE company_id=$1 AND branch_id IS NULL AND country_code='KE' AND is_deleted=FALSE
           AND holiday_date > $2::date AND holiday_date <= $2::date + 60`,
        [companyId, payment.payment_date],
      );
      for (const holiday of holidayResult.rows) holidays.add(holiday.holiday_date);
    }
    const withholdingEntries = withholdingLines.rows
      .map((line) => {
        const paymentDate = calendarDate(payment.payment_date);
        if (line.category_status !== "approved") {
          throw new Error(
            "Supplier payment uses a withholding category that is no longer approved",
          );
        }
        if (line.residency !== line.tax_residency) {
          throw new Error(
            "Supplier tax residency no longer matches the approved withholding category",
          );
        }
        if (
          line.effective_from > paymentDate ||
          (line.effective_to && line.effective_to < paymentDate)
        ) {
          throw new Error("Withholding category is not effective on the supplier payment date");
        }
        if (Number(line.total_amount) <= 0)
          throw new Error("Supplier bill has an invalid total for withholding calculation");
        const allocationRatio = Math.min(
          1,
          Number(line.allocated_amount) / Number(line.total_amount),
        );
        const lineBase =
          Number(line.net_amount) +
          (line.taxable_basis === "gross_including_vat" ? Number(line.tax_amount) : 0);
        const taxableBase = Math.round(lineBase * allocationRatio * 100) / 100;
        const amount = Math.round(((taxableBase * Number(line.rate)) / 100) * 100) / 100;
        return {
          ...line,
          taxableBase,
          amount,
          dueDate: addBusinessDays(paymentDate, Number(line.remittance_working_days), holidays),
        };
      })
      .filter((line) => line.amount > 0);
    const withholdingTotal =
      Math.round(withholdingEntries.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
    if (withholdingTotal >= Number(payment.amount)) {
      throw new Error("Withholding amount must be less than the gross supplier payment");
    }
    const withholdingByAccount = new Map();
    for (const entry of withholdingEntries) {
      withholdingByAccount.set(
        String(entry.liability_account_id),
        (withholdingByAccount.get(String(entry.liability_account_id)) || 0) + entry.amount,
      );
    }
    if (withholdingByAccount.size) {
      const liabilityAccounts = await client.query(
        `SELECT id FROM erp_chart_of_accounts
         WHERE company_id=$1 AND id=ANY($2::uuid[]) AND account_type='liability'
           AND is_postable=TRUE AND is_active=TRUE AND is_deleted=FALSE`,
        [companyId, [...withholdingByAccount.keys()]],
      );
      if (liabilityAccounts.rowCount !== withholdingByAccount.size) {
        throw new Error("An approved withholding category liability account is no longer postable");
      }
    }
    const journal = await gl.createJournalInTransaction(client, {
      companyId,
      userId,
      entryDate: payment.payment_date,
      journalType: "payment",
      referenceNo: payment.payment_no,
      description: `Supplier payment ${payment.payment_no}`,
      lines: [
        {
          account_id: payable.rows[0].id,
          debit: Number(payment.amount),
          credit: 0,
          description: "Settle supplier balance",
        },
        ...[...withholdingByAccount.entries()].map(([accountId, amount]) => ({
          account_id: accountId,
          debit: 0,
          credit: Math.round(amount * 100) / 100,
          description: "Withholding tax deducted from supplier payment",
        })),
        {
          account_id: payment.bank_account_id,
          debit: 0,
          credit: Math.round((Number(payment.amount) - withholdingTotal) * 100) / 100,
          description: `Bank payment ${payment.reference_no || payment.payment_no}`,
        },
      ],
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    for (const entry of withholdingEntries) {
      await client.query(
        `INSERT INTO erp_withholding_obligations (
           company_id, vendor_id, bill_id, bill_line_id, payment_id, category_id,
           taxable_base, rate, amount, due_date, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          companyId,
          payment.vendor_id,
          entry.bill_id,
          entry.bill_line_id,
          paymentId,
          entry.category_id,
          entry.taxableBase,
          entry.rate,
          entry.amount,
          entry.dueDate,
          userId,
        ],
      );
    }
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
  } finally {
    client.release();
  }
}

module.exports = {
  createBill,
  postBill,
  createPayment,
  postPayment,
  normalizeBillTaxLine,
  resolveBillTaxLine,
  buildBillPostingLines,
  verifySupplierBillEvidence,
};
