require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../src/db');
const sales = require('../src/services/salesService');
const gl = require('../src/services/glPostingService');

(async () => {
  const u = await pool.query(
    "SELECT u.id, u.company_id FROM erp_users u WHERE u.email = 'admin@martin.co.ke' LIMIT 1",
  );
  const companyId = u.rows[0].company_id;
  const userId = u.rows[0].id;
  const c = await pool.query('SELECT id FROM erp_customers WHERE company_id = $1 LIMIT 1', [companyId]);
  const i = await pool.query('SELECT id FROM erp_items WHERE company_id = $1 LIMIT 1', [companyId]);

  // Step 1: create draft only
  const client = await pool.connect();
  let invId;
  try {
    await client.query('BEGIN');
    const invResult = await client.query(
      `INSERT INTO erp_customer_invoices (
         company_id, customer_id, invoice_no, invoice_date, due_date,
         status, subtotal, tax_amount, total_amount, created_by
       ) VALUES ($1,$2,'INV-DEBUG-1',CURRENT_DATE,CURRENT_DATE + 30,'draft',2000,320,2320,$3) RETURNING id`,
      [companyId, c.rows[0].id, userId],
    );
    invId = invResult.rows[0].id;
    await client.query(
      `INSERT INTO erp_customer_invoice_lines (company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total, created_by)
       VALUES ($1,$2,1,$3,2,1000,320,2000,$4)`,
      [companyId, invId, i.rows[0].id, userId],
    );
    await client.query('COMMIT');
    console.log('draft created', invId);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('draft failed', e.message);
    process.exit(1);
  } finally {
    client.release();
  }

  // Step 2: post invoice only
  try {
    const r = await sales.postCustomerInvoice({ companyId, userId, invoiceId: invId, postGl: false });
    console.log('post invoice ok', r);
  } catch (e) {
    console.error('post invoice failed', e.message);
  }

  // Step 3: GL only
  try {
    const accounts = await pool.query(
      `SELECT id, account_code FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code IN ('1200','4000','2200')`,
      [companyId],
    );
    const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
    const journal = await gl.createJournal({
      companyId,
      userId,
      entryDate: new Date(),
      journalType: 'sales',
      referenceNo: 'TEST',
      description: 'test',
      lines: [
        { account_id: byCode['1200'], debit: 100, credit: 0 },
        { account_id: byCode['4000'], debit: 0, credit: 100 },
      ],
    });
    console.log('journal created', journal.id);
    await gl.postJournal({ journalId: journal.id, companyId, userId });
    console.log('journal posted ok');
  } catch (e) {
    console.error('GL failed', e.message);
    console.error(e.stack);
  }

  process.exit(0);
})();
