ALTER TABLE erp_items
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS abv NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS pack_size TEXT,
  ADD COLUMN IF NOT EXISTS litres_per_unit NUMERIC(10, 3);

DO $$
DECLARE
  target_company UUID;
  standard_tax_group UUID;
  each_uom UUID;
  retail_price_list UUID;
  wholesale_price_list UUID;
  distributor_price_list UUID;
  product_count BIGINT;
  mapped_count BIGINT;
  price_count BIGINT;
  legacy_table TEXT;
  legacy_tables TEXT[] := ARRAY[
    'roles', 'users', 'categories', 'products', 'warehouses', 'customers', 'suppliers',
    'stock_movements', 'sales_orders', 'sales_order_items', 'invoices', 'invoice_items',
    'payments', 'purchase_orders', 'purchase_order_items', 'grns', 'deliveries',
    'employees', 'payroll', 'accounts', 'journal_entries', 'taxes', 'audit_logs'
  ];
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    FOREACH legacy_table IN ARRAY legacy_tables LOOP
      IF to_regclass(format('public.%I', legacy_table)) IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy table public.% exists but the products source is missing; refusing cleanup', legacy_table;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  ALTER TABLE erp_items
    ADD COLUMN IF NOT EXISTS brand TEXT,
    ADD COLUMN IF NOT EXISTS abv NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS pack_size TEXT,
    ADD COLUMN IF NOT EXISTS litres_per_unit NUMERIC(10, 3);

  SELECT id INTO target_company
  FROM erp_companies
  WHERE code = 'MARTIN' AND is_deleted = FALSE
  ORDER BY created_at
  LIMIT 1;

  IF target_company IS NULL THEN
    RAISE EXCEPTION 'ERP company MARTIN was not found; refusing to migrate the real product catalog';
  END IF;

  IF EXISTS (SELECT 1 FROM products WHERE NULLIF(BTRIM(sku), '') IS NULL OR NULLIF(BTRIM(name), '') IS NULL) THEN
    RAISE EXCEPTION 'Legacy product catalog has a blank SKU or name; resolve it before cleanup';
  END IF;

  IF EXISTS (SELECT 1 FROM products GROUP BY BTRIM(sku) HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Legacy product catalog has duplicate SKUs; resolve them before cleanup';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1
      FROM erp_item_categories c
      WHERE c.company_id = target_company
        AND c.is_deleted = FALSE
        AND c.code = CASE BTRIM(p.category)
          WHEN 'Beer' THEN 'BEER'
          WHEN 'Spirits' THEN 'SPIRITS'
          WHEN 'Wine' THEN 'WINE'
          WHEN 'Soft Drinks' THEN 'SOFT'
          WHEN 'Water' THEN 'WATER'
          WHEN 'Juice' THEN 'JUICE'
          ELSE NULL
        END
    )
  ) THEN
    RAISE EXCEPTION 'A legacy product category has no ERP category mapping; refusing to discard product data';
  END IF;

  SELECT id INTO standard_tax_group
  FROM erp_tax_groups
  WHERE company_id = target_company AND code = 'STD-VAT' AND is_deleted = FALSE
  LIMIT 1;

  SELECT id INTO each_uom
  FROM erp_uom
  WHERE company_id = target_company AND code = 'EA' AND is_deleted = FALSE
  LIMIT 1;

  SELECT id INTO retail_price_list
  FROM erp_price_lists
  WHERE company_id = target_company AND is_default = TRUE AND is_active = TRUE AND is_deleted = FALSE
  ORDER BY created_at
  LIMIT 1;

  IF retail_price_list IS NULL THEN
    INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default, is_active)
    VALUES (target_company, 'RETAIL-LEGACY', 'Retail Price List', 'KES', TRUE, TRUE)
    ON CONFLICT (company_id, code) DO UPDATE SET
      name = EXCLUDED.name, currency_code = EXCLUDED.currency_code,
      is_default = TRUE, is_active = TRUE, is_deleted = FALSE
    RETURNING id INTO retail_price_list;
  END IF;

  INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default, is_active)
  VALUES
    (target_company, 'WHOLESALE-LEGACY', 'Wholesale Price List', 'KES', FALSE, TRUE),
    (target_company, 'DISTRIBUTOR-LEGACY', 'Distributor Price List', 'KES', FALSE, TRUE)
  ON CONFLICT (company_id, code) DO UPDATE SET
    name = EXCLUDED.name, currency_code = EXCLUDED.currency_code,
    is_default = FALSE, is_active = TRUE, is_deleted = FALSE;

  SELECT id INTO wholesale_price_list
  FROM erp_price_lists
  WHERE company_id = target_company AND code = 'WHOLESALE-LEGACY' AND is_deleted = FALSE;

  SELECT id INTO distributor_price_list
  FROM erp_price_lists
  WHERE company_id = target_company AND code = 'DISTRIBUTOR-LEGACY' AND is_deleted = FALSE;

  SELECT COUNT(*) INTO product_count FROM products;

  INSERT INTO erp_items (
    company_id, category_id, tax_group_id, uom_id, item_code, name, barcode,
    brand, abv, pack_size, litres_per_unit, cost_method, standard_cost,
    is_purchasable, is_saleable, is_stock_item, reorder_point, is_active, is_deleted
  )
  SELECT target_company, category.id, standard_tax_group, each_uom, BTRIM(p.sku), BTRIM(p.name),
         NULLIF(BTRIM(p.barcode), ''), NULLIF(BTRIM(p.brand), ''), p.abv,
         NULLIF(BTRIM(p.pack_size), ''), p.litres_per_unit, 'weighted_average',
         COALESCE(p.cost_price, 0), TRUE, TRUE, TRUE, COALESCE(p.min_stock, 0),
         LOWER(COALESCE(p.status, 'active')) = 'active', FALSE
  FROM products p
  JOIN erp_item_categories category
    ON category.company_id = target_company
   AND category.is_deleted = FALSE
   AND category.code = CASE BTRIM(p.category)
     WHEN 'Beer' THEN 'BEER'
     WHEN 'Spirits' THEN 'SPIRITS'
     WHEN 'Wine' THEN 'WINE'
     WHEN 'Soft Drinks' THEN 'SOFT'
     WHEN 'Water' THEN 'WATER'
     WHEN 'Juice' THEN 'JUICE'
   END
  ON CONFLICT (company_id, item_code) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    tax_group_id = COALESCE(erp_items.tax_group_id, EXCLUDED.tax_group_id),
    uom_id = COALESCE(erp_items.uom_id, EXCLUDED.uom_id),
    name = EXCLUDED.name,
    barcode = EXCLUDED.barcode,
    brand = EXCLUDED.brand,
    abv = EXCLUDED.abv,
    pack_size = EXCLUDED.pack_size,
    litres_per_unit = EXCLUDED.litres_per_unit,
    standard_cost = EXCLUDED.standard_cost,
    reorder_point = EXCLUDED.reorder_point,
    is_active = EXCLUDED.is_active,
    is_deleted = FALSE,
    updated_at = NOW();

  SELECT COUNT(*) INTO mapped_count
  FROM products p
  JOIN erp_items i ON i.company_id = target_company AND i.item_code = BTRIM(p.sku) AND i.is_deleted = FALSE
  JOIN erp_item_categories c ON c.id = i.category_id AND c.company_id = target_company;

  IF mapped_count <> product_count THEN
    RAISE EXCEPTION 'Product migration count mismatch: source %, mapped %', product_count, mapped_count;
  END IF;

  INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price, min_qty)
  SELECT target_company, price_list.id, item.id, source.price, 1
  FROM products p
  JOIN erp_items item ON item.company_id = target_company AND item.item_code = BTRIM(p.sku) AND item.is_deleted = FALSE
  CROSS JOIN (VALUES
    (retail_price_list, 'retail'::TEXT),
    (wholesale_price_list, 'wholesale'::TEXT),
    (distributor_price_list, 'distributor'::TEXT)
  ) tier(price_list_id, tier_name)
  JOIN erp_price_lists price_list ON price_list.id = tier.price_list_id
  CROSS JOIN LATERAL (
    SELECT CASE tier.tier_name
      WHEN 'retail' THEN COALESCE(p.retail_price, p.unit_price)
      WHEN 'wholesale' THEN p.wholesale_price
      WHEN 'distributor' THEN p.distributor_price
    END AS price
  ) source
  WHERE source.price IS NOT NULL
  ON CONFLICT (price_list_id, item_id, min_qty) DO UPDATE SET
    unit_price = EXCLUDED.unit_price,
    is_deleted = FALSE,
    updated_at = NOW();

  SELECT COUNT(*) INTO price_count
  FROM erp_price_list_items pli
  JOIN erp_items i ON i.id = pli.item_id AND i.company_id = target_company
  WHERE pli.company_id = target_company
    AND pli.price_list_id IN (retail_price_list, wholesale_price_list, distributor_price_list)
    AND pli.is_deleted = FALSE
    AND EXISTS (SELECT 1 FROM products p WHERE BTRIM(p.sku) = i.item_code);

  IF price_count <> product_count * 3 THEN
    RAISE EXCEPTION 'Product price migration count mismatch: expected %, found %', product_count * 3, price_count;
  END IF;
END $$;

DROP TABLE IF EXISTS
  sales_order_items,
  invoice_items,
  purchase_order_items,
  payments,
  deliveries,
  invoices,
  sales_orders,
  grns,
  purchase_orders,
  stock_movements,
  payroll,
  employees,
  journal_entries,
  audit_logs,
  customers,
  suppliers,
  products,
  warehouses,
  categories,
  users,
  roles,
  accounts,
  taxes
CASCADE;