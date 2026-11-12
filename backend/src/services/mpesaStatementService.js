const ExcelJS = require("exceljs");
const { Readable } = require("node:stream");
const pool = require("../db");
const gl = require("./glPostingService");
const integrationSettings = require("./integrationSettingsService");

function parseStatementDate(value) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{14}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

async function parseMpesaStatementCsv(csvText) {
  if (typeof csvText !== "string" || !csvText.trim()) throw new Error("Statement CSV is empty");
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.read(Readable.from([csvText]));
  const headers = sheet.getRow(1).values.slice(1).map((value) => String(value || ""));
  const rawRows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    rawRows.push(Object.fromEntries(headers.map((header, index) => [
      header,
      row.getCell(index + 1).text || "",
    ])));
  });
  if (!rawRows.length || rawRows.length > 10000) throw new Error("Import between 1 and 10,000 M-Pesa statement rows");
  return rawRows.map((raw, index) => {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), value]));
    const transactionDate = parseStatementDate(row.transaction_date || row.date || row.completion_time);
    const type = String(row.transaction_type || row.type || "").trim().toLowerCase();
    const amount = Number(String(row.amount || "0").replace(/,/g, ""));
    const feeAmount = Number(String(row.fee_amount || row.fee || "0").replace(/,/g, ""));
    const transactionId = String(row.transaction_id || row.trans_id || row.receipt_no || "").trim();
    if (!transactionDate) throw new Error(`Statement row ${index + 2} has an invalid transaction date`);
    if (!new Set(["payment", "deposit", "fee", "reversal"]).has(type)) {
      throw new Error(`Statement row ${index + 2} transaction_type must be payment, deposit, fee, or reversal`);
    }
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(feeAmount) || feeAmount < 0) {
      throw new Error(`Statement row ${index + 2} has an invalid amount or fee`);
    }
    if (["payment", "reversal"].includes(type) && !transactionId) {
      throw new Error(`Statement row ${index + 2} requires a transaction_id`);
    }
    return {
      lineNo: index + 1,
      transactionId: transactionId || null,
      transactionDate,
      transactionType: type,
      amount: Math.round(amount * 100) / 100,
      feeAmount: Math.round(feeAmount * 100) / 100,
      reference: String(row.reference || row.bill_reference || "").trim() || null,
      rawRow: { transaction_id: transactionId || null, transaction_type: type,
        transaction_date: transactionDate, amount, fee_amount: feeAmount,
        reference: String(row.reference || row.bill_reference || "").trim() || null },
    };
  });
}

async function postStatementAdjustment(client, { companyId, userId, line, policy, accountCode, debitAmount, creditAmount }) {
  const clearingAccountId = policy.mpesa_clearing_account_id;
  const adjustmentAccountId = accountCode;
  if (!clearingAccountId || !adjustmentAccountId) {
    throw new Error("Configure M-Pesa clearing and fee/reversal accounts before importing statement adjustments");
  }
  const accounts = await client.query(
    `SELECT id FROM erp_chart_of_accounts WHERE company_id=$1 AND id=ANY($2::uuid[])
     AND is_active=TRUE AND is_deleted=FALSE AND is_postable=TRUE`,
    [companyId, [clearingAccountId, adjustmentAccountId]],
  );
  if (accounts.rowCount !== 2) throw new Error("Configured M-Pesa statement accounts must be active and postable");
  const journal = await gl.createJournalInTransaction(client, {
    companyId,
    userId,
    entryDate: line.transactionDate,
    journalType: "adjustment",
    source: "module",
    referenceNo: line.transactionId || line.reference || `MPESA-${line.lineNo}`,
    description: `M-Pesa statement ${line.transactionType}: ${line.reference || line.transactionId || ""}`,
    lines: [
      { account_id: adjustmentAccountId, debit: debitAmount, credit: 0, description: `M-Pesa ${line.transactionType}` },
      { account_id: clearingAccountId, debit: 0, credit: creditAmount, description: "M-Pesa clearing adjustment" },
    ],
  });
  await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
  return journal.id;
}

async function importMpesaStatement({ companyId, userId, statementReference, csvText, fileName = null }) {
  const reference = String(statementReference || "").trim();
  if (!reference) throw new Error("Statement reference is required");
  const rows = await parseMpesaStatementCsv(csvText);
  const requiresAdjustmentAccounts = rows.some((row) => row.transactionType === "fee" || row.transactionType === "reversal");
  const config = requiresAdjustmentAccounts
    ? await integrationSettings.getProviderRuntimeConfig({ companyId, provider: "mpesa" })
    : null;
  const policy = config?.policy || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const imported = await client.query(
      `INSERT INTO erp_mpesa_statement_imports
         (company_id,statement_reference,file_name,row_count,imported_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [companyId, reference, fileName ? String(fileName).slice(0, 255) : null, rows.length, userId],
    );
    const importId = imported.rows[0].id;
    let matched = 0;
    let unmatched = 0;
    let variance = 0;
    for (const line of rows) {
      let status = "unmatched";
      let mpesaTransactionId = null;
      let matchedSource = null;
      let matchedSourceId = null;
      let bankStatementLineId = null;
      let journalId = null;
      let lineVariance = 0;
      if (line.transactionId) {
        const duplicate = await client.query(
          `SELECT 1 FROM erp_mpesa_statement_lines
           WHERE company_id=$1 AND transaction_id=$2 AND status <> 'duplicate' LIMIT 1`,
          [companyId, line.transactionId],
        );
        if (duplicate.rowCount) status = "duplicate";
      }
      if (status !== "duplicate" && (line.transactionType === "payment" || line.transactionType === "reversal")) {
        const transaction = await client.query(
          `SELECT id,amount,'c2b'::text AS source FROM erp_mpesa_transactions
             WHERE company_id=$1 AND trans_id=$2
           UNION ALL
           SELECT id,amount,'customer_receipt'::text AS source FROM erp_customer_receipts
             WHERE company_id=$1 AND provider_receipt_no=$2 AND payment_method='mpesa' AND status='posted' AND is_deleted=FALSE
           UNION ALL
           SELECT request.id,COALESCE(receipt.amount,request.amount),'stk'::text AS source
             FROM erp_mpesa_payment_requests request
             LEFT JOIN erp_customer_receipts receipt ON receipt.id=request.receipt_id AND receipt.company_id=request.company_id
             WHERE request.company_id=$1 AND request.provider_receipt_no=$2 AND request.status='confirmed'
           LIMIT 1`,
          [companyId, line.transactionId],
        );
        if (transaction.rowCount) {
          matchedSource = transaction.rows[0].source;
          matchedSourceId = transaction.rows[0].id;
          if (matchedSource === "c2b") mpesaTransactionId = transaction.rows[0].id;
          lineVariance = Math.round((line.amount - Number(transaction.rows[0].amount)) * 100) / 100;
          status = Math.abs(lineVariance) <= 0.01 ? "matched" : "unmatched";
        } else lineVariance = line.amount;
      } else if (status !== "duplicate" && line.transactionType === "deposit" && line.reference) {
        const bankLine = await client.query(
          `SELECT bank_line.id,bank_line.credit,bank_line.debit
           FROM erp_bank_reconciliation_lines bank_line
           JOIN erp_bank_reconciliations reconciliation ON reconciliation.id=bank_line.reconciliation_id
             AND reconciliation.company_id=bank_line.company_id
           WHERE bank_line.company_id=$1 AND bank_line.reference=$2
           ORDER BY reconciliation.statement_end DESC LIMIT 1`,
          [companyId, line.reference],
        );
        if (bankLine.rowCount) {
          bankStatementLineId = bankLine.rows[0].id;
          const bankAmount = Number(bankLine.rows[0].credit) - Number(bankLine.rows[0].debit);
          lineVariance = Math.round((line.amount - bankAmount) * 100) / 100;
          status = Math.abs(lineVariance) <= 0.01 ? "matched" : "unmatched";
        } else lineVariance = line.amount;
      }
      if (status !== "duplicate" && line.transactionType === "fee" && line.feeAmount + line.amount > 0) {
        const fee = line.feeAmount || line.amount;
        journalId = await postStatementAdjustment(client, { companyId, userId, line, policy,
          accountCode: policy.statement_fee_account_id, debitAmount: fee, creditAmount: fee });
        status = "posted";
      } else if (status !== "duplicate" && line.transactionType === "reversal" && mpesaTransactionId) {
        const reversal = line.amount;
        journalId = await postStatementAdjustment(client, { companyId, userId, line, policy,
          accountCode: policy.statement_reversal_account_id, debitAmount: reversal, creditAmount: reversal });
        status = "posted";
      }
      if (status === "matched" || status === "posted") matched += 1;
      else unmatched += 1;
      variance += lineVariance;
      await client.query(
        `INSERT INTO erp_mpesa_statement_lines
           (company_id,import_id,line_no,transaction_id,transaction_date,transaction_type,amount,fee_amount,
            reference,mpesa_transaction_id,bank_statement_line_id,journal_id,status,variance_amount,raw_row,
            matched_source,matched_source_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
        [companyId, importId, line.lineNo, line.transactionId, line.transactionDate, line.transactionType,
          line.amount, line.feeAmount, line.reference, mpesaTransactionId, bankStatementLineId, journalId,
           status, lineVariance, JSON.stringify(line.rawRow), matchedSource, matchedSourceId],
      );
    }
    await client.query(
      `UPDATE erp_mpesa_statement_imports SET matched_count=$3,unmatched_count=$4,variance_amount=$5
       WHERE id=$1 AND company_id=$2`, [importId, companyId, matched, unmatched, Math.round(variance * 100) / 100],
    );
    await client.query("COMMIT");
    return { import_id: importId, row_count: rows.length, matched_count: matched, unmatched_count: unmatched,
      variance_amount: Math.round(variance * 100) / 100 };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function getMpesaStatementVariance({ companyId, importId }) {
  const result = await pool.query(
    `SELECT import.id,import.statement_reference,import.row_count,import.matched_count,
            import.unmatched_count,import.variance_amount,import.imported_at,
            line.line_no,line.transaction_id,line.transaction_date,line.transaction_type,line.amount,
            line.fee_amount,line.reference,line.status,line.variance_amount AS line_variance,
            line.matched_source,line.matched_source_id
     FROM erp_mpesa_statement_imports import
     LEFT JOIN erp_mpesa_statement_lines line ON line.import_id=import.id AND line.company_id=import.company_id
     WHERE import.company_id=$1 AND import.id=$2 ORDER BY line.line_no`,
    [companyId, importId],
  );
  if (!result.rowCount) return null;
  const header = Object.fromEntries(Object.entries(result.rows[0]).filter(([key]) => !key.startsWith("line_")
    && !["transaction_id", "transaction_date", "transaction_type", "amount", "fee_amount", "reference", "status", "line_variance"].includes(key)));
  return { ...header, lines: result.rows.map((row) => ({
    line_no: row.line_no, transaction_id: row.transaction_id, transaction_date: row.transaction_date,
    transaction_type: row.transaction_type, amount: row.amount, fee_amount: row.fee_amount,
    reference: row.reference, status: row.status, variance_amount: row.line_variance,
    matched_source: row.matched_source, matched_source_id: row.matched_source_id,
  })).filter((row) => row.line_no != null) };
}

module.exports = { getMpesaStatementVariance, importMpesaStatement, parseMpesaStatementCsv };