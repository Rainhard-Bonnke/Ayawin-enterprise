async function nextDocumentNo(client, { companyId, docType, prefix, padding = 4, date = new Date() }) {
  const year = Number(date instanceof Date ? date.getFullYear() : String(date).slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("A valid document date is required");
  const sequenceType = ({ erp_sales_orders: "sales_order", erp_delivery_notes: "delivery_note",
    erp_customer_invoices: "customer_invoice", erp_customer_credit_notes: "customer_credit_note",
    erp_customer_receipts: "customer_receipt", erp_journals: "journal" })[docType] || docType;
  const result = await client.query(
    `INSERT INTO erp_document_sequences(company_id,doc_type,fiscal_year,last_number,prefix,padding)
     VALUES($1,$2,$3,1,$4,$5)
     ON CONFLICT(company_id,doc_type,fiscal_year) DO UPDATE
       SET last_number=erp_document_sequences.last_number+1,prefix=EXCLUDED.prefix,
           padding=EXCLUDED.padding,updated_at=NOW()
     RETURNING last_number,prefix,padding`,
    [companyId, sequenceType, year, prefix, padding],
  );
  const sequence = result.rows[0];
  return `${sequence.prefix}-${year}-${String(sequence.last_number).padStart(sequence.padding, "0")}`;
}

module.exports = { nextDocumentNo };
