-- Sales rep, line discounts, tiered price lists

ALTER TABLE erp_sales_orders
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES erp_users (id);

ALTER TABLE erp_sales_order_lines
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(8, 4) NOT NULL DEFAULT 0;

UPDATE erp_sales_orders so
SET sales_rep_id = so.created_by
WHERE so.sales_rep_id IS NULL AND so.created_by IS NOT NULL;

INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default)
SELECT c.id, 'WHOLESALE-2026', 'Wholesale Price List 2026', 'KES', FALSE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_price_lists pl WHERE pl.company_id = c.id AND pl.code = 'WHOLESALE-2026');

INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default)
SELECT c.id, 'DIST-2026', 'Distributor Price List 2026', 'KES', FALSE
FROM erp_companies c
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (SELECT 1 FROM erp_price_lists pl WHERE pl.company_id = c.id AND pl.code = 'DIST-2026');

INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price)
SELECT pl.company_id, pl.id, i.id, ROUND(v.price * 0.92, 2)
FROM erp_price_lists pl
JOIN erp_companies c ON c.id = pl.company_id AND c.code = 'MARTIN'
JOIN erp_items i ON i.company_id = c.id
JOIN (VALUES
  ('TSK-500', 250), ('GNS-500', 320), ('JW-RED', 2600), ('COKE-500', 70), ('DSN-1L', 70)
) AS v(sku, price) ON i.item_code = v.sku
WHERE pl.code = 'WHOLESALE-2026'
  AND NOT EXISTS (
    SELECT 1 FROM erp_price_list_items x WHERE x.price_list_id = pl.id AND x.item_id = i.id
  );

INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price)
SELECT pl.company_id, pl.id, i.id, ROUND(v.price * 0.85, 2)
FROM erp_price_lists pl
JOIN erp_companies c ON c.id = pl.company_id AND c.code = 'MARTIN'
JOIN erp_items i ON i.company_id = c.id
JOIN (VALUES
  ('TSK-500', 250), ('GNS-500', 320), ('JW-RED', 2600), ('COKE-500', 70), ('DSN-1L', 70)
) AS v(sku, price) ON i.item_code = v.sku
WHERE pl.code = 'DIST-2026'
  AND NOT EXISTS (
    SELECT 1 FROM erp_price_list_items x WHERE x.price_list_id = pl.id AND x.item_id = i.id
  );
