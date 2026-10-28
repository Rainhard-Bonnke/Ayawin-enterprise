INSERT INTO erp_goods_receipt_lot_links (company_id, goods_receipt_line_id, lot_id, quantity_received)
SELECT gl.company_id, gl.id, l.id, gl.quantity
FROM erp_goods_receipt_lines gl
JOIN erp_goods_receipts gr ON gr.id = gl.goods_receipt_id AND gr.company_id = gl.company_id
JOIN erp_items i ON i.id = gl.item_id AND i.company_id = gl.company_id AND i.lot_tracking_enabled = TRUE
JOIN erp_inventory_lots l ON l.company_id = gl.company_id AND l.warehouse_id = gr.warehouse_id
  AND l.item_id = gl.item_id AND l.batch_no = BTRIM(gl.batch_no) AND l.expiry_date = gl.expiry_date
WHERE gl.is_deleted = FALSE AND gr.status = 'posted'
  AND gl.batch_no IS NOT NULL AND gl.expiry_date IS NOT NULL
ON CONFLICT (goods_receipt_line_id) DO NOTHING;
