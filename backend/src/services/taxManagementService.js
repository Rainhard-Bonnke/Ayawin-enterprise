function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPeriodLabel(periodEnd) {
  if (!periodEnd) return "Current period";
  const date = new Date(`${String(periodEnd).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Current period";
  return new Intl.DateTimeFormat("en-KE", { month: "short", year: "numeric" }).format(date);
}

function determineCalendarStatus(calendar = []) {
  if (!calendar.length) return "On track";
  const anyPending = calendar.some((item) => /pending|in review|draft/.test(String(item.status || "")));
  return anyPending ? "Watch" : "On track";
}

function defaultCalendarFromReturn(latestVatReturn) {
  const referenceDate = latestVatReturn?.period_end || new Date().toISOString().slice(0, 10);
  const dueDate = new Date(`${referenceDate}T00:00:00Z`);
  dueDate.setUTCDate(dueDate.getUTCDate() + 20);

  return [
    {
      name: `VAT return — ${formatPeriodLabel(referenceDate)}`,
      due_date: dueDate.toISOString().slice(0, 10),
      status: latestVatReturn?.status === "locked" ? "Filed" : "Draft ready",
    },
  ];
}

function buildTaxManagementSummary({
  latestVatReturn = null,
  withholdingTax = {},
  calendar = [],
} = {}) {
  const vatSummary = latestVatReturn?.summary || {};
  const vatDue = normalizeNumber(vatSummary.net_payable, 0);
  const inputVatClaim = normalizeNumber(vatSummary.claimable_input_vat, 0);
  const outputVat = normalizeNumber(vatSummary.output_vat, 0);
  const varianceAmount = normalizeNumber(vatSummary.variance_amount, 0);
  const whtPayable = normalizeNumber(withholdingTax.payable, 0);
  const certificatesPending = normalizeNumber(withholdingTax.certificatesPending, 0);
  const outstandingRemittances = normalizeNumber(withholdingTax.outstandingRemittances, 0);
  const periodLabel = formatPeriodLabel(latestVatReturn?.period_end || new Date().toISOString().slice(0, 10));

  const summary = [
    { label: "VAT due", value: vatDue, tone: "amber" },
    { label: "WHT payable", value: whtPayable, tone: "slate" },
    { label: "Input VAT claim", value: inputVatClaim, tone: "emerald" },
    { label: "Tax calendar status", value: determineCalendarStatus(calendar), tone: "blue" },
  ];

  const obligations = [
    {
      type: "Output VAT",
      amount: outputVat,
      status: latestVatReturn?.status === "locked" ? "Filed" : "Draft ready",
      period: periodLabel,
    },
    {
      type: "Input VAT",
      amount: inputVatClaim,
      status: "Validated",
      period: periodLabel,
    },
    {
      type: "Withholding tax",
      amount: whtPayable,
      status: withholdingTax.remittanceStatus === "not_configured"
        ? "Not configured"
        : withholdingTax.remittanceStatus === "pending_remittance"
          ? "Awaiting remittance"
          : withholdingTax.remittanceStatus === "pending_approval" ? "Awaiting payment" : "Ready",
      period: periodLabel,
    },
    {
      type: "Excise (if applicable)",
      amount: 0,
      status: "Not configured",
      period: periodLabel,
    },
  ];

  const deadlines = (calendar.length ? calendar : defaultCalendarFromReturn(latestVatReturn)).map((item) => ({
    name: item.name,
    due: item.due_date || item.due || "",
    status: item.status || "Pending",
  }));

  const followUps = [
    {
      label: "WHT certificates pending matching",
      value: certificatesPending,
      detail: "Supplier deductions awaiting verification",
    },
    {
      label: "VAT return variances",
      value: varianceAmount,
      detail: "Exceptions require reviewer sign-off",
    },
    {
      label: "Outstanding remittances",
      value: outstandingRemittances,
      detail: withholdingTax.remittanceStatus === "not_configured"
        ? "No approved withholding categories or obligations are configured"
        : "Due within the category-specific working-day period",
    },
  ];

  return {
    summary,
    obligations,
    deadlines,
    followUps,
    status: determineCalendarStatus(deadlines),
  };
}

module.exports = {
  buildTaxManagementSummary,
  determineCalendarStatus,
  formatPeriodLabel,
};
