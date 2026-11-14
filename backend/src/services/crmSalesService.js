const pool = require("../db");
const { normalizeKraPin } = require("../lib/kraPin");
const salesService = require("./salesService");
const { nextDocumentNo } = require("./documentNumberingService");
const { lineMoney, roundMoney, sumMoney } = require("../lib/money");

function dateValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function normalizeLeadInput(input = {}) {
  const companyName = String(input.company_name || input.companyName || "").trim();
  const contactName = String(input.contact_name || input.contactName || "").trim();
  const email = String(input.email || "").trim();
  const phone = String(input.phone || "").trim();
  const source = String(input.source || "").trim() || "manual";
  const status = String(input.status || "new").trim();
  const assignedTo = input.assigned_to || input.assignedTo || null;
  const estimatedValue = Number(input.estimated_value ?? input.estimatedValue ?? 0);

  if (!companyName) throw new Error("Lead company name is required");
  if (!/^(new|contacted|qualified|converted|lost)$/.test(status)) {
    throw new Error("Lead status is not supported");
  }
  if (status === "converted") throw new Error("Leads can only be converted through the customer conversion workflow");
  if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
    throw new Error("Estimated value must be a non-negative number");
  }

  return {
    company_name: companyName,
    contact_name: contactName || null,
    email: email || null,
    phone: phone || null,
    source,
    status,
    assigned_to: assignedTo,
    estimated_value: estimatedValue,
  };
}

function normalizeOpportunityInput(input = {}) {
  const name = String(input.name || "").trim();
  const stage = String(input.stage || "prospecting").trim();
  const amount = Number(input.amount ?? 0);
  const probability = Number(input.probability ?? 0);
  const expectedCloseDate = input.expected_close_date || input.expectedCloseDate || null;
  const lostReason = input.lost_reason || input.lostReason || null;
  const assignedTo = input.assigned_to || input.assignedTo || null;

  if (!name) throw new Error("Opportunity name is required");
  if (!/^(prospecting|qualification|proposal|negotiation|won|lost)$/.test(stage)) {
    throw new Error("Opportunity stage is not supported");
  }
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Opportunity amount must be non-negative");
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
    throw new Error("Opportunity probability must be between 0 and 100");
  }
  if (expectedCloseDate && !validDate(dateValue(expectedCloseDate))) {
    throw new Error("Expected close date must be a valid calendar date");
  }
  if (stage === "lost" && !String(lostReason || "").trim()) {
    throw new Error("A lost reason is required when closing an opportunity as lost");
  }

  return {
    name,
    stage,
    amount,
    probability,
    expected_close_date: expectedCloseDate,
    lost_reason: lostReason,
    assigned_to: assignedTo,
  };
}

async function getLeadById(client, companyId, leadId) {
  const result = await client.query(
    `SELECT * FROM erp_leads WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
    [leadId, companyId],
  );
  if (!result.rowCount) throw new Error("Lead not found");
  return result.rows[0];
}

async function assertActiveCompanyUser(client, companyId, userId, label) {
  if (!userId) return;
  const result = await client.query(
    `SELECT 1 FROM erp_users WHERE id=$1 AND company_id=$2 AND status='active' AND is_deleted=FALSE`,
    [userId, companyId],
  );
  if (!result.rowCount) throw new Error(`${label} must be an active user in this company`);
}

async function listLeads({ companyId, q = "", status = null, limit = 50, offset = 0 }) {
  const params = [companyId];
  let filter = " WHERE company_id = $1 AND is_deleted = FALSE";
  if (q) {
    params.push(`%${String(q).trim()}%`);
    filter += ` AND (company_name ILIKE $${params.length} OR contact_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
  }
  if (status) {
    params.push(String(status));
    filter += ` AND status = $${params.length}`;
  }
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM erp_leads${filter}`,
    params,
  );
  params.push(Math.min(Number(limit) || 50, 500), Number(offset) || 0);
  const result = await pool.query(
    `SELECT * FROM erp_leads${filter} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    data: result.rows,
    pagination: { limit: Math.min(Number(limit) || 50, 500), offset: Number(offset) || 0, total: Number(countResult.rows[0].total || 0) },
  };
}

async function createLead({ companyId, userId, payload = {} }) {
  const lead = normalizeLeadInput(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await assertActiveCompanyUser(client, companyId, lead.assigned_to, "Lead assignee");
    const leadNoResult = await client.query(
      `SELECT COALESCE(MAX(CAST(substring(lead_no FROM '^LEAD-[0-9]{4}-([0-9]+)$') AS bigint)), 0) AS max_no
       FROM erp_leads WHERE company_id = $1 AND lead_no ~ '^LEAD-[0-9]{4}-[0-9]+$'`,
      [companyId],
    );
    const nextNo = Number(leadNoResult.rows[0].max_no || 0) + 1;
    const leadNo = `LEAD-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;
    const result = await client.query(
      `INSERT INTO erp_leads (
         company_id, lead_no, company_name, contact_name, email, phone, source, status,
         assigned_to, estimated_value, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [companyId, leadNo, lead.company_name, lead.contact_name, lead.email, lead.phone, lead.source, lead.status,
        lead.assigned_to, lead.estimated_value, userId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateLead({ companyId, userId, leadId, payload = {} }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await getLeadById(client, companyId, leadId);
    if (existing.status === "converted") throw new Error("Converted leads cannot be edited");
    const next = normalizeLeadInput({ ...existing, ...payload });
    await assertActiveCompanyUser(client, companyId, next.assigned_to, "Lead assignee");
    const result = await client.query(
      `UPDATE erp_leads
       SET company_name = $3, contact_name = $4, email = $5, phone = $6, source = $7, status = $8,
           assigned_to = $9, estimated_value = $10, updated_by = $11, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       RETURNING *`,
      [leadId, companyId, next.company_name, next.contact_name, next.email, next.phone, next.source,
        next.status, next.assigned_to, next.estimated_value, userId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveLead({ companyId, userId, leadId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (payload.lead_id) {
      const lead = await client.query(
        `SELECT 1 FROM erp_leads WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
        [payload.lead_id, companyId],
      );
      if (!lead.rowCount) throw new Error("Opportunity lead must belong to this company");
    }
    if (payload.customer_id) {
      const customer = await client.query(
        `SELECT 1 FROM erp_customers WHERE id=$1 AND company_id=$2 AND is_active=TRUE AND is_deleted=FALSE`,
        [payload.customer_id, companyId],
      );
      if (!customer.rowCount) throw new Error("Opportunity customer must be active in this company");
    }
    await assertActiveCompanyUser(client, companyId, opportunity.assigned_to, "Opportunity assignee");
    const result = await client.query(
      `UPDATE erp_leads
       SET is_deleted = TRUE, updated_by = $3, updated_at = NOW(), status = 'lost'
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       RETURNING *`,
      [leadId, companyId, userId],
    );
    if (!result.rowCount) throw new Error("Lead not found");
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listOpportunities({ companyId, q = "", stage = null, limit = 50, offset = 0 }) {
  const params = [companyId];
  let filter = " WHERE o.company_id = $1 AND o.is_deleted = FALSE";
  if (q) {
    params.push(`%${String(q).trim()}%`);
    filter += ` AND (o.name ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
  }
  if (stage) {
    params.push(String(stage));
    filter += ` AND o.stage = $${params.length}`;
  }
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM erp_opportunities o LEFT JOIN erp_customers c ON c.id = o.customer_id${filter}`,
    params,
  );
  params.push(Math.min(Number(limit) || 50, 500), Number(offset) || 0);
  const result = await pool.query(
    `SELECT o.*, c.name AS customer_name FROM erp_opportunities o LEFT JOIN erp_customers c ON c.id = o.customer_id${filter}
     ORDER BY o.amount DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    data: result.rows,
    pagination: { limit: Math.min(Number(limit) || 50, 500), offset: Number(offset) || 0, total: Number(countResult.rows[0].total || 0) },
  };
}

async function createOpportunity({ companyId, userId, payload = {} }) {
  const opportunity = normalizeOpportunityInput(payload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const opportunityNoResult = await client.query(
      `SELECT COALESCE(MAX(CAST(substring(opportunity_no FROM '^OPP-[0-9]{4}-([0-9]+)$') AS bigint)), 0) AS max_no
       FROM erp_opportunities WHERE company_id = $1 AND opportunity_no ~ '^OPP-[0-9]{4}-[0-9]+$'`,
      [companyId],
    );
    const nextNo = Number(opportunityNoResult.rows[0].max_no || 0) + 1;
    const opportunityNo = `OPP-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;
    const result = await client.query(
      `INSERT INTO erp_opportunities (
         company_id, lead_id, customer_id, opportunity_no, name, stage, probability,
         expected_close_date, amount, assigned_to, lost_reason, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       RETURNING *`,
      [companyId, payload.lead_id || null, payload.customer_id || null,
        opportunityNo, opportunity.name, opportunity.stage, opportunity.probability,
        opportunity.expected_close_date || null, opportunity.amount, opportunity.assigned_to,
        opportunity.lost_reason || null, userId],
    );
    if (payload.lead_id) {
      await client.query(
        `UPDATE erp_leads SET status = 'qualified', updated_at = NOW(), updated_by = $2 WHERE id = $1 AND company_id = $3 AND is_deleted = FALSE`,
        [payload.lead_id, userId, companyId],
      );
    }
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateOpportunity({ companyId, userId, opportunityId, payload = {} }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM erp_opportunities WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [opportunityId, companyId],
    );
    if (!existing.rowCount) throw new Error("Opportunity not found");
    const next = normalizeOpportunityInput({ ...existing.rows[0], ...payload });
    await assertActiveCompanyUser(client, companyId, next.assigned_to, "Opportunity assignee");
    const result = await client.query(
      `UPDATE erp_opportunities
       SET name = $3, stage = $4, probability = $5, expected_close_date = $6, amount = $7,
           assigned_to = $8, lost_reason = $9, updated_by = $10, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       RETURNING *`,
      [opportunityId, companyId, next.name, next.stage, next.probability,
        next.expected_close_date || null, next.amount, next.assigned_to, next.lost_reason || null, userId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveOpportunity({ companyId, userId, opportunityId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE erp_opportunities
       SET is_deleted = TRUE, updated_by = $3, updated_at = NOW(), stage = 'lost'
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE
       RETURNING *`,
      [opportunityId, companyId, userId],
    );
    if (!result.rowCount) throw new Error("Opportunity not found");
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listActivities({ companyId, leadId = null, opportunityId = null, customerId = null, q = "" }) {
  const params = [companyId];
  let filter = " WHERE a.company_id = $1 AND a.is_deleted = FALSE";
  if (leadId) { params.push(leadId); filter += " AND a.lead_id = $" + params.length; }
  if (opportunityId) { params.push(opportunityId); filter += " AND a.opportunity_id = $" + params.length; }
  if (customerId) { params.push(customerId); filter += " AND a.customer_id = $" + params.length; }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    filter += " AND (a.subject ILIKE $" + params.length + " OR a.description ILIKE $" + params.length + ")";
  }
  const result = await pool.query(
    `SELECT a.* FROM erp_crm_activities a${filter} ORDER BY a.activity_date DESC, a.created_at DESC`,
    params,
  );
  return result.rows;
}

async function createActivity({ companyId, userId, payload = {} }) {
  const { lead_id, opportunity_id, customer_id, activity_type, subject, description, activity_date, assigned_to } = payload;
  if (!activity_type || !subject) throw new Error("Activity type and subject are required");
  if (!/^(call|email|meeting|task|note)$/.test(String(activity_type))) {
    throw new Error("Activity type is not supported");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const linked = await client.query(
      `SELECT
         ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM erp_leads WHERE id=$2 AND company_id=$1 AND is_deleted=FALSE)) AS lead_ok,
         ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM erp_opportunities WHERE id=$3 AND company_id=$1 AND is_deleted=FALSE)) AS opportunity_ok,
         ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM erp_customers WHERE id=$4 AND company_id=$1 AND is_deleted=FALSE)) AS customer_ok`,
      [companyId, lead_id || null, opportunity_id || null, customer_id || null],
    );
    if (!linked.rows[0].lead_ok || !linked.rows[0].opportunity_ok || !linked.rows[0].customer_ok) {
      throw new Error("Activity links must reference records in this company");
    }
    await assertActiveCompanyUser(client, companyId, assigned_to, "Activity assignee");
    const result = await client.query(
      `INSERT INTO erp_crm_activities (
         company_id, lead_id, opportunity_id, customer_id, activity_type, subject, description,
         activity_date, assigned_to, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW()),$9,$10,$10)
       RETURNING *`,
      [companyId, lead_id || null, opportunity_id || null, customer_id || null, activity_type, subject,
        description || null, activity_date || null, assigned_to || null, userId],
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function convertLeadToCustomerAndOpportunity({ companyId, userId, leadId, opportunityName, customerTaxId = null }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lead = await getLeadById(client, companyId, leadId);
    if (lead.status === "converted") throw new Error("Lead is already converted");
    const taxId = String(customerTaxId || "").trim();
    const normalizedTaxId = taxId ? normalizeKraPin(taxId) : null;
    const customerCodeResult = await client.query(
      `SELECT COALESCE(MAX(CAST(substring(customer_code FROM '^CUST-[0-9]{4}-([0-9]+)$') AS bigint)), 0) AS max_no
       FROM erp_customers WHERE company_id = $1 AND customer_code ~ '^CUST-[0-9]{4}-[0-9]+$'`,
      [companyId],
    );
    const customerCode = `CUST-${new Date().getFullYear()}-${String(Number(customerCodeResult.rows[0].max_no || 0) + 1).padStart(4, "0")}`;
    const customerResult = await client.query(
      `INSERT INTO erp_customers (
         company_id, customer_code, name, tax_id, contact_name, email, phone, customer_type,
         credit_limit, is_active, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'lead',0,TRUE,$8,$8)
       RETURNING *`,
      [companyId, customerCode, lead.company_name, normalizedTaxId, lead.contact_name, lead.email, lead.phone, userId],
    );
    const opportunityNoResult = await client.query(
      `SELECT COALESCE(MAX(CAST(substring(opportunity_no FROM '^OPP-[0-9]{4}-([0-9]+)$') AS bigint)), 0) AS max_no
       FROM erp_opportunities WHERE company_id = $1 AND opportunity_no ~ '^OPP-[0-9]{4}-[0-9]+$'`,
      [companyId],
    );
    const opportunityNo = `OPP-${new Date().getFullYear()}-${String(Number(opportunityNoResult.rows[0].max_no || 0) + 1).padStart(4, "0")}`;
    const opportunity = await client.query(
      `INSERT INTO erp_opportunities (
         company_id, lead_id, customer_id, opportunity_no, name, stage, probability, amount,
         expected_close_date, assigned_to, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,'qualification',10,COALESCE($6::numeric,0),CURRENT_DATE + INTERVAL '30 days', $7, $8, $8)
       RETURNING *`,
      [companyId, lead.id, customerResult.rows[0].id, opportunityNo, opportunityName || lead.company_name, lead.estimated_value, userId, userId],
    );
    await client.query(
      `UPDATE erp_leads SET status = 'converted', assigned_to = $2, updated_by = $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3 AND is_deleted = FALSE`,
      [lead.id, userId, companyId],
    );
    await client.query("COMMIT");
    return { lead: { ...lead, status: "converted" }, customer: customerResult.rows[0], opportunity: opportunity.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createQuote({ companyId, userId, payload = {}, permissions = [] }) {
  const customerId = payload.customer_id || payload.customerId;
  const quoteDate = payload.quote_date || payload.quoteDate || new Date().toISOString().slice(0, 10);
  const validUntil = payload.valid_until || payload.validUntil || null;
  const opportunityId = payload.opportunity_id || payload.opportunityId || null;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!customerId) throw new Error("Customer is required");
  if (!lines.length) throw new Error("Quote lines are required");
  if (!validDate(quoteDate) || (validUntil && (!validDate(validUntil) || validUntil < quoteDate))) {
    throw new Error("Provide a valid quote date and a validity date on or after the quote date");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      `SELECT id FROM erp_customers WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND is_active = TRUE`,
      [customerId, companyId],
    );
    if (!customer.rowCount) throw new Error("Customer not found");
    if (opportunityId) {
      const opportunity = await client.query(
        `SELECT id FROM erp_opportunities WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE`,
        [opportunityId, companyId],
      );
      if (!opportunity.rowCount) throw new Error("Opportunity not found in this company");
    }

    let subtotal = 0;
    let totalDiscount = 0;
    const prepared = [];

    for (const [index, line] of lines.entries()) {
      const itemId = line.item_id || line.itemId;
      const quantity = Number(line.quantity || 0);
      const suppliedPrice = line.unit_price ?? line.unitPrice;
      const discountPercent = Number(line.discount_percent || line.discountPercent || 0);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0
          || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        throw new Error(`Quote line ${index + 1} is invalid`);
      }
      const price = await salesService.previewCustomerSalePrice({
        companyId,
        customerId,
        itemId,
        quantity,
        priceDate: quoteDate,
        suppliedPrice,
        permissions,
        freeIssueReasonCode: line.reason_code,
      });
      const gross = lineMoney(quantity, price.unitPrice);
      const discount = roundMoney(gross * discountPercent / 100);
      const net = sumMoney([gross, -discount]);
      subtotal = sumMoney([subtotal, net]);
      totalDiscount = sumMoney([totalDiscount, discount]);
      prepared.push({ item_id: itemId, quantity, unit_price: price.unitPrice,
        discount_percent: discountPercent, line_total: net, tax_unit_price: net / quantity });
    }

    const taxPreview = await salesService.previewSaleTax(companyId, prepared.map((line) => ({
      item_id: line.item_id,
      quantity: line.quantity,
      unit_price: line.tax_unit_price,
    })), quoteDate);
    const taxAmount = Number(taxPreview.tax_amount);
    const quoteNo = await nextDocumentNo(client, {
      companyId,
      docType: "erp_quotations",
      prefix: "QT",
      padding: 4,
      date: quoteDate,
    });
    const totalAmount = sumMoney([subtotal, taxAmount]);
    const quoteResult = await client.query(
      `INSERT INTO erp_quotations (
         company_id, customer_id, opportunity_id, quote_no, quote_date, valid_until,
         status, subtotal, discount_amount, tax_amount, total_amount,
         currency_code, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,'KES',$11,$11)
       RETURNING *`,
      [companyId, customerId, opportunityId, quoteNo, quoteDate, validUntil || null,
        subtotal, totalDiscount, taxAmount, totalAmount, userId],
    );

    for (const [index, line] of prepared.entries()) {
      await client.query(
        `INSERT INTO erp_quotation_lines (
           company_id, quotation_id, line_no, item_id, quantity, unit_price,
           discount_percent, line_total, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
        [companyId, quoteResult.rows[0].id, index + 1, line.item_id, line.quantity, line.unit_price,
          line.discount_percent, line.line_total, userId],
      );
    }
    await client.query("COMMIT");
    return quoteResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function acceptQuote({ companyId, userId, quoteId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE erp_quotations
       SET status = 'accepted', updated_by = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status IN ('draft','sent')
         AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       RETURNING *`,
      [quoteId, companyId, userId],
    );
    if (!result.rowCount) throw new Error("Quote not found or not in an accept-able state");
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateQuoteStatus({ companyId, userId, quoteId, status }) {
  const allowed = status === "sent"
    ? "status = 'draft'"
    : "status IN ('draft','sent')";
  const result = await pool.query(
    `UPDATE erp_quotations SET status = $3, updated_by = $4, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND ${allowed}
     RETURNING *`,
    [quoteId, companyId, status, userId],
  );
  if (!result.rowCount) throw new Error("Quote not found or cannot transition to the requested status");
  return result.rows[0];
}

async function listQuotes({ companyId, status = null, q = "", limit = 50, offset = 0 }) {
  const params = [companyId];
  let filter = " WHERE q.company_id = $1 AND q.is_deleted = FALSE";
  if (status) {
    params.push(String(status));
    filter += ` AND q.status = $${params.length}`;
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    filter += ` AND (q.quote_no ILIKE $${params.length} OR customer.name ILIKE $${params.length})`;
  }
  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM erp_quotations q
     JOIN erp_customers customer ON customer.id=q.customer_id AND customer.company_id=q.company_id${filter}`,
    params,
  );
  params.push(Math.min(Number(limit) || 50, 500), Number(offset) || 0);
  const data = await pool.query(
    `SELECT q.*, customer.name AS customer_name FROM erp_quotations q
     JOIN erp_customers customer ON customer.id=q.customer_id AND customer.company_id=q.company_id${filter}
     ORDER BY q.quote_date DESC, q.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { data: data.rows, pagination: { limit: Math.min(Number(limit) || 50, 500), offset: Number(offset) || 0, total: Number(count.rows[0].total) } };
}

async function getQuote({ companyId, quoteId }) {
  const quote = await pool.query(
    `SELECT q.*, customer.name AS customer_name FROM erp_quotations q
     JOIN erp_customers customer ON customer.id=q.customer_id AND customer.company_id=q.company_id
     WHERE q.id=$1 AND q.company_id=$2 AND q.is_deleted=FALSE`,
    [quoteId, companyId],
  );
  if (!quote.rowCount) throw new Error("Quote not found");
  const lines = await pool.query(
    `SELECT line.*, item.item_code, item.name AS item_name FROM erp_quotation_lines line
     JOIN erp_items item ON item.id=line.item_id AND item.company_id=line.company_id
     WHERE line.quotation_id=$1 AND line.company_id=$2 AND line.is_deleted=FALSE ORDER BY line.line_no`,
    [quoteId, companyId],
  );
  return { ...quote.rows[0], lines: lines.rows };
}

async function convertQuoteToSalesOrder({ companyId, userId, quoteId, warehouseId, requiredDate, permissions = [] }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quote = await client.query(
      `SELECT * FROM erp_quotations
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE AND status = 'accepted'
         AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
       FOR UPDATE`,
      [quoteId, companyId],
    );
    if (!quote.rowCount) throw new Error("Accepted quote not found or expired");
    const quoteRow = quote.rows[0];
    const existingOrder = await client.query(
      `SELECT * FROM erp_sales_orders
       WHERE company_id=$1 AND quotation_id=$2 AND is_deleted=FALSE LIMIT 1`,
      [companyId, quoteId],
    );
    if (existingOrder.rowCount) {
      await client.query(
        `UPDATE erp_quotations SET status='converted', updated_by=$2, updated_at=NOW()
         WHERE id=$1 AND company_id=$3`,
        [quoteId, userId, companyId],
      );
      await client.query("COMMIT");
      return { quote: { ...quoteRow, status: "converted" }, salesOrder: existingOrder.rows[0] };
    }
    const quoteLines = await client.query(
      `SELECT item_id, quantity, unit_price, discount_percent FROM erp_quotation_lines
       WHERE company_id=$1 AND quotation_id=$2 AND is_deleted=FALSE ORDER BY line_no`,
      [companyId, quoteId],
    );
    if (!quoteLines.rowCount) throw new Error("Accepted quote has no active lines");
    const salesOrder = await salesService.createSalesOrder({
      client,
      companyId,
      userId,
      customerId: quoteRow.customer_id,
      warehouseId,
      quotationId: quoteRow.id,
      orderDate: dateValue(quoteRow.quote_date),
      requiredDate: requiredDate || dateValue(quoteRow.valid_until || quoteRow.quote_date),
      permissions,
      lines: quoteLines.rows.map((line) => ({
        item_id: line.item_id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        discount_percent: Number(line.discount_percent || 0),
      })),
    });
    await client.query(
      `UPDATE erp_quotations SET status = 'converted', updated_by = $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3`,
      [quoteId, userId, companyId],
    );
    await client.query("COMMIT");
    return { quote: { ...quoteRow, status: "converted" }, salesOrder };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listLeads,
  createLead,
  updateLead,
  archiveLead,
  listOpportunities,
  createOpportunity,
  updateOpportunity,
  archiveOpportunity,
  listActivities,
  createActivity,
  convertLeadToCustomerAndOpportunity,
  createQuote,
  listQuotes,
  getQuote,
  updateQuoteStatus,
  acceptQuote,
  convertQuoteToSalesOrder,
};
