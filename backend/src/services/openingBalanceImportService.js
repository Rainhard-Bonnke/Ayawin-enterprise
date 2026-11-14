function validateOpeningBalanceRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Opening balance import requires at least one row");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const entries = [];
  for (const row of rows) {
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    if (!row.account_code) {
      throw new Error("Each opening-balance row requires an account_code");
    }
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      throw new Error(`Invalid opening balance for ${row.account_code}`);
    }
    totalDebit += debit;
    totalCredit += credit;
    entries.push({
      accountCode: String(row.account_code),
      branchId: row.branch_id ? String(row.branch_id) : null,
      debit,
      credit,
    });
  }

  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new Error(`Opening balance must balance: debit ${totalDebit} != credit ${totalCredit}`);
  }

  return {
    totalDebit,
    totalCredit,
    entries,
    balanced: true,
  };
}

function importOpeningBalance({ companyId, rows = [] }) {
  const validated = validateOpeningBalanceRows(rows);
  const journal = {
    companyId: String(companyId),
    journalType: "opening_balance",
    totalDebit: validated.totalDebit,
    totalCredit: validated.totalCredit,
    entries: validated.entries,
    balanced: validated.balanced,
  };
  return journal;
}

module.exports = {
  validateOpeningBalanceRows,
  importOpeningBalance,
};
