require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/db');

(async () => {
  const login = await fetch('http://localhost:4000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@martin.co.ke', password: 'demo' }),
  });
  const loginBody = await login.json();
  const token = loginBody.access_token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  console.log('JWT companyId', payload.companyId, 'sub', payload.sub);

  const u = await pool.query('SELECT id, company_id, email FROM erp_users WHERE id = $1', [payload.sub]);
  console.log('DB user company', u.rows[0]?.company_id);

  const custRes = await fetch('http://localhost:4000/api/v1/master/customers?limit=3', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data: customers } = await custRes.json();
  const itemsRes = await fetch('http://localhost:4000/api/v1/master/items?limit=3', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data: items } = await itemsRes.json();

  for (const c of customers) {
    const row = await pool.query('SELECT company_id FROM erp_customers WHERE id = $1', [c.id]);
    console.log('customer', c.id, 'company', row.rows[0]?.company_id);
  }

  const sales = require('../src/services/salesService');
  try {
    const r = await sales.createCustomerInvoice({
      companyId: u.rows[0].company_id,
      userId: u.rows[0].id,
      customerId: customers[0].id,
      lines: [{ item_id: items[0].id, quantity: 1, unit_price: 500 }],
      invoiceDate: '2026-05-24',
      dueDate: '2026-06-24',
    });
    console.log('direct service', r);
  } catch (e) {
    console.error('direct service ERR', e.message);
  }

  const inv = await fetch('http://localhost:4000/api/v1/sales/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      customer_id: customers[0].id,
      invoice_date: '2026-05-24',
      due_date: '2026-06-24',
      lines: [{ item_id: items[0].id, quantity: 1, unit_price: 500 }],
    }),
  });
  console.log('HTTP', inv.status, await inv.text());

  process.exit(0);
})();
