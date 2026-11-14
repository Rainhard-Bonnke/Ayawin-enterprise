function normalizeScope(scope = {}) {
  return {
    companyId: scope.companyId ? String(scope.companyId) : null,
    branchId: scope.branchId ? String(scope.branchId) : null,
    allowedBranches: Array.isArray(scope.allowedBranches) ? scope.allowedBranches.map((branch) => String(branch)) : [],
    role: scope.role ? String(scope.role).toLowerCase() : "",
  };
}

function canAccessRecord(record, scope) {
  const context = normalizeScope(scope);
  if (!record || !context.companyId) return false;
  if (record.companyId && record.companyId !== context.companyId) return false;
  if (!record.branchId && !context.branchId && context.allowedBranches.length === 0) return true;
  if (context.role === "admin") return true;

  const recordBranch = record.branchId ? String(record.branchId) : null;
  if (recordBranch && context.allowedBranches.length > 0 && !context.allowedBranches.includes(recordBranch)) {
    return false;
  }
  if (context.branchId && recordBranch && recordBranch !== context.branchId) return false;
  if (recordBranch && context.branchId && recordBranch === context.branchId) return true;
  if (!recordBranch && context.allowedBranches.length === 0) return true;
  return true;
}

function applyRlsScope(records = [], scope) {
  const context = normalizeScope(scope);
  return records.filter((record) => canAccessRecord(record, context));
}

module.exports = {
  normalizeScope,
  canAccessRecord,
  applyRlsScope,
};
