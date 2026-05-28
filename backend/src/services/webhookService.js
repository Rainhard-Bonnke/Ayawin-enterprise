const crypto = require('crypto');
const pool = require('../db');

const EVENTS = [
  'invoice.posted',
  'purchase_order.approved',
  'goods_receipt.posted',
  'sales_order.confirmed',
  'payroll.posted',
  'stock.low',
];

async function emitEvent({ companyId, eventType, payload }) {
  const subs = await pool.query(
    `SELECT * FROM erp_webhook_subscriptions
     WHERE company_id = $1 AND is_active = TRUE AND is_deleted = FALSE
       AND $2 = ANY(events)`,
    [companyId, eventType],
  );

  const results = [];
  for (const sub of subs.rows) {
    const body = JSON.stringify({ event: eventType, company_id: companyId, data: payload, ts: new Date().toISOString() });
    const signature = sub.secret
      ? crypto.createHmac('sha256', sub.secret).update(body).digest('hex')
      : null;

    let success = false;
    let responseStatus = null;
    let responseBody = null;

    try {
      if (typeof fetch === 'function' && sub.url.startsWith('http')) {
        const resp = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(signature ? { 'X-ERP-Signature': signature } : {}),
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        responseStatus = resp.status;
        responseBody = (await resp.text()).slice(0, 2000);
        success = resp.ok;
      } else {
        console.log(`[webhook] ${eventType} -> ${sub.url}`);
        success = true;
        responseStatus = 200;
        responseBody = 'logged locally';
      }
    } catch (err) {
      responseBody = err.message;
    }

    await pool.query(
      `INSERT INTO erp_webhook_deliveries (company_id, subscription_id, event_type, payload, response_status, response_body, success)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [companyId, sub.id, eventType, payload, responseStatus, responseBody, success],
    );
    results.push({ subscription_id: sub.id, success });
  }

  return { event: eventType, delivered: results.length, results };
}

module.exports = { emitEvent, EVENTS };
