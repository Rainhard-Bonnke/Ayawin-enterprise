const pool = require('../db');

/**
 * Mark posted/partial invoices as overdue when due_date is reached in company timezone.
 * On the due date (from 00:00 local), status becomes overdue on the next sync (default hourly + startup).
 */
async function syncOverdueInvoices(companyId = null) {
  const params = [];
  let companyFilter = '';
  if (companyId) {
    companyFilter = ' AND inv.company_id = $1';
    params.push(companyId);
  }

  const result = await pool.query(
    `UPDATE erp_customer_invoices inv
     SET status = 'overdue', updated_at = NOW()
     FROM erp_companies c
     WHERE inv.company_id = c.id
       AND inv.status IN ('posted', 'partial')
       AND inv.due_date IS NOT NULL
       AND (inv.due_date::date <= (NOW() AT TIME ZONE COALESCE(c.timezone, 'Africa/Nairobi'))::date)
       AND inv.is_deleted = FALSE
       ${companyFilter}
     RETURNING inv.id`,
    params,
  );

  return { updated: result.rowCount };
}

function scheduleOverdueSync() {
  const run = () => syncOverdueInvoices().catch((err) => console.error('[overdue-sync]', err.message));

  run();

  const hours = Number(process.env.OVERDUE_SYNC_HOURS) || 1;
  setInterval(run, hours * 60 * 60 * 1000);

  const tz = process.env.COMPANY_TIMEZONE || 'Africa/Nairobi';
  const scheduleNextMidnight = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    const msUntilMidnight =
      ((23 - hour) * 3600 + (59 - minute) * 60 + 60) * 1000;
    setTimeout(() => {
      run();
      setInterval(run, 24 * 60 * 60 * 1000);
    }, Math.max(msUntilMidnight, 60_000));
  };
  scheduleNextMidnight();
}

module.exports = { syncOverdueInvoices, scheduleOverdueSync };
