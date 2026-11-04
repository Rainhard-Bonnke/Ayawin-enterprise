-- Module 4 seed: PR -> PO -> GRN + opening stock

-- Requisition
INSERT INTO erp_purchase_requisitions (company_id, requisition_no, status, notes, required_date)
SELECT c.id, 'PR-2026-0001', 'approved', 'Beer replenishment Nairobi', '2026-05-25'::date
FROM erp_companies c WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_purchase_requisitions r WHERE r.company_id = c.id AND r.requisition_no = 'PR-2026-0001');

INSERT INTO erp_purchase_requisition_lines (company_id, requisition_id, line_no, item_id, quantity, estimated_unit_cost, warehouse_id)
SELECT c.id, pr.id, 1, i.id, 800, 180, w.id
FROM erp_companies c
JOIN erp_purchase_requisitions pr ON pr.company_id = c.id AND pr.requisition_no = 'PR-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_purchase_requisition_lines l WHERE l.requisition_id = pr.id AND l.line_no = 1);

-- Purchase order
INSERT INTO erp_purchase_orders (
  company_id, vendor_id, warehouse_id, requisition_id, po_number, order_date, expected_date,
  status, subtotal, total_amount
)
SELECT c.id, v.id, w.id, pr.id, 'PO-2026-0001', '2026-05-18'::date, '2026-05-25'::date,
       'approved', 144000, 144000
FROM erp_companies c
JOIN erp_vendors v ON v.company_id = c.id AND v.vendor_code = 'V001'
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
LEFT JOIN erp_purchase_requisitions pr ON pr.company_id = c.id AND pr.requisition_no = 'PR-2026-0001'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_purchase_orders po WHERE po.company_id = c.id AND po.po_number = 'PO-2026-0001');

INSERT INTO erp_purchase_order_lines (company_id, purchase_order_id, line_no, item_id, quantity, unit_cost, line_total)
SELECT c.id, po.id, 1, i.id, 800, 180, 144000
FROM erp_companies c
JOIN erp_purchase_orders po ON po.company_id = c.id AND po.po_number = 'PO-2026-0001'
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.line_no = 1);

-- Posted GRN (partial receive 600 of 800)
INSERT INTO erp_goods_receipts (
  company_id, purchase_order_id, warehouse_id, grn_number, received_date, status, posted_at
)
SELECT c.id, po.id, w.id, 'GRN-2026-0001', '2026-05-19'::date, 'posted', NOW()
FROM erp_companies c
JOIN erp_purchase_orders po ON po.company_id = c.id AND po.po_number = 'PO-2026-0001'
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = 'WH-NRB'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_goods_receipts g WHERE g.company_id = c.id AND g.grn_number = 'GRN-2026-0001');

INSERT INTO erp_goods_receipt_lines (
  company_id, goods_receipt_id, po_line_id, line_no, item_id, quantity, unit_cost, batch_no, expiry_date
)
SELECT c.id, grn.id, pol.id, 1, i.id, 600, 180, 'BATCH-TSK-MAY26', '2026-08-15'::date
FROM erp_companies c
JOIN erp_goods_receipts grn ON grn.company_id = c.id AND grn.grn_number = 'GRN-2026-0001'
JOIN erp_purchase_orders po ON po.id = grn.purchase_order_id
JOIN erp_purchase_order_lines pol ON pol.purchase_order_id = po.id AND pol.line_no = 1
JOIN erp_items i ON i.id = pol.item_id
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_goods_receipt_lines l WHERE l.goods_receipt_id = grn.id AND l.line_no = 1);

UPDATE erp_purchase_order_lines pol
SET qty_received = 600
FROM erp_purchase_orders po
JOIN erp_companies c ON c.id = po.company_id AND c.code = 'MARTIN'
WHERE pol.purchase_order_id = po.id AND po.po_number = 'PO-2026-0001';

-- Stock from GRN + additional opening balances
INSERT INTO erp_stock_ledger (company_id, warehouse_id, item_id, movement_type, quantity, unit_cost, reference_type, reference_id, batch_no, expiry_date, movement_date)
SELECT c.id, w.id, i.id, 'receipt', 600, 180, 'goods_receipt', grn.id, 'BATCH-TSK-MAY26', '2026-08-15'::date, '2026-05-19'::timestamptz
FROM erp_companies c
JOIN erp_goods_receipts grn ON grn.company_id = c.id AND grn.grn_number = 'GRN-2026-0001'
JOIN erp_warehouses w ON w.id = grn.warehouse_id
JOIN erp_items i ON i.company_id = c.id AND i.item_code = 'TSK-500'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_stock_ledger sl WHERE sl.reference_type = 'goods_receipt' AND sl.reference_id = grn.id
  );

INSERT INTO erp_stock_on_hand (company_id, warehouse_id, item_id, quantity, avg_unit_cost, last_movement_at)
SELECT c.id, w.id, i.id, v.qty, v.cost, NOW()
FROM erp_companies c
CROSS JOIN (VALUES
  ('WH-NRB', 'TSK-500', 1240, 178),
  ('WH-NRB', 'GNS-500', 540, 220),
  ('WH-NRB', 'COKE-500', 3200, 40),
  ('WH-MBA', 'TSK-500', 670, 175)
) AS v(wh, sku, qty, cost)
JOIN erp_warehouses w ON w.company_id = c.id AND w.code = v.wh
JOIN erp_items i ON i.company_id = c.id AND i.item_code = v.sku
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_stock_on_hand s WHERE s.warehouse_id = w.id AND s.item_id = i.id
  );
