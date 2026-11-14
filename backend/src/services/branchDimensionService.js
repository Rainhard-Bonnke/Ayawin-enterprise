const branchDimensionRegistry = new Map();

function createBranchDimension({ companyId, branchId, branchName, currency = "KES", allowedAccounts = [] }) {
  if (!companyId || !branchId || !branchName) {
    throw new Error("companyId, branchId, and branchName are required");
  }
  const record = {
    id: `${String(companyId)}:${String(branchId)}`,
    companyId: String(companyId),
    branchId: String(branchId),
    branchName: String(branchName),
    currency: String(currency).toUpperCase(),
    allowedAccounts: Array.isArray(allowedAccounts) ? allowedAccounts.map((account) => String(account)) : [],
    createdAt: new Date().toISOString(),
  };
  branchDimensionRegistry.set(record.id, record);
  return record;
}

function summarizeBranchBalances(entries = []) {
  const totals = new Map();
  for (const entry of entries) {
    const key = `${entry.branchId}:${entry.accountCode}`;
    const current = totals.get(key) || { branchId: entry.branchId, accountCode: entry.accountCode, debit: 0, credit: 0 };
    current.debit += Number(entry.debit || 0);
    current.credit += Number(entry.credit || 0);
    totals.set(key, current);
  }

  return Array.from(totals.values()).map((entry) => ({
    ...entry,
    net: Number(entry.debit) - Number(entry.credit),
  }));
}

function consolidateBranchBalances(entries = []) {
  const byBranch = new Map();
  for (const entry of entries) {
    const branch = byBranch.get(entry.branchId) || { branchId: entry.branchId, debit: 0, credit: 0 };
    branch.debit += Number(entry.debit || 0);
    branch.credit += Number(entry.credit || 0);
    byBranch.set(entry.branchId, branch);
  }

  const branches = Array.from(byBranch.values()).map((entry) => ({
    ...entry,
    net: Number(entry.debit) - Number(entry.credit),
  }));

  return {
    branches,
    consolidated: branches.reduce((sum, branch) => sum + Number(branch.net || 0), 0),
  };
}

function createBranchJournalEntry({ companyId, branchId, accountCode, debit = 0, credit = 0 }) {
  if (!companyId || !branchId || !accountCode) {
    throw new Error("companyId, branchId, and accountCode are required");
  }
  const entry = {
    companyId: String(companyId),
    branchId: String(branchId),
    accountCode: String(accountCode),
    debit: Number(debit || 0),
    credit: Number(credit || 0),
  };

  if (entry.debit < 0 || entry.credit < 0) {
    throw new Error("Branch journal entries cannot be negative");
  }
  return entry;
}

module.exports = {
  branchDimensionRegistry,
  createBranchDimension,
  summarizeBranchBalances,
  consolidateBranchBalances,
  createBranchJournalEntry,
};
