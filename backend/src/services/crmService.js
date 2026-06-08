const pool = require('../db');

const TXN_BASE_SQL = `
  SELECT invoice_date AS txn_date, 'invoice' AS type, invoice_no AS ref,
         total_amount::numeric AS debit, 0::numeric AS credit,
         total_amount::numeric AS balance_effect, 1 AS sort_key
  FROM erp_customer_invoices
  WHERE company_id = $1 AND customer_id = $2
    AND status NOT IN ('draft', 'cancelled') AND is_deleted = FALSE
  UNION ALL
  SELECT credit_date, 'credit_note', credit_note_no,
         0::numeric, total_amount::numeric, (0 - total_amount)::numeric, 2
  FROM erp_credit_notes
  WHERE company_id = $1 AND customer_id = $2 AND status = 'posted' AND is_deleted = FALSE
  UNION ALL
  SELECT receipt_date, 'payment', receipt_no,
         0::numeric, amount::numeric, (0 - amount)::numeric, 3
  FROM erp_customer_receipts
  WHERE company_id = $1 AND customer_id = $2 AND is_deleted = FALSE AND status = 'posted'
`;

async function getCustomerArBalance(companyId, customerId) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(balance_effect), 0)::numeric AS balance
     FROM (${TXN_BASE_SQL}) t`,
    [companyId, customerId],
  );
  return Number(result.rows[0]?.balance || 0);
}

async function getCustomerStatement(companyId, customerId, { from = null, to = null } = {}) {
  const customer = await pool.query(
    `SELECT id, name, customer_code, tax_id, credit_limit, is_active
     FROM erp_customers
     WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [customerId, companyId],
  );
  if (!customer.rowCount) return null;

  const all = await pool.query(
    `SELECT * FROM (${TXN_BASE_SQL}) t ORDER BY txn_date ASC, sort_key ASC, ref ASC`,
    [companyId, customerId],
  );

  const fromTime = from ? new Date(from).getTime() : null;
  const toTime = to ? new Date(to).getTime() : null;

  let openingBalance = 0;
  const periodRows = [];

  for (const row of all.rows) {
    const d = new Date(row.txn_date).getTime();
    const effect = Number(row.balance_effect || 0);
    if (fromTime != null && d < fromTime) {
      openingBalance += effect;
      continue;
    }
    if (toTime != null && d > toTime) continue;
    periodRows.push(row);
  }

  let running = openingBalance;
  const transactions = periodRows.map((row) => {
    running += Number(row.balance_effect || 0);
    return {
      txn_date: row.txn_date,
      type: row.type,
      ref: row.ref,
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      balance_effect: Number(row.balance_effect || 0),
      running_balance: running,
    };
  });

  const closingBalance = running;
  const arBalance = await getCustomerArBalance(companyId, customerId);

  return {
    customer: {
      ...customer.rows[0],
      balance: arBalance,
    },
    opening_balance: openingBalance,
    closing_balance: closingBalance,
    ar_balance: arBalance,
    transactions,
  };
}

async function getArAging(companyId) {
  const result = await pool.query(
    `SELECT inv.id, inv.invoice_no, c.id AS customer_id, c.name AS customer,
            inv.invoice_date, inv.due_date,
            (inv.total_amount - inv.amount_paid)::numeric AS outstanding,
            GREATEST(0, CURRENT_DATE - inv.due_date)::int AS days_overdue,
            CASE
              WHEN inv.due_date >= CURRENT_DATE THEN 'current'
              WHEN inv.due_date >= CURRENT_DATE - INTERVAL '30 days' THEN 'days_30'
              WHEN inv.due_date >= CURRENT_DATE - INTERVAL '60 days' THEN 'days_60'
              WHEN inv.due_date >= CURRENT_DATE - INTERVAL '90 days' THEN 'days_90'
              ELSE 'days_90_plus'
            END AS bucket
     FROM erp_customer_invoices inv
     JOIN erp_customers c ON c.id = inv.customer_id
     WHERE inv.company_id = $1 AND inv.is_deleted = FALSE
       AND inv.status IN ('posted', 'partial', 'overdue')
       AND inv.total_amount > inv.amount_paid
     ORDER BY inv.due_date ASC, inv.invoice_no`,
    [companyId],
  );

  const summary = {
    current: 0,
    days_30: 0,
    days_60: 0,
    days_90: 0,
    days_90_plus: 0,
    total: 0,
  };
  for (const row of result.rows) {
    const amt = Number(row.outstanding || 0);
    summary[row.bucket] = (summary[row.bucket] || 0) + amt;
    summary.total += amt;
  }

  return { rows: result.rows, summary };
}

async function assertDuplicateCustomer(poolOrClient, companyId, { name, taxId }, excludeId) {
  const db = poolOrClient?.query ? poolOrClient : pool;
  const trimmedName = String(name || '').trim();
  const pin = String(taxId || '').trim().toUpperCase();
  if (!trimmedName || !pin) {
    const err = new Error('Customer name and KRA PIN are required for duplicate check');
    err.code = 'VALIDATION';
    throw err;
  }
  const params = [companyId, trimmedName, pin];
  let exclude = '';
  if (excludeId) {
    params.push(excludeId);
    exclude = ` AND id <> $${params.length}`;
  }
  const dup = await db.query(
    `SELECT id, customer_code FROM erp_customers
     WHERE company_id = $1 AND is_deleted = FALSE
       AND lower(trim(name)) = lower(trim($2))
       AND upper(trim(tax_id)) = $3
       ${exclude}
     LIMIT 1`,
    params,
  );
  if (dup.rowCount) {
    const err = new Error(`Duplicate customer: "${trimmedName}" with this KRA PIN already exists (${dup.rows[0].customer_code})`);
    err.code = 'DUPLICATE_CUSTOMER';
    throw err;
  }
}

async function getCustomerBalanceMap(companyId) {
  const result = await pool.query(
    `SELECT customer_id, COALESCE(SUM(balance_effect), 0)::numeric AS balance
     FROM (
       SELECT customer_id, total_amount AS balance_effect
       FROM erp_customer_invoices
       WHERE company_id = $1 AND status NOT IN ('draft','cancelled') AND is_deleted = FALSE
       UNION ALL
       SELECT customer_id, (0 - total_amount)
       FROM erp_credit_notes
       WHERE company_id = $1 AND status = 'posted' AND is_deleted = FALSE
       UNION ALL
       SELECT customer_id, (0 - amount)
       FROM erp_customer_receipts
       WHERE company_id = $1 AND is_deleted = FALSE AND status = 'posted'
     ) t
     GROUP BY customer_id`,
    [companyId],
  );
  return Object.fromEntries(result.rows.map((r) => [String(r.customer_id), Number(r.balance)]));
}

module.exports = {
  getCustomerStatement,
  getCustomerArBalance,
  getArAging,
  getCustomerBalanceMap,
  assertDuplicateCustomer,
};
