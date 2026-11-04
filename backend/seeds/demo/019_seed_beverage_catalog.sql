-- Expanded beverage catalog for sales, POS, procurement, and stock management.

INSERT INTO erp_item_categories (company_id, code, name)
SELECT c.id, v.code, v.name
FROM erp_companies c
CROSS JOIN (VALUES
  ('CIDER', 'Cider'),
  ('SPARKLING', 'Sparkling Wine'),
  ('RTD', 'Ready-to-Drink'),
  ('MALT', 'Malt Drinks'),
  ('ENERGY', 'Energy Drinks'),
  ('SPORTS', 'Sports Drinks'),
  ('MIXERS', 'Mixers'),
  ('COCKTAIL', 'Cocktails')
) AS v(code, name)
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_item_categories ic
    WHERE ic.company_id = c.id AND ic.code = v.code
  );

INSERT INTO erp_items (
  company_id, category_id, tax_group_id, uom_id, item_code, name,
  cost_method, standard_cost, reorder_point
)
SELECT c.id, cat.id, tg.id, uom.id, v.item_code, v.name,
       'weighted_average', v.cost, v.reorder_point
FROM erp_companies c
CROSS JOIN (VALUES
  ('WHI-500', 'White Cap Lager 500ml', 'BEER', 175, 150),
  ('PIL-500', 'Pilsner Lager 500ml', 'BEER', 165, 150),
  ('BAL-500', 'Balozi Lager 500ml', 'BEER', 155, 100),
  ('TUS-CAN', 'Tusker Lager 500ml Can', 'BEER', 185, 120),
  ('SMV-750', 'Savanna Dry Cider 750ml', 'CIDER', 260, 80),
  ('SOM-330', 'Somersby Apple Cider 330ml', 'CIDER', 145, 100),
  ('KWV-750', 'KWV Classic Red Wine 750ml', 'WINE', 650, 50),
  ('FOU-750', 'Four Cousins Sweet Red 750ml', 'WINE', 520, 50),
  ('PRO-750', 'Prosecco Sparkling Wine 750ml', 'SPARKLING', 1200, 25),
  ('JW-BLK', 'Johnnie Walker Black Label 750ml', 'SPIRITS', 3200, 25),
  ('SMN-750', 'Smirnoff Vodka 750ml', 'SPIRITS', 1350, 40),
  ('GIL-750', 'Gordon''s London Dry Gin 750ml', 'SPIRITS', 1550, 35),
  ('BCR-750', 'Baileys Irish Cream 750ml', 'SPIRITS', 2600, 20),
  ('VOD-750', 'Kenya Cane Vodka 750ml', 'SPIRITS', 850, 40),
  ('BAC-275', 'Bacardi Breezer 275ml', 'RTD', 170, 100),
  ('SMR-330', 'Smirnoff Ice 330ml', 'RTD', 180, 100),
  ('MAL-300', 'Mala Fermented Milk 300ml', 'MALT', 55, 100),
  ('MALT-300', 'Malt Guinness 300ml', 'MALT', 95, 100),
  ('RED-250', 'Red Bull Energy Drink 250ml', 'ENERGY', 130, 100),
  ('MON-355', 'Monster Energy Drink 355ml', 'ENERGY', 180, 80),
  ('VIT-500', 'Keringet Vitamin Water 500ml', 'SPORTS', 75, 100),
  ('POW-500', 'Powerade Sports Drink 500ml', 'SPORTS', 110, 80),
  ('SCH-300', 'Schweppes Tonic Water 300ml', 'MIXERS', 65, 100),
  ('SCH-300G', 'Schweppes Ginger Ale 300ml', 'MIXERS', 65, 100),
  ('PEP-500', 'Pepsi 500ml', 'SOFT', 40, 300),
  ('FAN-500', 'Fanta Orange 500ml', 'SOFT', 40, 300),
  ('SPR-500', 'Sprite 500ml', 'SOFT', 40, 300),
  ('MIR-500', 'Mirinda Orange 500ml', 'SOFT', 38, 250),
  ('MAN-1L', 'Mango Juice 1L', 'JUICE', 140, 120),
  ('ORA-1L', 'Orange Juice 1L', 'JUICE', 150, 120),
  ('APP-1L', 'Apple Juice 1L', 'JUICE', 160, 100),
  ('AQU-500', 'Aquamist Water 500ml', 'WATER', 22, 500),
  ('AQU-1L', 'Aquamist Water 1L', 'WATER', 35, 350)
) AS v(item_code, name, cat_code, cost, reorder_point)
JOIN erp_item_categories cat ON cat.company_id = c.id AND cat.code = v.cat_code
JOIN erp_tax_groups tg ON tg.company_id = c.id AND tg.code = 'STD-VAT'
JOIN erp_uom uom ON uom.company_id = c.id AND uom.code = 'EA'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_items i
    WHERE i.company_id = c.id AND i.item_code = v.item_code
  );
