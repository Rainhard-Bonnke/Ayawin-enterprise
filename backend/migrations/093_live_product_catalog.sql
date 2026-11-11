CREATE TEMP TABLE phase8_live_products (
  item_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  brand TEXT NOT NULL,
  abv NUMERIC(5, 2) NOT NULL,
  pack_size TEXT NOT NULL,
  litres_per_unit NUMERIC(10, 3) NOT NULL,
  category_code TEXT NOT NULL,
  standard_cost NUMERIC(18, 4) NOT NULL,
  reorder_point NUMERIC(18, 4) NOT NULL,
  retail_price NUMERIC(18, 4) NOT NULL,
  wholesale_price NUMERIC(18, 4) NOT NULL,
  distributor_price NUMERIC(18, 4) NOT NULL
) ON COMMIT DROP;

INSERT INTO phase8_live_products VALUES
  ('4TH-750', 'Four Cousins Red 750ml', '6009880123451', 'Van Loveren', 8.00, '6x750ml', 0.750, 'WINE', 720, 40, 1050, 940, 840),
  ('ALV-500', 'Alvaro Pear 500ml', '5449000131837', 'Coca-Cola', 0, '12x500ml', 0.500, 'SOFT', 60, 200, 90, 80, 72),
  ('BLZ-500', 'Balozi Lager 500ml', '6161100012348', 'Keroche', 5.00, '24x500ml', 0.500, 'BEER', 160, 150, 230, 205, 185),
  ('COKE-500', 'Coca-Cola 500ml', '5449000000996', 'Coca-Cola', 0, '24x500ml', 0.500, 'SOFT', 40, 500, 70, 60, 52),
  ('DEL-1L', 'Delmonte Mango Juice 1L', '0024000162018', 'Delmonte', 0, '12x1L', 1.000, 'JUICE', 180, 80, 260, 230, 210),
  ('DSN-1L', 'Dasani Water 1L', '5449000054227', 'Coca-Cola', 0, '12x1L', 1.000, 'WATER', 45, 250, 70, 60, 52),
  ('FNT-500', 'Fanta Orange 500ml', '5449000050205', 'Coca-Cola', 0, '24x500ml', 0.500, 'SOFT', 40, 400, 70, 60, 52),
  ('GNS-500', 'Guinness Stout 500ml', '5000213000010', 'EABL', 7.50, '24x500ml', 0.500, 'BEER', 220, 100, 320, 290, 260),
  ('JW-BLK', 'Johnnie Walker Black 750ml', '5000267023748', 'Diageo', 40.00, '12x750ml', 0.750, 'SPIRITS', 3500, 30, 4800, 4400, 4100),
  ('JW-RED', 'Johnnie Walker Red 750ml', '5000267014206', 'Diageo', 40.00, '12x750ml', 0.750, 'SPIRITS', 1850, 50, 2600, 2350, 2150),
  ('KCP-750', 'Kingfisher Cape Wine 750ml', '6001108100123', 'KWV', 12.50, '6x750ml', 0.750, 'WINE', 850, 30, 1250, 1120, 1000),
  ('KMI-500', 'Keringet Mineral 500ml', '6161100099120', 'Keringet', 0, '24x500ml', 0.500, 'WATER', 25, 400, 50, 42, 35),
  ('KRS-300', 'Krest Bitter Lemon 300ml', '5449000131836', 'Coca-Cola', 0, '24x300ml', 0.300, 'SOFT', 35, 300, 55, 48, 42),
  ('OLM-750', 'Olmeca Tequila 750ml', '7501013005206', 'Pernod Ricard', 38.00, '12x750ml', 0.750, 'SPIRITS', 2200, 40, 3100, 2820, 2580),
  ('PIC-1L', 'Picana Pineapple 1L', '6161100200012', 'Kevian', 0, '12x1L', 1.000, 'JUICE', 130, 100, 200, 175, 155),
  ('RCH-750', 'Richot Brandy 750ml', '6001108055672', 'Distell', 43.00, '12x750ml', 0.750, 'SPIRITS', 950, 50, 1400, 1260, 1130),
  ('SMV-750', 'Smirnoff Vodka 750ml', '5410316430234', 'Diageo', 37.50, '12x750ml', 0.750, 'SPIRITS', 1200, 60, 1750, 1580, 1430),
  ('TSK-330', 'Tusker Cider 330ml', '6161100012346', 'EABL', 4.50, '24x330ml', 0.330, 'BEER', 150, 150, 220, 195, 175),
  ('TSK-500', 'Tusker Lager 500ml', '6161100012345', 'EABL', 4.20, '24x500ml', 0.500, 'BEER', 180, 200, 250, 220, 200),
  ('WCP-500', 'Whitecap Lager 500ml', '6161100012347', 'EABL', 4.50, '24x500ml', 0.500, 'BEER', 175, 200, 240, 215, 195);

DO $$
DECLARE
  target_company UUID;
  tax_group UUID;
  each_uom UUID;
  retail_list UUID;
  wholesale_list UUID;
  distributor_list UUID;
  item_count BIGINT;
  price_count BIGINT;
BEGIN
  SELECT id INTO target_company
  FROM erp_companies
  WHERE code = 'MARTIN' AND is_deleted = FALSE
  ORDER BY created_at
  LIMIT 1;

  IF target_company IS NULL THEN
    RAISE EXCEPTION 'ERP company MARTIN is required to seed the live product catalog';
  END IF;

  SELECT id INTO tax_group FROM erp_tax_groups
  WHERE company_id = target_company AND code = 'STD-VAT' AND is_deleted = FALSE LIMIT 1;
  SELECT id INTO each_uom FROM erp_uom
  WHERE company_id = target_company AND code = 'EA' AND is_deleted = FALSE LIMIT 1;

  INSERT INTO erp_price_lists (company_id, code, name, currency_code, is_default, is_active)
  VALUES
    (target_company, 'RETAIL-2026', 'Retail Price List 2026', 'KES', TRUE, TRUE),
    (target_company, 'WHOLESALE-LEGACY', 'Wholesale Price List', 'KES', FALSE, TRUE),
    (target_company, 'DISTRIBUTOR-LEGACY', 'Distributor Price List', 'KES', FALSE, TRUE)
  ON CONFLICT (company_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    currency_code = EXCLUDED.currency_code,
    is_default = EXCLUDED.is_default,
    is_active = TRUE,
    is_deleted = FALSE;

  SELECT id INTO retail_list FROM erp_price_lists
  WHERE company_id = target_company AND code = 'RETAIL-2026' AND is_deleted = FALSE;
  SELECT id INTO wholesale_list FROM erp_price_lists
  WHERE company_id = target_company AND code = 'WHOLESALE-LEGACY' AND is_deleted = FALSE;
  SELECT id INTO distributor_list FROM erp_price_lists
  WHERE company_id = target_company AND code = 'DISTRIBUTOR-LEGACY' AND is_deleted = FALSE;

  INSERT INTO erp_items (
    company_id, category_id, tax_group_id, uom_id, item_code, name, barcode,
    brand, abv, pack_size, litres_per_unit, cost_method, standard_cost,
    is_purchasable, is_saleable, is_stock_item, reorder_point, is_active
  )
  SELECT target_company, category.id, tax_group, each_uom, source.item_code, source.name,
         source.barcode, source.brand, source.abv, source.pack_size, source.litres_per_unit,
         'weighted_average', source.standard_cost, TRUE, TRUE, TRUE, source.reorder_point, TRUE
  FROM phase8_live_products source
  JOIN erp_item_categories category
    ON category.company_id = target_company
   AND category.code = source.category_code
   AND category.is_deleted = FALSE
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
    is_active = TRUE,
    is_deleted = FALSE,
    updated_at = NOW();

  INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price, min_qty)
  SELECT target_company, tier.price_list_id, item.id, tier.unit_price, 1
  FROM phase8_live_products source
  JOIN erp_items item ON item.company_id = target_company AND item.item_code = source.item_code
  CROSS JOIN LATERAL (VALUES
    (retail_list, source.retail_price),
    (wholesale_list, source.wholesale_price),
    (distributor_list, source.distributor_price)
  ) tier(price_list_id, unit_price)
  ON CONFLICT (price_list_id, item_id, min_qty) DO UPDATE SET
    unit_price = EXCLUDED.unit_price,
    is_deleted = FALSE,
    updated_at = NOW();

  SELECT COUNT(*) INTO item_count
  FROM phase8_live_products source
  JOIN erp_items item ON item.company_id = target_company AND item.item_code = source.item_code
    AND item.brand = source.brand AND item.pack_size = source.pack_size
    AND item.litres_per_unit = source.litres_per_unit AND item.is_deleted = FALSE;

  SELECT COUNT(*) INTO price_count
  FROM phase8_live_products source
  JOIN erp_items item ON item.company_id = target_company AND item.item_code = source.item_code
  JOIN erp_price_list_items pli ON pli.item_id = item.id AND pli.company_id = target_company
    AND pli.is_deleted = FALSE AND pli.min_qty = 1
  WHERE pli.price_list_id IN (retail_list, wholesale_list, distributor_list);

  IF item_count <> 20 OR price_count <> 60 THEN
    RAISE EXCEPTION 'Live product catalog validation failed: expected 20 items/60 prices, found % items/% prices', item_count, price_count;
  END IF;
END $$;