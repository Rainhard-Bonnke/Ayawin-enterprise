const pool = require("../db");
const { logAudit, assertDifferentUser } = require("./auditService");
const { roundMoney, sumMoney } = require("../lib/money");
const ExcelJS = require("exceljs");

const OUTPUT_TREATMENTS = ["standard", "zero_rated", "exempt"];

function buildReturnSummary({ invoices, customerCredits, supplierBills, supplierCredits, glBalances }) {
  const outputByTreatment = Object.fromEntries(OUTPUT_TREATMENTS.map((treatment) => [treatment, { taxable_amount: 0, vat_amount: 0 }]));
  for (const row of invoices) {
    const treatment = OUTPUT_TREATMENTS.includes(row.tax_treatment) ? row.tax_treatment : "standard";
    outputByTreatment[treatment].taxable_amount += Number(row.taxable_amount || 0);
    outputByTreatment[treatment].vat_amount += Number(row.vat_amount || 0);
  }
  for (const row of customerCredits) {
    const treatment = OUTPUT_TREATMENTS.includes(row.tax_treatment) ? row.tax_treatment : "standard";
    outputByTreatment[treatment].taxable_amount -= Number(row.taxable_amount || 0);
    outputByTreatment[treatment].vat_amount -= Number(row.vat_amount || 0);
  }
  for (const entry of Object.values(outputByTreatment)) {
    entry.taxable_amount = roundMoney(entry.taxable_amount);
    entry.vat_amount = roundMoney(entry.vat_amount);
  }

  const claimableInputVat = roundMoney(sumMoney(supplierBills.map((row) => row.claimable_input_vat))
    - sumMoney(supplierCredits.map((row) => row.claimable_input_vat)));
  const heldInputVat = roundMoney(sumMoney(supplierBills.map((row) => row.held_input_vat))
    - sumMoney(supplierCredits.map((row) => row.held_input_vat)));
  const nonClaimableInputVat = roundMoney(sumMoney(supplierBills.map((row) => row.non_claimable_input_vat))
    - sumMoney(supplierCredits.map((row) => row.non_claimable_input_vat)));
  const outputVat = roundMoney(sumMoney(Object.values(outputByTreatment).map((entry) => entry.vat_amount)));
  const netPayable = roundMoney(outputVat - claimableInputVat);
  const glByCode = Object.fromEntries(glBalances.map((row) => [row.account_code, {
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
  }]));
  const outputGl = glByCode["2200"] || { debit: 0, credit: 0 };
  const inputGl = glByCode["1400"] || { debit: 0, credit: 0 };
  const pendingGl = glByCode["1401"] || { debit: 0, credit: 0 };
  const reconciliation = {
    output_vat_variance: roundMoney(outputGl.credit - outputGl.debit - outputVat),
    claimable_input_vat_variance: roundMoney(inputGl.debit - inputGl.credit - claimableInputVat),
    held_input_vat_variance: roundMoney(pendingGl.debit - pendingGl.credit - heldInputVat),
  };
  const varianceAmount = roundMoney(Object.values(reconciliation).reduce((sum, amount) => sum + Math.abs(amount), 0));
  return {
    output_by_treatment: outputByTreatment,
    output_vat: outputVat,
    claimable_input_vat: claimableInputVat,
    held_input_vat: heldInputVat,
    non_claimable_input_vat: nonClaimableInputVat,
    net_payable: Math.max(0, netPayable),
    net_refundable: Math.max(0, -netPayable),
    reconciliation,
    variance_amount: varianceAmount,
  };
}

function asReturnLine(sourceType, row, amounts) {
  return {
    source_document_type: sourceType,
    source_document_id: row.document_id,
    source_document_line_id: row.source_line_id || null,
    document_no: row.document_no,
    document_date: row.document_date,
    tax_treatment: row.tax_treatment || null,
    evidence_status: amounts.evidence_status || null,
    taxable_amount: roundMoney(amounts.taxable_amount || 0),
    output_vat: roundMoney(amounts.output_vat || 0),
    claimable_input_vat: roundMoney(amounts.claimable_input_vat || 0),
    held_input_vat: roundMoney(amounts.held_input_vat || 0),
    non_claimable_input_vat: roundMoney(amounts.non_claimable_input_vat || 0),
  };
}

async function getSourceRows(client, companyId, period) {
  const [invoices, customerCredits, supplierBills, supplierCredits, glBalances] = await Promise.all([
    client.query(
      `SELECT i.id AS document_id, il.id AS source_line_id, i.invoice_no AS document_no,
              i.invoice_date AS document_date, il.tax_treatment, il.line_total AS taxable_amount,
              il.tax_amount AS vat_amount
       FROM erp_customer_invoices i
       JOIN erp_customer_invoice_lines il ON il.invoice_id = i.id AND il.company_id = i.company_id
       WHERE i.company_id = $1 AND i.status IN ('posted','paid','partial','overdue')
         AND i.is_deleted = FALSE AND il.is_deleted = FALSE
         AND i.invoice_date BETWEEN $2 AND $3`,
      [companyId, period.start_date, period.end_date],
    ),
    client.query(
      `SELECT n.id AS document_id, l.id AS source_line_id, n.credit_note_no AS document_no,
              n.credit_date AS document_date, l.tax_treatment, l.net_amount AS taxable_amount,
              l.tax_amount AS vat_amount
       FROM erp_customer_credit_notes n
       JOIN erp_customer_credit_note_lines l ON l.credit_note_id = n.id AND l.company_id = n.company_id
       WHERE n.company_id = $1 AND n.status = 'posted' AND n.credit_date BETWEEN $2 AND $3`,
      [companyId, period.start_date, period.end_date],
    ),
    client.query(
      `SELECT b.id AS document_id, bl.id AS source_line_id, b.bill_no AS document_no,
              b.bill_date AS document_date, bl.tax_treatment, bl.net_amount AS taxable_amount,
                  bl.claimable_vat, bl.non_claimable_vat, b.evidence_status,
                  reclass_j.entry_date AS evidence_reclassification_date,
                  CASE WHEN (b.input_vat_posting_status = 'claimable' AND b.bill_date BETWEEN $2 AND $3)
                   OR (b.input_vat_posting_status = 'held_no_evidence' AND reclass_j.entry_date BETWEEN $2 AND $3)
                    THEN bl.claimable_vat ELSE 0 END AS claimable_input_vat,
                  (CASE WHEN b.input_vat_posting_status IN ('held_no_evidence','legacy_input_vat_1400')
                     AND b.bill_date BETWEEN $2 AND $3
                  THEN bl.claimable_vat ELSE 0 END)
                 - CASE WHEN b.input_vat_posting_status = 'held_no_evidence'
                       AND reclass_j.entry_date BETWEEN $2 AND $3
                     THEN bl.claimable_vat ELSE 0 END AS held_input_vat,
              CASE WHEN b.bill_date BETWEEN $2 AND $3 THEN bl.non_claimable_vat ELSE 0 END AS non_claimable_input_vat
       FROM erp_supplier_bills b
       JOIN erp_supplier_bill_lines bl ON bl.bill_id = b.id AND bl.company_id = b.company_id
              LEFT JOIN erp_journals reclass_j ON reclass_j.id = b.evidence_reclassification_journal_id
                AND reclass_j.company_id = b.company_id AND reclass_j.status = 'posted'
       WHERE b.company_id = $1 AND b.status IN ('posted','partial','paid','overdue')
         AND b.is_deleted = FALSE
            AND (b.bill_date BETWEEN $2 AND $3 OR reclass_j.entry_date BETWEEN $2 AND $3)`,
      [companyId, period.start_date, period.end_date],
    ),
    client.query(
      `SELECT c.id AS document_id, c.source_bill_line_id AS source_line_id,
              c.credit_note_no AS document_no, c.received_date AS document_date,
              bl.tax_treatment, c.inventory_claim_amount AS taxable_amount,
              c.claimable_vat_amount, c.non_claimable_vat_amount, c.source_evidence_status,
              CASE WHEN c.source_evidence_status = 'verified' THEN c.claimable_vat_amount ELSE 0 END AS claimable_input_vat,
              CASE WHEN c.source_evidence_status <> 'verified' THEN c.claimable_vat_amount ELSE 0 END AS held_input_vat,
              c.non_claimable_vat_amount AS non_claimable_input_vat
       FROM erp_supplier_return_credit_notes c
       LEFT JOIN erp_supplier_bill_lines bl ON bl.id = c.source_bill_line_id AND bl.company_id = c.company_id
       WHERE c.company_id = $1 AND c.status = 'posted' AND c.is_deleted = FALSE
         AND c.received_date BETWEEN $2 AND $3`,
      [companyId, period.start_date, period.end_date],
    ),
    client.query(
      `SELECT a.account_code, COALESCE(SUM(l.debit), 0) AS debit,
              COALESCE(SUM(l.credit), 0) AS credit
       FROM erp_journal_lines l
       JOIN erp_journals j ON j.id = l.journal_id AND j.company_id = l.company_id
       JOIN erp_chart_of_accounts a ON a.id = l.account_id AND a.company_id = l.company_id
       WHERE l.company_id = $1 AND j.status = 'posted' AND j.is_deleted = FALSE
         AND j.entry_date BETWEEN $2 AND $3 AND a.account_code = ANY($4::text[])
       GROUP BY a.account_code`,
      [companyId, period.start_date, period.end_date, ["2200", "1400", "1401"]],
    ),
  ]);
  return {
    invoices: invoices.rows,
    customerCredits: customerCredits.rows,
    supplierBills: supplierBills.rows,
    supplierCredits: supplierCredits.rows,
    glBalances: glBalances.rows,
  };
}

function buildReturnLines(rows) {
  return [
    ...rows.invoices.map((row) => asReturnLine("customer_invoice", row, {
      taxable_amount: row.taxable_amount, output_vat: row.vat_amount,
    })),
    ...rows.customerCredits.map((row) => asReturnLine("customer_credit_note", row, {
      taxable_amount: -Number(row.taxable_amount), output_vat: -Number(row.vat_amount),
    })),
    ...rows.supplierBills.map((row) => asReturnLine("supplier_bill", row, {
      evidence_status: row.evidence_status,
      taxable_amount: row.taxable_amount,
      claimable_input_vat: row.claimable_input_vat,
      held_input_vat: row.held_input_vat,
      non_claimable_input_vat: row.non_claimable_input_vat,
    })),
    ...rows.supplierCredits.map((row) => asReturnLine("supplier_return_credit", row, {
      evidence_status: row.source_evidence_status,
      taxable_amount: -Number(row.taxable_amount),
      claimable_input_vat: -Number(row.claimable_input_vat),
      held_input_vat: -Number(row.held_input_vat),
      non_claimable_input_vat: -Number(row.non_claimable_input_vat),
    })),
  ];
}

async function prepareVatReturn({ companyId, userId, periodId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodResult = await client.query(
      `SELECT id, name, start_date, end_date, status FROM erp_fiscal_periods
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE FOR UPDATE`,
      [periodId, companyId],
    );
    const period = periodResult.rows[0];
    if (!period) throw new Error("Tax period not found");
    const existingResult = await client.query(
      `SELECT * FROM erp_vat_returns WHERE company_id = $1 AND period_id = $2 FOR UPDATE`,
      [companyId, periodId],
    );
    const existing = existingResult.rows[0];
    if (existing && existing.status !== "draft") throw new Error("Only a draft VAT return can be refreshed");
    const rows = await getSourceRows(client, companyId, period);
    const summary = buildReturnSummary(rows);
    const lines = buildReturnLines(rows);
    let vatReturn;
    if (existing) {
      const updated = await client.query(
        `UPDATE erp_vat_returns SET summary = $3::jsonb, variance_amount = $4,
           prepared_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING *`,
        [existing.id, companyId, JSON.stringify(summary), summary.variance_amount],
      );
      vatReturn = updated.rows[0];
      await client.query("DELETE FROM erp_vat_return_lines WHERE return_id = $1 AND company_id = $2", [vatReturn.id, companyId]);
    } else {
      const returnNo = `VAT3-${String(period.start_date).slice(0, 7)}`;
      const inserted = await client.query(
        `INSERT INTO erp_vat_returns
         (company_id, period_id, return_no, period_start, period_end, status, prepared_by, prepared_at, summary, variance_amount)
         VALUES ($1,$2,$3,$4,$5,'draft',$6,NOW(),$7::jsonb,$8) RETURNING *`,
        [companyId, periodId, returnNo, period.start_date, period.end_date, userId, JSON.stringify(summary), summary.variance_amount],
      );
      vatReturn = inserted.rows[0];
    }
    for (const line of lines) {
      await client.query(
        `INSERT INTO erp_vat_return_lines
         (company_id, return_id, source_document_type, source_document_id, source_document_line_id,
          document_no, document_date, tax_treatment, taxable_amount, output_vat,
          claimable_input_vat, held_input_vat, non_claimable_input_vat)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [companyId, vatReturn.id, line.source_document_type, line.source_document_id,
          line.source_document_line_id, line.document_no, line.document_date, line.tax_treatment,
          line.taxable_amount, line.output_vat, line.claimable_input_vat, line.held_input_vat,
          line.non_claimable_input_vat],
      );
    }
    await logAudit({ client, companyId, userId, entityType: "erp_vat_returns", entityId: vatReturn.id,
      action: "vat_return_prepared", newValues: { return_no: vatReturn.return_no, period_id: periodId, summary } });
    await client.query("COMMIT");
    return { ...vatReturn, summary, line_count: lines.length, filing_status: "working_paper_only" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function approveVatReturn({ companyId, userId, returnId, varianceExplanation }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_vat_returns WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [returnId, companyId],
    );
    const vatReturn = result.rows[0];
    if (!vatReturn) throw new Error("Draft VAT return not found");
    assertDifferentUser(vatReturn.prepared_by, userId);
    const explanation = String(varianceExplanation || "").trim();
    if (Math.abs(Number(vatReturn.variance_amount)) > 0.01 && !explanation) {
      throw new Error("Explain the nonzero VAT control-account variance before approval");
    }
    const updated = await client.query(
      `UPDATE erp_vat_returns SET status = 'approved', approved_by = $3, approved_at = NOW(),
         variance_explanation = $4, updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING *`,
      [returnId, companyId, userId, explanation || null],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_vat_returns", entityId: returnId,
      action: "vat_return_approved", oldValues: { status: "draft" },
      newValues: { status: "approved", variance_amount: vatReturn.variance_amount, variance_explanation: explanation || null } });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockVatReturn({ companyId, userId, returnId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE erp_vat_returns SET status = 'locked', locked_by = $3, locked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'approved' RETURNING *`,
      [returnId, companyId, userId],
    );
    if (!result.rowCount) throw new Error("Only an approved VAT return can be locked");
    await logAudit({ client, companyId, userId, entityType: "erp_vat_returns", entityId: returnId,
      action: "vat_return_locked", newValues: { status: "locked", return_no: result.rows[0].return_no } });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reopenVatReturn({ companyId, userId, returnId, reason }) {
  const explanation = String(reason || "").trim();
  if (!explanation) throw new Error("A reason is required to reopen a locked VAT period");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM erp_vat_returns WHERE id = $1 AND company_id = $2 AND status = 'locked' FOR UPDATE`,
      [returnId, companyId],
    );
    const vatReturn = result.rows[0];
    if (!vatReturn) throw new Error("Locked VAT return not found");
    assertDifferentUser(vatReturn.locked_by, userId);
    const updated = await client.query(
      `UPDATE erp_vat_returns SET status = 'approved', reopened_by = $3, reopened_at = NOW(),
         reopen_reason = $4, updated_at = NOW() WHERE id = $1 AND company_id = $2 RETURNING *`,
      [returnId, companyId, userId, explanation],
    );
    await logAudit({ client, companyId, userId, entityType: "erp_vat_returns", entityId: returnId,
      action: "vat_return_reopened", oldValues: { status: "locked" },
      newValues: { status: "approved", reopen_reason: explanation } });
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getVatReturn(companyId, returnId) {
  const [header, lines] = await Promise.all([
    pool.query(`SELECT * FROM erp_vat_returns WHERE id = $1 AND company_id = $2`, [returnId, companyId]),
    pool.query(`SELECT * FROM erp_vat_return_lines WHERE return_id = $1 AND company_id = $2 ORDER BY document_date, document_no, id`, [returnId, companyId]),
  ]);
  if (!header.rowCount) return null;
  return { ...header.rows[0], lines: lines.rows, filing_status: "working_paper_only" };
}

async function listVatReturns(companyId) {
  const result = await pool.query(
    `SELECT r.*, p.name AS period_name FROM erp_vat_returns r
     JOIN erp_fiscal_periods p ON p.id = r.period_id AND p.company_id = r.company_id
     WHERE r.company_id = $1 ORDER BY r.period_start DESC`,
    [companyId],
  );
  return result.rows.map((row) => ({ ...row, filing_status: "working_paper_only" }));
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function returnLinesToCsv(lines) {
  const headers = ["source_document_type", "source_document_id", "source_document_line_id", "document_no", "document_date", "tax_treatment", "evidence_status", "taxable_amount", "output_vat", "claimable_input_vat", "held_input_vat", "non_claimable_input_vat"];
  return [headers.join(","), ...lines.map((line) => headers.map((header) => csvEscape(line[header])).join(","))].join("\r\n");
}

function returnToCsv(vatReturn) {
  const summary = typeof vatReturn.summary === "string" ? JSON.parse(vatReturn.summary) : vatReturn.summary || {};
  const topRows = [
    ["VAT3 Working Paper - Not Filed"],
    ["Return", vatReturn.return_no],
    ["Period start", vatReturn.period_start],
    ["Period end", vatReturn.period_end],
    ["Status", vatReturn.status],
    [],
    ["Output VAT by treatment"],
    ["Treatment", "Taxable amount", "VAT amount"],
    ...OUTPUT_TREATMENTS.map((treatment) => [treatment,
      summary.output_by_treatment?.[treatment]?.taxable_amount || 0,
      summary.output_by_treatment?.[treatment]?.vat_amount || 0]),
    ["Claimable input VAT", summary.claimable_input_vat || 0],
    ["Held pending evidence", summary.held_input_vat || 0],
    ["Non-claimable input VAT", summary.non_claimable_input_vat || 0],
    ["Net payable", summary.net_payable || 0],
    ["Net refundable", summary.net_refundable || 0],
    ["Variance", summary.variance_amount || 0],
    [],
    ["Source document lines"],
  ].map((row) => row.map(csvEscape).join(","));
  return [...topRows, returnLinesToCsv(vatReturn.lines || [])].join("\r\n");
}

async function returnToXlsx(vatReturn) {
  const summary = typeof vatReturn.summary === "string" ? JSON.parse(vatReturn.summary) : vatReturn.summary || {};
  const rows = [
    ["VAT3 Working Paper - Not Filed"],
    ["Return", vatReturn.return_no],
    ["Period start", vatReturn.period_start],
    ["Period end", vatReturn.period_end],
    ["Status", vatReturn.status],
    [],
    ["Output VAT by treatment"],
    ["Treatment", "Taxable amount", "VAT amount"],
    ...OUTPUT_TREATMENTS.map((treatment) => [treatment,
      summary.output_by_treatment?.[treatment]?.taxable_amount || 0,
      summary.output_by_treatment?.[treatment]?.vat_amount || 0]),
    ["Claimable input VAT", summary.claimable_input_vat || 0],
    ["Held pending evidence", summary.held_input_vat || 0],
    ["Non-claimable input VAT", summary.non_claimable_input_vat || 0],
    ["Net payable", summary.net_payable || 0],
    ["Net refundable", summary.net_refundable || 0],
    ["Variance", summary.variance_amount || 0],
    [],
    ["Source document lines"],
    ["Source type", "Source ID", "Source line ID", "Document no", "Date", "Tax treatment", "Evidence status", "Taxable amount", "Output VAT", "Claimable input VAT", "Held input VAT", "Non-claimable input VAT"],
    ...(vatReturn.lines || []).map((line) => [line.source_document_type, line.source_document_id,
      line.source_document_line_id, line.document_no, line.document_date, line.tax_treatment, line.evidence_status,
      line.taxable_amount, line.output_vat, line.claimable_input_vat, line.held_input_vat,
      line.non_claimable_input_vat]),
  ];
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("VAT3 Working Paper");
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = {
  buildReturnSummary,
  buildReturnLines,
  prepareVatReturn,
  approveVatReturn,
  lockVatReturn,
  reopenVatReturn,
  getVatReturn,
  listVatReturns,
  returnLinesToCsv,
  returnToCsv,
  returnToXlsx,
};