-- Module 5 seed: CRM + sales flow

INSERT INTO erp_leads (company_id, lead_no, company_name, contact_name, email, status, estimated_value)
SELECT c.id, v.no, v.name, v.contact, v.email, v.status, v.val
FROM erp_companies c
CROSS JOIN (VALUES
  ('LD-001', 'Westlands Spirits Hub', 'James Kariuki', 'james@wsh.co.ke', 'qualified', 250000),
  ('LD-002', 'Coast Retail Group', 'Amina Hassan', 'amina@crg.co.ke', 'contacted', 800000)
) AS v(no, name, contact, email, status, val)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_leads l WHERE l.company_id = c.id AND l.lead_no = v.no);

INSERT INTO erp_opportunities (company_id, customer_id, opportunity_no, name, stage, probability, amount)
SELECT c.id, cu.id, 'OPP-001', 'Naivas Q2 Supply', 'proposal', 60, 890000
FROM erp_companies c
JOIN erp_customers cu ON cu.company_id = c.id AND cu.customer_code = 'C002'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_opportunities o WHERE o.company_id = c.id AND o.opportunity_no = 'OPP-001');

-- Quotation
INSERT INTO erp_quotations (company_id, customer_id, quote_no, quote_date, valid_until, status, subtotal, tax_amount, total_amount)
SELECT c.id, cu.id, 'QT-2026-0001', '2026-05-18'::date, '2026-06-18'::date, 'accepted', 184500, 29520, 214020
FROM erp_companies c
JOIN erp_customers cu ON cu.company_id = c.id AND cu.customer_code = 'C001'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_quotations q WHERE q.company_id = c.id AND q.quote_no = 'QT-2026-0001');

INSERT INTO erp_quotation_lines (company_id, quotation_id, line_no, item_id, quantity, unit_price, line_total)
SELECT c.id, q.id, 1, i.id, 600, 250, 150000
FROM erp_companies c
JOIN erp_quotations q ON q.company_id = c.id AND q.quote_no = 'QT-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_quotation_lines ql WHERE ql.quotation_id = q.id);

-- Confirmed sales order
INSERT INTO erp_sales_orders (
  company_id, customer_id, quotation_id, warehouse_id, order_no, order_date, status,
  subtotal, tax_amount, total_amount, credit_check_passed
)
SELECT c.id, cu.id, q.id, w.id, 'SO-2026-0001', '2026-05-20'::date, 'confirmed',
       150000, 24000, 174000, TRUE
FROM erp_companies c
JOIN erp_customers cu ON cu.company_id = c.id AND cu.customer_code = 'C001'
JOIN erp_quotations q ON q.company_id = c.id AND q.quote_no = 'QT-2026-0001'
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_sales_orders so WHERE so.company_id = c.id AND so.order_no = 'SO-2026-0001');

INSERT INTO erp_sales_order_lines (company_id, sales_order_id, line_no, item_id, quantity, unit_price, line_total)
SELECT c.id, so.id, 1, i.id, 600, 250, 150000
FROM erp_companies c
JOIN erp_sales_orders so ON so.company_id = c.id AND so.order_no = 'SO-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_sales_order_lines sol WHERE sol.sales_order_id = so.id);

-- Posted delivery (partial 400 units)
INSERT INTO erp_delivery_notes (company_id, sales_order_id, warehouse_id, delivery_no, delivery_date, status, posted_at)
SELECT c.id, so.id, w.id, 'DN-2026-0001', '2026-05-21'::date, 'posted', NOW()
FROM erp_companies c
JOIN erp_sales_orders so ON so.company_id = c.id AND so.order_no = 'SO-2026-0001'
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_delivery_notes d WHERE d.company_id = c.id AND d.delivery_no = 'DN-2026-0001');

INSERT INTO erp_delivery_note_lines (company_id, delivery_note_id, so_line_id, line_no, item_id, quantity, unit_cost)
SELECT c.id, dn.id, sol.id, 1, i.id, 400, 178
FROM erp_companies c
JOIN erp_delivery_notes dn ON dn.company_id = c.id AND dn.delivery_no = 'DN-2026-0001'
JOIN erp_sales_orders so ON so.id = dn.sales_order_id
JOIN erp_sales_order_lines sol ON sol.sales_order_id = so.id AND sol.line_no = 1
JOIN erp_items i ON i.id = sol.item_id
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_delivery_note_lines dl WHERE dl.delivery_note_id = dn.id);

UPDATE erp_sales_order_lines sol SET qty_delivered = 400
FROM erp_sales_orders so
JOIN erp_companies c ON c.id = so.company_id AND c.code = 'MARTIN'
WHERE sol.sales_order_id = so.id AND so.order_no = 'SO-2026-0001';

-- Stock issue for delivery
INSERT INTO erp_stock_ledger (company_id, warehouse_id, item_id, movement_type, quantity, unit_cost, reference_type, reference_id, movement_date)
SELECT c.id, dn.warehouse_id, i.id, 'sale', -400, 178, 'delivery_note', dn.id, '2026-05-21'::timestamptz
FROM erp_companies c
JOIN erp_delivery_notes dn ON dn.company_id = c.id AND dn.delivery_no = 'DN-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_stock_ledger sl WHERE sl.reference_type = 'delivery_note' AND sl.reference_id = dn.id);

UPDATE erp_stock_on_hand s SET quantity = quantity - 400, last_movement_at = NOW()
FROM erp_companies c
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE s.warehouse_id = w.id AND s.item_id = i.id AND c.code = 'MARTIN';

-- Posted customer invoice
INSERT INTO erp_customer_invoices (
  company_id, customer_id, sales_order_id, delivery_note_id, invoice_no, invoice_date, due_date,
  status, subtotal, tax_amount, total_amount, posted_at
)
SELECT c.id, cu.id, so.id, dn.id, 'INV-2026-0001', '2026-05-21'::date, '2026-06-20'::date,
       'posted', 100000, 16000, 116000, NOW()
FROM erp_companies c
JOIN erp_customers cu ON cu.company_id = c.id AND cu.customer_code = 'C001'
JOIN erp_sales_orders so ON so.company_id = c.id AND so.order_no = 'SO-2026-0001'
JOIN erp_delivery_notes dn ON dn.sales_order_id = so.id AND dn.delivery_no = 'DN-2026-0001'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_customer_invoices inv WHERE inv.company_id = c.id AND inv.invoice_no = 'INV-2026-0001');

INSERT INTO erp_customer_invoice_lines (company_id, invoice_id, line_no, item_id, quantity, unit_price, tax_amount, line_total)
SELECT c.id, inv.id, 1, i.id, 400, 250, 16000, 100000
FROM erp_companies c
JOIN erp_customer_invoices inv ON inv.company_id = c.id AND inv.invoice_no = 'INV-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_customer_invoice_lines il WHERE il.invoice_id = inv.id);

UPDATE erp_sales_order_lines sol SET qty_invoiced = 400
FROM erp_sales_orders so
JOIN erp_companies c ON c.id = so.company_id AND c.code = 'MARTIN'
WHERE sol.sales_order_id = so.id AND so.order_no = 'SO-2026-0001';
