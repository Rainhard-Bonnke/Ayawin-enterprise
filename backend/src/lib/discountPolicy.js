/** Role-based maximum line discount (%). */

const ROLE_CAPS = [
  { match: /administrator/i, cap: 100 },
  { match: /managing director/i, cap: 25 },
  { match: /operations manager/i, cap: 15 },
  { match: /sales manager/i, cap: 15 },
  { match: /sales/i, cap: 5 },
];

const DEFAULT_CAP = 5;

function maxDiscountPercent(user) {
  const role = String(user?.role_name || '');
  for (const { match, cap } of ROLE_CAPS) {
    if (match.test(role)) return cap;
  }
  const perms = user?.permissions || [];
  if (perms.includes('sales.approve') || perms.includes('foundation.edit')) return 15;
  return DEFAULT_CAP;
}

function assertLineDiscounts(user, lines) {
  const cap = maxDiscountPercent(user);
  for (const line of lines || []) {
    const d = Number(line.discount_percent ?? line.discountPercent ?? 0);
    if (!Number.isFinite(d) || d < 0) throw new Error('Invalid discount_percent');
    if (d > cap) {
      const err = new Error(`Discount ${d}% exceeds your allowed maximum of ${cap}%`);
      err.code = 'DISCOUNT_LIMIT';
      err.details = { cap, requested: d };
      throw err;
    }
  }
  return cap;
}

module.exports = { maxDiscountPercent, assertLineDiscounts, DEFAULT_CAP };
