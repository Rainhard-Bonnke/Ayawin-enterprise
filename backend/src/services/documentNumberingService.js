const DOCUMENT_SEQUENCE_TABLES = {
  sales_order: { table: "erp_sales_orders", column: "order_no" },
  delivery_note: { table: "erp_delivery_notes", column: "delivery_no" },
  customer_invoice: { table: "erp_customer_invoices", column: "invoice_no" },
  customer_credit_note: { table: "erp_customer_credit_notes", column: "credit_note_no" },
  customer_receipt: { table: "erp_customer_receipts", column: "receipt_no" },
  journal: { table: "erp_journals", column: "journal_no" },
};

function normalizeSequenceType(docType) {
  const mapping = {
    erp_sales_orders: "sales_order",
    erp_delivery_notes: "delivery_note",
    erp_customer_invoices: "customer_invoice",
    erp_customer_credit_notes: "customer_credit_note",
    erp_customer_receipts: "customer_receipt",
    erp_journals: "journal",
  };
  return mapping[docType] || docType;
}

async function getExistingDocumentMax(client, { companyId, sequenceType, prefix }) {
  const definition = DOCUMENT_SEQUENCE_TABLES[sequenceType];
  if (!definition) return 0;
  const result = await client.query(
    `SELECT COALESCE(MAX(CAST(substring(${definition.column} FROM '^' || $1 || '-[0-9]{4}-([0-9]+)$') AS BIGINT)), 0) AS max_number
     FROM ${definition.table}
     WHERE company_id = $2 AND ${definition.column} ~ ('^' || $1 || '-[0-9]{4}-[0-9]+$')`,
    [prefix, companyId],
  );
  return Number(result.rows[0]?.max_number || 0);
}

async function nextDocumentNo(client, { companyId, docType, prefix, padding = 4, date = new Date() }) {
  const year = Number(date instanceof Date ? date.getFullYear() : String(date).slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("A valid document date is required");

  const sequenceType = normalizeSequenceType(docType);
  const maxExisting = await getExistingDocumentMax(client, { companyId, sequenceType, prefix });
  const existing = await client.query(
    `SELECT last_number, prefix, padding FROM erp_document_sequences
     WHERE company_id = $1 AND doc_type = $2 AND fiscal_year = $3
     FOR UPDATE`,
    [companyId, sequenceType, year],
  );

  const currentLast = existing.rowCount ? Number(existing.rows[0].last_number || 0) : 0;
  const nextNumber = Math.max(currentLast, maxExisting) + 1;

  if (existing.rowCount) {
    await client.query(
      `UPDATE erp_document_sequences
       SET last_number = $4, prefix = $5, padding = $6, updated_at = NOW()
       WHERE company_id = $1 AND doc_type = $2 AND fiscal_year = $3`,
      [companyId, sequenceType, year, nextNumber, prefix, padding],
    );
    return `${prefix}-${year}-${String(nextNumber).padStart(padding, "0")}`;
  }

  await client.query(
    `INSERT INTO erp_document_sequences(company_id,doc_type,fiscal_year,last_number,prefix,padding)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [companyId, sequenceType, year, nextNumber, prefix, padding],
  );
  return `${prefix}-${year}-${String(nextNumber).padStart(padding, "0")}`;
}

module.exports = { nextDocumentNo };
