const pool = require("../db");
const gl = require("./glPostingService");

const agencyLabels = {
  KRA_PAYE: "KRA PAYE",
  NSSF: "NSSF",
  SHA_SHIF: "SHA SHIF",
  AHL: "Affordable Housing Levy",
};

async function listRemittances(companyId, payrollRunId = null) {
  const result = await pool.query(
    `SELECT r.*, pr.run_no, pr.payroll_month,
            COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'posted'), 0) AS posted_payment_total,
            COUNT(p.id) FILTER (WHERE p.status = 'posted')::int AS posted_payment_count
     FROM erp_payroll_statutory_remittances r
     JOIN erp_payroll_runs pr ON pr.id = r.payroll_run_id AND pr.company_id = r.company_id
     LEFT JOIN erp_payroll_remittance_payments p ON p.remittance_id = r.id AND p.company_id = r.company_id
     WHERE r.company_id = $1 AND ($2::uuid IS NULL OR r.payroll_run_id = $2)
     GROUP BY r.id, pr.id
     ORDER BY pr.payroll_month DESC, r.agency_code`,
    [companyId, payrollRunId],
  );
  return result.rows.map((row) => ({
    ...row,
    agency_name: agencyLabels[row.agency_code] || row.agency_code,
    outstanding_amount: Math.max(0, Number(row.amount_due) - Number(row.amount_paid)),
    posted_payment_total: Number(row.posted_payment_total),
  }));
}

function normalizePaymentDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const text = value.trim();
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const yearNo = Number(year);
      const monthNo = Number(month);
      const dayNo = Number(day);
      if (monthNo >= 1 && monthNo <= 12 && dayNo >= 1 && dayNo <= 31) {
        const safeDate = new Date(Date.UTC(yearNo, monthNo - 1, dayNo));
        if (
          safeDate.getUTCFullYear() === yearNo &&
          safeDate.getUTCMonth() === monthNo - 1 &&
          safeDate.getUTCDate() === dayNo
        ) {
          return `${yearNo.toString().padStart(4, "0")}-${String(monthNo).padStart(2, "0")}-${String(dayNo).padStart(2, "0")}`;
        }
      }
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

async function createPayment({ companyId, userId, remittanceId, amount, paymentDate, bankAccountId, referenceNo }) {
  const paymentAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) throw new Error("Remittance amount must be positive");
  const reference = String(referenceNo || "").trim();
  if (!reference) throw new Error("Enter the statutory payment reference");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const remittanceResult = await client.query(
      `SELECT * FROM erp_payroll_statutory_remittances
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [remittanceId, companyId],
    );
    const remittance = remittanceResult.rows[0];
    if (!remittance) throw new Error("Statutory remittance not found");
    const payrollRunResult = await client.query(
      `SELECT pr.payroll_month
       FROM erp_payroll_runs pr
       WHERE pr.id = $1 AND pr.company_id = $2`,
      [remittance.payroll_run_id, companyId],
    );
    const payrollMonthDate = normalizePaymentDate(payrollRunResult.rows[0]?.payroll_month);
    const inputPaymentDate = normalizePaymentDate(paymentDate);
    const normalizedPaymentDate = payrollMonthDate && (
      !inputPaymentDate || inputPaymentDate.slice(0, 7) !== payrollMonthDate.slice(0, 7)
    ) ? payrollMonthDate : inputPaymentDate;
    if (!normalizedPaymentDate) throw new Error("A valid payment date is required");
    const outstanding = Number(remittance.amount_due) - Number(remittance.amount_paid);
    if (outstanding <= 0 || paymentAmount - outstanding > 0.0001) {
      throw new Error("Payment exceeds the outstanding statutory remittance balance");
    }
    const bank = await client.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND account_type = 'asset'
         AND account_code LIKE '11%' AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [bankAccountId, companyId],
    );
    if (!bank.rowCount) throw new Error("Choose an active postable bank or cash account");

    const paymentNo = `PRM-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
    const created = await client.query(
      `INSERT INTO erp_payroll_remittance_payments (
         company_id, remittance_id, payment_no, payment_date, amount,
         bank_account_id, reference_no, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [companyId, remittanceId, paymentNo, normalizedPaymentDate, paymentAmount, bankAccountId, reference, userId],
    );
    await client.query("COMMIT");
    return created.rows[0];
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
    const paymentResult = await client.query(
      `SELECT * FROM erp_payroll_remittance_payments
       WHERE id = $1 AND company_id = $2 AND status = 'draft' FOR UPDATE`,
      [paymentId, companyId],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error("Draft statutory payment not found");
    if (payment.created_by === userId) throw new Error("The payment preparer cannot approve and post their own remittance");

    const remittanceResult = await client.query(
      `SELECT * FROM erp_payroll_statutory_remittances
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [payment.remittance_id, companyId],
    );
    const remittance = remittanceResult.rows[0];
    if (!remittance || Number(payment.amount) > Number(remittance.amount_due) - Number(remittance.amount_paid) + 0.0001) {
      throw new Error("Statutory liability changed; payment exceeds the remaining balance");
    }
    const payrollRunResult = await client.query(
      `SELECT pr.payroll_month FROM erp_payroll_runs pr
       WHERE pr.id = $1 AND pr.company_id = $2`,
      [remittance.payroll_run_id, companyId],
    );
    const journalEntryDate = normalizePaymentDate(payment.payment_date)
      || normalizePaymentDate(payrollRunResult.rows[0]?.payroll_month)
      || new Date().toISOString().slice(0, 10);
    const accounts = await client.query(
      `SELECT id, account_code FROM erp_chart_of_accounts
       WHERE company_id = $1 AND account_code = ANY($2::text[])
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [companyId, [remittance.liability_account_code]],
    );
    if (!accounts.rowCount) throw new Error(`Payroll liability account ${remittance.liability_account_code} is not postable`);
    const bank = await client.query(
      `SELECT id FROM erp_chart_of_accounts
       WHERE id = $1 AND company_id = $2 AND account_type = 'asset' AND account_code LIKE '11%'
         AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`,
      [payment.bank_account_id, companyId],
    );
    if (!bank.rowCount) throw new Error("Payment bank or cash account is not postable");

    const journal = await gl.createJournalInTransaction(client, {
      companyId,
      userId,
      entryDate: journalEntryDate,
      journalType: "payment",
      referenceNo: payment.payment_no,
      description: `${agencyLabels[remittance.agency_code] || remittance.agency_code} payroll remittance ${payment.reference_no}`,
      lines: [
        { account_id: accounts.rows[0].id, debit: Number(payment.amount), credit: 0, description: `Settle ${agencyLabels[remittance.agency_code]} liability` },
        { account_id: payment.bank_account_id, debit: 0, credit: Number(payment.amount), description: `Remittance ${payment.reference_no}` },
      ],
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });

    const paid = Number(remittance.amount_paid) + Number(payment.amount);
    const nextStatus = paid >= Number(remittance.amount_due) - 0.01 ? "paid" : "partial";
    await client.query(
      `UPDATE erp_payroll_statutory_remittances
       SET amount_paid = $3, status = $4, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [remittance.id, companyId, paid, nextStatus],
    );
    const posted = await client.query(
      `UPDATE erp_payroll_remittance_payments
       SET status = 'posted', journal_id = $3, approved_at = NOW(), approved_by = $4
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [paymentId, companyId, journal.id, userId],
    );
    await client.query("COMMIT");
    return { payment: posted.rows[0], remittance_status: nextStatus, journal_id: journal.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { listRemittances, createPayment, postPayment };
