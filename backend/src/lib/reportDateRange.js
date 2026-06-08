const { parseDashboardRange } = require('./chartMonths');

function parseReportRange(query = {}) {
  const range = parseDashboardRange({
    ...query,
    from: query.from || query.from_date,
    to: query.to || query.to_date,
  });
  let compare = null;
  if (query.compare_prior === 'true' || query.compare_prior === '1' || query.compare_prior === true) {
    const from = new Date(`${range.from}T00:00:00Z`);
    const to = new Date(`${range.to}T00:00:00Z`);
    const days = Math.max(1, Math.ceil((to - from) / 86400000) + 1);
    const priorTo = new Date(from);
    priorTo.setUTCDate(priorTo.getUTCDate() - 1);
    const priorFrom = new Date(priorTo);
    priorFrom.setUTCDate(priorFrom.getUTCDate() - (days - 1));
    compare = {
      from: priorFrom.toISOString().slice(0, 10),
      to: priorTo.toISOString().slice(0, 10),
      days,
    };
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50000, 1), 50000);
  return { ...range, compare, limit };
}

module.exports = { parseReportRange };
