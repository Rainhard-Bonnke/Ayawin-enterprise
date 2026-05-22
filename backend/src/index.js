const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const pool = require('./db');
const auth = require('./auth');
const { ensureBootstrap, getSchemaStatus } = require('./bootstrap');
const { generateInsight } = require('./intelligence');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const IS_DEMO_MODE = (process.env.ENABLE_DEMO_MODE === 'true') && (process.env.NODE_ENV !== 'production');

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/notifications/email', (req, res) => {
  const recipient = typeof req.body?.recipient === 'string' ? req.body.recipient.trim() : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

  if (!recipient || !subject || !message) {
    return res.status(400).json({ error: 'recipient, subject and message are required' });
  }

  console.log(`[email-trigger] to=${recipient} subject=${subject}`);
  return res.json({ ok: true });
});

app.get('/api/system/bootstrap', async (req, res) => {
  try {
    const status = await getSchemaStatus();
    res.json(status);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to inspect schema' });
  }
});

app.post('/api/intelligence/insight', async (req, res) => {
  const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario : 'dashboard';
  const context = req.body?.context ?? {};

  try {
    const result = await generateInsight({ scenario, context });
    if (!result?.insight || (result.confidence ?? 0) < 0.85) {
      return res.json({ insight: null, confidence: result?.confidence ?? 0 });
    }
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.json({ insight: null, confidence: 0 });
  }
});

app.post('/api/events/track', auth.authenticateToken, async (req, res) => {
  const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
  const entityType = typeof req.body?.entityType === 'string' ? req.body.entityType.trim() : null;
  const entityId = typeof req.body?.entityId === 'string' ? req.body.entityId.trim() : null;
  const details = req.body?.details && typeof req.body.details === 'object' ? req.body.details : {};
  const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario.trim() : '';
  const context = req.body?.context ?? {};

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, action, entityType, entityId, details],
    );

    if (!scenario) {
      return res.json({ ok: true, audited: true, insight: null, confidence: 0 });
    }

    const result = await generateInsight({ scenario, context });
    if (!result?.insight || (result.confidence ?? 0) < 0.85) {
      return res.json({ ok: true, audited: true, insight: null, confidence: result?.confidence ?? 0 });
    }

    return res.json({ ok: true, audited: true, insight: result.insight, confidence: result.confidence });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to track event' });
  }
});

app.get('/api/audit-logs', auth.authenticateToken, auth.authorizeRoles('Admin'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const result = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
              u.full_name AS user_name, u.email AS user_email, u.role AS user_role
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ($1 = '' OR a.action ILIKE '%' || $1 || '%' OR COALESCE(a.entity_type, '') ILIKE '%' || $1 || '%' OR COALESCE(a.entity_id, '') ILIKE '%' || $1 || '%')
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [q, limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

function canUseDemoAuth(email, password) {
  if (!IS_DEMO_MODE) return false;
  const normalized = email.trim().toLowerCase();
  return (
    password === 'demo' &&
    [
      'admin@martin.co.ke',
      'admin@company.local',
      'admin',
      'manager@martin.co.ke',
      'accountant@martin.co.ke',
      'hr@martin.co.ke',
      'store@martin.co.ke',
      'sales@martin.co.ke',
      'warehouse@martin.co.ke',
      'driver@martin.co.ke',
    ].includes(normalized)
  );
}

app.post('/api/auth/login', async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const normalizedEmail = rawEmail.toLowerCase();

  if (!rawEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const lookupValues = normalizedEmail === 'admin@company.local'
      ? [rawEmail, 'admin@martin.co.ke', 'admin']
      : [rawEmail, normalizedEmail];

    const result = await pool.query(
      'SELECT id, username, full_name, email, role, status, password_hash FROM users WHERE email = ANY($1::text[]) OR username = ANY($1::text[]) LIMIT 1',
      [lookupValues],
    );

    if (result.rowCount === 0) {
      if (canUseDemoAuth(rawEmail, password)) {
        const user = auth.createDemoUser(normalizedEmail === 'admin' ? 'admin@martin.co.ke' : rawEmail);
        const token = auth.generateToken(user);
        return res.json({
          token,
          user: {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
          },
          demo: true,
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      if (canUseDemoAuth(rawEmail, password)) {
        const demoUser = auth.createDemoUser(user.email || normalizedEmail || 'admin@martin.co.ke');
        const token = auth.generateToken(demoUser);
        return res.json({
          token,
          user: {
            id: demoUser.id,
            username: demoUser.username,
            full_name: demoUser.full_name,
            email: demoUser.email,
            role: demoUser.role,
          },
          demo: true,
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const verified = await auth.comparePassword(password, user.password_hash);
    if (!verified) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    const token = auth.generateToken(user);
    return res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    if (canUseDemoAuth(rawEmail, password)) {
      const user = auth.createDemoUser(normalizedEmail === 'admin' ? 'admin@martin.co.ke' : rawEmail);
      const token = auth.generateToken(user);
      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
        demo: true,
      });
    }

    return res.status(503).json({ error: 'Authentication service temporarily unavailable' });
  }
});

app.get('/api/auth/me', auth.authenticateToken, (req, res) => {
  return res.json(req.user);
});

app.get('/api/products', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `select id, name, sku, barcode, category, brand, abv, pack_size, litres_per_unit, unit_price,
              cost_price, retail_price, wholesale_price, distributor_price, min_stock, status
       from products
       order by name asc
       limit 200`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/warehouses', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('select id, name, address, manager, phone from warehouses order by name asc');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/inventory/items', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `WITH agg AS (
         SELECT product_id,
                warehouse_id,
                SUM(CASE
                      WHEN movement_type ILIKE 'stock_out%' OR movement_type ILIKE 'sale%' OR movement_type ILIKE 'dispatch%'
                        THEN -quantity
                      ELSE quantity
                    END) AS stock,
                MIN(expiry_date) AS expiry_date
         FROM stock_movements
         GROUP BY product_id, warehouse_id
       )
       SELECT p.id AS product_id,
              p.name,
              p.sku,
              p.barcode,
              p.category,
              p.brand,
              p.abv,
              p.pack_size,
              p.cost_price,
              p.retail_price,
              p.min_stock,
              w.id AS warehouse_id,
              w.name AS warehouse,
              COALESCE(agg.stock, 0) AS stock,
              agg.expiry_date
       FROM products p
       JOIN agg ON agg.product_id = p.id
       JOIN warehouses w ON w.id = agg.warehouse_id
       WHERE p.status = 'active'
       ORDER BY p.name ASC, w.name ASC`,
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

function exciseRateForCategory(category) {
  const rates = {
    Beer: 121.85,
    Spirits: 356.28,
    Wine: 229.85,
    'Soft Drinks': 10.68,
    Juice: 10.68,
    Water: 0,
  };
  return rates[category] ?? 0;
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function nextDocumentNumber(client, table, column, prefix) {
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  const next = Number(result.rows[0]?.count || 0) + 1;
  return `${prefix}-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
}

app.post('/api/sales/product-sale', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager', 'Sales Rep'), async (req, res) => {
  const customerKraPin = typeof req.body?.customer_kra_pin === 'string' ? req.body.customer_kra_pin.trim() : '';
  const warehouseName = typeof req.body?.warehouse === 'string' ? req.body.warehouse.trim() : 'Nairobi Main';
  const discountPercent = Number(req.body?.discount_percent ?? 0);
  const paymentMethod = typeof req.body?.payment_method === 'string' ? req.body.payment_method.trim() : '';
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!customerKraPin || items.length === 0 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return res.status(400).json({ error: 'customer_kra_pin, valid discount_percent and at least one item are required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const customerResult = await client.query(
      'SELECT id, name, kra_pin, credit_limit, balance FROM customers WHERE kra_pin = $1 FOR UPDATE',
      [customerKraPin],
    );
    if (customerResult.rowCount === 0) {
      throw Object.assign(new Error('Customer not found'), { status: 404 });
    }
    const customer = customerResult.rows[0];

    const warehouseResult = await client.query('SELECT id, name FROM warehouses WHERE name = $1', [warehouseName]);
    if (warehouseResult.rowCount === 0) {
      throw Object.assign(new Error('Warehouse not found'), { status: 404 });
    }
    const warehouse = warehouseResult.rows[0];

    const orderNumber = await nextDocumentNumber(client, 'sales_orders', 'order_number', 'SO');
    const invoiceNumber = await nextDocumentNumber(client, 'invoices', 'invoice_number', 'INV');
    const etrNumber = `ETR${Date.now()}`;
    const orderLines = [];

    let subtotal = 0;
    let exciseTotal = 0;

    for (const rawItem of items) {
      const sku = typeof rawItem?.sku === 'string' ? rawItem.sku.trim() : '';
      const quantity = Number(rawItem?.quantity ?? 0);
      const priceTier = typeof rawItem?.price_tier === 'string' ? rawItem.price_tier : 'wholesale';

      if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
        throw Object.assign(new Error('Each item requires sku and positive quantity'), { status: 400 });
      }

      const productResult = await client.query(
        `SELECT id, name, sku, category, litres_per_unit, retail_price, wholesale_price, distributor_price
         FROM products
         WHERE sku = $1 AND status = 'active'
         FOR UPDATE`,
        [sku],
      );
      if (productResult.rowCount === 0) {
        throw Object.assign(new Error(`Product ${sku} not found`), { status: 404 });
      }

      const product = productResult.rows[0];
      const stockResult = await client.query(
        `SELECT COALESCE(SUM(CASE
                  WHEN movement_type ILIKE 'stock_out%' OR movement_type ILIKE 'sale%' OR movement_type ILIKE 'dispatch%'
                    THEN -quantity
                  ELSE quantity
                END), 0) AS stock
         FROM stock_movements
         WHERE product_id = $1 AND warehouse_id = $2`,
        [product.id, warehouse.id],
      );
      const available = Number(stockResult.rows[0]?.stock || 0);
      if (available < quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${product.name}: ${available} available`), { status: 409 });
      }

      const unitPrice = Number(
        priceTier === 'retail'
          ? product.retail_price
          : priceTier === 'distributor'
            ? product.distributor_price
            : product.wholesale_price,
      );
      const lineSubtotal = money(unitPrice * quantity * (1 - discountPercent / 100));
      const lineExcise = money(Number(product.litres_per_unit || 0) * quantity * exciseRateForCategory(product.category));

      subtotal = money(subtotal + lineSubtotal);
      exciseTotal = money(exciseTotal + lineExcise);
      orderLines.push({ product, quantity, unitPrice, lineSubtotal, lineExcise });
    }

    const vatTotal = money((subtotal + exciseTotal) * 0.16);
    const total = money(subtotal + exciseTotal + vatTotal);
    const projectedBalance = Number(customer.balance || 0) + total;

    if (Number(customer.credit_limit || 0) > 0 && projectedBalance > Number(customer.credit_limit)) {
      throw Object.assign(new Error('Customer credit limit would be exceeded by this sale'), { status: 409 });
    }

    const actorId = req.user.id && Number(req.user.id) > 0 ? req.user.id : null;
    const orderResult = await client.query(
      `INSERT INTO sales_orders (order_number, customer_id, sales_rep_id, warehouse_id, status, order_date, total_amount, due_date, discount_amount, notes)
       VALUES ($1, $2, $3, $4, 'Invoiced', NOW(), $5, NOW() + INTERVAL '30 days', $6, $7)
       RETURNING id, order_number`,
      [orderNumber, customer.id, actorId, warehouse.id, total, money(subtotal * discountPercent / 100), 'Automated sale workflow'],
    );
    const order = orderResult.rows[0];

    for (const line of orderLines) {
      await client.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, line.product.id, line.quantity, line.unitPrice, line.lineSubtotal],
      );
      await client.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_no, batch_no, expiry_date)
         VALUES ($1, $2, 'stock_out_sale', $3, $4, $5, NULL)`,
        [line.product.id, warehouse.id, line.quantity, order.order_number, `SALE-${order.order_number}`],
      );
    }

    const invoiceResult = await client.query(
      `INSERT INTO invoices (invoice_number, sales_order_id, customer_id, invoice_date, due_date, etr_number, kra_pin, subtotal, excise_amount, vat_amount, total_amount, status)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, invoice_number, etr_number, total_amount`,
      [invoiceNumber, order.id, customer.id, etrNumber, customer.kra_pin, subtotal, exciseTotal, vatTotal, total, paymentMethod ? 'Paid' : 'Sent'],
    );
    const invoice = invoiceResult.rows[0];

    for (const line of orderLines) {
      const lineVat = money((line.lineSubtotal + line.lineExcise) * 0.16);
      await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, excise_amount, vat_amount, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoice.id, line.product.id, line.product.name, line.quantity, line.unitPrice, line.lineExcise, lineVat, money(line.lineSubtotal + line.lineExcise + lineVat)],
      );
    }

    if (paymentMethod) {
      await client.query(
        `INSERT INTO payments (invoice_id, customer_id, payment_date, amount, method, reference_no, status)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'Posted')`,
        [invoice.id, customer.id, total, paymentMethod, `PAY-${invoice.invoice_number}`],
      );
    } else {
      await client.query('UPDATE customers SET balance = balance + $1 WHERE id = $2', [total, customer.id]);
    }

    const accounts = await client.query(
      `SELECT id, account_code FROM accounts WHERE account_code = ANY($1::text[])`,
      [['1100', '1200', '2200', '2300', '4000']],
    );
    const accountMap = Object.fromEntries(accounts.rows.map((row) => [row.account_code, row.id]));
    const debitAccount = paymentMethod ? accountMap['1100'] : accountMap['1200'];
    const entries = [
      [debitAccount, `Invoice ${invoice.invoice_number}`, total, 0],
      [accountMap['4000'], `Sales revenue ${invoice.invoice_number}`, 0, subtotal],
      [accountMap['2300'], `Excise duty payable ${invoice.invoice_number}`, 0, exciseTotal],
      [accountMap['2200'], `VAT output ${invoice.invoice_number}`, 0, vatTotal],
    ].filter(([accountId]) => accountId);

    for (const [accountId, description, debit, credit] of entries) {
      await client.query(
        `INSERT INTO journal_entries (entry_date, reference_no, account_id, description, debit, credit)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)`,
        [invoice.invoice_number, accountId, description, debit, credit],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'product_sale_workflow_completed', 'sales_order', $2, $3)`,
      [actorId, order.order_number, { invoice: invoice.invoice_number, total, payment_method: paymentMethod || null }],
    );

    await client.query('COMMIT');

    return res.status(201).json({
      order_number: order.order_number,
      invoice_number: invoice.invoice_number,
      etr_number: invoice.etr_number,
      subtotal,
      excise: exciseTotal,
      vat: vatTotal,
      total,
      paid: Boolean(paymentMethod),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return res.status(status).json({ error: err.message || 'Unable to complete sale workflow' });
  } finally {
    client.release();
  }
});

app.get('/api/sales/orders', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT so.order_number AS id,
              so.order_date::date AS date,
              c.name AS customer,
              COALESCE(u.full_name, 'Unassigned') AS rep,
              COUNT(soi.id)::int AS items,
              so.total_amount AS total,
              so.status
       FROM sales_orders so
       LEFT JOIN customers c ON c.id = so.customer_id
       LEFT JOIN users u ON u.id = so.sales_rep_id
       LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id
       GROUP BY so.id, so.order_number, so.order_date, c.name, u.full_name, so.total_amount, so.status
       ORDER BY so.order_date DESC
       LIMIT 100`,
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load sales orders' });
  }
});

function normalizePoStatus(status) {
  const allowed = new Set(['Draft', 'Approved', 'Sent', 'Received', 'Invoiced', 'Cancelled']);
  if (!status) return 'Draft';
  const trimmed = String(status).trim();
  return allowed.has(trimmed) ? trimmed : 'Draft';
}

async function stockOnHand(client, productId, warehouseId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(CASE
              WHEN movement_type ILIKE 'stock_out%' OR movement_type ILIKE 'sale%' OR movement_type ILIKE 'dispatch%'
                THEN -quantity
              ELSE quantity
            END), 0) AS stock
     FROM stock_movements
     WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, warehouseId],
  );
  return Number(result.rows[0]?.stock || 0);
}

app.get('/api/procurement/purchase-orders', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT po.id,
              po.po_number AS id_display,
              po.order_date,
              po.status,
              po.total_amount,
              s.name AS supplier,
              w.name AS warehouse,
              COALESCE(COUNT(poi.id), 0)::int AS items
       FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       LEFT JOIN warehouses w ON w.id = po.warehouse_id
       LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
       GROUP BY po.id, po.po_number, po.order_date, po.status, po.total_amount, s.name, w.name
       ORDER BY po.order_date DESC, po.id DESC
       LIMIT 200`,
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id_display,
        internal_id: row.id,
        date: row.order_date,
        supplier: row.supplier || 'Unknown supplier',
        warehouse: row.warehouse || 'Unknown warehouse',
        items: row.items,
        total: Number(row.total_amount || 0),
        status: row.status,
      })),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load purchase orders' });
  }
});

app.post('/api/procurement/purchase-orders', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager', 'Store Manager', 'Warehouse', 'Accountant'), async (req, res) => {
  const supplierId = Number(req.body?.supplier_id);
  const warehouseId = Number(req.body?.warehouse_id);
  const status = normalizePoStatus(req.body?.status);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!Number.isFinite(supplierId) || !Number.isFinite(warehouseId) || items.length === 0) {
    return res.status(400).json({ error: 'supplier_id, warehouse_id and at least one item are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplier = await client.query('SELECT id, name FROM suppliers WHERE id = $1', [supplierId]);
    if (supplier.rowCount === 0) throw Object.assign(new Error('Supplier not found'), { status: 404 });

    const warehouse = await client.query('SELECT id, name FROM warehouses WHERE id = $1', [warehouseId]);
    if (warehouse.rowCount === 0) throw Object.assign(new Error('Warehouse not found'), { status: 404 });

    const poNumber = await nextDocumentNumber(client, 'purchase_orders', 'po_number', 'PO');

    let totalAmount = 0;
    const resolvedItems = [];
    for (const rawItem of items) {
      const sku = typeof rawItem?.sku === 'string' ? rawItem.sku.trim() : '';
      const quantity = Number(rawItem?.quantity ?? 0);
      const unitCost = Number(rawItem?.unit_cost ?? 0);
      if (!sku || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost <= 0) {
        throw Object.assign(new Error('Each item requires sku, positive quantity, and positive unit_cost'), { status: 400 });
      }
      const product = await client.query('SELECT id, name, sku FROM products WHERE sku = $1 LIMIT 1', [sku]);
      if (product.rowCount === 0) throw Object.assign(new Error(`Product ${sku} not found`), { status: 404 });
      const lineTotal = money(quantity * unitCost);
      totalAmount = money(totalAmount + lineTotal);
      resolvedItems.push({ product_id: product.rows[0].id, sku, quantity, unit_cost: unitCost, line_total: lineTotal });
    }

    const po = await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, warehouse_id, status, order_date, expected_date, total_amount, credit_limit)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', $5, 0)
       RETURNING id, po_number, status, order_date, total_amount`,
      [poNumber, supplierId, warehouseId, status, totalAmount],
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [po.rows[0].id, item.product_id, item.quantity, item.unit_cost, item.line_total],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'purchase_order_created', 'purchase_order', $2, $3)`,
      [req.user.id || null, poNumber, { supplier_id: supplierId, warehouse_id: warehouseId, total: totalAmount, status }],
    );

    await client.query('COMMIT');
    res.status(201).json({ id: po.rows[0].po_number, status: po.rows[0].status, total: Number(po.rows[0].total_amount || 0) });
  } catch (err) {
    await client.query('ROLLBACK');
    const statusCode = err.status || 500;
    if (statusCode >= 500) console.error(err);
    res.status(statusCode).json({ error: err.message || 'Unable to create purchase order' });
  } finally {
    client.release();
  }
});

app.patch('/api/procurement/purchase-orders/:id', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager', 'Store Manager', 'Warehouse', 'Accountant'), async (req, res) => {
  const id = Number(req.params.id);
  const status = normalizePoStatus(req.body?.status);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid purchase order id' });

  try {
    const current = await pool.query('SELECT id, po_number, status FROM purchase_orders WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Purchase order not found' });

    const updated = await pool.query(
      `UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING id, po_number, status`,
      [status, id],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'purchase_order_status_updated', 'purchase_order', $2, $3)`,
      [req.user.id || null, updated.rows[0].po_number, { from: current.rows[0].status, to: status }],
    );

    res.json({ ok: true, id: updated.rows[0].po_number, status: updated.rows[0].status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to update purchase order' });
  }
});

app.post('/api/procurement/purchase-orders/:id/receive', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager', 'Store Manager', 'Warehouse'), async (req, res) => {
  const id = Number(req.params.id);
  const receivedBy = typeof req.body?.received_by === 'string' ? req.body.received_by.trim() : (req.user?.full_name || 'System');
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid purchase order id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const po = await client.query(
      `SELECT id, po_number, supplier_id, warehouse_id, status
       FROM purchase_orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    if (po.rowCount === 0) throw Object.assign(new Error('Purchase order not found'), { status: 404 });

    const poRow = po.rows[0];
    if (poRow.status === 'Received') {
      throw Object.assign(new Error('Purchase order already received'), { status: 409 });
    }

    const grnNumber = await nextDocumentNumber(client, 'grns', 'grn_number', 'GRN');
    await client.query(
      `INSERT INTO grns (grn_number, purchase_order_id, supplier_id, received_date, received_by, status)
       VALUES ($1, $2, $3, CURRENT_DATE, $4, 'Received')`,
      [grnNumber, poRow.id, poRow.supplier_id, receivedBy],
    );

    const items = await client.query(
      `SELECT poi.product_id, poi.quantity, p.sku
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       WHERE poi.purchase_order_id = $1`,
      [poRow.id],
    );

    for (const item of items.rows) {
      await client.query(
        `INSERT INTO stock_movements (product_id, warehouse_id, movement_type, quantity, reference_no, batch_no, expiry_date)
         VALUES ($1, $2, 'stock_in_purchase', $3, $4, $5, NULL)`,
        [item.product_id, poRow.warehouse_id, Number(item.quantity), grnNumber, `PO-${poRow.po_number}`],
      );
    }

    await client.query(`UPDATE purchase_orders SET status = 'Received' WHERE id = $1`, [poRow.id]);

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'purchase_order_received', 'purchase_order', $2, $3)`,
      [req.user.id || null, poRow.po_number, { grn_number: grnNumber, items: items.rowCount }],
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, grn_number: grnNumber, po_number: poRow.po_number, received_items: items.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    const statusCode = err.status || 500;
    if (statusCode >= 500) console.error(err);
    res.status(statusCode).json({ error: err.message || 'Unable to receive purchase order' });
  } finally {
    client.release();
  }
});

app.get('/api/dashboard/summary', auth.authenticateToken, async (req, res) => {
  try {
    const [
      kpis,
      monthlyRevenue,
      topProducts,
      salesByCategory,
      lowStock,
      recentTransactions,
    ] = await Promise.all([
      pool.query(
        `SELECT
          COALESCE((SELECT SUM(total_amount) FROM sales_orders WHERE order_date::date = CURRENT_DATE), 0) AS todays_sales,
          COALESCE((SELECT SUM(total_amount) FROM invoices WHERE date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)), 0) AS revenue_mtd,
          COALESCE((SELECT COUNT(*) FROM sales_orders WHERE status IN ('Draft', 'Confirmed', 'Dispatched')), 0) AS pending_orders,
          COALESCE((SELECT COUNT(*) FROM invoices WHERE status = 'Overdue'), 0) AS outstanding_invoices`,
      ),
      pool.query(
        `SELECT to_char(invoice_date, 'Mon') AS month, SUM(total_amount)::numeric AS revenue
         FROM invoices
         WHERE invoice_date >= CURRENT_DATE - INTERVAL '6 months'
         GROUP BY date_trunc('month', invoice_date), to_char(invoice_date, 'Mon')
         ORDER BY date_trunc('month', invoice_date)`,
      ),
      pool.query(
        `SELECT p.name, SUM(ii.quantity)::numeric AS units
         FROM invoice_items ii
         JOIN products p ON p.id = ii.product_id
         GROUP BY p.name
         ORDER BY units DESC
         LIMIT 10`,
      ),
      pool.query(
        `SELECT p.category AS name, SUM(ii.line_total)::numeric AS value
         FROM invoice_items ii
         JOIN products p ON p.id = ii.product_id
         GROUP BY p.category
         ORDER BY value DESC`,
      ),
      pool.query(
        `WITH stock AS (
           SELECT p.id, p.name, p.min_stock,
             COALESCE(SUM(CASE WHEN sm.movement_type ILIKE 'stock_out%' OR sm.movement_type ILIKE 'sale%' OR sm.movement_type ILIKE 'dispatch%' THEN -sm.quantity ELSE sm.quantity END), 0) AS qty
           FROM products p
           LEFT JOIN stock_movements sm ON sm.product_id = p.id
           GROUP BY p.id, p.name, p.min_stock
         )
         SELECT name, qty, min_stock FROM stock WHERE qty < min_stock ORDER BY qty ASC LIMIT 8`,
      ),
      pool.query(
        `SELECT so.order_number AS id, so.order_date::date AS date, c.name AS customer, u.full_name AS rep, so.total_amount AS total, so.status
         FROM sales_orders so
         LEFT JOIN customers c ON c.id = so.customer_id
         LEFT JOIN users u ON u.id = so.sales_rep_id
         ORDER BY so.order_date DESC
         LIMIT 8`,
      ),
    ]);

    res.json({
      kpis: kpis.rows[0],
      monthlyRevenue: monthlyRevenue.rows,
      topProducts: topProducts.rows,
      salesByCategory: salesByCategory.rows,
      alerts: lowStock.rows.map((row) => ({
        type: 'stock',
        severity: 'high',
        message: `${row.name} below minimum (${Number(row.qty)} / ${Number(row.min_stock)})`,
      })),
      recentTransactions: recentTransactions.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to load dashboard summary' });
  }
});

app.get('/api/customers', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `select id, name, kra_pin, contact, email, address, location, type, segment, credit_limit, payment_terms, balance
       from customers
       order by name asc
       limit 100`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/customers', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const kraPin = typeof req.body?.kra_pin === 'string' ? req.body.kra_pin.trim() : '';
  const contact = typeof req.body?.contact === 'string' ? req.body.contact.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  const location = typeof req.body?.location === 'string' ? req.body.location.trim() : '';
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  const segment = typeof req.body?.segment === 'string' ? req.body.segment.trim() : type;
  const paymentTerms = typeof req.body?.payment_terms === 'string' ? req.body.payment_terms.trim() : '';
  const creditLimit = Number(req.body?.credit_limit ?? 0);
  const balance = Number(req.body?.balance ?? 0);

  if (!name || !kraPin) {
    return res.status(400).json({ error: 'name and kra_pin are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (name, kra_pin, contact, email, address, location, type, segment, credit_limit, payment_terms, balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, name, kra_pin, contact, email, address, location, type, segment, credit_limit, payment_terms, balance`,
      [name, kraPin, contact || null, email || null, address || null, location || null, type || null, segment || null, creditLimit, paymentTerms || null, balance],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'customer_created', 'customer', String(result.rows[0].id), { name, kra_pin: kraPin, segment: segment || null }],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Customer KRA PIN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.patch('/api/customers/:id', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  const fields = [];
  const values = [];
  const pushField = (column, value) => {
    fields.push(`${column} = $${values.length + 1}`);
    values.push(value);
  };

  const maybeString = (value) => (typeof value === 'string' ? value.trim() : undefined);

  const name = maybeString(req.body?.name);
  const kraPin = maybeString(req.body?.kra_pin);
  const contact = maybeString(req.body?.contact);
  const email = maybeString(req.body?.email);
  const address = maybeString(req.body?.address);
  const location = maybeString(req.body?.location);
  const type = maybeString(req.body?.type);
  const segment = maybeString(req.body?.segment);
  const paymentTerms = maybeString(req.body?.payment_terms);
  const creditLimit = req.body?.credit_limit !== undefined ? Number(req.body.credit_limit) : undefined;
  const balance = req.body?.balance !== undefined ? Number(req.body.balance) : undefined;

  if (name !== undefined) pushField('name', name);
  if (kraPin !== undefined) pushField('kra_pin', kraPin);
  if (contact !== undefined) pushField('contact', contact || null);
  if (email !== undefined) pushField('email', email || null);
  if (address !== undefined) pushField('address', address || null);
  if (location !== undefined) pushField('location', location || null);
  if (type !== undefined) pushField('type', type || null);
  if (segment !== undefined) pushField('segment', segment || null);
  if (paymentTerms !== undefined) pushField('payment_terms', paymentTerms || null);
  if (creditLimit !== undefined && Number.isFinite(creditLimit)) pushField('credit_limit', creditLimit);
  if (balance !== undefined && Number.isFinite(balance)) pushField('balance', balance);

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No customer fields to update' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE customers
       SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, kra_pin, contact, email, address, location, type, segment, credit_limit, payment_terms, balance`,
      values,
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'customer_updated', 'customer', String(id), { name: result.rows[0].name, kra_pin: result.rows[0].kra_pin }],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Customer KRA PIN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/customers/:id', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  try {
    const existing = await pool.query('SELECT id, name, kra_pin FROM customers WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await pool.query('DELETE FROM customers WHERE id = $1', [id]);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'customer_deleted', 'customer', String(id), { name: existing.rows[0].name, kra_pin: existing.rows[0].kra_pin }],
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/suppliers', auth.authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `select id, name, kra_pin, contact, email, phone, payment_terms, credit_limit, balance
       from suppliers
       order by name asc
       limit 100`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/suppliers', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const kraPin = typeof req.body?.kra_pin === 'string' ? req.body.kra_pin.trim() : '';
  const contact = typeof req.body?.contact === 'string' ? req.body.contact.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const paymentTerms = typeof req.body?.payment_terms === 'string' ? req.body.payment_terms.trim() : '';
  const creditLimit = Number(req.body?.credit_limit ?? 0);
  const balance = Number(req.body?.balance ?? 0);

  if (!name || !kraPin) {
    return res.status(400).json({ error: 'name and kra_pin are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO suppliers (name, kra_pin, contact, email, phone, payment_terms, credit_limit, balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, kra_pin, contact, email, phone, payment_terms, credit_limit, balance`,
      [name, kraPin, contact || null, email || null, phone || null, paymentTerms || null, creditLimit, balance],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'supplier_created', 'supplier', String(result.rows[0].id), { name, kra_pin: kraPin }],
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Supplier KRA PIN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.patch('/api/suppliers/:id', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid supplier id' });
  }

  const fields = [];
  const values = [];
  const pushField = (column, value) => {
    fields.push(`${column} = $${values.length + 1}`);
    values.push(value);
  };

  const maybeString = (value) => (typeof value === 'string' ? value.trim() : undefined);

  const name = maybeString(req.body?.name);
  const kraPin = maybeString(req.body?.kra_pin);
  const contact = maybeString(req.body?.contact);
  const email = maybeString(req.body?.email);
  const phone = maybeString(req.body?.phone);
  const paymentTerms = maybeString(req.body?.payment_terms);
  const creditLimit = req.body?.credit_limit !== undefined ? Number(req.body.credit_limit) : undefined;
  const balance = req.body?.balance !== undefined ? Number(req.body.balance) : undefined;

  if (name !== undefined) pushField('name', name);
  if (kraPin !== undefined) pushField('kra_pin', kraPin);
  if (contact !== undefined) pushField('contact', contact || null);
  if (email !== undefined) pushField('email', email || null);
  if (phone !== undefined) pushField('phone', phone || null);
  if (paymentTerms !== undefined) pushField('payment_terms', paymentTerms || null);
  if (creditLimit !== undefined && Number.isFinite(creditLimit)) pushField('credit_limit', creditLimit);
  if (balance !== undefined && Number.isFinite(balance)) pushField('balance', balance);

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No supplier fields to update' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE suppliers
       SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, name, kra_pin, contact, email, phone, payment_terms, credit_limit, balance`,
      values,
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'supplier_updated', 'supplier', String(id), { name: result.rows[0].name, kra_pin: result.rows[0].kra_pin }],
    );

    return res.json(result.rows[0]);
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Supplier KRA PIN already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/api/suppliers/:id', auth.authenticateToken, auth.authorizeRoles('Admin', 'Manager'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid supplier id' });
  }

  try {
    const existing = await pool.query('SELECT id, name, kra_pin FROM suppliers WHERE id = $1', [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'supplier_deleted', 'supplier', String(id), { name: existing.rows[0].name, kra_pin: existing.rows[0].kra_pin }],
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/users', auth.authenticateToken, auth.authorizeRoles('Admin'), async (req, res) => {
  try {
    const result = await pool.query('select id, username, full_name, email, role, status, phone, two_factor_enabled, last_login from users order by id limit 100');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/users', auth.authenticateToken, auth.authorizeRoles('Admin'), async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : 'Sales Rep';
  const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : null;

  if (!username || !fullName || !email) {
    return res.status(400).json({ error: 'username, full_name and email are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (username, full_name, email, role, status, phone, two_factor_enabled)
       VALUES ($1, $2, $3, $4, 'active', $5, false)
       RETURNING id, username, full_name, email, role, status, phone, two_factor_enabled`,
      [username, fullName, email, role, phone],
    );
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'user_created', 'user', String(result.rows[0].id), { username, email, role }],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.patch('/api/users/:id', auth.authenticateToken, auth.authorizeRoles('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : null;
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : null;
  const twoFactorEnabled = typeof req.body?.two_factor_enabled === 'boolean' ? req.body.two_factor_enabled : null;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  try {
    const current = await pool.query('SELECT id, username, full_name, email, role, status, phone, two_factor_enabled FROM users WHERE id = $1', [id]);
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const nextStatus = status || current.rows[0].status;
    const nextRole = role || current.rows[0].role;
    const nextTwoFactor = twoFactorEnabled ?? current.rows[0].two_factor_enabled;

    const result = await pool.query(
      `UPDATE users
       SET status = $1, role = $2, two_factor_enabled = $3
       WHERE id = $4
       RETURNING id, username, full_name, email, role, status, phone, two_factor_enabled`,
      [nextStatus, nextRole, nextTwoFactor, id],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'user_updated', 'user', String(id), { status: nextStatus, role: nextRole, two_factor_enabled: nextTwoFactor }],
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

const port = process.env.PORT || 4000;

async function start() {
  try {
    try {
      await ensureBootstrap();
      await auth.ensureDefaultAdmin();
    } catch (seedErr) {
      console.warn('Running without database seed. Demo sign-in will still work.', seedErr.message);
    }
    app.listen(port, () => console.log(`Server listening on ${port}`));
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

start();
