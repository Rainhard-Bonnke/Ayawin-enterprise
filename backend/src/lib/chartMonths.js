function monthKeyFromRow(row) {
  if (row.month_key) return row.month_key;
  if (!row.sort_key) return null;
  const d = row.sort_key instanceof Date ? row.sort_key : new Date(row.sort_key);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Fill missing calendar months with zero revenue for continuous chart axes. */
function fillMonthlyRevenueGaps(rows, fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  from.setUTCDate(1);
  to.setUTCDate(1);

  const byKey = new Map();
  for (const row of rows || []) {
    const key = monthKeyFromRow(row);
    if (key) byKey.set(key, Number(row.revenue || 0));
  }

  const out = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  while (cursor <= end) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = cursor.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    out.push({
      month: label,
      month_key: key,
      revenue: byKey.get(key) ?? 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function defaultRangeMonths(months = 6) {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function parseDashboardRange(query = {}) {
  const fromParam = query.from || query.from_date;
  const toParam = query.to || query.to_date;
  if (fromParam && toParam) {
    return { from: String(fromParam).slice(0, 10), to: String(toParam).slice(0, 10) };
  }
  const preset = String(query.preset || '6m').toLowerCase();
  const to = new Date();
  const from = new Date();
  if (preset === '7d') {
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === '30d' || preset === '1m') {
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === '90d' || preset === '3m') {
    from.setDate(from.getDate() - 90);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === 'ytd') {
    from.setMonth(0);
    from.setDate(1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === 'mtd') {
    from.setDate(1);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  return defaultRangeMonths(6);
}

module.exports = { fillMonthlyRevenueGaps, parseDashboardRange, defaultRangeMonths };
