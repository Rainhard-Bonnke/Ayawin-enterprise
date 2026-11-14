const pool = require("../db");

async function createSupplierDocument({
  companyId,
  supplierId,
  documentType,
  documentName,
  fileUrl,
  expiryDate,
  status = "active",
  userId,
}) {
  if (!supplierId || !documentType) throw new Error("Supplier and document type are required");
  const result = await pool.query(
    `INSERT INTO erp_supplier_documents (company_id, supplier_id, document_type, document_name, file_url, expiry_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      companyId,
      supplierId,
      documentType,
      documentName || null,
      fileUrl || null,
      expiryDate || null,
      status,
      userId || null,
    ],
  );
  return result.rows[0];
}

async function upsertSupplierScorecard({
  companyId,
  supplierId,
  periodStart,
  periodEnd,
  scorecard,
  reviewedBy,
}) {
  const existing = await pool.query(
    `SELECT id FROM erp_supplier_scorecards WHERE company_id = $1 AND supplier_id = $2 AND period_start = $3 AND period_end = $4`,
    [companyId, supplierId, periodStart, periodEnd],
  );
  if (existing.rowCount) {
    const result = await pool.query(
      `UPDATE erp_supplier_scorecards
       SET on_time_delivery_pct = $3, short_receipt_pct = $4, rejected_receipt_pct = $5,
           price_variance_pct = $6, invoice_accuracy_pct = $7, total_score = $8,
           review_notes = $9, reviewed_by = $10, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        existing.rows[0].id,
        companyId,
        scorecard.on_time_delivery_pct || 0,
        scorecard.short_receipt_pct || 0,
        scorecard.rejected_receipt_pct || 0,
        scorecard.price_variance_pct || 0,
        scorecard.invoice_accuracy_pct || 0,
        scorecard.total_score || 0,
        scorecard.review_notes || null,
        reviewedBy || null,
      ],
    );
    return result.rows[0];
  }
  const result = await pool.query(
    `INSERT INTO erp_supplier_scorecards (company_id, supplier_id, period_start, period_end,
       on_time_delivery_pct, short_receipt_pct, rejected_receipt_pct, price_variance_pct,
       invoice_accuracy_pct, total_score, review_notes, reviewed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      companyId,
      supplierId,
      periodStart,
      periodEnd,
      scorecard.on_time_delivery_pct || 0,
      scorecard.short_receipt_pct || 0,
      scorecard.rejected_receipt_pct || 0,
      scorecard.price_variance_pct || 0,
      scorecard.invoice_accuracy_pct || 0,
      scorecard.total_score || 0,
      scorecard.review_notes || null,
      reviewedBy || null,
    ],
  );
  return result.rows[0];
}

async function blacklistSupplier({ companyId, supplierId, reason, userId }) {
  const result = await pool.query(
    `INSERT INTO erp_supplier_blacklist (company_id, supplier_id, reason, blacklisted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, supplier_id) DO UPDATE SET reason = EXCLUDED.reason, is_active = TRUE, blacklisted_by = EXCLUDED.blacklisted_by, blacklisted_at = NOW()
     RETURNING *`,
    [companyId, supplierId, reason, userId || null],
  );
  return result.rows[0];
}

async function createProcurementPolicy({ companyId, policyName, policy = {} }) {
  const result = await pool.query(
    `INSERT INTO erp_procurement_policies (company_id, policy_name, approval_threshold, quote_count_min, quote_threshold_amount, preferred_supplier_only, require_maker_checker, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8) RETURNING *`,
    [
      companyId,
      policyName,
      Number(policy.approval_threshold || 0),
      Number(policy.quote_count_min || 3),
      Number(policy.quote_threshold_amount || 0),
      Boolean(policy.preferred_supplier_only),
      Boolean(policy.require_maker_checker !== false),
      policy.created_by || null,
    ],
  );
  return result.rows[0];
}

async function createTender({
  companyId,
  tenderNo,
  title,
  tenderType = "open",
  submissionDeadline,
  notes,
  userId,
}) {
  const result = await pool.query(
    `INSERT INTO erp_tenders (company_id, tender_no, title, tender_type, status, submission_deadline, notes, created_by)
     VALUES ($1, $2, $3, $4, 'published', $5, $6, $7) RETURNING *`,
    [
      companyId,
      tenderNo,
      title,
      tenderType,
      submissionDeadline || null,
      notes || null,
      userId || null,
    ],
  );
  return result.rows[0];
}

async function addTenderBidder({ companyId, tenderId, vendorId }) {
  const result = await pool.query(
    `INSERT INTO erp_tender_bidders (company_id, tender_id, vendor_id, registration_status)
     VALUES ($1, $2, $3, 'registered')
     ON CONFLICT (tender_id, vendor_id) DO NOTHING RETURNING *`,
    [companyId, tenderId, vendorId],
  );
  return result.rows[0];
}

async function evaluateTender({ companyId, tenderId, vendorId, evaluatorName, score, comments }) {
  const result = await pool.query(
    `INSERT INTO erp_tender_evaluations (company_id, tender_id, vendor_id, evaluator_name, score, comments)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tender_id, vendor_id, evaluator_name) DO UPDATE SET score = EXCLUDED.score, comments = EXCLUDED.comments
     RETURNING *`,
    [companyId, tenderId, vendorId, evaluatorName, Number(score || 0), comments || null],
  );
  return result.rows[0];
}

async function createContract({
  companyId,
  supplierId,
  contractNo,
  contractType = "supplier",
  valueAmount,
  startDate,
  endDate,
  ownerUserId,
  renewalTerms,
  serviceLevels,
  userId,
}) {
  const result = await pool.query(
    `INSERT INTO erp_contracts (company_id, supplier_id, contract_no, contract_type, value_amount, start_date, end_date, status, owner_user_id, renewal_terms, service_levels, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11) RETURNING *`,
    [
      companyId,
      supplierId,
      contractNo,
      contractType,
      Number(valueAmount || 0),
      startDate,
      endDate || null,
      ownerUserId || null,
      renewalTerms || null,
      serviceLevels || null,
      userId || null,
    ],
  );
  return result.rows[0];
}

async function recordContractCallOff({ companyId, contractId, purchaseOrderId, calloffAmount }) {
  const result = await pool.query(
    `INSERT INTO erp_contract_call_offs (company_id, contract_id, purchase_order_id, calloff_amount)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [companyId, contractId, purchaseOrderId, Number(calloffAmount || 0)],
  );
  return result.rows[0];
}

async function allocateCost({ companyId, allocationType, sourceId, details, userId }) {
  const result = await pool.query(
    `INSERT INTO erp_cost_allocations (company_id, allocation_type, source_id, department, cost_centre, project_code, branch_id, allocation_pct, amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      companyId,
      allocationType,
      sourceId,
      details.department || null,
      details.cost_centre || null,
      details.project_code || null,
      details.branch_id || null,
      Number(details.allocation_pct || 0),
      Number(details.amount || 0),
      userId || null,
    ],
  );
  return result.rows[0];
}

module.exports = {
  createSupplierDocument,
  upsertSupplierScorecard,
  blacklistSupplier,
  createProcurementPolicy,
  createTender,
  addTenderBidder,
  evaluateTender,
  createContract,
  recordContractCallOff,
  allocateCost,
};
