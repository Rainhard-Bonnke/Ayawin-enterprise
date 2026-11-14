function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeExpenseClaimInput(input = {}) {
  const claimDate = String(input.claim_date || "");
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(claimDate)
    ? new Date(`${claimDate}T00:00:00.000Z`)
    : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== claimDate) {
    throw new Error("Enter a valid expense claim date");
  }
  const description = String(input.description || "").trim();
  if (!description || description.length > 500) throw new Error("Enter an expense claim description up to 500 characters");
  const currencyCode = String(input.currency_code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new Error("Expense currency must be a three-letter ISO code");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) {
    throw new Error("An expense claim must contain between 1 and 50 lines");
  }
  const lines = input.lines.map((line) => {
    const categoryId = String(line?.category_id || "").trim();
    const lineDescription = String(line?.description || "").trim();
    const amount = Number(line?.amount);
    const costCentre = String(line?.cost_centre || "").trim();
    if (!categoryId || !lineDescription || lineDescription.length > 300
      || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw new Error("Each expense line needs a category, description, and positive amount");
    }
    return { category_id: categoryId, description: lineDescription, amount: Math.round(amount * 100) / 100, cost_centre: costCentre || null };
  });
  const totalMinor = lines.reduce((sum, line) => sum + Math.round(line.amount * 100), 0);
  return {
    claim_date: claimDate,
    description,
    currency_code: currencyCode,
    lines,
    total_amount: totalMinor / 100,
  };
}

function getPolicyAdherence(claims = []) {
  if (!claims.length) return 0;
  const rejectedCount = claims.filter((claim) => String(claim.status || "").toLowerCase() === "rejected").length;
  const score = 100 - (rejectedCount * 6);
  return Math.min(100, Math.max(0, score));
}

function buildExpenseManagementSummary({ claims = [], budgets = [] } = {}) {
  const normalizedClaims = claims.map((claim) => ({
    employee: String(claim.employee || "Unknown employee"),
    category: String(claim.category || "General"),
    amount: normalizeNumber(claim.amount, 0),
    status: String(claim.status || "Pending"),
    date: String(claim.date || new Date().toISOString().slice(0, 10)),
  }));

  const normalizedBudgets = budgets.map((row) => ({
    category: String(row.category || "General"),
    allocated: normalizeNumber(row.allocated, 0),
    used: normalizeNumber(row.used, 0),
    remaining: normalizeNumber(row.remaining, row.allocated - row.used),
  }));

  const submitted = normalizedClaims.filter((claim) => claim.status.toLowerCase() !== "rejected").length;
  const approvals = normalizedClaims.filter((claim) => claim.status.toLowerCase() === "approved").length;
  const pendingAmount = normalizedClaims
    .filter((claim) => claim.status.toLowerCase() !== "rejected")
    .reduce((sum, claim) => sum + claim.amount, 0);
  const policyAdherence = getPolicyAdherence(normalizedClaims);

  return {
    summary: [
      { label: "Claims submitted", value: submitted, tone: "blue" },
      { label: "Approved", value: approvals, tone: "emerald" },
      { label: "Pending amount", value: pendingAmount, tone: "amber" },
      { label: "Policy adherence", value: policyAdherence, tone: "slate" },
    ],
    claims: normalizedClaims,
    budgets: normalizedBudgets,
    status: policyAdherence >= 90 ? "Within policy" : "Review required",
  };
}

module.exports = {
  buildExpenseManagementSummary,
  getPolicyAdherence,
  normalizeExpenseClaimInput,
};
